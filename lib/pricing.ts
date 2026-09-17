import { createId, dbAll, dbRun, timestamp } from "@/lib/auth";

/**
 * 价目表的唯一权威来源。
 *
 * 之前价目表写死在 lib/credits.ts 里，改一次价要改代码、重新构建、重新发版。
 * 现在规则存在 pricing_rules 表里，后台改完立刻生效（写库后主动失效内存缓存），
 * 源站 /api/credits 与下单扣费都读同一份。
 *
 * 关键约束：改价只影响**改价之后**下的单。已经在跑的任务退款按 credit_ledger
 * 里实际扣掉的金额退，与当前价目表无关 —— 所以调价不会把在途订单算错。
 */

export const pricingModes = ["automatic", "manual"] as const;
export type PricingMode = (typeof pricingModes)[number];

/** 渠道侧硬边界：紫域 allowedDurations 实际是 1~30 秒。 */
export const PRICING_MIN_SECONDS = 1;
export const PRICING_MAX_SECONDS = 30;

/**
 * 默认单价：渠道成本 4 渠道点/秒 × 1.5 渠道加价 = 6 积分/秒。
 * 与改造前 lib/credits.ts 的 Math.ceil(4 × 1.5) 完全一致，不涨价、只把它挪进数据库。
 */
export const DEFAULT_CREDITS_PER_SECOND = 6;

export type PricingRule = {
  id: string;
  mode: PricingMode;
  /** 按秒线性计价：每秒多少积分。与 flatCredits 二选一。 */
  creditsPerSecond: number | null;
  /** 一口价：区间内不管几秒都收这么多。与 creditsPerSecond 二选一。 */
  flatCredits: number | null;
  minSeconds: number;
  maxSeconds: number;
  enabled: boolean;
  note: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type PricingRow = {
  id: string;
  mode: string;
  credits_per_second: number | string | null;
  flat_credits: number | string | null;
  min_seconds: number | string;
  max_seconds: number | string;
  enabled: number | string;
  note: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

function asInteger(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isInteger(parsed) ? parsed : 0;
}

export function validPricingMode(value: unknown): PricingMode | null {
  return typeof value === "string" && pricingModes.includes(value as PricingMode) ? (value as PricingMode) : null;
}

function publicRule(row: PricingRow): PricingRule {
  return {
    id: row.id,
    mode: (validPricingMode(row.mode) ?? "automatic") as PricingMode,
    creditsPerSecond: row.credits_per_second === null || row.credits_per_second === undefined ? null : asInteger(row.credits_per_second),
    flatCredits: row.flat_credits === null || row.flat_credits === undefined ? null : asInteger(row.flat_credits),
    minSeconds: asInteger(row.min_seconds),
    maxSeconds: asInteger(row.max_seconds),
    enabled: asInteger(row.enabled) === 1,
    note: row.note,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function defaultPricingRules(): PricingRule[] {
  const now = new Date(0).toISOString();
  return pricingModes.map((mode) => ({
    id: `default_${mode}`,
    mode,
    creditsPerSecond: DEFAULT_CREDITS_PER_SECOND,
    flatCredits: null,
    minSeconds: PRICING_MIN_SECONDS,
    maxSeconds: PRICING_MAX_SECONDS,
    enabled: true,
    note: "系统默认：渠道成本 4 点/秒 × 1.5",
    updatedBy: null,
    createdAt: now,
    updatedAt: now,
  }));
}

async function seedDefaultRules() {
  const now = timestamp();
  for (const mode of pricingModes) {
    await dbRun(
      `INSERT INTO pricing_rules (id, mode, credits_per_second, flat_credits, min_seconds, max_seconds, enabled, note, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, 1, ?, NULL, ?, ?) ON CONFLICT(id) DO NOTHING`,
      [`default_${mode}`, mode, DEFAULT_CREDITS_PER_SECOND, PRICING_MIN_SECONDS, PRICING_MAX_SECONDS, "系统默认：渠道成本 4 点/秒 × 1.5", now, now],
    );
  }
}

// ---------------------------------------------------------------------------
// 内存缓存：扣费路径是同步调用（taskCreditCost），不能每次都查库。
// 冷启动时用内置默认值兜底，随后由 ensurePricingLoaded() 换成库里的真实值。
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 30_000;

declare global {
  var niannianPricingCache: { loadedAt: number; rules: PricingRule[] } | undefined;
  var niannianPricingInflight: Promise<PricingRule[]> | undefined;
}

function cache() {
  return globalThis.niannianPricingCache ?? null;
}

async function loadRules(): Promise<PricingRule[]> {
  let rows = await dbAll<PricingRow>("SELECT * FROM pricing_rules ORDER BY mode, min_seconds, created_at");
  if (!rows.length) {
    // 首次接入：表里还没有规则，播两条默认价，保证源站和扣费都有价可用。
    await seedDefaultRules();
    rows = await dbAll<PricingRow>("SELECT * FROM pricing_rules ORDER BY mode, min_seconds, created_at");
  }
  return rows.map(publicRule);
}

/** 让调用方强制看到最新价（后台改价后调用）。 */
export function invalidatePricingCache() {
  globalThis.niannianPricingCache = undefined;
}

/** 在异步入口处调用，保证扣费用的是库里的最新价，而不是冷启动默认值。 */
export async function ensurePricingLoaded(force = false): Promise<PricingRule[]> {
  const current = cache();
  if (!force && current && Date.now() - current.loadedAt < CACHE_TTL_MS) return current.rules;
  if (!globalThis.niannianPricingInflight) {
    globalThis.niannianPricingInflight = loadRules()
      .then((rules) => {
        globalThis.niannianPricingCache = { loadedAt: Date.now(), rules };
        return rules;
      })
      .finally(() => {
        globalThis.niannianPricingInflight = undefined;
      });
  }
  return globalThis.niannianPricingInflight;
}

/** 同步读：拿当前已知规则，冷启动前退回内置默认值。 */
export function pricingRulesSync(): PricingRule[] {
  return cache()?.rules ?? defaultPricingRules();
}

/**
 * 命中规则，优先级从高到低：
 *   1. 区间更窄的（可以叠一条"25~30 秒一口价"做长片折扣，不必改整张表）
 *   2. 区间一样宽 → 最近改过的（后台新增一条同区间规则必须能盖住旧的，
 *      否则会出现"改了价但源站没变"这种最坑的情况）
 *   3. 还一样 → 一口价优先于按秒
 * 三条都必须确定，不能依赖数组原顺序。
 */
export function pricingRuleFor(mode: PricingMode, durationSeconds: number): PricingRule | null {
  const candidates = pricingRulesSync().filter((rule) =>
    rule.enabled && rule.mode === mode && durationSeconds >= rule.minSeconds && durationSeconds <= rule.maxSeconds,
  );
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const width = (a.maxSeconds - a.minSeconds) - (b.maxSeconds - b.minSeconds);
    if (width !== 0) return width;
    if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
    return Number(b.flatCredits !== null) - Number(a.flatCredits !== null);
  });
  return candidates[0];
}

/**
 * 找出「永远赢不了」的规则：1~30 秒里没有任何一秒会命中它。
 * 通常是后台新增了一条和旧规则完全同区间、但更早保存的规则 ——
 * 不标出来的话，管理员会以为自己改过价了，实际源站一动不动。
 */
function shadowedRuleIds(rules: PricingRule[]) {
  const winners = new Set<string>();
  for (const mode of pricingModes) {
    for (let duration = PRICING_MIN_SECONDS; duration <= PRICING_MAX_SECONDS; duration += 1) {
      const winner = pricingRuleFor(mode, duration);
      if (winner) winners.add(winner.id);
    }
  }
  return new Set(rules.filter((rule) => rule.enabled && !winners.has(rule.id)).map((rule) => rule.id));
}

/** 返回 null 表示该时长没有可用报价（后台能看到覆盖率缺口）。 */
export function pricingCostFor(mode: PricingMode, durationSeconds: number): number | null {
  const rule = pricingRuleFor(mode, durationSeconds);
  if (!rule) return null;
  const cost = rule.flatCredits !== null ? rule.flatCredits : Math.ceil(durationSeconds * (rule.creditsPerSecond ?? 0));
  return Number.isInteger(cost) && cost > 0 ? cost : null;
}

export function pricingTable(): { automatic: Record<number, number>; manual: Record<number, number> } {
  const table: { automatic: Record<number, number>; manual: Record<number, number> } = { automatic: {}, manual: {} };
  for (const mode of pricingModes) {
    for (let duration = PRICING_MIN_SECONDS; duration <= PRICING_MAX_SECONDS; duration += 1) {
      const cost = pricingCostFor(mode, duration);
      if (cost !== null) table[mode][duration] = cost;
    }
  }
  return table;
}

/** 1~30 秒里有哪些秒数没有报价 —— 有缺口说明用户会下单失败。 */
export function pricingCoverage() {
  const missing: Record<PricingMode, number[]> = { automatic: [], manual: [] };
  for (const mode of pricingModes) {
    for (let duration = PRICING_MIN_SECONDS; duration <= PRICING_MAX_SECONDS; duration += 1) {
      if (pricingCostFor(mode, duration) === null) missing[mode].push(duration);
    }
  }
  return {
    minSeconds: PRICING_MIN_SECONDS,
    maxSeconds: PRICING_MAX_SECONDS,
    missing,
    complete: missing.automatic.length === 0 && missing.manual.length === 0,
  };
}

export function pricingRevision() {
  const rules = pricingRulesSync();
  const latest = rules.reduce((acc, rule) => (rule.updatedAt > acc ? rule.updatedAt : acc), "");
  return { updatedAt: latest || null, loadedAt: cache()?.loadedAt ?? null, source: cache() ? "database" : "default" };
}

// ---------------------------------------------------------------------------
// 后台写操作
// ---------------------------------------------------------------------------

function normalizeRange(minSeconds: unknown, maxSeconds: unknown) {
  const min = Math.trunc(Number(minSeconds));
  const max = Math.trunc(Number(maxSeconds));
  if (!Number.isInteger(min) || !Number.isInteger(max)) throw new Error("PRICING_RANGE_INVALID");
  if (min < PRICING_MIN_SECONDS || max > PRICING_MAX_SECONDS || min > max) throw new Error("PRICING_RANGE_INVALID");
  return { min, max };
}

function normalizePrice(input: { creditsPerSecond?: unknown; flatCredits?: unknown }) {
  const hasPerSecond = input.creditsPerSecond !== undefined && input.creditsPerSecond !== null && input.creditsPerSecond !== "";
  const hasFlat = input.flatCredits !== undefined && input.flatCredits !== null && input.flatCredits !== "";
  if (hasPerSecond === hasFlat) throw new Error("PRICING_AMOUNT_INVALID");
  if (hasPerSecond) {
    const value = Math.trunc(Number(input.creditsPerSecond));
    if (!Number.isInteger(value) || value < 0 || value > 100_000) throw new Error("PRICING_AMOUNT_INVALID");
    return { creditsPerSecond: value, flatCredits: null };
  }
  const value = Math.trunc(Number(input.flatCredits));
  if (!Number.isInteger(value) || value < 0 || value > 10_000_000) throw new Error("PRICING_AMOUNT_INVALID");
  return { creditsPerSecond: null, flatCredits: value };
}

export async function upsertPricingRule(input: {
  id?: unknown;
  mode: unknown;
  creditsPerSecond?: unknown;
  flatCredits?: unknown;
  minSeconds: unknown;
  maxSeconds: unknown;
  enabled?: unknown;
  note?: unknown;
  actorEmail: string;
}) {
  const mode = validPricingMode(input.mode);
  if (!mode) throw new Error("PRICING_MODE_INVALID");
  const { min, max } = normalizeRange(input.minSeconds, input.maxSeconds);
  const price = normalizePrice(input);
  const enabled = input.enabled === undefined ? 1 : input.enabled ? 1 : 0;
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 280) : null;
  const id = typeof input.id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(input.id) ? input.id : createId();
  const now = timestamp();

  await dbRun(
    `INSERT INTO pricing_rules (id, mode, credits_per_second, flat_credits, min_seconds, max_seconds, enabled, note, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET mode = excluded.mode, credits_per_second = excluded.credits_per_second,
       flat_credits = excluded.flat_credits, min_seconds = excluded.min_seconds, max_seconds = excluded.max_seconds,
       enabled = excluded.enabled, note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    [id, mode, price.creditsPerSecond, price.flatCredits, min, max, enabled, note, input.actorEmail, now, now],
  );
  invalidatePricingCache();
  await ensurePricingLoaded(true);
  return { id };
}

export async function deletePricingRule(id: unknown) {
  if (typeof id !== "string" || !id) throw new Error("PRICING_RULE_INVALID");
  const remaining = await dbRunCountSafe(id);
  if (!remaining) throw new Error("PRICING_RULE_NOT_FOUND");
  invalidatePricingCache();
  await ensurePricingLoaded(true);
  return { id };
}

async function dbRunCountSafe(id: string) {
  const before = await dbAll<{ id: string }>("SELECT id FROM pricing_rules WHERE id = ? LIMIT 1", [id]);
  if (!before.length) return false;
  await dbRun("DELETE FROM pricing_rules WHERE id = ?", [id]);
  return true;
}

/** 一键回到出厂价：删掉全部自定义规则，重新播默认两条。 */
export async function restoreDefaultPricing(actorEmail: string) {
  await dbRun("DELETE FROM pricing_rules", []);
  await seedDefaultRules();
  const now = timestamp();
  await dbRun("UPDATE pricing_rules SET updated_by = ?, updated_at = ?", [actorEmail, now]);
  invalidatePricingCache();
  await ensurePricingLoaded(true);
  return { restored: pricingModes.length };
}

export type AdminPricingRule = PricingRule & { shadowed: boolean };

export async function adminPricingSnapshot() {
  const rules = await ensurePricingLoaded();
  const shadowed = shadowedRuleIds(rules);
  return {
    rules: rules.map((rule) => ({ ...rule, shadowed: shadowed.has(rule.id) })) as AdminPricingRule[],
    table: pricingTable(),
    coverage: pricingCoverage(),
    revision: pricingRevision(),
    bounds: { minSeconds: PRICING_MIN_SECONDS, maxSeconds: PRICING_MAX_SECONDS },
  };
}
