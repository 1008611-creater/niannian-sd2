import { createId, dbRun, timestamp } from "@/lib/auth";
import {
  MAX_BILLABLE_DURATION_SECONDS,
  MIN_BILLABLE_DURATION_SECONDS,
  refundTaskCredits,
  reserveTaskCredits,
} from "@/lib/credits";
import { createZiyuJob, type ZiyuJobInput } from "@/lib/ziyu-api";

/**
 * 紫域下单的落库 + 计费封装。
 *
 * 为什么要它：原来 `POST /api/ziyu/jobs` 只校验登录就直接打渠道，
 * 既不写 video_tasks（出完片没记录、失败无法重试、无法对账），
 * 也不碰积分（余额 0 也能无限出片，成本裸奔）。
 *
 * 顺序（先落库、再扣费、最后打渠道）：
 *   1. 写 video_tasks 意图记录 —— 就算后面挂了，也留下"谁在什么时候想出什么片"；
 *   2. reserveTaskCredits —— 余额不足直接 402，**不碰渠道**（关键：不能先花钱再发现没钱）；
 *   3. createZiyuJob —— 真正提交；
 *   4. 失败 → refundTaskCredits（策略：只要没拿到片就全退）+ 任务标记 failed。
 */

export class ZiyuBillingError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ZiyuBillingError";
  }
}

const DEFAULT_DURATION_SECONDS = 10;

/**
 * t2i（文生图）没有时长概念，不能按视频秒数计费，否则明显多收。
 * 这里按最小视频档（5 秒 = 30 积分 = 0.3 元）计价。
 * ⚠️ 这是拍脑袋的缺省值，紫域 t2i 的真实点数成本未知，需要老大按实际账单校准。
 */
export const T2I_BILLING_DURATION_SECONDS = 5;

/** 把任意入参收敛到可计费区间，避免 taskCreditCost 抛 CREDIT_QUOTE_INVALID 把用户挡死。 */
export function resolveDurationSeconds(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed)) return DEFAULT_DURATION_SECONDS;
  return Math.min(MAX_BILLABLE_DURATION_SECONDS, Math.max(MIN_BILLABLE_DURATION_SECONDS, parsed));
}

export type BilledZiyuJobInput = {
  userId: string;
  job: ZiyuJobInput;
  durationSeconds: number;
  aspectRatio: string;
  modelLabel: string;
};

async function updateTask(
  taskId: string,
  patch: { status: string; blocker?: string | null; providerTaskId?: string | null; submitAllowed?: number; costAuthorized?: number },
) {
  await dbRun(
    `UPDATE video_tasks
        SET status = ?, blocker = ?, provider_task_id = ?, submit_allowed = ?, cost_authorized = ?, updated_at = ?
      WHERE id = ?`,
    [
      patch.status,
      patch.blocker ?? null,
      patch.providerTaskId ?? null,
      patch.submitAllowed ?? 0,
      patch.costAuthorized ?? 0,
      timestamp(),
      taskId,
    ],
  );
}

export async function submitBilledZiyuJob(input: BilledZiyuJobInput) {
  const taskId = createId();
  const createdAt = timestamp();
  const prompt = input.job.prompt;
  const assetManifest = JSON.stringify(input.job.assets ?? {});
  // 文生图没有时长，走固定档计费；其余模式按实际/兜底时长计费。
  const durationSeconds =
    input.job.mode === "t2i" ? T2I_BILLING_DURATION_SECONDS : input.durationSeconds;

  await dbRun(
    `INSERT INTO video_tasks (
       id, user_id, execution_mode, channel, prompt, model, resolution, duration_seconds,
       aspect_ratio, asset_manifest, task_spec_path, status, blocker, provider_task_id,
       output_path, submit_allowed, cost_authorized, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      taskId,
      input.userId,
      "automatic",
      "ziyu",
      prompt,
      input.modelLabel,
      "auto",
      durationSeconds,
      input.aspectRatio,
      assetManifest,
      `ziyu://job/${taskId}`,
      "prepared",
      null,
      null,
      null,
      0,
      0,
      createdAt,
      createdAt,
    ],
  );

  try {
    await reserveTaskCredits({
      userId: input.userId,
      taskId,
      serviceMode: "automatic",
      durationSeconds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CREDITS_RESERVATION_FAILED";
    await updateTask(taskId, { status: "failed", blocker: message }).catch(() => undefined);
    throw new ZiyuBillingError(message === "CREDITS_INSUFFICIENT" ? 402 : 503, message);
  }

  try {
    const result = await createZiyuJob(input.job);
    await updateTask(taskId, {
      status: "queued_server",
      blocker: null,
      providerTaskId: result.job?.id ?? null,
      submitAllowed: 1,
      costAuthorized: 1,
    }).catch(() => undefined);
    return result;
  } catch (error) {
    // 策略：只要没拿到片就全退（含内容审核拦截）。渠道侧成本由我们承担。
    await refundTaskCredits(taskId).catch(() => undefined);
    const message = error instanceof Error ? error.message : "ZIYU_JOB_CREATE_FAILED";
    await updateTask(taskId, { status: "failed", blocker: message.slice(0, 500) }).catch(() => undefined);
    throw error;
  }
}
