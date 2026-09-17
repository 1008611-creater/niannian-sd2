import { dbAll, dbOne } from "@/lib/auth";

/**
 * 后台经营看板的数据来源。
 *
 * 原则：只做**只读聚合**，不写任何东西；所有数字都能用 SQL 复算。
 * 成本一律标注为「估算」—— 渠道实际账单要以紫域后台为准，这里只是按
 * 1.5 倍加价反推出来的口径，不能当财务凭证。
 */

export const TREND_DAYS = 14;
const YUAN_PER_CREDIT = 0.01;
/** 用户价 = 渠道成本 × 1.5，所以渠道成本 ≈ 用户价 / 1.5。 */
const CHANNEL_MARKUP = 1.5;

type CountRow = { count: number | string };
type DayRow = { day: string; value: number | string };
type NamedRow = { name: string; value: number | string };

function asNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dayKey(offsetDays: number) {
  const date = new Date(Date.now() - offsetDays * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function fillDays(rows: DayRow[]) {
  const map = new Map(rows.map((row) => [row.day, asNumber(row.value)]));
  const series: Array<{ day: string; value: number }> = [];
  for (let offset = TREND_DAYS - 1; offset >= 0; offset -= 1) {
    const day = dayKey(offset);
    series.push({ day, value: map.get(day) ?? 0 });
  }
  return series;
}

async function scalar(sql: string, values: unknown[] = []) {
  const row = await dbOne<CountRow>(sql, values as never[]);
  return asNumber(row?.count);
}

export async function adminAnalytics() {
  const since = dayKey(TREND_DAYS - 1);

  const [
    totals,
    activeUsers,
    signups,
    taskTrend,
    consumedTrend,
    toppedUpTrend,
    failureReasons,
    topModels,
    channelSplit,
  ] = await Promise.all([
    dbOne<{ users: number | string; tasks: number | string; completed: number | string; failed: number | string; projects: number | string }>(
      `SELECT (SELECT COUNT(*) FROM users) AS users,
              (SELECT COUNT(*) FROM video_tasks) AS tasks,
              (SELECT COUNT(*) FROM video_tasks WHERE status = 'completed') AS completed,
              (SELECT COUNT(*) FROM video_tasks WHERE status IN ('failed','blocked')) AS failed,
              (SELECT COUNT(*) FROM projects) AS projects`,
    ),
    scalar("SELECT COUNT(DISTINCT user_id) AS count FROM video_tasks WHERE created_at >= ?", [since]),
    dbAll<DayRow>("SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS value FROM users WHERE created_at >= ? GROUP BY day", [since]),
    dbAll<DayRow>("SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS value FROM video_tasks WHERE created_at >= ? GROUP BY day", [since]),
    dbAll<DayRow>("SELECT substr(created_at, 1, 10) AS day, SUM(-amount) AS value FROM credit_ledger WHERE amount < 0 AND created_at >= ? GROUP BY day", [since]),
    dbAll<DayRow>(
      `SELECT substr(created_at, 1, 10) AS day, SUM(amount) AS value FROM credit_ledger
        WHERE reason IN ('recharge_approved', 'ldxp_redeem') AND created_at >= ? GROUP BY day`, [since],
    ),
    dbAll<NamedRow>(
      `SELECT COALESCE(blocker, status) AS name, COUNT(*) AS value FROM video_tasks
        WHERE status IN ('failed', 'blocked') GROUP BY COALESCE(blocker, status) ORDER BY value DESC LIMIT 8`,
    ),
    dbAll<NamedRow>(
      `SELECT model AS name, COUNT(*) AS value FROM video_tasks
        WHERE model IS NOT NULL AND model <> '' GROUP BY model ORDER BY value DESC LIMIT 10`,
    ),
    dbAll<NamedRow>("SELECT channel AS name, COUNT(*) AS value FROM video_tasks GROUP BY channel ORDER BY value DESC"),
  ]);

  const lifetime = await Promise.all([
    scalar("SELECT COALESCE(SUM(-amount), 0) AS count FROM credit_ledger WHERE amount < 0"),
    scalar("SELECT COALESCE(SUM(amount), 0) AS count FROM credit_ledger WHERE reason IN ('recharge_approved', 'ldxp_redeem')"),
    scalar("SELECT COALESCE(SUM(balance), 0) AS count FROM user_credits"),
  ]);

  const [creditsConsumed, creditsToppedUp, creditsOutstanding] = lifetime;
  const revenueYuan = creditsConsumed * YUAN_PER_CREDIT;
  const channelCostYuan = (creditsConsumed / CHANNEL_MARKUP) * YUAN_PER_CREDIT;

  const taskCount = asNumber(totals?.tasks);
  const completedCount = asNumber(totals?.completed);

  return {
    totals: {
      users: asNumber(totals?.users),
      projects: asNumber(totals?.projects),
      tasks: taskCount,
      completed: completedCount,
      failed: asNumber(totals?.failed),
      completionRate: taskCount ? completedCount / taskCount : null,
      activeUsers14d: activeUsers,
    },
    credits: {
      consumed: creditsConsumed,
      toppedUp: creditsToppedUp,
      outstanding: creditsOutstanding,
      yuanPerCredit: YUAN_PER_CREDIT,
      revenueYuan: Number(revenueYuan.toFixed(2)),
      channelCostYuan: Number(channelCostYuan.toFixed(2)),
      grossMarginYuan: Number((revenueYuan - channelCostYuan).toFixed(2)),
      /** 这句必须被 UI 显示出来，否则容易被当成实际账单。 */
      costBasis: `按用户价 ÷ ${CHANNEL_MARKUP} 反推的估算值，不是渠道实际账单`,
    },
    trend: {
      days: TREND_DAYS,
      signups: fillDays(signups),
      tasks: fillDays(taskTrend),
      creditsConsumed: fillDays(consumedTrend),
      creditsToppedUp: fillDays(toppedUpTrend),
    },
    breakdown: {
      failureReasons: failureReasons.map((row) => ({ name: row.name, value: asNumber(row.value) })),
      topModels: topModels.map((row) => ({ name: row.name, value: asNumber(row.value) })),
      channels: channelSplit.map((row) => ({ name: row.name, value: asNumber(row.value) })),
    },
  };
}

export type AdminAnalytics = Awaited<ReturnType<typeof adminAnalytics>>;
