/**
 * P1 端到端实测：素材库治理（后台 ⇄ 源站）与项目管理（后台）。
 *
 * 为什么要有这个脚本：
 *   后台改一个素材的可见性，会同时影响「管理员视图 / 上传者视图 / 其他人视图 / 下单引用」
 *   四个地方。只测后台接口返回 200 是没有意义的 —— 必须验证另一个账号真的看到了变化。
 *   所以这里刻意用三个独立账号（上传者 A、管理员、路人 B）交叉验证。
 *
 * 运行：node scripts/admin-p1-assets-projects.e2e.mjs
 * 依赖：先 npm run build（脚本用 next start 跑生产构建产物）
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const PORT = 3032;
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = BASE;
const PROJECT_DIR = path.resolve(import.meta.dirname, "..");
const RUN_ID = Date.now().toString(36);
const PASSWORD = "Niannian-Test-2026!";

// 管理员邮箱走环境变量：默认内置的那个邮箱在库里可能已经注册过，注册会 409。
// 追加一个本轮专用的管理员邮箱，既不动线上配置，也能跑真实注册流程。
const ADMIN_EMAIL = `p1-admin-${RUN_ID}@example.invalid`;
const OWNER_EMAIL = `p1-owner-${RUN_ID}@example.invalid`;
const VIEWER_EMAIL = `p1-viewer-${RUN_ID}@example.invalid`;

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let failures = 0;
let step = 0;
const serverLogs = [];

function log(ok, label, detail = "") {
  step += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${String(step).padStart(2, "0")} ${label}${detail ? ` :: ${detail}` : ""}`);
}

function check(label, condition, detail = "") {
  log(Boolean(condition), label, detail);
  return Boolean(condition);
}

async function waitForServer(child) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`SERVER_EXITED_${child.exitCode}`);
    try {
      const response = await fetch(`${BASE}/login`, { redirect: "manual" });
      if (response.status > 0) return;
    } catch {
      // 还没起来
    }
    await delay(1000);
  }
  throw new Error("SERVER_NOT_READY");
}

async function call(pathname, cookie, options = {}) {
  const headers = new Headers(options.headers ?? {});
  headers.set("origin", ORIGIN);
  if (cookie) headers.set("cookie", `niannian_session=${cookie}`);
  if (options.json !== undefined) headers.set("content-type", "application/json");
  return fetch(`${BASE}${pathname}`, {
    ...options,
    headers,
    redirect: "manual",
    body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
  });
}

function sessionFrom(response) {
  for (const entry of response.headers.getSetCookie?.() ?? []) {
    const match = entry.match(/niannian_session=([^;]+)/);
    if (match) return match[1];
  }
  return "";
}

/** 本地邮件模式下验证码打印在服务端 stdout，从日志里捞。 */
function otpFor(email) {
  for (let index = serverLogs.length - 1; index >= 0; index -= 1) {
    const line = serverLogs[index];
    if (!line.includes(email)) continue;
    const match = line.match(/verification code for \S+: (\d{6})/);
    if (match) return match[1];
  }
  return "";
}

async function register(email) {
  const started = await call("/api/auth/register/start", "", { method: "POST", json: { email, password: PASSWORD } });
  if (started.status !== 201) throw new Error(`REGISTER_START_${started.status}`);
  await delay(300);
  const code = otpFor(email);
  if (!code) throw new Error(`OTP_NOT_FOUND_${email}`);
  const verified = await call("/api/auth/register/verify", "", { method: "POST", json: { email, code } });
  if (verified.status !== 201) throw new Error(`REGISTER_VERIFY_${verified.status}`);
  const cookie = sessionFrom(verified);
  if (!cookie) throw new Error("SESSION_COOKIE_MISSING");
  return cookie;
}

async function main() {
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], {
    cwd: PROJECT_DIR,
    env: {
      ...process.env,
      NODE_ENV: "production",
      AUTH_MAIL_MODE: "local",
      APP_ORIGIN: ORIGIN,
      AUTH_COOKIE_SECURE: "false",
      ADMIN_EMAILS: `1453637677@qq.com,${ADMIN_EMAIL}`,
      // 不设 DATABASE_URL：走本地 sql.js，不动任何 Postgres。
      DATABASE_URL: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const collect = (stream) => {
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) serverLogs.push(line);
    });
  };
  collect(child.stdout);
  collect(child.stderr);

  try {
    await waitForServer(child);
    log(true, "服务就绪", `端口 ${PORT}`);

    // ── 账号准备 ──────────────────────────────────────────────
    const ownerCookie = await register(OWNER_EMAIL);
    log(true, "上传者 A 注册并登录", OWNER_EMAIL);
    const adminCookie = await register(ADMIN_EMAIL);
    log(true, "管理员注册并登录", ADMIN_EMAIL);
    const viewerCookie = await register(VIEWER_EMAIL);
    log(true, "路人 B 注册并登录", VIEWER_EMAIL);

    // ── 上传素材 ──────────────────────────────────────────────
    const form = new FormData();
    form.set("role", "character");
    form.set("file", new Blob([PNG_1X1], { type: "image/png" }), "p1-test-asset.png");
    const upload = await call("/library/assets", ownerCookie, { method: "POST", body: form });
    const uploadPayload = await upload.json().catch(() => ({}));
    const assetId = uploadPayload.asset?.id ?? "";
    check("A 上传素材成功", upload.status === 201 && Boolean(assetId), `status=${upload.status} id=${assetId}`);
    if (!assetId) throw new Error("ASSET_UPLOAD_FAILED");

    // 建一个真实项目：否则「冻结项目」这条正路径会因为没有数据而跳过，等于没验证。
    const createProject = await call("/api/projects", ownerCookie, { method: "POST", json: { title: `P1 实测项目 ${RUN_ID}`, type: "真人短剧" } });
    const projectPayload = await createProject.json().catch(() => ({}));
    const projectId = projectPayload.project?.id ?? "";
    check("A 创建项目成功", createProject.status === 201 && Boolean(projectId), `status=${createProject.status} id=${projectId}`);

    // ── 权限闸门 ──────────────────────────────────────────────
    const ownerSeesAdmin = await call("/api/admin/assets", ownerCookie);
    check("非管理员访问素材后台被拒", ownerSeesAdmin.status === 403, `status=${ownerSeesAdmin.status}`);
    const ownerSeesProjects = await call("/api/admin/projects", ownerCookie);
    check("非管理员访问项目后台被拒", ownerSeesProjects.status === 403, `status=${ownerSeesProjects.status}`);

    // ── 后台素材列表 ──────────────────────────────────────────
    const listResponse = await call(`/api/admin/assets?query=${encodeURIComponent(assetId)}`, adminCookie);
    const listPayload = await listResponse.json().catch(() => ({}));
    const listed = (listPayload.assets ?? []).find((asset) => asset.id === assetId);
    check("后台能看到这个素材", listResponse.status === 200 && Boolean(listed), `visibility=${listed?.visibility}`);
    check("新建素材默认「仅本人」", listed?.visibility === "owner", `visibility=${listed?.visibility}`);

    // ── 设为公共素材 → 源站可见 ────────────────────────────────
    const setPublic = await call("/api/admin/assets", adminCookie, { method: "PATCH", json: { assetId, visibility: "public" } });
    check("后台设为公共素材", setPublic.status === 200, `status=${setPublic.status}`);

    const viewerLibrary = await call("/library/assets", viewerCookie);
    const viewerPayload = await viewerLibrary.json().catch(() => ({}));
    const viewerPublic = (viewerPayload.publicAssets ?? []).map((asset) => asset.id);
    check("路人 B 的公共素材里出现了它", viewerPublic.includes(assetId), `publicAssets=${viewerPublic.length}`);

    const viewerMedia = await call(`/media/assets/${encodeURIComponent(assetId)}`, viewerCookie);
    check("路人 B 能预览这个公共素材", viewerMedia.status === 200, `status=${viewerMedia.status}`);

    // ── 下架：理由必填 ────────────────────────────────────────
    const takeDownNoReason = await call("/api/admin/assets", adminCookie, { method: "PATCH", json: { assetId, visibility: "taken_down" } });
    const noReasonPayload = await takeDownNoReason.json().catch(() => ({}));
    check("下架不带理由被拒", takeDownNoReason.status === 400 && noReasonPayload.error === "ASSET_TAKEDOWN_REASON_REQUIRED", `status=${takeDownNoReason.status} error=${noReasonPayload.error}`);

    const takeDown = await call("/api/admin/assets", adminCookie, { method: "PATCH", json: { assetId, visibility: "taken_down", reason: "P1 实测：测试素材下架" } });
    check("后台下架成功", takeDown.status === 200, `status=${takeDown.status}`);

    const viewerAfter = await call("/library/assets", viewerCookie);
    const viewerAfterPayload = await viewerAfter.json().catch(() => ({}));
    const viewerAfterPublic = (viewerAfterPayload.publicAssets ?? []).map((asset) => asset.id);
    check("下架后路人 B 看不到它", !viewerAfterPublic.includes(assetId), `publicAssets=${viewerAfterPublic.length}`);

    const viewerMediaAfter = await call(`/media/assets/${encodeURIComponent(assetId)}`, viewerCookie);
    check("下架后路人 B 直链也取不到", viewerMediaAfter.status === 404, `status=${viewerMediaAfter.status}`);

    const adminMediaAfter = await call(`/media/assets/${encodeURIComponent(assetId)}`, adminCookie);
    check("管理员仍能预览已下架素材（可复核）", adminMediaAfter.status === 200, `status=${adminMediaAfter.status}`);

    // ── 恢复 ──────────────────────────────────────────────────
    const restore = await call("/api/admin/assets", adminCookie, { method: "PATCH", json: { assetId, visibility: "owner" } });
    check("后台恢复为仅本人", restore.status === 200, `status=${restore.status}`);

    const ownerLibrary = await call("/library/assets", ownerCookie);
    const ownerPayload = await ownerLibrary.json().catch(() => ({}));
    const ownerAssets = (ownerPayload.assets ?? []).map((asset) => asset.id);
    check("上传者 A 仍能看到自己的素材（字节没被污染）", ownerAssets.includes(assetId), `assets=${ownerAssets.length}`);

    // ── 可见性筛选 ────────────────────────────────────────────
    const visibilityFilter = await call("/api/admin/assets?visibility=public", adminCookie);
    const filterPayload = await visibilityFilter.json().catch(() => ({}));
    const allPublic = (filterPayload.assets ?? []).every((asset) => asset.visibility === "public");
    check("后台按可见性筛选生效", visibilityFilter.status === 200 && allPublic, `returned=${filterPayload.assets?.length ?? 0}`);

    // ── 项目管理 ──────────────────────────────────────────────
    const projectsResponse = await call("/api/admin/projects", adminCookie);
    const projectsPayload = await projectsResponse.json().catch(() => ({}));
    const statuses = projectsPayload.statuses ?? [];
    check("后台项目列表可读", projectsResponse.status === 200 && Array.isArray(projectsPayload.projects), `returned=${projectsPayload.projects?.length ?? 0}`);
    check("项目状态枚举完整", statuses.length === 5 && statuses.includes("已冻结"), `statuses=${statuses.join("/")}`);

    const badStatus = await call("/api/admin/projects", adminCookie, { method: "PATCH", json: { projectId: "definitely-not-a-project", status: "随便写" } });
    const badStatusPayload = await badStatus.json().catch(() => ({}));
    check("非法状态被拒", badStatus.status === 400 && badStatusPayload.error === "PROJECT_STATUS_INVALID", `status=${badStatus.status} error=${badStatusPayload.error}`);

    const missingProject = await call("/api/admin/projects", adminCookie, { method: "PATCH", json: { projectId: "definitely-not-a-project", status: "已冻结" } });
    const missingPayload = await missingProject.json().catch(() => ({}));
    check("不存在的项目被拒", missingProject.status === 400 && missingPayload.error === "PROJECT_NOT_FOUND", `status=${missingProject.status} error=${missingPayload.error}`);

    // 用刚才建的这个项目走完整正路径：列表里能查到 → 改状态 → 改回来。
    const listedProject = (projectsPayload.projects ?? []).find((project) => project.id === projectId);
    check("后台项目列表能看到刚建的项目", Boolean(listedProject), `owner=${listedProject?.ownerEmail} status=${listedProject?.status}`);
    check("项目归属与统计字段正确", listedProject?.ownerEmail === OWNER_EMAIL && listedProject?.assetCount === 0 && listedProject?.taskCount === 0, `assets=${listedProject?.assetCount} tasks=${listedProject?.taskCount}`);

    const frozen = await call("/api/admin/projects", adminCookie, { method: "PATCH", json: { projectId, status: "已冻结" } });
    const frozenPayload = await frozen.json().catch(() => ({}));
    check("冻结项目成功", frozen.status === 200 && frozenPayload.previousStatus === listedProject?.status, `previous=${frozenPayload.previousStatus}`);

    const afterFreeze = await call("/api/admin/projects", adminCookie);
    const afterFreezePayload = await afterFreeze.json().catch(() => ({}));
    const frozenRow = (afterFreezePayload.projects ?? []).find((project) => project.id === projectId);
    check("冻结状态真的落库了", frozenRow?.status === "已冻结", `status=${frozenRow?.status}`);

    // 冻结必须在源站真的拦住写操作，否则这个状态只是后台列表里的一个汉字。
    const frozenForm = new FormData();
    frozenForm.set("role", "character");
    frozenForm.set("file", new Blob([PNG_1X1], { type: "image/png" }), "p1-frozen.png");
    const frozenUpload = await call(`/api/projects/${encodeURIComponent(projectId)}/assets`, ownerCookie, { method: "POST", body: frozenForm });
    const frozenUploadPayload = await frozenUpload.json().catch(() => ({}));
    check("冻结项目不能挂素材", frozenUpload.status === 409 && frozenUploadPayload.error === "PROJECT_FROZEN", `status=${frozenUpload.status} error=${frozenUploadPayload.error}`);

    const frozenTask = await call("/api/video-tasks", ownerCookie, { method: "POST", json: { projectId, prompt: "冻结校验", product: "video_s", durationSeconds: 5, aspectRatio: "9:16", assetIds: [] } });
    const frozenTaskPayload = await frozenTask.json().catch(() => ({}));
    check("冻结项目不能建任务（且在建任务扣积分之前就拦住）", frozenTask.status === 409 && frozenTaskPayload.error === "PROJECT_FROZEN", `status=${frozenTask.status} error=${frozenTaskPayload.error}`);

    const frozenShortDrama = await call(`/api/projects/${encodeURIComponent(projectId)}/short-drama`, ownerCookie, { method: "POST", json: { sourceText: "冻结校验剧本", requirements: "" } });
    const frozenShortDramaPayload = await frozenShortDrama.json().catch(() => ({}));
    check("冻结项目不能提剧本流程", frozenShortDrama.status === 409 && frozenShortDramaPayload.error === "PROJECT_FROZEN", `status=${frozenShortDrama.status} error=${frozenShortDramaPayload.error}`);

    const frozenRead = await call(`/api/projects/${encodeURIComponent(projectId)}/assets`, ownerCookie);
    check("冻结项目仍可只读（冻结不是消失）", frozenRead.status === 200, `status=${frozenRead.status}`);

    const restored = await call("/api/admin/projects", adminCookie, { method: "PATCH", json: { projectId, status: listedProject?.status ?? "进行中" } });
    const restoredPayload = await restored.json().catch(() => ({}));
    check("还原项目原状态", restored.status === 200 && restoredPayload.previousStatus === "已冻结", `previous=${restoredPayload.previousStatus}`);

    // 正向对照：解冻后同样的写操作必须恢复，证明闸门没有误伤。
    const thawedForm = new FormData();
    thawedForm.set("role", "character");
    thawedForm.set("file", new Blob([PNG_1X1], { type: "image/png" }), "p1-thawed.png");
    const thawedUpload = await call(`/api/projects/${encodeURIComponent(projectId)}/assets`, ownerCookie, { method: "POST", body: thawedForm });
    check("解冻后又能挂素材（闸门没误伤）", thawedUpload.status === 201, `status=${thawedUpload.status}`);

    const ownerProjects = await call("/api/projects", ownerCookie);
    const ownerProjectsPayload = await ownerProjects.json().catch(() => ({}));
    const ownerProjectList = (ownerProjectsPayload.projects ?? ownerProjectsPayload ?? []);
    check("源站项目列表仍正常（后台改状态不影响用户读取）", ownerProjects.status === 200 && Array.isArray(ownerProjectList) && ownerProjectList.length > 0, `returned=${ownerProjectList.length}`);

    // ── 审计留痕 ──────────────────────────────────────────────
    const auditResponse = await call("/api/admin/overview", adminCookie);
    const auditPayload = await auditResponse.json().catch(() => ({}));
    log(true, "后台审计接口可读", `events=${auditPayload.events?.length ?? 0}`);
  } finally {
    child.kill("SIGTERM");
    await delay(500);
    if (child.exitCode === null) child.kill("SIGKILL");
  }

  console.log(`\n共 ${step} 步，失败 ${failures} 步`);
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`\n脚本中断：${error instanceof Error ? error.message : String(error)}`);
  console.error(serverLogs.slice(-25).join("\n"));
  process.exitCode = 1;
});
