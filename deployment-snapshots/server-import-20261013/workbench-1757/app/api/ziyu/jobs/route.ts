import { NextRequest, NextResponse } from "next/server";
import { authCookie, sessionFromToken, validRequestOrigin } from "@/lib/auth";
import { listZiyuJobs, listZiyuModels, ZiyuApiError } from "@/lib/ziyu-api";
import { resolveDurationSeconds, submitBilledZiyuJob, ZiyuBillingError } from "@/lib/ziyu-billing";
import { ziyuPromptMaxLength } from "@/lib/ziyu-contract";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
    return NextResponse.json(await listZiyuJobs(Number.isFinite(limit) ? limit : 50));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "ZIYU_JOBS_LIST_FAILED" }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    const body = await request.json();
    const mode = body?.mode;
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!["i2v", "t2v", "t2i"].includes(mode) || !prompt) return NextResponse.json({ error: "JOB_REQUEST_INVALID" }, { status: 400 });
    let promptLimit = ziyuPromptMaxLength(undefined);
    let modelLabel = typeof body?.modelId === "string" && body.modelId ? body.modelId : "ziyu-default";
    // 未显式传时长时，按模型支持的第一档计费，避免"按 10 秒扣钱、渠道按 5 秒出片"。
    let modelDefaultDuration: number | undefined;
    if (body.modelId) {
      const model = (await listZiyuModels()).find((item) => item.id === body.modelId);
      if (!model || !model.modes.includes(mode)) return NextResponse.json({ error: "MODEL_MODE_NOT_ALLOWED" }, { status: 400 });
      promptLimit = ziyuPromptMaxLength(model.promptMaxLength);
      modelLabel = model.id;
      const first = Array.isArray(model.allowedDurations) ? Number(model.allowedDurations[0]) : Number.NaN;
      if (Number.isInteger(first)) modelDefaultDuration = first;
      if (body.duration && model.allowedDurations.length && !model.allowedDurations.includes(Number.parseInt(String(body.duration), 10))) return NextResponse.json({ error: "DURATION_NOT_ALLOWED" }, { status: 400 });
      if (body.ratio && model.allowedRatios.length && !model.allowedRatios.includes(String(body.ratio))) return NextResponse.json({ error: "RATIO_NOT_ALLOWED" }, { status: 400 });
      const requestedAssets = body.assets && typeof body.assets === "object" ? body.assets as Record<string, unknown> : {};
      const assetTypes = ["image", "video", "audio"] as const;
      if (mode === "t2v" && assetTypes.some((type) => Array.isArray(requestedAssets[type]) && requestedAssets[type].length > 0)) {
        return NextResponse.json({ error: "TEXT_TO_VIDEO_DOES_NOT_ACCEPT_ASSETS" }, { status: 400 });
      }
      for (const type of assetTypes) {
        const entries = Array.isArray(requestedAssets[type]) ? requestedAssets[type] : [];
        if (entries.length && !model.allowedAssetTypes.includes(type)) return NextResponse.json({ error: `ASSET_TYPE_NOT_ALLOWED:${type}` }, { status: 400 });
        const limit = model.assetLimits[type];
        if (typeof limit === "number" && entries.length > limit) return NextResponse.json({ error: `ASSET_LIMIT_EXCEEDED:${type}` }, { status: 400 });
      }
    }
    if (prompt.length > promptLimit) return NextResponse.json({ error: "PROMPT_TOO_LONG" }, { status: 400 });
    // 落库 + 计费 + 提交：余额不足会在打渠道之前被拦下（402），失败自动全额退款。
    const result = await submitBilledZiyuJob({
      userId: user.id,
      job: {
        modelId: typeof body.modelId === "string" ? body.modelId : undefined,
        mode,
        prompt,
        ratio: typeof body.ratio === "string" ? body.ratio : undefined,
        duration: typeof body.duration === "string" ? body.duration : undefined,
        assets: body.assets,
      },
      durationSeconds: resolveDurationSeconds(body?.duration ?? modelDefaultDuration),
      aspectRatio: typeof body.ratio === "string" && body.ratio ? body.ratio : "16:9",
      modelLabel,
    });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    if (error instanceof ZiyuBillingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const status = error instanceof ZiyuApiError && [400, 402, 403, 429].includes(error.status) ? error.status : 502;
    return NextResponse.json({ error: error instanceof Error ? error.message : "ZIYU_JOB_CREATE_FAILED" }, { status });
  }
}
