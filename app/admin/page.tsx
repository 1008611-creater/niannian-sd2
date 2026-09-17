"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";

type AdminTask = {
  id: string; userEmail: string; executionMode: string; channel: string; prompt: string; model: string;
  resolution: string; durationSeconds: number; aspectRatio: string; assets: { id: string; role: string; name: string }[];
  status: string; blocker: string | null; providerTaskId: string | null; outputPath: string | null;
  submitAllowed: boolean; costAuthorized: boolean; createdAt: string; updatedAt: string;
  operation: { ageMinutes: number; priority: "critical" | "warning" | "normal" | "done"; overdue: boolean; attention: boolean; nextAction: string; slaMinutes: number };
};
type ProductRouting = { video_s: string | null; video_smini: string | null; image_g: string | null };
type Overview = {
  stats: { users: number; projects: number; tasks: number; pending: number; blocked: number; completed: number };
  users: { id: string; email: string; createdAt: string; projectCount: number; taskCount: number; isAdmin: boolean }[];
  tasks: AdminTask[];
  operations: { critical: number; warning: number; overdue: number; awaitingManual: number; awaitingQa: number; recentUsers: number; recentRedemptions: number };
  events: { id: string; taskId: string; event: string; detail: string | null; createdAt: string; userEmail: string }[];
  worker: {
    online: boolean; status: string; pid: number | null; startedAt: string | null; heartbeatAt: string | null;
    modes: string[]; codexAvailable: boolean; mimoDirectConfigured: boolean; serverConfigured: boolean; lastTaskId: string | null;
    lastResult: string | null; lastError: string | null;
  };
  macWorker: {
    configured: boolean; online: boolean; productionReady: boolean; status: string; workerId: string | null; heartbeatAt: string | null;
    activeTaskId: string | null; summary: string | null; version: string | null;
    readiness: null | {
      checkedAt: string; readyToClaim: boolean; blocker: string | null;
      computer: { hostname: string; platform: string; arch: string; workspaceWritable: boolean; ffprobeAvailable: boolean };
      skills: { state: "ready" | "blocked"; bundleName: string | null; bundleVersion: string | null; skills: number | null; blocker: string | null };
      channel: { id: "mimo"; state: string; checkedAt: string; reachable: boolean | null; authenticated: boolean | null; credits: string | null; model: string; blocker: string | null };
    };
  };
  mimoWindowsWorker: {
    configured: boolean; online: boolean; readyToClaim: boolean; status: string; workerId: string | null; heartbeatAt: string | null;
    activeTaskId: string | null; summary: string | null; version: string | null;
    readiness: null | {
      checkedAt: string; readyToClaim: boolean; blocker: string | null;
      computer: { hostname: string; platform: string; arch: string; workspaceWritable: boolean; ffprobeAvailable: boolean };
      skills: { state: "ready" | "blocked"; bundleName: string | null; bundleVersion: string | null; skills: number | null; blocker: string | null };
      channel: { id: "mimo"; state: string; checkedAt: string; reachable: boolean | null; authenticated: boolean | null; credits: string | null; model: string; blocker: string | null };
    };
  };
  channels: { id: string; label: string; configured: boolean; status: string; modes: string[] }[];
  mimoReadiness: {
    checkedAt: string | null; configured: boolean; reachable: boolean | null; authenticated: boolean | null;
    credits: string | null; state: "not_checked" | "configuration_missing" | "ready" | "unreachable" | "authentication_failed" | "unknown_error";
  };
  dolaReadiness: {
    checkedAt: string; configured: boolean; reachable: boolean; authenticated: boolean; proxyConfigured: boolean;
    cdpAvailable: boolean; extensionCount: number; state: "not_checked" | "ready" | "bridge_unreachable" | "interactive_login_required" | "region_restricted" | "capability_invalid";
    blocker: string | null; novncUrl: string | null; allowedActions: string[]; providerSubmitEnabled: false; spendEnabled: false;
  };
  mioraReadiness: {
    checkedAt: string | null; configured: boolean; reachable: boolean | null; authenticated: boolean | null;
    credits: string | null; modelAvailable: boolean | null; model: string; entryUrl: string;
    state: "not_checked" | "configuration_missing" | "ready" | "browser_session_visible" | "unreachable" | "authentication_failed" | "unknown_error";
    blocker: string | null;
  };
  mioraSession: null | {
    channel: "miora"; state: string; visibleProjectUrl: string | null; creditReadback: string | null;
    modelReadback: string | null; lastPreflightAt: string | null; lastSuccessAt: string | null;
    lastBlocker: string | null; updatedAt: string;
  };
  mioraHandoffs: {
    id: string; taskId: string; channel: "miora"; action: "login" | "email_otp" | "phone_otp" | "captcha" | "terms" | "cost_authorization";
    state: "awaiting_user" | "acknowledged" | "resolved" | "expired"; instructions: string; browserUrl: string | null;
    resumeFrom: string; createdAt: string; resolvedAt: string | null;
  }[];
  mioraLearning: {
    evidenceRule: "only_real_receipts"; receiptCount: number; providerTaskCount: number; downloadedAndProbedCount: number;
    qaPassedCount: number; consecutiveVerifiedCount: number; qaPassRate: number | null; activeHumanHandoffCount: number; handoffCounts: Record<string, number>;
    stableConcurrencyLimit: 1 | 3 | 10; concurrencyReason: string; latestVerifiedAt: string | null;
    costBaseline: { state: "not_observed" | "maximum_authorized_only"; note: string };
    templates: { sourceTaskId: string; prompt: string; referenceRoles: string[]; model: string; resolution: string; durationSeconds: number; aspectRatio: string; completedAt: string; source: "real_qa_passed_receipt" }[];
  };
  credits: {
    wallets: { userId: string; userEmail: string; balance: number }[];
    rechargeRequests: { id: string; userId: string; userEmail: string | null; requestedCredits: number; note: string | null; status: string; processedAt: string | null; createdAt: string }[];
  };
};

const modeNames: Record<string, string> = { manual_assist: "人工兜底", mac_codex: "Mac 自动制作", codex_skill: "Windows Skill 自动", server_auto: "服务器自动" };
const channelNames: Record<string, string> = { mimo: "渠道 M", dola: "Dola", miora: "Miora 方法13", auto: "渠道 M（历史任务）" };
const statusNames: Record<string, string> = {
  awaiting_manual_operator: "等待人工接单", manual_in_progress: "人工处理中", queued_skill: "Skill 队列",
  awaiting_human_login: "等待本人登录", awaiting_human_verification: "等待真人验证",
  queued_mac: "等待 Mac 授权", queued_server: "服务器队列", approved_for_execution: "已授权待领取", running_on_mac: "Mac 员工执行中",
  dispatching_skill: "Skill 提交中", syncing_skill: "Skill 同步中",
  dispatching_server: "服务器提交中", syncing_server: "服务器同步中",
  running: "生成中", blocked: "已阻塞", completed: "已完成",
};
const eventNames: Record<string, string> = {
  task_prepared: "任务已创建", admin_claim_manual: "管理员接单", admin_approve_cost: "管理员授权成本",
  admin_retry_automatic: "重新交给自动执行",
  admin_route_channel: "切换视频渠道",
  admin_mark_running: "登记渠道任务", admin_block: "管理员阻塞", admin_retry: "管理员重试", admin_complete: "管理员完成",
  admin_reconcile_official_frontend: "关联官方成片",
  admin_automatic_test_created: "创建自动测试任务",
  worker_claimed: "执行器领取任务", worker_result: "执行器回写结果",
  worker_failed: "执行器阻塞任务", worker_recovered_stale_claim: "执行器恢复中断任务",
  mac_worker_claimed: "Mac 员工领取任务", mac_worker_provider_running: "Mac 员工已提交渠道",
  mac_worker_output_received: "Mac 成片已回传待验收", mac_worker_blocked: "Mac 员工报告阻塞",
  mac_worker_lease_expired: "Mac 任务租约到期重排",
  automatic_fallback_manual: "自动失败转人工兜底", admin_fallback_manual: "管理员转人工兜底",
  admin_review_output: "管理员验收渠道成片",
  miora_human_handoff_requested: "Miora 请求本人接管",
};
const mimoReadinessNames = {
  not_checked: "尚未检查", configuration_missing: "未配置安全凭据", ready: "可执行",
  unreachable: "服务不可达", authentication_failed: "凭据验证失败", unknown_error: "配置异常",
} as const;
const mioraReadinessNames = {
  not_checked: "尚未检查", configuration_missing: "未配置 CDP/Cookie", ready: "可执行",
  browser_session_visible: "浏览器会话可见", unreachable: "服务不可达",
  authentication_failed: "会话验证失败", unknown_error: "配置异常",
} as const;
const mimoChannelStateNames: Record<string, string> = {
  ready: "已登录，可执行", credentials_missing: "Mac 未配置凭据", configuration_invalid: "渠道配置异常",
  authentication_failed: "登录已失效", unreachable: "渠道不可达",
};

type PricingRuleView = {
  id: string; mode: "automatic" | "manual"; creditsPerSecond: number | null; flatCredits: number | null;
  minSeconds: number; maxSeconds: number; enabled: boolean; note: string | null; updatedBy: string | null;
  createdAt: string; updatedAt: string; shadowed: boolean;
};
type PricingSnapshot = {
  rules: PricingRuleView[];
  table: { automatic: Record<string, number>; manual: Record<string, number> };
  coverage: { minSeconds: number; maxSeconds: number; missing: { automatic: number[]; manual: number[] }; complete: boolean };
  revision: { updatedAt: string | null; loadedAt: number | null; source: "database" | "default" };
  bounds: { minSeconds: number; maxSeconds: number };
};
type PricingDraft = {
  id: string; mode: "automatic" | "manual"; kind: "per_second" | "flat";
  creditsPerSecond: string; flatCredits: string; minSeconds: string; maxSeconds: string; enabled: boolean; note: string;
};
const pricingModeNames: Record<string, string> = { automatic: "自动制作", manual: "人工兜底" };

function emptyDraft(mode: "automatic" | "manual" = "automatic"): PricingDraft {
  return { id: "", mode, kind: "per_second", creditsPerSecond: "6", flatCredits: "", minSeconds: "1", maxSeconds: "30", enabled: true, note: "" };
}

type CatalogModelView = {
  id: string; name: string; displayName: string; type: string; modes: string[];
  allowedDurations: number[]; allowedRatios: string[]; resolution: string;
  enabled: boolean; sortOrder: number; tags: string[]; surchargePercent: number;
  note: string | null; source: "channel" | "override_only"; override: boolean;
};
type ModelCatalogSnapshot = {
  models: CatalogModelView[]; channelModelCount: number; overrideCount: number; channelError: string | null;
  summary: { total: number; enabled: number; disabled: number; staleOverrides: number };
};
type ModelDraft = {
  modelId: string; displayName: string; enabled: boolean;
  sortOrder: string; tags: string; surchargePercent: string; note: string;
};
type AnalyticsSnapshot = {
  totals: { users: number; projects: number; tasks: number; completed: number; failed: number; completionRate: number | null; activeUsers14d: number };
  credits: {
    consumed: number; toppedUp: number; outstanding: number; yuanPerCredit: number;
    revenueYuan: number; channelCostYuan: number; grossMarginYuan: number; costBasis: string;
  };
  trend: {
    days: number;
    signups: { day: string; value: number }[];
    tasks: { day: string; value: number }[];
    creditsConsumed: { day: string; value: number }[];
    creditsToppedUp: { day: string; value: number }[];
  };
  breakdown: {
    failureReasons: { name: string; value: number }[];
    topModels: { name: string; value: number }[];
    channels: { name: string; value: number }[];
  };
};
type AssetVisibility = "owner" | "public" | "taken_down";
type AdminAsset = {
  id: string; ownerEmail: string; ownerId: string; role: string; name: string; mimeType: string;
  byteSize: number; visibility: AssetVisibility; reason: string | null; moderatedBy: string | null;
  moderatedAt: string | null; hiddenByOwner: boolean; createdAt: string; previewUrl: string;
};
type AssetAdminSnapshot = { assets: AdminAsset[]; summary: { returned: number; limit: number } };
type AdminProject = {
  id: string; title: string; type: string; status: string; progress: number; episodes: number;
  ownerEmail: string; ownerId: string; assetCount: number; taskCount: number;
  createdAt: string; updatedAt: string;
};
type ProjectAdminSnapshot = {
  projects: AdminProject[]; statuses: string[];
  summary: { returned: number; limit: number; frozen: number };
};
const assetVisibilityNames: Record<AssetVisibility, string> = { owner: "仅本人", public: "公共素材", taken_down: "已下架" };
const assetRoleNames: Record<string, string> = {
  character: "角色", product: "产品", scene: "场景", reference_video: "参考视频",
  reference_audio: "参考音频", reference_image: "参考图", other: "其它",
};

function draftFromModel(model: CatalogModelView): ModelDraft {
  return {
    modelId: model.id,
    displayName: model.displayName === model.name ? "" : model.displayName,
    enabled: model.enabled,
    sortOrder: String(model.sortOrder),
    tags: model.tags.join("、"),
    surchargePercent: String(model.surchargePercent),
    note: model.note ?? "",
  };
}

function draftFromRule(rule: PricingRuleView): PricingDraft {
  return {
    id: rule.id,
    mode: rule.mode,
    kind: rule.flatCredits === null ? "per_second" : "flat",
    creditsPerSecond: String(rule.creditsPerSecond ?? ""),
    flatCredits: String(rule.flatCredits ?? ""),
    minSeconds: String(rule.minSeconds),
    maxSeconds: String(rule.maxSeconds),
    enabled: rule.enabled,
    note: rule.note ?? "",
  };
}

function formatBytes(value: number) {
  if (!value) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function taskAge(minutes: number) {
  if (minutes < 1) return "刚刚更新";
  if (minutes < 60) return `${minutes} 分钟未更新`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} 小时未更新`;
  return `${Math.floor(minutes / (24 * 60))} 天未更新`;
}

export default function AdminPage() {
  const router = useRouter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tab, setTab] = useState<"tasks" | "data" | "users" | "pricing" | "models" | "assets" | "projects" | "credits" | "channels" | "audit">("tasks");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [focus, setFocus] = useState<"all" | "attention" | "overdue" | "manual" | "qa">("attention");
  const [error, setError] = useState("");
  const [busyTask, setBusyTask] = useState("");
  const [checkingMimo, setCheckingMimo] = useState(false);
  const [checkingDola, setCheckingDola] = useState(false);
  const [checkingMiora, setCheckingMiora] = useState(false);
  const [costAuthorization, setCostAuthorization] = useState<AdminTask | null>(null);
  const [costReadback, setCostReadback] = useState("");
  const [maxCost, setMaxCost] = useState("");
  const [automaticRetry, setAutomaticRetry] = useState<AdminTask | null>(null);
  const [officialReconciliation, setOfficialReconciliation] = useState<AdminTask | null>(null);
  const [officialProviderTaskId, setOfficialProviderTaskId] = useState("");
  const [outputReview, setOutputReview] = useState<AdminTask | null>(null);
  const [productRouting, setProductRouting] = useState<ProductRouting | null>(null);
  const [savingProductRoute, setSavingProductRoute] = useState("");
  const [pricing, setPricing] = useState<PricingSnapshot | null>(null);
  const [pricingDraft, setPricingDraft] = useState<PricingDraft | null>(null);
  const [savingPricing, setSavingPricing] = useState(false);
  const [catalog, setCatalog] = useState<ModelCatalogSnapshot | null>(null);
  const [modelDraft, setModelDraft] = useState<ModelDraft | null>(null);
  const [savingModel, setSavingModel] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [analytics, setAnalytics] = useState<AnalyticsSnapshot | null>(null);
  const [assets, setAssets] = useState<AssetAdminSnapshot | null>(null);
  const [assetQuery, setAssetQuery] = useState("");
  const [assetVisibility, setAssetVisibility] = useState<"" | AssetVisibility>("");
  const [assetDraft, setAssetDraft] = useState<{ assetId: string; visibility: AssetVisibility; reason: string } | null>(null);
  const [savingAsset, setSavingAsset] = useState(false);
  const [projects, setProjects] = useState<ProjectAdminSnapshot | null>(null);
  const [projectQuery, setProjectQuery] = useState("");
  const [savingProject, setSavingProject] = useState("");

  const load = useCallback(async () => {
    setError("");
    const response = await fetch("/api/admin/overview", { cache: "no-store" });
    if (response.status === 403) {
      const session = await fetch("/api/auth/session", { cache: "no-store" }).then((item) => item.json()).catch(() => ({ user: null }));
      router.replace(session.user ? "/home" : "/login?next=/admin");
      return;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "ADMIN_OVERVIEW_UNAVAILABLE");
    setOverview(data);
  }, [router]);

  const loadProductRouting = useCallback(async () => {
    const response = await fetch("/api/admin/product-routing", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "PRODUCT_ROUTING_UNAVAILABLE");
    setProductRouting(data.routing);
  }, []);

  const loadPricing = useCallback(async () => {
    const response = await fetch("/api/admin/pricing", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "PRICING_UNAVAILABLE");
    setPricing(data);
  }, []);

  useEffect(() => {
    Promise.all([load(), loadProductRouting()]).catch(() => setError("管理员数据加载失败，请刷新重试"));
    const timer = window.setInterval(() => { load().catch(() => undefined); loadProductRouting().catch(() => undefined); }, 30_000);
    return () => window.clearInterval(timer);
  }, [load, loadProductRouting]);

  const loadModels = useCallback(async () => {
    const response = await fetch("/api/admin/models", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "MODEL_CATALOG_UNAVAILABLE");
    setCatalog(data);
  }, []);

  const loadAnalytics = useCallback(async () => {
    const response = await fetch("/api/admin/analytics", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "ANALYTICS_UNAVAILABLE");
    setAnalytics(data);
  }, []);

  const loadAssets = useCallback(async () => {
    const params = new URLSearchParams();
    if (assetQuery.trim()) params.set("query", assetQuery.trim());
    if (assetVisibility) params.set("visibility", assetVisibility);
    const response = await fetch(`/api/admin/assets?${params.toString()}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "ASSET_ADMIN_UNAVAILABLE");
    setAssets(data);
  }, [assetQuery, assetVisibility]);

  const loadProjects = useCallback(async () => {
    const params = new URLSearchParams();
    if (projectQuery.trim()) params.set("query", projectQuery.trim());
    const response = await fetch(`/api/admin/projects?${params.toString()}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "PROJECT_ADMIN_UNAVAILABLE");
    setProjects(data);
  }, [projectQuery]);

  useEffect(() => {
    if (tab === "pricing") loadPricing().catch(() => setError("价目表加载失败，请刷新重试"));
    if (tab === "models") loadModels().catch(() => setError("模型目录加载失败，请刷新重试"));
    if (tab === "data") loadAnalytics().catch(() => setError("经营数据加载失败，请刷新重试"));
    if (tab === "assets") loadAssets().catch(() => setError("素材库加载失败，请刷新重试"));
    if (tab === "projects") loadProjects().catch(() => setError("项目列表加载失败，请刷新重试"));
  }, [tab, loadPricing, loadModels, loadAnalytics, loadAssets, loadProjects]);

  async function savePricingRule() {
    if (!pricingDraft) return;
    setSavingPricing(true);
    setError("");
    try {
      const response = await fetch("/api/admin/pricing", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(pricingDraft.id ? { id: pricingDraft.id } : {}),
          mode: pricingDraft.mode,
          creditsPerSecond: pricingDraft.kind === "per_second" ? pricingDraft.creditsPerSecond : null,
          flatCredits: pricingDraft.kind === "flat" ? pricingDraft.flatCredits : null,
          minSeconds: pricingDraft.minSeconds,
          maxSeconds: pricingDraft.maxSeconds,
          enabled: pricingDraft.enabled,
          note: pricingDraft.note,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "PRICING_UPDATE_FAILED");
      setPricing(data.snapshot);
      setPricingDraft(null);
    } catch (actionError) {
      setError(actionError instanceof Error ? `价目保存失败：${actionError.message}` : "价目保存失败");
    } finally {
      setSavingPricing(false);
    }
  }

  async function runPricingAction(action: () => Promise<Response>, failure: string) {
    setSavingPricing(true);
    setError("");
    try {
      const response = await action();
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "PRICING_UPDATE_FAILED");
      if (data.snapshot) setPricing(data.snapshot);
      else await loadPricing();
    } catch (actionError) {
      setError(actionError instanceof Error ? `${failure}：${actionError.message}` : failure);
    } finally {
      setSavingPricing(false);
    }
  }

  async function saveModelOverride() {
    if (!modelDraft) return;
    setSavingModel(true);
    setError("");
    try {
      const response = await fetch("/api/admin/models", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modelId: modelDraft.modelId,
          displayName: modelDraft.displayName,
          enabled: modelDraft.enabled,
          sortOrder: modelDraft.sortOrder,
          tags: modelDraft.tags,
          surchargePercent: modelDraft.surchargePercent,
          note: modelDraft.note,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "MODEL_UPDATE_FAILED");
      setCatalog(data.snapshot);
      setModelDraft(null);
    } catch (actionError) {
      setError(actionError instanceof Error ? `模型保存失败：${actionError.message}` : "模型保存失败");
    } finally {
      setSavingModel(false);
    }
  }

  async function runModelAction(action: () => Promise<Response>, failure: string) {
    setSavingModel(true);
    setError("");
    try {
      const response = await action();
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "MODEL_UPDATE_FAILED");
      if (data.snapshot) setCatalog(data.snapshot);
      else await loadModels();
    } catch (actionError) {
      setError(actionError instanceof Error ? `${failure}：${actionError.message}` : failure);
    } finally {
      setSavingModel(false);
    }
  }

  async function runAssetAction(action: () => Promise<Response>, failure: string) {
    setSavingAsset(true);
    setError("");
    try {
      const response = await action();
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "ASSET_UPDATE_FAILED");
      setAssetDraft(null);
      await loadAssets();
    } catch (actionError) {
      setError(actionError instanceof Error ? `${failure}：${actionError.message}` : failure);
    } finally {
      setSavingAsset(false);
    }
  }

  async function runProjectAction(projectId: string, status: string) {
    setSavingProject(projectId);
    setError("");
    try {
      const response = await fetch("/api/admin/projects", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, status }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "PROJECT_UPDATE_FAILED");
      await loadProjects();
    } catch (actionError) {
      setError(actionError instanceof Error ? `项目状态更新失败：${actionError.message}` : "项目状态更新失败");
    } finally {
      setSavingProject("");
    }
  }

  async function saveProductRoute(product: keyof ProductRouting, channel: string | null) {
    setSavingProductRoute(product);
    setError("");
    try {
      const response = await fetch("/api/admin/product-routing", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product, channel }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "PRODUCT_ROUTE_UPDATE_FAILED");
      setProductRouting(data.routing);
    } catch (actionError) {
      setError(actionError instanceof Error ? `产品路由更新失败：${actionError.message}` : "产品路由更新失败");
    } finally {
      setSavingProductRoute("");
    }
  }

  const tasks = useMemo(() => (overview?.tasks ?? []).filter((task) => {
    const term = query.trim().toLowerCase();
    const matches = !term || task.prompt.toLowerCase().includes(term) || task.userEmail.toLowerCase().includes(term) || task.id.toLowerCase().includes(term);
    const focusMatches = focus === "all"
      || (focus === "attention" && task.operation.attention)
      || (focus === "overdue" && task.operation.overdue)
      || (focus === "manual" && ["awaiting_manual_operator", "manual_in_progress", "awaiting_human_login", "awaiting_human_verification"].includes(task.status))
      || (focus === "qa" && task.status === "blocked" && task.blocker === "awaiting_content_qa");
    return matches && focusMatches && (status === "all" || task.status === status);
  }), [overview, query, status, focus]);

  const visibleModels = useMemo(() => (catalog?.models ?? []).filter((model) => {
    const term = modelQuery.trim().toLowerCase();
    return !term || model.id.toLowerCase().includes(term) || model.displayName.toLowerCase().includes(term);
  }), [catalog, modelQuery]);

  function openTaskFocus(nextFocus: typeof focus) {
    setTab("tasks");
    setFocus(nextFocus);
    setStatus("all");
  }

  function beginCostAuthorization(task: AdminTask) {
    setCostAuthorization(task);
    setCostReadback("");
    setMaxCost("");
  }

  async function submitCostAuthorization() {
    if (!costAuthorization || !costReadback.trim() || !maxCost.trim()) return;
    const task = costAuthorization;
    setBusyTask(task.id);
    setError("");
    try {
      const response = await fetch("/api/admin/overview", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: task.id, action: "approve_cost", costReadback: costReadback.trim(), maxCost: maxCost.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "ADMIN_ACTION_FAILED");
      setCostAuthorization(null);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? `操作失败：${actionError.message}` : "操作失败");
    } finally {
      setBusyTask("");
    }
  }

  async function submitAutomaticRetry() {
    if (!automaticRetry) return;
    const task = automaticRetry;
    setBusyTask(task.id);
    setError("");
    try {
      const response = await fetch("/api/admin/overview", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: task.id, action: "retry_automatic" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "AUTOMATIC_RETRY_FAILED");
      setAutomaticRetry(null);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? `操作失败：${actionError.message}` : "操作失败");
    } finally {
      setBusyTask("");
    }
  }

  async function submitOfficialReconciliation() {
    if (!officialReconciliation || !officialProviderTaskId.trim()) return;
    const task = officialReconciliation;
    setBusyTask(task.id); setError("");
    try {
      const response = await fetch("/api/admin/overview", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: task.id, action: "reconcile_official_frontend", providerTaskId: officialProviderTaskId.trim() }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "OFFICIAL_FRONTEND_RECONCILIATION_FAILED");
      setOfficialReconciliation(null); setOfficialProviderTaskId(""); await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? `操作失败：${actionError.message}` : "操作失败");
    } finally { setBusyTask(""); }
  }

  async function submitOutputReview() {
    if (!outputReview) return;
    const task = outputReview;
    setBusyTask(task.id); setError("");
    try {
      const response = await fetch("/api/admin/overview", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: task.id, action: "review_output", contentQaPassed: true }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "OUTPUT_REVIEW_FAILED");
      setOutputReview(null); await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? `操作失败：${actionError.message}` : "操作失败");
    } finally { setBusyTask(""); }
  }

  async function runAction(task: AdminTask, action: string) {
    const payload: Record<string, string | boolean> = { taskId: task.id, action };
    if (action === "route_dola" || action === "route_mimo" || action === "route_miora") {
      const channel = action === "route_dola" ? "dola" : action === "route_miora" ? "miora" : "mimo";
      const label = channel === "dola" ? " Dola" : channel === "miora" ? " Miora 方法13" : "渠道 M";
      if (!window.confirm(`确认把这条未授权任务切换到${label}吗？切换不会提交或产生渠道费用。`)) return;
      payload.action = "route_channel";
      payload.channel = channel;
    } else if (action === "approve_cost") {
      beginCostAuthorization(task);
      return;
    } else if (action === "retry_automatic") {
      setAutomaticRetry(task);
      return;
    } else if (action === "block") {
      const note = window.prompt("请输入阻塞原因", task.blocker ?? "渠道暂不可用");
      if (!note) return; payload.note = note;
    } else if (action === "mark_running") {
      const providerTaskId = window.prompt("请输入渠道返回的任务 ID");
      if (!providerTaskId) return; payload.providerTaskId = providerTaskId;
    } else if (action === "reconcile_official_frontend") {
      setOfficialReconciliation(task); setOfficialProviderTaskId(""); return;
    } else if (action === "create_automatic_test") {
      // The user explicitly authorized one controlled, billable test.
    } else if (action === "complete") {
      const outputPath = window.prompt("请输入任务 downloads 目录内的已下载视频绝对路径", task.outputPath ?? "");
      if (!outputPath) return; payload.outputPath = outputPath;
      const ledgerPath = window.prompt("请输入任务 ledger 目录内的账本文件绝对路径");
      if (!ledgerPath) return; payload.ledgerPath = ledgerPath;
      if (!window.confirm("请确认已人工检查成片内容、人物/商品/场景/动作均符合任务要求。服务器还会执行 ffprobe 与时长校验。")) return;
      payload.contentQaPassed = true;
    } else if (action === "review_output") {
      setOutputReview(task); return;
    } else if (action === "miora_handoff_completed") {
      // The only assertion is that the person finished the platform-required
      // step in the visible browser. No password, OTP, cookie or CAPTCHA data
      // is ever sent back to this application.
    } else if (!window.confirm("确定执行该操作吗？")) return;

    setBusyTask(task.id); setError("");
    try {
      const response = await fetch("/api/admin/overview", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "ADMIN_ACTION_FAILED");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? `操作失败：${actionError.message}` : "操作失败");
    } finally { setBusyTask(""); }
  }

  async function checkMimoReadiness() {
    setCheckingMimo(true); setError("");
    try {
      const response = await fetch("/api/admin/mimo-preflight", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "MIMO_PREFLIGHT_UNAVAILABLE");
      await load();
    } catch (checkError) {
      setError(checkError instanceof Error ? `渠道检查失败：${checkError.message}` : "渠道检查失败");
    } finally { setCheckingMimo(false); }
  }

  async function checkDolaReadiness() {
    setCheckingDola(true); setError("");
    try {
      const response = await fetch("/api/admin/dola-preflight", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.readiness?.blocker || data.error || "DOLA_PREFLIGHT_UNAVAILABLE");
      await load();
    } catch (checkError) {
      setError(checkError instanceof Error ? `Dola 检查失败：${checkError.message}` : "Dola 检查失败");
      await load().catch(() => undefined);
    } finally { setCheckingDola(false); }
  }

  async function checkMioraReadiness() {
    setCheckingMiora(true); setError("");
    try {
      const response = await fetch("/api/admin/miora-preflight", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.blocker || data.error || "MIORA_PREFLIGHT_UNAVAILABLE");
      await load();
    } catch (checkError) {
      setError(checkError instanceof Error ? `Miora 检查失败：${checkError.message}` : "Miora 检查失败");
      await load().catch(() => undefined);
    } finally { setCheckingMiora(false); }
  }

  function openMioraSession(url: string | null | undefined) {
    const target = url || overview?.mioraSession?.visibleProjectUrl || overview?.mioraReadiness.entryUrl;
    if (!target) { setError("Miora 会话入口不可用，请先执行只读预检"); return; }
    window.open(target, "_blank", "noopener,noreferrer");
  }

  async function processRecharge(requestId: string, action: "approve_recharge" | "reject_recharge") {
    const approval = action === "approve_recharge";
    if (!window.confirm(approval ? "确认已收到付款并为该用户入账积分吗？" : "确认驳回该充值申请吗？")) return;
    setBusyTask(requestId); setError("");
    try {
      const response = await fetch("/api/admin/overview", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, rechargeRequestId: requestId }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "RECHARGE_ACTION_FAILED");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? `充值处理失败：${actionError.message}` : "充值处理失败");
    } finally { setBusyTask(""); }
  }

  if (!overview) return <main className="app-page"><SiteHeader /><div className="admin-loading">{error || "正在加载管理员后台…"}</div></main>;

  return (
    <main className="app-page admin-page">
      <SiteHeader />
      <section className="admin-shell">
        <header className="admin-heading"><div><p>NIANNIAN CONTROL CENTER</p><h1>管理员控制台</h1><span>用户、任务、渠道、成本授权与异常审计</span></div><button onClick={() => load().catch(() => setError("刷新失败"))}>刷新数据</button></header>
        {error ? <div className="admin-alert">{error}</div> : null}
        <div className="admin-stats">
          {[['用户', overview.stats.users], ['项目', overview.stats.projects], ['全部任务', overview.stats.tasks], ['待处理', overview.stats.pending], ['阻塞', overview.stats.blocked], ['已完成', overview.stats.completed]].map(([label, value], index) => <article key={String(label)} className={index === 4 ? "danger" : index === 5 ? "success" : ""}><span>{label}</span><b>{value}</b></article>)}
        </div>
        <section className="admin-operations" aria-label="运营待办">
          <header><div><p>OPERATIONS QUEUE</p><h2>今日运营待办</h2></div><span>每 30 秒自动刷新 · 按最后更新时间计算</span></header>
          <div className="admin-operation-grid">
            <button className={overview.operations.critical ? "critical" : ""} onClick={() => openTaskFocus("attention")}><span>紧急处理</span><b>{overview.operations.critical}</b><small>阻塞、待接单或严重超时</small></button>
            <button className={overview.operations.overdue ? "critical" : ""} onClick={() => openTaskFocus("overdue")}><span>已经超时</span><b>{overview.operations.overdue}</b><small>超过当前阶段服务时限</small></button>
            <button className={overview.operations.awaitingManual ? "warning" : ""} onClick={() => openTaskFocus("manual")}><span>人工兜底</span><b>{overview.operations.awaitingManual}</b><small>等待接单或正在处理</small></button>
            <button onClick={() => openTaskFocus("qa")}><span>待质检交付</span><b>{overview.operations.awaitingQa}</b><small>成片已回传，等待管理员验收</small></button>
            <article><span>24h 新用户</span><b>{overview.operations.recentUsers}</b><small>关注首次任务与使用阻塞</small></article>
            <article><span>24h 兑换</span><b>{overview.operations.recentRedemptions}</b><small>LDXP 兑换成功次数</small></article>
          </div>
        </section>
        <nav className="admin-tabs">
          <button className={tab === "tasks" ? "active" : ""} onClick={() => setTab("tasks")}>任务中心</button>
          <button className={tab === "data" ? "active" : ""} onClick={() => setTab("data")}>数据看板</button>
          <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>用户管理</button>
          <button className={tab === "pricing" ? "active" : ""} onClick={() => setTab("pricing")}>定价管理</button>
          <button className={tab === "models" ? "active" : ""} onClick={() => setTab("models")}>模型管理</button>
          <button className={tab === "assets" ? "active" : ""} onClick={() => setTab("assets")}>素材库</button>
          <button className={tab === "projects" ? "active" : ""} onClick={() => setTab("projects")}>项目管理</button>
          <button className={tab === "credits" ? "active" : ""} onClick={() => setTab("credits")}>积分与充值</button>
          <button className={tab === "channels" ? "active" : ""} onClick={() => setTab("channels")}>渠道状态</button>
          <button className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}>审计记录</button>
        </nav>

        {tab === "tasks" ? <section className="admin-panel">
          <div className="admin-focus-tabs">{([['attention','需要处理'],['overdue','已经超时'],['manual','人工兜底'],['qa','待质检'],['all','全部任务']] as const).map(([value,label]) => <button key={value} className={focus === value ? "active" : ""} onClick={() => setFocus(value)}>{label}</button>)}</div>
          <div className="admin-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索邮箱、任务 ID 或提示词" /><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option>{Object.entries(statusNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <div className="admin-task-list">{tasks.length ? tasks.map((task) => <article className={`admin-task priority-${task.operation.priority}`} key={task.id}>
            <div className="admin-task-top"><div><span className={`admin-mode mode-${task.executionMode}`}>{modeNames[task.executionMode] ?? task.executionMode}</span><b>{task.userEmail}</b></div><span className={`admin-status status-${task.status}`}>{statusNames[task.status] ?? task.status}</span></div>
            <p>{task.prompt}</p>
            <div className="admin-task-meta"><span>{channelNames[task.channel] ?? task.channel}</span><span>{task.model}</span><span>{task.resolution}</span><span>{task.durationSeconds}s</span><span>{task.aspectRatio}</span><span>{task.assets.length} 项素材</span></div>
            <div className={`admin-next-action ${task.operation.priority}`}><div><b>{task.operation.nextAction}</b><span>{taskAge(task.operation.ageMinutes)}{task.operation.overdue ? " · 已超过服务时限" : ""}</span></div><em>{task.operation.overdue ? "超时" : task.operation.priority === "critical" ? "紧急" : task.operation.priority === "warning" ? "关注" : "正常"}</em></div>
            {task.blocker ? <div className="admin-blocker">阻塞：{task.blocker}</div> : null}
            <div className="admin-task-foot"><small>{task.id}<br />{new Date(task.createdAt).toLocaleString("zh-CN")}</small><div className="admin-actions">
              {task.status === "awaiting_manual_operator" ? <button onClick={() => runAction(task, "claim_manual")}>接单</button> : null}
              {task.executionMode === "manual_assist" && task.status === "awaiting_manual_operator" && !task.providerTaskId ? <button className="success" onClick={() => runAction(task, "reconcile_official_frontend")}>关联官方成片</button> : null}
              {task.executionMode === "manual_assist" && task.blocker === "automatic_generation_failed_manual_fallback" ? <button onClick={() => runAction(task, "retry_automatic")}>重试自动执行</button> : null}
              {["awaiting_human_login", "awaiting_human_verification"].includes(task.status) && task.channel === "miora" ? <>
                <button onClick={() => openMioraSession(overview.mioraHandoffs.find((handoff) => handoff.taskId === task.id)?.browserUrl)}>打开 Miora 会话</button>
                <button className="success" onClick={() => runAction(task, "miora_handoff_completed")}>我已完成，继续任务</button>
              </> : null}
              {task.providerTaskId && ((["mac_codex", "codex_skill", "server_auto"].includes(task.executionMode) && ["blocked", "running_on_mac", "running"].includes(task.status)) || (task.executionMode === "manual_assist" && task.status === "awaiting_manual_operator" && task.blocker === "automatic_generation_failed_manual_fallback")) ? <button className="success" onClick={() => runAction(task, "resume_provider_sync")}>恢复渠道同步</button> : null}
              {["mac_codex", "codex_skill", "server_auto"].includes(task.executionMode) && task.status !== "completed" && task.blocker !== "awaiting_content_qa" ? <button onClick={() => runAction(task, "fallback_manual")}>转人工兜底</button> : null}
              {!task.costAuthorized && !task.submitAllowed && !task.providerTaskId && ["queued_mac", "queued_skill", "queued_server"].includes(task.status) ? <>
                {task.channel !== "mimo" ? <button onClick={() => runAction(task, "route_mimo")}>改用渠道 M</button> : null}
                {task.channel !== "dola" ? <button onClick={() => runAction(task, "route_dola")}>改用 Dola</button> : null}
                {task.channel !== "miora" ? <button onClick={() => runAction(task, "route_miora")}>改用 Miora</button> : null}
              </> : null}
              {!task.costAuthorized && (task.executionMode !== "manual_assist" || task.status === "manual_in_progress") ? <button className="primary" onClick={() => runAction(task, "approve_cost")}>成本授权</button> : null}
              {!["mac_codex", "codex_skill", "server_auto"].includes(task.executionMode) && task.submitAllowed && !task.providerTaskId && task.status !== "running" ? <button onClick={() => runAction(task, "mark_running")}>登记渠道任务</button> : null}
              {task.status !== "completed" && task.status !== "blocked" ? <button className="danger" onClick={() => runAction(task, "block")}>暂停</button> : null}
              {task.status === "blocked" && task.blocker === "awaiting_content_qa" && task.providerTaskId && task.outputPath ? <button className="success" onClick={() => runAction(task, "review_output")}>验收并交付</button> : null}
              {task.status === "completed" ? <button onClick={() => runAction(task, "create_automatic_test")}>创建自动测试</button> : null}
              {task.status === "blocked" && task.blocker !== "awaiting_content_qa" ? <button onClick={() => runAction(task, "retry")}>重新入队</button> : null}
              {task.executionMode === "manual_assist" && task.status === "manual_in_progress" ? <button className="success" onClick={() => runAction(task, "complete")}>验收并完成</button> : null}
              {busyTask === task.id ? <span>处理中…</span> : null}
            </div></div>
          </article>) : <div className="admin-empty">当前筛选条件下没有任务</div>}</div>
        </section> : null}

        {tab === "data" ? <section className="admin-panel">
          {analytics ? <>
            <div className="analytics-cards">
              <article><span>注册用户</span><b>{analytics.totals.users}</b><small>14 天内有出片行为 {analytics.totals.activeUsers14d} 人</small></article>
              <article><span>累计任务</span><b>{analytics.totals.tasks}</b><small>已完成 {analytics.totals.completed} · 失败/阻塞 {analytics.totals.failed}</small></article>
              <article><span>完成率</span><b>{analytics.totals.completionRate === null ? "—" : `${Math.round(analytics.totals.completionRate * 100)}%`}</b><small>已完成 ÷ 全部任务</small></article>
              <article><span>消耗积分</span><b>{analytics.credits.consumed}</b><small>用户已充值 {analytics.credits.toppedUp} · 账上沉淀 {analytics.credits.outstanding}</small></article>
              <article><span>收入（估）</span><b>{analytics.credits.revenueYuan} 元</b><small>按 {analytics.credits.yuanPerCredit} 元/积分折算</small></article>
              <article><span>渠道成本（估）</span><b>{analytics.credits.channelCostYuan} 元</b><small>毛利约 {analytics.credits.grossMarginYuan} 元</small></article>
            </div>
            <p className="admin-hint">成本口径：{analytics.credits.costBasis}。要看真实账单请去紫域后台对账。</p>
            {[["每日新增用户", analytics.trend.signups], ["每日任务数", analytics.trend.tasks], ["每日消耗积分", analytics.trend.creditsConsumed], ["每日充值积分", analytics.trend.creditsToppedUp]].map(([label, series]) => {
              const rows = series as { day: string; value: number }[];
              const max = Math.max(1, ...rows.map((item) => item.value));
              return <div key={label as string}>
                <div className="credits-admin-summary"><b>{label as string}</b><span>近 {analytics.trend.days} 天</span></div>
                <div className="analytics-trend">
                  {rows.map((item) => <div className="analytics-bar" key={item.day}>
                    <em>{item.day.slice(5)}</em>
                    <i style={{ width: `${Math.max(2, Math.round((item.value / max) * 100))}%` }} />
                    <b>{item.value}</b>
                  </div>)}
                </div>
              </div>;
            })}
            <div className="credits-admin-summary"><b>失败原因分布</b><span>取状态为 failed/blocked 的任务</span></div>
            <div className="admin-table">
              <div className="admin-table-row head"><span>原因</span><span>次数</span></div>
              {analytics.breakdown.failureReasons.length ? analytics.breakdown.failureReasons.map((row) => <div className="admin-table-row" key={row.name}><b>{row.name}</b><span>{row.value}</span></div>) : <div className="admin-empty">暂无失败任务</div>}
            </div>
            <div className="credits-admin-summary"><b>调用最多的模型</b><span>Top {analytics.breakdown.topModels.length}</span></div>
            <div className="admin-table">
              <div className="admin-table-row head"><span>模型</span><span>任务数</span></div>
              {analytics.breakdown.topModels.length ? analytics.breakdown.topModels.map((row) => <div className="admin-table-row" key={row.name}><b>{row.name}</b><span>{row.value}</span></div>) : <div className="admin-empty">还没有任务</div>}
            </div>
            <div className="credits-admin-summary"><b>渠道分布</b><span>按 video_tasks.channel 统计</span></div>
            <div className="admin-table">
              <div className="admin-table-row head"><span>渠道</span><span>任务数</span></div>
              {analytics.breakdown.channels.length ? analytics.breakdown.channels.map((row) => <div className="admin-table-row" key={row.name}><b>{row.name}</b><span>{row.value}</span></div>) : <div className="admin-empty">还没有任务</div>}
            </div>
          </> : <div className="admin-empty">经营数据加载中…</div>}
        </section> : null}

        {tab === "users" ? <section className="admin-panel"><div className="admin-table"><div className="admin-table-row head"><span>用户邮箱</span><span>身份</span><span>项目</span><span>任务</span><span>注册时间</span></div>{overview.users.map((user) => <div className="admin-table-row" key={user.id}><b>{user.email}</b><span>{user.isAdmin ? "管理员" : "普通用户"}</span><span>{user.projectCount}</span><span>{user.taskCount}</span><span>{new Date(user.createdAt).toLocaleString("zh-CN")}</span></div>)}</div></section> : null}

        {tab === "pricing" ? <section className="admin-panel">
          {pricing ? <>
            <div className="credits-admin-summary">
              <b>价目来源</b>
              <span>{pricing.revision.source === "database" ? "数据库 pricing_rules" : "内置默认值（库里还没有规则）"}{pricing.revision.updatedAt ? ` · 最后改价 ${new Date(pricing.revision.updatedAt).toLocaleString("zh-CN")}` : ""}</span>
            </div>
            {pricing.rules.some((rule) => rule.shadowed) ? <div className="admin-blocker">
              有规则被遮蔽：{pricing.rules.filter((rule) => rule.shadowed).map((rule) => `${pricingModeNames[rule.mode] ?? rule.mode} ${rule.minSeconds}~${rule.maxSeconds}s`).join("、")}。
              它们和另一条更晚保存的规则完全同区间，1~30 秒里没有任何一秒会命中 —— 改了也不生效，建议删掉或改窄区间。
            </div> : null}
            {pricing.coverage.complete ? null : <div className="admin-blocker">
              报价缺口：自动模式缺 {pricing.coverage.missing.automatic.join("、") || "无"} 秒；人工模式缺 {pricing.coverage.missing.manual.join("、") || "无"} 秒。
              缺哪秒，用户选哪秒就会下单失败（CREDIT_QUOTE_INVALID）。
            </div>}
            <div className="admin-toolbar">
              <button className="primary" onClick={() => setPricingDraft(emptyDraft())}>新增规则</button>
              <button disabled={savingPricing} onClick={() => void runPricingAction(() => fetch("/api/admin/pricing", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "restore_default" }) }), "恢复默认价失败")}>恢复默认价</button>
              {savingPricing ? <span>处理中…</span> : null}
            </div>
            <div className="admin-table">
              <div className="admin-table-row head"><span>模式</span><span>计价方式</span><span>区间</span><span>状态</span><span>备注</span><span>最后修改</span><span>操作</span></div>
              {pricing.rules.length ? pricing.rules.map((rule) => <div className="admin-table-row" key={rule.id}>
                <b>{pricingModeNames[rule.mode] ?? rule.mode}</b>
                <span>{rule.flatCredits !== null ? `一口价 ${rule.flatCredits} 积分` : `${rule.creditsPerSecond} 积分/秒`}</span>
                <span>{rule.minSeconds}~{rule.maxSeconds} 秒</span>
                <span>{rule.shadowed ? "被遮蔽（不生效）" : rule.enabled ? "启用" : "停用"}</span>
                <span>{rule.note || "—"}</span>
                <span>{rule.updatedBy ?? "系统"} · {new Date(rule.updatedAt).toLocaleString("zh-CN")}</span>
                <div className="admin-actions">
                  <button onClick={() => setPricingDraft(draftFromRule(rule))}>编辑</button>
                  <button onClick={() => void runPricingAction(() => fetch("/api/admin/pricing", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: rule.id, mode: rule.mode, creditsPerSecond: rule.creditsPerSecond, flatCredits: rule.flatCredits, minSeconds: rule.minSeconds, maxSeconds: rule.maxSeconds, enabled: !rule.enabled, note: rule.note }) }), "状态切换失败")}>{rule.enabled ? "停用" : "启用"}</button>
                  <button className="danger" onClick={() => void runPricingAction(() => fetch(`/api/admin/pricing?id=${encodeURIComponent(rule.id)}`, { method: "DELETE" }), "删除失败")}>删除</button>
                </div>
              </div>) : <div className="admin-empty">还没有任何定价规则</div>}
            </div>

            {pricingDraft ? <div className="admin-panel">
              <div className="admin-form-row">
                <select value={pricingDraft.mode} onChange={(event) => setPricingDraft({ ...pricingDraft, mode: event.target.value as "automatic" | "manual" })}>
                  <option value="automatic">自动制作</option><option value="manual">人工兜底</option>
                </select>
                <select value={pricingDraft.kind} onChange={(event) => setPricingDraft({ ...pricingDraft, kind: event.target.value as "per_second" | "flat" })}>
                  <option value="per_second">按秒计价</option><option value="flat">一口价</option>
                </select>
                {pricingDraft.kind === "per_second"
                  ? <input value={pricingDraft.creditsPerSecond} onChange={(event) => setPricingDraft({ ...pricingDraft, creditsPerSecond: event.target.value })} placeholder="每秒积分" />
                  : <input value={pricingDraft.flatCredits} onChange={(event) => setPricingDraft({ ...pricingDraft, flatCredits: event.target.value })} placeholder="一口价积分" />}
                <input value={pricingDraft.minSeconds} onChange={(event) => setPricingDraft({ ...pricingDraft, minSeconds: event.target.value })} placeholder="最小秒" />
                <input value={pricingDraft.maxSeconds} onChange={(event) => setPricingDraft({ ...pricingDraft, maxSeconds: event.target.value })} placeholder="最大秒" />
                <input value={pricingDraft.note} onChange={(event) => setPricingDraft({ ...pricingDraft, note: event.target.value })} placeholder="备注（如：长片折扣）" />
                <label><input type="checkbox" checked={pricingDraft.enabled} onChange={(event) => setPricingDraft({ ...pricingDraft, enabled: event.target.checked })} /> 启用</label>
                <button className="primary" disabled={savingPricing} onClick={() => void savePricingRule()}>保存</button>
                <button onClick={() => setPricingDraft(null)}>取消</button>
              </div>
              <p className="admin-hint">优先级：区间更窄的优先 → 区间一样宽时最近保存的优先 → 再一样则一口价优先。所以「改基础价」请直接编辑默认那条；要叠「25~30 秒 · 一口价 150」做长片折扣，就新增一条窄区间规则。</p>
            </div> : null}

            <div className="credits-admin-summary"><b>当前生效价（自动模式）</b><span>1 积分 = 0.01 元</span></div>
            <div className="pricing-preview">
              {Array.from({ length: pricing.bounds.maxSeconds - pricing.bounds.minSeconds + 1 }, (_, index) => pricing.bounds.minSeconds + index).map((duration) => {
                const cost = pricing.table.automatic[duration];
                return <span key={duration} className={cost === undefined ? "missing" : ""}>{duration}s · {cost === undefined ? "无价" : `${cost} 积分 · ${(cost / 100).toFixed(2)} 元`}</span>;
              })}
            </div>
            <p className="admin-hint">改价只影响改价之后下的单；已经在跑的任务退款按当时实际扣掉的积分退还，不受影响。</p>
          </> : <div className="admin-empty">价目表加载中…</div>}
        </section> : null}

        {tab === "models" ? <section className="admin-panel">
          {catalog ? <>
            <div className="credits-admin-summary">
              <b>渠道模型 {catalog.channelModelCount} 个</b>
              <span>上架 {catalog.summary.enabled} · 下架 {catalog.summary.disabled}{catalog.summary.staleOverrides ? ` · 残留配置 ${catalog.summary.staleOverrides}` : ""}</span>
            </div>
            {catalog.channelError ? <div className="admin-blocker">渠道模型列表拉取失败：{catalog.channelError}（现在显示的是上次同步的快照加上你的覆盖配置）</div> : null}
            <div className="admin-toolbar">
              <input value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder="搜索模型 ID 或名称" />
              <select value="" onChange={(event) => { if (event.target.value) setModelDraft(draftFromModel(catalog.models.find((model) => model.id === event.target.value) as CatalogModelView)); }}>
                <option value="">选择模型来配置…</option>
                {catalog.models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}
              </select>
            </div>
            <div className="admin-table">
              <div className="admin-table-row head"><span>模型</span><span>ID</span><span>能力</span><span>时长档</span><span>状态</span><span>排序</span><span>加价</span><span>标签</span><span>操作</span></div>
              {visibleModels.length ? visibleModels.map((model) => <div className="admin-table-row" key={model.id}>
                <b>{model.displayName}</b>
                <span>{model.id}</span>
                <span>{model.modes.length ? model.modes.join("/") : "—"}</span>
                <span>{model.allowedDurations.length ? `${model.allowedDurations[0]}~${model.allowedDurations[model.allowedDurations.length - 1]}s` : "—"}</span>
                <span>{model.source === "override_only" ? "渠道已移除" : model.enabled ? "上架" : "下架"}</span>
                <span>{model.sortOrder}</span>
                <span>{model.surchargePercent ? `+${model.surchargePercent}%` : "—"}</span>
                <span>{model.tags.length ? model.tags.join("、") : "—"}</span>
                <div className="admin-actions">
                  <button onClick={() => setModelDraft(draftFromModel(model))}>配置</button>
                  <button onClick={() => void runModelAction(() => fetch("/api/admin/models", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ modelId: model.id, displayName: model.displayName, enabled: !model.enabled, sortOrder: model.sortOrder, tags: model.tags, surchargePercent: model.surchargePercent, note: model.note }) }), "状态切换失败")}>{model.enabled ? "下架" : "上架"}</button>
                  {model.override ? <button className="danger" onClick={() => void runModelAction(() => fetch(`/api/admin/models?modelId=${encodeURIComponent(model.id)}`, { method: "DELETE" }), "清除配置失败")}>清除配置</button> : null}
                </div>
              </div>) : <div className="admin-empty">没有匹配的模型</div>}
            </div>

            {modelDraft ? <div className="admin-panel">
              <div className="admin-form-row">
                <input value={modelDraft.modelId} readOnly placeholder="模型 ID" />
                <input value={modelDraft.displayName} onChange={(event) => setModelDraft({ ...modelDraft, displayName: event.target.value })} placeholder="中文显示名（留空用渠道原名）" />
                <input value={modelDraft.sortOrder} onChange={(event) => setModelDraft({ ...modelDraft, sortOrder: event.target.value })} placeholder="排序（小靠前）" />
                <input value={modelDraft.surchargePercent} onChange={(event) => setModelDraft({ ...modelDraft, surchargePercent: event.target.value })} placeholder="加价 %" />
                <input value={modelDraft.tags} onChange={(event) => setModelDraft({ ...modelDraft, tags: event.target.value })} placeholder="标签，顿号分隔" />
                <input value={modelDraft.note} onChange={(event) => setModelDraft({ ...modelDraft, note: event.target.value })} placeholder="备注" />
                <label><input type="checkbox" checked={modelDraft.enabled} onChange={(event) => setModelDraft({ ...modelDraft, enabled: event.target.checked })} /> 上架</label>
                <button className="primary" disabled={savingModel} onClick={() => void saveModelOverride()}>保存</button>
                <button onClick={() => setModelDraft(null)}>取消</button>
              </div>
              <p className="admin-hint">下架只影响源站：渠道里这个模型还能用，但用户看不到也下不了单。加价按「基础价 × (1 + 加价%)」向上取整，下单时生效。</p>
            </div> : null}
          </> : <div className="admin-empty">模型目录加载中…</div>}
        </section> : null}

        {tab === "assets" ? <section className="admin-panel">
          {assets ? <>
            <div className="credits-admin-summary">
              <b>素材 {assets.summary.returned} 个</b>
              <span>最多展示 {assets.summary.limit} 个 · 按上传时间倒序</span>
            </div>
            <div className="admin-toolbar">
              <input value={assetQuery} onChange={(event) => setAssetQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadAssets().catch(() => setError("素材库加载失败")); }} placeholder="搜索文件名、素材 ID 或上传者邮箱" />
              <select value={assetVisibility} onChange={(event) => setAssetVisibility(event.target.value as "" | AssetVisibility)}>
                <option value="">全部可见性</option>
                <option value="owner">仅本人</option>
                <option value="public">公共素材</option>
                <option value="taken_down">已下架</option>
              </select>
              <button className="primary" onClick={() => void loadAssets().catch(() => setError("素材库加载失败"))}>搜索</button>
              {savingAsset ? <span>处理中…</span> : null}
            </div>
            <p className="admin-hint">下架只影响「展示」：素材字节和历史任务的 manifest 原样保留，随时可以恢复。设为「公共素材」后，全站用户在做视频时能直接引用它。</p>
            <div className="admin-table">
              <div className="admin-table-row head"><span>素材</span><span>上传者</span><span>用途</span><span>大小</span><span>可见性</span><span>处置说明</span><span>预览</span><span>操作</span></div>
              {assets.assets.length ? assets.assets.map((asset) => <div className="admin-table-row" key={asset.id}>
                <b title={asset.id}>{asset.name || asset.id}</b>
                <span>{asset.ownerEmail}{asset.hiddenByOwner ? " · 已自行隐藏" : ""}</span>
                <span>{assetRoleNames[asset.role] ?? asset.role}</span>
                <span>{formatBytes(asset.byteSize)}</span>
                <span>{assetVisibilityNames[asset.visibility] ?? asset.visibility}</span>
                <span>{asset.reason || "—"}</span>
                <span><a href={asset.previewUrl} target="_blank" rel="noreferrer">打开</a></span>
                <div className="admin-actions">
                  {asset.visibility !== "public" ? <button className="success" onClick={() => void runAssetAction(() => fetch("/api/admin/assets", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetId: asset.id, visibility: "public" }) }), "设为公共素材失败")}>设公共</button> : null}
                  {asset.visibility !== "owner" ? <button onClick={() => void runAssetAction(() => fetch("/api/admin/assets", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetId: asset.id, visibility: "owner" }) }), "恢复为仅本人失败")}>恢复仅本人</button> : null}
                  {asset.visibility !== "taken_down" ? <button className="danger" onClick={() => setAssetDraft({ assetId: asset.id, visibility: "taken_down", reason: "" })}>下架</button> : null}
                </div>
              </div>) : <div className="admin-empty">没有匹配的素材</div>}
            </div>

            {assetDraft ? <div className="admin-panel">
              <div className="admin-form-row">
                <input value={assetDraft.assetId} readOnly placeholder="素材 ID" />
                <input value={assetDraft.reason} onChange={(event) => setAssetDraft({ ...assetDraft, reason: event.target.value })} placeholder="下架理由（必填，会记进审计）" />
                <button className="danger" disabled={savingAsset || !assetDraft.reason.trim()} onClick={() => void runAssetAction(() => fetch("/api/admin/assets", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetId: assetDraft.assetId, visibility: assetDraft.visibility, reason: assetDraft.reason }) }), "下架失败")}>确认下架</button>
                <button onClick={() => setAssetDraft(null)}>取消</button>
              </div>
              <p className="admin-hint">下架后任何人（含上传者）都看不到这个素材，但管理员仍能预览复核。理由必填——这是给用户的交代，也是日后复盘的依据。</p>
            </div> : null}
          </> : <div className="admin-empty">素材库加载中…</div>}
        </section> : null}

        {tab === "projects" ? <section className="admin-panel">
          {projects ? <>
            <div className="credits-admin-summary">
              <b>项目 {projects.summary.returned} 个</b>
              <span>其中已冻结 {projects.summary.frozen} 个 · 按最近更新倒序</span>
            </div>
            <div className="admin-toolbar">
              <input value={projectQuery} onChange={(event) => setProjectQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadProjects().catch(() => setError("项目列表加载失败")); }} placeholder="搜索项目名、项目 ID 或归属邮箱" />
              <button className="primary" onClick={() => void loadProjects().catch(() => setError("项目列表加载失败"))}>搜索</button>
            </div>
            <p className="admin-hint">后台刻意不提供「删除项目」：删项目会连带删掉画布、任务关联和素材关联，不可逆。要处置异常项目，请改状态为「已冻结」。</p>
            <div className="admin-table">
              <div className="admin-table-row head"><span>项目</span><span>归属</span><span>类型</span><span>状态</span><span>进度</span><span>素材</span><span>任务</span><span>更新时间</span><span>操作</span></div>
              {projects.projects.length ? projects.projects.map((project) => <div className="admin-table-row" key={project.id}>
                <b title={project.id}>{project.title || "(未命名)"}</b>
                <span>{project.ownerEmail}</span>
                <span>{project.type}</span>
                <span>{project.status}</span>
                <span>{project.progress}%</span>
                <span>{project.assetCount}</span>
                <span>{project.taskCount}</span>
                <span>{new Date(project.updatedAt).toLocaleString("zh-CN")}</span>
                <div className="admin-actions">
                  <select value="" disabled={savingProject === project.id} onChange={(event) => { if (event.target.value) void runProjectAction(project.id, event.target.value); }}>
                    <option value="">改状态…</option>
                    {projects.statuses.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                  {savingProject === project.id ? <span>处理中…</span> : null}
                </div>
              </div>) : <div className="admin-empty">没有匹配的项目</div>}
            </div>
          </> : <div className="admin-empty">项目列表加载中…</div>}
        </section> : null}

        {tab === "credits" ? <section className="admin-panel credits-admin-panel">
          <div className="credits-admin-summary"><b>用户积分余额</b><span>{overview.credits.wallets.reduce((total, wallet) => total + wallet.balance, 0)} 积分</span></div>
          <div className="admin-table"><div className="admin-table-row head"><span>用户邮箱</span><span>余额</span><span>待处理充值</span></div>{overview.credits.wallets.map((wallet) => <div className="admin-table-row" key={wallet.userId}><b>{wallet.userEmail}</b><span>{wallet.balance} 积分</span><span>{overview.credits.rechargeRequests.filter((request) => request.userId === wallet.userId && request.status === "pending").length} 笔</span></div>)}</div>
          <div className="recharge-request-list">{overview.credits.rechargeRequests.length ? overview.credits.rechargeRequests.map((request) => <article key={request.id}><div><b>{request.userEmail ?? "未知用户"}</b><span>申请 {request.requestedCredits} 积分 · {new Date(request.createdAt).toLocaleString("zh-CN")}</span>{request.note ? <p>{request.note}</p> : null}</div><div><em className={`recharge-status ${request.status}`}>{request.status === "pending" ? "待确认付款" : request.status === "approved" ? "已入账" : "已驳回"}</em>{request.status === "pending" ? <div className="admin-actions"><button className="success" disabled={busyTask === request.id} onClick={() => processRecharge(request.id, "approve_recharge")}>确认入账</button><button className="danger" disabled={busyTask === request.id} onClick={() => processRecharge(request.id, "reject_recharge")}>驳回</button></div> : null}</div></article>) : <div className="admin-empty">暂无充值申请</div>}</div>
        </section> : null}

        {tab === "channels" ? <section className="admin-panel">
          <div className="admin-table">
            <div className="admin-table-row head"><span>用户产品</span><span>内部执行渠道</span><span>状态</span></div>
            {(["video_s", "video_smini", "image_g"] as const).map((product) => <div className="admin-table-row" key={product}>
              <b>{product === "video_s" ? "全能视频 S" : product === "video_smini" ? "全能视频 Smini" : "全能图片 G"}</b>
              {product === "image_g" ? <span>暂未接入</span> : <select value={productRouting?.[product] ?? ""} disabled={!productRouting || savingProductRoute === product} onChange={(event) => { void saveProductRoute(product, event.target.value); }}>
                <option value="mimo">Mimo</option>
                <option value="astorie">AStorie</option>
                <option value="higgsfield">Higgsfield</option>
                <option value="miora">Miora</option>
                <option value="dola">Dola</option>
              </select>}
              <span>{savingProductRoute === product ? "保存中" : product === "image_g" ? "待接入图片执行器" : "已生效"}</span>
            </div>)}
          </div>
          <article className={`admin-worker-card ${overview.mimoWindowsWorker.readyToClaim ? "online" : "offline"}`}>
            <header><i /><div><b>Windows Mimo CDP 执行器</b><span>{overview.mimoWindowsWorker.readyToClaim ? "生产预检通过，可领取已授权的渠道 M 任务" : overview.mimoWindowsWorker.online ? "节点在线，但生产预检未通过" : overview.mimoWindowsWorker.configured ? "已配置但当前离线" : "服务密钥尚未配置"}</span></div></header>
            <div className="admin-worker-details">
              <span>节点：{overview.mimoWindowsWorker.workerId ?? "未登记"}</span>
              <span>状态：{overview.mimoWindowsWorker.status}</span>
              <span>当前任务：{overview.mimoWindowsWorker.activeTaskId ?? "无"}</span>
              <span>版本：{overview.mimoWindowsWorker.version ?? "未知"}</span>
              <span>心跳：{overview.mimoWindowsWorker.heartbeatAt ? new Date(overview.mimoWindowsWorker.heartbeatAt).toLocaleString("zh-CN") : "暂无"}</span>
            </div>
            {overview.mimoWindowsWorker.readiness ? <div className="admin-production-readiness">
              <article className={overview.mimoWindowsWorker.readiness.computer.workspaceWritable && overview.mimoWindowsWorker.readiness.computer.ffprobeAvailable ? "ready" : "blocked"}><b>Windows 环境</b><span>工作目录：{overview.mimoWindowsWorker.readiness.computer.workspaceWritable ? "可写" : "不可写"}</span><span>媒体探测：{overview.mimoWindowsWorker.readiness.computer.ffprobeAvailable ? "可用" : "缺少 ffprobe"}</span><small>{overview.mimoWindowsWorker.readiness.computer.arch} · {overview.mimoWindowsWorker.readiness.computer.hostname}</small></article>
              <article className={overview.mimoWindowsWorker.readiness.skills.state === "ready" ? "ready" : "blocked"}><b>执行包</b><span>{overview.mimoWindowsWorker.readiness.skills.state === "ready" ? `${overview.mimoWindowsWorker.readiness.skills.skills ?? 0} 项正常` : "校验失败"}</span><span>版本：{overview.mimoWindowsWorker.readiness.skills.bundleVersion ?? "未知"}</span><small>{overview.mimoWindowsWorker.readiness.skills.blocker ?? "候选包与技能路径已验证"}</small></article>
              <article className={overview.mimoWindowsWorker.readiness.channel.state === "ready" ? "ready" : "blocked"}><b>可见 Mimo 前端</b><span>{mimoChannelStateNames[overview.mimoWindowsWorker.readiness.channel.state] ?? overview.mimoWindowsWorker.readiness.channel.state}</span><span>额度：{overview.mimoWindowsWorker.readiness.channel.credits ?? "未读回"}</span><small>{overview.mimoWindowsWorker.readiness.channel.blocker ?? `${overview.mimoWindowsWorker.readiness.channel.model} · 无消费检查`}</small></article>
            </div> : null}
            {overview.mimoWindowsWorker.readiness && !overview.mimoWindowsWorker.readyToClaim ? <div className="admin-readiness-blocker">暂停接单：{overview.mimoWindowsWorker.readiness.blocker ?? "生产检查已过期，请等待 Windows 下一轮检查"}</div> : null}
            {overview.mimoWindowsWorker.summary ? <p>{overview.mimoWindowsWorker.summary}</p> : <p>新建渠道 M 任务只会由该 Windows Worker 领取；历史 Mac 任务保持原记录，不会自动迁移。</p>}
          </article>
          <article className={`admin-worker-card ${overview.macWorker.productionReady ? "online" : "offline"}`}>
            <header><i /><div><b>Mac Codex 历史兼容执行器</b><span>{overview.macWorker.productionReady ? "仅可继续已存在的 Mac 任务" : overview.macWorker.online ? "历史节点在线，但生产预检未通过" : overview.macWorker.configured ? "历史节点已配置但当前离线" : "历史节点未配置"}</span></div></header>
            <div className="admin-worker-details">
              <span>节点：{overview.macWorker.workerId ?? "未登记"}</span>
              <span>状态：{overview.macWorker.status}</span>
              <span>当前任务：{overview.macWorker.activeTaskId ?? "无"}</span>
              <span>版本：{overview.macWorker.version ?? "未知"}</span>
              <span>心跳：{overview.macWorker.heartbeatAt ? new Date(overview.macWorker.heartbeatAt).toLocaleString("zh-CN") : "暂无"}</span>
            </div>
            {overview.macWorker.readiness ? <div className="admin-production-readiness">
              <article className={overview.macWorker.readiness.computer.workspaceWritable && overview.macWorker.readiness.computer.ffprobeAvailable ? "ready" : "blocked"}><b>电脑环境</b><span>工作目录：{overview.macWorker.readiness.computer.workspaceWritable ? "可写" : "不可写"}</span><span>媒体探测：{overview.macWorker.readiness.computer.ffprobeAvailable ? "可用" : "缺少 ffprobe"}</span><small>{overview.macWorker.readiness.computer.arch} · {overview.macWorker.readiness.computer.hostname}</small></article>
              <article className={overview.macWorker.readiness.skills.state === "ready" ? "ready" : "blocked"}><b>生产技能</b><span>{overview.macWorker.readiness.skills.state === "ready" ? `${overview.macWorker.readiness.skills.skills ?? 0}/6 正常` : "校验失败"}</span><span>版本：{overview.macWorker.readiness.skills.bundleVersion ?? "未知"}</span><small>{overview.macWorker.readiness.skills.blocker ?? "文件哈希与渠道映射已验证"}</small></article>
              <article className={overview.macWorker.readiness.channel.state === "ready" ? "ready" : "blocked"}><b>Mac 上的 Mimo</b><span>{mimoChannelStateNames[overview.macWorker.readiness.channel.state] ?? overview.macWorker.readiness.channel.state}</span><span>额度：{overview.macWorker.readiness.channel.credits ?? "未读回"}</span><small>{overview.macWorker.readiness.channel.blocker ?? `${overview.macWorker.readiness.channel.model} · 无消费检查`}</small></article>
            </div> : null}
            {overview.macWorker.readiness && !overview.macWorker.productionReady ? <div className="admin-readiness-blocker">暂停接单：{overview.macWorker.readiness.blocker ?? "生产检查已过期，请等待 Mac 下一轮检查"}</div> : null}
            {overview.macWorker.summary ? <p>{overview.macWorker.summary}</p> : <p>仅用于保留和恢复历史 mac_codex 任务；新建渠道 M 任务不会由该节点领取。</p>}
          </article>
          <article className={`admin-worker-card ${overview.worker.online ? "online" : "offline"}`}>
            <header><i /><div><b>服务器辅助执行器</b><span>{overview.worker.online ? "在线，仅处理明确分配的服务器任务" : "当前未在线"}</span></div></header>
            <div className="admin-worker-details">
              <span>Skill：{overview.worker.codexAvailable ? "可用" : "不可用"}</span>
              <span>渠道 M 直连：{overview.worker.mimoDirectConfigured ? "已配置" : "待配置"}</span>
              <span>服务器：{overview.worker.serverConfigured ? "已配置" : "待配置"}</span>
              <span>模式：{overview.worker.modes.length ? overview.worker.modes.map((mode) => modeNames[mode] ?? mode).join(" + ") : "未启动"}</span>
              <span>心跳：{overview.worker.heartbeatAt ? new Date(overview.worker.heartbeatAt).toLocaleString("zh-CN") : "暂无"}</span>
            </div>
            {overview.worker.lastError ? <p>最近阻塞：{overview.worker.lastError}</p> : overview.worker.lastResult ? <p>最近结果：{overview.worker.lastResult}</p> : null}
          </article>
          <article className={`admin-worker-card ${overview.mioraSession?.state === "ready" ? "online" : "offline"}`}>
            <header><i /><div><b>Miora / S2 Video 会话中心</b><span>{overview.mioraSession?.state === "ready" ? "会话、积分与模型已读回" : "仅在需要本人操作时接管；不会保存平台凭据"}</span></div></header>
            <div className="admin-worker-details">
              <span>会话：{mioraReadinessNames[overview.mioraReadiness.state]}</span>
              <span>积分：{overview.mioraSession?.creditReadback ?? overview.mioraReadiness.credits ?? "未读回"}</span>
              <span>模型：{overview.mioraSession?.modelReadback ?? overview.mioraReadiness.model ?? "未读回"}</span>
              <span>最近预检：{overview.mioraSession?.lastPreflightAt ? new Date(overview.mioraSession.lastPreflightAt).toLocaleString("zh-CN") : "暂无"}</span>
              <span>最近成功：{overview.mioraSession?.lastSuccessAt ? new Date(overview.mioraSession.lastSuccessAt).toLocaleString("zh-CN") : "暂无"}</span>
            </div>
            {overview.mioraSession?.lastBlocker ? <p>最近阻塞：{overview.mioraSession.lastBlocker}</p> : <p>自动部分会固定走画布视频容器、S2 Video、参考图上传、参数读回、task-id 同步与媒体验收。</p>}
            <div className="admin-actions"><button onClick={() => openMioraSession(overview.mioraSession?.visibleProjectUrl)}>打开 Miora 会话</button><button className="admin-readiness-button" onClick={checkMioraReadiness} disabled={checkingMiora}>{checkingMiora ? "检查中…" : "我已登录，重新检查"}</button></div>
          </article>
          {overview.mioraHandoffs.length ? <section className="admin-channel-grid" aria-label="Miora 人工接管">
            {overview.mioraHandoffs.map((handoff) => <article key={handoff.id}><header><i className="standby" /><div><b>需要你操作：{handoff.action === "captcha" ? "真人验证" : handoff.action === "email_otp" ? "邮箱验证码" : handoff.action === "phone_otp" ? "手机验证码" : handoff.action === "terms" ? "确认平台条款" : "登录 Miora"}</b><span>任务 {handoff.taskId.slice(0, 10)} · 完成后任务会从原恢复点继续</span></div></header><p>{handoff.instructions}</p><div className="admin-actions"><button onClick={() => openMioraSession(handoff.browserUrl)}>打开对应会话</button><button className="success" onClick={() => { const task = overview.tasks.find((item) => item.id === handoff.taskId); if (task) void runAction(task, "miora_handoff_completed"); }}>我已完成，继续任务</button></div></article>)}
          </section> : null}
          <section className="admin-channel-grid" aria-label="Miora 渠道画像与真实模板">
            <article><header><i className={overview.mioraLearning.qaPassedCount ? "online" : "standby"} /><div><b>Miora · 渠道复利画像</b><span>只统计真实执行回执，不把教程、截图或 dry-run 当成功</span></div></header><div className="admin-channel-readiness"><span>回执：{overview.mioraLearning.receiptCount}</span><span>已获 task id：{overview.mioraLearning.providerTaskCount}</span><span>下载并探测：{overview.mioraLearning.downloadedAndProbedCount}</span><span>QA 通过：{overview.mioraLearning.qaPassedCount}</span><span>连续闭环：{overview.mioraLearning.consecutiveVerifiedCount}</span><span>QA 通过率：{overview.mioraLearning.qaPassRate === null ? "暂无" : `${Math.round(overview.mioraLearning.qaPassRate * 100)}%`}</span><span>当前并发上限：{overview.mioraLearning.stableConcurrencyLimit}</span><span>待本人接管：{overview.mioraLearning.activeHumanHandoffCount}</span></div><p>{overview.mioraLearning.concurrencyReason}</p><small>{overview.mioraLearning.costBaseline.note}</small></article>
            <article><header><i className={overview.mioraLearning.templates.length ? "online" : "standby"} /><div><b>Miora · 已验证模板库</b><span>仅来自同任务 ID 的 MP4、媒体探测与内容 QA 都通过的成片</span></div></header>{overview.mioraLearning.templates.length ? <div className="admin-audit-list">{overview.mioraLearning.templates.slice(0, 3).map((template) => <article key={template.sourceTaskId}><div><b>{template.model} · {template.resolution} · {template.durationSeconds}s · {template.aspectRatio}</b><span>素材职责：{template.referenceRoles.join(" / ") || "未记录"}</span><p>{template.prompt}</p></div><time>{new Date(template.completedAt).toLocaleString("zh-CN")}</time></article>)}</div> : <p>暂无可复用模板；先完成真实任务的下载、探测和内容 QA。</p>}</article>
          </section>
          <div className="admin-channel-grid">
            <article><header><i className={overview.mimoReadiness.state === "ready" ? "online" : "standby"} /><div><b>渠道 M · 服务器诊断</b><span>{mimoReadinessNames[overview.mimoReadiness.state]}</span></div></header><p>该检查仅用于排查服务器配置；客户是否能接单以上方 Windows Mimo CDP 执行器的生产预检为准。</p><div className="admin-channel-readiness"><span>网络：{overview.mimoReadiness.reachable === null ? "未检查" : overview.mimoReadiness.reachable ? "可达" : "不可达"}</span><span>会话：{overview.mimoReadiness.authenticated === null ? "未检查" : overview.mimoReadiness.authenticated ? "有效" : "无效"}</span>{overview.mimoReadiness.credits ? <span>额度读回：{overview.mimoReadiness.credits}</span> : null}<span>最后检查：{overview.mimoReadiness.checkedAt ? new Date(overview.mimoReadiness.checkedAt).toLocaleString("zh-CN") : "暂无"}</span></div><button className="admin-readiness-button" onClick={checkMimoReadiness} disabled={checkingMimo}>{checkingMimo ? "检查中…" : "检查服务器渠道 M"}</button><small>只验证连通性、会话与额度读回；不会上传素材或提交生成。</small></article>
            <article><header><i className={overview.dolaReadiness.state === "ready" ? "online" : "standby"} /><div><b>Dola · Windows Skill</b><span>{overview.dolaReadiness.state === "ready" ? "已登录，可路由" : overview.dolaReadiness.state === "interactive_login_required" ? "需要在 noVNC 登录" : overview.dolaReadiness.state === "region_restricted" ? "代理地区受限" : overview.dolaReadiness.state === "bridge_unreachable" ? "Dola2API 不可达" : "预检未通过"}</span></div></header><p>通过固定 Skill 路由连接本机 Dola2API；成本授权前必须再次通过实时预检。</p><div className="admin-channel-readiness"><span>代理：{overview.dolaReadiness.proxyConfigured ? "已配置" : "未就绪"}</span><span>CDP：{overview.dolaReadiness.cdpAvailable ? "可用" : "不可用"}</span><span>会话：{overview.dolaReadiness.authenticated ? "有效" : "需要登录"}</span><span>扩展：{overview.dolaReadiness.extensionCount}/2</span><span>最后检查：{new Date(overview.dolaReadiness.checkedAt).toLocaleString("zh-CN")}</span></div><button className="admin-readiness-button" onClick={checkDolaReadiness} disabled={checkingDola}>{checkingDola ? "检查中…" : "检查 Dola"}</button><small>此处只做登录、代理、CDP 和扩展预检；不会上传、提交或扣点。</small></article>
            <article><header><i className={overview.mioraReadiness.state === "ready" ? "online" : "standby"} /><div><b>Miora · 方法13</b><span>{mioraReadinessNames[overview.mioraReadiness.state]}</span></div></header><p>通过已登录的本机 Chrome CDP 执行；成本授权前必须读回会话、积分和 Seedance2 可见性。</p><div className="admin-channel-readiness"><span>网络：{overview.mioraReadiness.reachable === null ? "未检查" : overview.mioraReadiness.reachable ? "可达" : "不可达"}</span><span>会话：{overview.mioraReadiness.authenticated === null ? "未检查" : overview.mioraReadiness.authenticated ? "有效" : "无效"}</span><span>Seedance2：{overview.mioraReadiness.modelAvailable === null ? "未读回" : overview.mioraReadiness.modelAvailable ? "可见" : "未见"}</span><span>积分：{overview.mioraReadiness.credits ?? "未读回"}</span><span>最后检查：{overview.mioraReadiness.checkedAt ? new Date(overview.mioraReadiness.checkedAt).toLocaleString("zh-CN") : "暂无"}</span></div><button className="admin-readiness-button" onClick={checkMioraReadiness} disabled={checkingMiora}>{checkingMiora ? "检查中…" : "检查 Miora"}</button><small>{overview.mioraReadiness.blocker ?? "只读预检，不会上传素材、提交生成或扣点。"}</small></article>
          </div>
        </section> : null}

        {tab === "audit" ? <section className="admin-panel"><div className="admin-audit-list">{overview.events.length ? overview.events.map((event) => <article key={event.id}><i /><div><b>{eventNames[event.event] ?? event.event}</b><span>{event.userEmail} · 任务 {event.taskId.slice(0, 10)}</span><p>{event.detail || "无附加说明"}</p></div><time>{new Date(event.createdAt).toLocaleString("zh-CN")}</time></article>) : <div className="admin-empty">暂无审计事件</div>}</div></section> : null}
      </section>
      {costAuthorization ? <div className="credit-dialog-backdrop" role="presentation" onMouseDown={() => { if (!busyTask) setCostAuthorization(null); }}>
        <section className="credit-dialog" role="dialog" aria-modal="true" aria-labelledby="cost-authorization-title" onMouseDown={(event) => event.stopPropagation()}>
          <header><div><p>CHANNEL COST AUTHORIZATION</p><h2 id="cost-authorization-title">授权自动制作</h2></div><button type="button" className="icon-close" onClick={() => setCostAuthorization(null)} disabled={Boolean(busyTask)} aria-label="关闭">×</button></header>
          <p>任务 <b>{costAuthorization.id.slice(0, 10)}</b> 会在授权后由{costAuthorization.channel === "dola" ? "本机 Dola Skill 执行器" : costAuthorization.channel === "miora" ? "本机 Miora CDP 执行器" : "Windows Mimo CDP 执行器"}领取。系统只会提交这一次任务。</p>
          <label><span>渠道状态读回</span><input autoFocus value={costReadback} onChange={(event) => setCostReadback(event.target.value)} placeholder={costAuthorization.channel === "dola" ? "例如：Dola 已登录，当前点数可用" : costAuthorization.channel === "miora" ? "例如：Miora 已登录，1000 积分，Seedance2 可见" : "例如：Mimo 已登录，额度可用"} /></label>
          <label><span>本次最高允许成本</span><input value={maxCost} onChange={(event) => setMaxCost(event.target.value)} placeholder={costAuthorization.channel === "miora" ? "例如：最高 84 Miora 积分" : "例如：最高 5 Mimo 额度"} /></label>
          <small>确认后会进入对应自动队列；未确认不会提交{costAuthorization.channel === "dola" ? " Dola" : costAuthorization.channel === "miora" ? " Miora" : " Mimo"}。</small>
          <footer><button type="button" onClick={() => setCostAuthorization(null)} disabled={Boolean(busyTask)}>取消</button><button type="button" className="primary" disabled={!costReadback.trim() || !maxCost.trim() || Boolean(busyTask)} onClick={() => { void submitCostAuthorization(); }}>{busyTask ? "授权中…" : "确认并授权"}</button></footer>
        </section>
      </div> : null}
      {automaticRetry ? <div className="credit-dialog-backdrop" role="presentation" onMouseDown={() => { if (!busyTask) setAutomaticRetry(null); }}>
        <section className="credit-dialog" role="dialog" aria-modal="true" aria-labelledby="automatic-retry-title" onMouseDown={(event) => event.stopPropagation()}>
          <header><div><p>AUTOMATIC RETRY</p><h2 id="automatic-retry-title">重新交给自动执行</h2></div><button type="button" className="icon-close" onClick={() => setAutomaticRetry(null)} disabled={Boolean(busyTask)} aria-label="关闭">×</button></header>
          {automaticRetry.blocker === "automatic_generation_failed_manual_fallback" && automaticRetry.costAuthorized && !automaticRetry.providerTaskId ? <>
            <p>任务 <b>{automaticRetry.id.slice(0, 10)}</b> 在获得渠道任务编号前失败。将复用本任务现有授权，只重试一次自动提交；不会创建新任务或再次扣除网站积分。</p>
            <small>仅限没有渠道任务编号、没有成片的前置提交失败。Mac 领取后仍会遵守当前授权上限。</small>
          </> : <>
            <p>任务 <b>{automaticRetry.id.slice(0, 10)}</b> 会恢复为等待成本授权状态。本操作不会立即提交 Mimo，也不会扣除积分。</p>
            <small>确认后请重新填写渠道状态读回和本次最高允许成本，Mac 才会自动领取这一条任务。</small>
          </>}
          <footer><button type="button" onClick={() => setAutomaticRetry(null)} disabled={Boolean(busyTask)}>取消</button><button type="button" className="primary" disabled={Boolean(busyTask)} onClick={() => { void submitAutomaticRetry(); }}>{busyTask ? "恢复中…" : "确认恢复自动执行"}</button></footer>
        </section>
      </div> : null}
      {officialReconciliation ? <div className="credit-dialog-backdrop" role="presentation" onMouseDown={() => { if (!busyTask) setOfficialReconciliation(null); }}>
        <section className="credit-dialog" role="dialog" aria-modal="true" aria-labelledby="official-reconciliation-title" onMouseDown={(event) => event.stopPropagation()}>
          <header><div><p>OFFICIAL RESULT RECONCILIATION</p><h2 id="official-reconciliation-title">关联已完成成片</h2></div><button type="button" className="icon-close" onClick={() => setOfficialReconciliation(null)} disabled={Boolean(busyTask)} aria-label="关闭">×</button></header>
          <p>系统只会同步、下载、媒体探测并等待内容验收，不会重新生成或扣除积分。</p>
          <label><span>官方渠道任务 ID</span><input autoFocus value={officialProviderTaskId} onChange={(event) => setOfficialProviderTaskId(event.target.value)} placeholder="粘贴已完成任务 ID" /></label>
          <footer><button type="button" onClick={() => setOfficialReconciliation(null)} disabled={Boolean(busyTask)}>取消</button><button type="button" className="primary" disabled={!officialProviderTaskId.trim() || Boolean(busyTask)} onClick={() => { void submitOfficialReconciliation(); }}>{busyTask ? "关联中…" : "关联并回传"}</button></footer>
        </section>
      </div> : null}
      {outputReview ? <div className="credit-dialog-backdrop" role="presentation" onMouseDown={() => { if (!busyTask) setOutputReview(null); }}>
        <section className="credit-dialog" role="dialog" aria-modal="true" aria-labelledby="output-review-title" onMouseDown={(event) => event.stopPropagation()}>
          <header><div><p>CONTENT QA</p><h2 id="output-review-title">验收并交付</h2></div><button type="button" className="icon-close" onClick={() => setOutputReview(null)} disabled={Boolean(busyTask)} aria-label="关闭">×</button></header>
          <p>已回传的成片会再次通过媒体与时长校验，然后向客户开放播放和下载。</p>
          <footer><button type="button" onClick={() => setOutputReview(null)} disabled={Boolean(busyTask)}>取消</button><button type="button" className="primary" disabled={Boolean(busyTask)} onClick={() => { void submitOutputReview(); }}>{busyTask ? "验收中…" : "确认验收并交付"}</button></footer>
        </section>
      </div> : null}
    </main>
  );
}
