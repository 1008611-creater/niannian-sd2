import { dbAll, dbRun, timestamp } from "@/lib/auth";
import { listZiyuModels, type ZiyuModel } from "@/lib/ziyu-api";

/**
 * 模型目录 = 紫域渠道模型 + 后台覆盖。
 *
 * 紫域只能告诉我们"有哪些模型、支持哪些参数"，它不知道：
 *   - 哪个模型要下架（渠道还能用，但我不想卖）
 *   - 模型叫什么中文名（渠道返回的是 zy_model_xxx）
 *   - 哪个模型要靠前排、要不要打「热门」
 *   - 哪个模型成本更高、要加价
 *
 * 这些存在 model_overrides 表里，按 model_id 覆盖。渠道没有的模型也能预先配
 * （source=override_only），渠道加回来时自动生效。
 */

export type ModelOverride = {
  modelId: string;
  displayName: string | null;
  enabled: boolean;
  sortOrder: number;
  tags: string[];
  surchargePercent: number;
  note: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CatalogModel = ZiyuModel & {
  displayName: string;
  enabled: boolean;
  sortOrder: number;
  tags: string[];
  surchargePercent: number;
  note: string | null;
  /** channel=渠道有；override_only=渠道列表里没有了，只剩我们的配置 */
  source: "channel" | "override_only";
  override: boolean;
};

type OverrideRow = {
  model_id: string;
  display_name: string | null;
  enabled: number | string;
  sort_order: number | string;
  tags: string | null;
  surcharge_percent: number | string;
  note: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

function asInteger(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isInteger(parsed) ? parsed : 0;
}

function parseTags(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 12) : [];
  } catch {
    return [];
  }
}

function publicOverride(row: OverrideRow): ModelOverride {
  return {
    modelId: row.model_id,
    displayName: row.display_name,
    enabled: asInteger(row.enabled) === 1,
    sortOrder: asInteger(row.sort_order),
    tags: parseTags(row.tags),
    surchargePercent: asInteger(row.surcharge_percent),
    note: row.note,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const CACHE_TTL_MS = 30_000;

declare global {
  var niannianModelOverrideCache: { loadedAt: number; overrides: ModelOverride[] } | undefined;
}

export function invalidateModelOverrideCache() {
  globalThis.niannianModelOverrideCache = undefined;
}

async function loadOverrides(force = false): Promise<ModelOverride[]> {
  const cached = globalThis.niannianModelOverrideCache;
  if (!force && cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.overrides;
  const rows = await dbAll<OverrideRow>("SELECT * FROM model_overrides");
  const overrides = rows.map(publicOverride);
  globalThis.niannianModelOverrideCache = { loadedAt: Date.now(), overrides };
  return overrides;
}

function overrideMap(overrides: ModelOverride[]) {
  return new Map(overrides.map((override) => [override.modelId, override]));
}

function merge(channelModels: ZiyuModel[], overrides: ModelOverride[]): CatalogModel[] {
  const byId = overrideMap(overrides);
  const merged: CatalogModel[] = channelModels.map((model) => {
    const override = byId.get(model.id);
    return {
      ...model,
      displayName: override?.displayName || model.name,
      enabled: override ? override.enabled : true,
      sortOrder: override?.sortOrder ?? 0,
      tags: override?.tags ?? [],
      surchargePercent: override?.surchargePercent ?? 0,
      note: override?.note ?? null,
      source: "channel" as const,
      override: Boolean(override),
    };
  });
  // 渠道已经下架、但我们还有配置的模型，也要在后台可见（否则没法清理）。
  const channelIds = new Set(channelModels.map((model) => model.id));
  for (const override of overrides) {
    if (channelIds.has(override.modelId)) continue;
    merged.push({
      id: override.modelId,
      name: override.displayName || override.modelId,
      type: "unknown",
      modes: [],
      allowedDurations: [],
      allowedRatios: [],
      allowedAssetTypes: [],
      assetLimits: {},
      resolution: "",
      promptMaxLength: 0,
      cost: null,
      costPerSecond: null,
      durationCosts: {},
      displayName: override.displayName || override.modelId,
      enabled: override.enabled,
      sortOrder: override.sortOrder,
      tags: override.tags,
      surchargePercent: override.surchargePercent,
      note: override.note,
      source: "override_only",
      override: true,
    });
  }
  merged.sort((a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName, "zh-CN"));
  return merged;
}

/** 面向用户的目录：只给上架的，按排序和中文名排好。渠道挂了就用空目录，不谎报。 */
export async function listPublicModels(): Promise<CatalogModel[]> {
  // 不在这里吞掉渠道错误：源站要能区分「渠道挂了」和「模型全下架了」，
  // 否则用户只会看到空列表，以为是自己没权限。
  const [channelModels, overrides] = await Promise.all([listZiyuModels(), loadOverrides()]);
  return merge(channelModels, overrides).filter((model) => model.enabled && model.source === "channel");
}

/** 面向后台的完整目录：含已下架、含渠道已移除的残留配置。 */
export async function adminModelCatalog() {
  let channelModels: ZiyuModel[] = [];
  let channelError: string | null = null;
  try {
    channelModels = await listZiyuModels();
  } catch (error) {
    channelError = error instanceof Error ? error.message : "CHANNEL_MODEL_LIST_FAILED";
  }
  const overrides = await loadOverrides();
  const models = merge(channelModels, overrides);
  return {
    models,
    channelModelCount: channelModels.length,
    overrideCount: overrides.length,
    channelError,
    summary: {
      total: models.length,
      enabled: models.filter((model) => model.enabled).length,
      disabled: models.filter((model) => !model.enabled).length,
      staleOverrides: models.filter((model) => model.source === "override_only").length,
    },
  };
}

/** 下单校验用：按 id 找到模型（不管有没有上架），以便区分「不存在」和「已下架」。 */
export async function catalogModelById(modelId: string): Promise<CatalogModel | null> {
  const [channelModels, overrides] = await Promise.all([
    listZiyuModels().catch(() => [] as ZiyuModel[]),
    loadOverrides(),
  ]);
  return merge(channelModels, overrides).find((model) => model.id === modelId) ?? null;
}

function normalizeSurcharge(value: unknown) {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = Math.trunc(Number(value));
  if (!Number.isInteger(parsed) || parsed < -90 || parsed > 500) throw new Error("MODEL_SURCHARGE_INVALID");
  return parsed;
}

function normalizeSortOrder(value: unknown) {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = Math.trunc(Number(value));
  if (!Number.isInteger(parsed) || parsed < -100000 || parsed > 100000) throw new Error("MODEL_SORT_INVALID");
  return parsed;
}

export async function upsertModelOverride(input: {
  modelId: unknown;
  displayName?: unknown;
  enabled?: unknown;
  sortOrder?: unknown;
  tags?: unknown;
  surchargePercent?: unknown;
  note?: unknown;
  actorEmail: string;
}) {
  const modelId = typeof input.modelId === "string" ? input.modelId.trim() : "";
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(modelId)) throw new Error("MODEL_ID_INVALID");
  const displayName = typeof input.displayName === "string" && input.displayName.trim() ? input.displayName.trim().slice(0, 120) : null;
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 280) : null;
  const tags = Array.isArray(input.tags)
    ? input.tags.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 24)).filter(Boolean).slice(0, 12)
    : typeof input.tags === "string"
      ? input.tags.split(/[,，\s]+/).map((item) => item.trim().slice(0, 24)).filter(Boolean).slice(0, 12)
      : [];
  const now = timestamp();
  await dbRun(
    `INSERT INTO model_overrides (model_id, display_name, enabled, sort_order, tags, surcharge_percent, note, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(model_id) DO UPDATE SET display_name = excluded.display_name, enabled = excluded.enabled,
       sort_order = excluded.sort_order, tags = excluded.tags, surcharge_percent = excluded.surcharge_percent,
       note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    [
      modelId,
      displayName,
      input.enabled === undefined ? 1 : input.enabled ? 1 : 0,
      normalizeSortOrder(input.sortOrder),
      JSON.stringify(tags),
      normalizeSurcharge(input.surchargePercent),
      note,
      input.actorEmail,
      now,
      now,
    ],
  );
  invalidateModelOverrideCache();
  return { modelId };
}

export async function deleteModelOverride(modelId: unknown) {
  const id = typeof modelId === "string" ? modelId.trim() : "";
  if (!id) throw new Error("MODEL_ID_INVALID");
  const existing = await dbAll<{ model_id: string }>("SELECT model_id FROM model_overrides WHERE model_id = ? LIMIT 1", [id]);
  if (!existing.length) throw new Error("MODEL_OVERRIDE_NOT_FOUND");
  await dbRun("DELETE FROM model_overrides WHERE model_id = ?", [id]);
  invalidateModelOverrideCache();
  return { modelId: id };
}

export async function modelSurchargePercent(modelId: string | undefined) {
  if (!modelId) return 0;
  const overrides = await loadOverrides();
  return overrideMap(overrides).get(modelId)?.surchargePercent ?? 0;
}
