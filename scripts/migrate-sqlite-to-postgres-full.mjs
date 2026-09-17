#!/usr/bin/env node
/**
 * migrate-sqlite-to-postgres-full.mjs — 全量 SQLite → Postgres 迁移
 *
 * 为什么需要它：
 *   官方 scripts/migrate-sqlite-to-postgres.mjs 只搬 users 一张表。
 *   真实 SQLite 里有 12 张非空表（users/sessions/user_credits/otp_codes/
 *   credit_ledger/projects/uploaded_assets/auth_audit ...），只搬 users 会
 *   让积分余额、项目、资产、审计日志全部丢失 —— 那是钱和账，不能丢。
 *
 * 行为：
 *   1. 执行权威建表 DDL（deploy/schema-auth.sql，从 lib/auth.ts 抽取），幂等；
 *   2. 逐表从 SQLite 读全量行写入 Postgres，ON CONFLICT DO NOTHING（可重跑）；
 *   3. 迁移后逐表对账，行数不一致即抛错退出（非零退出码）。
 *
 * 用法：
 *   node scripts/migrate-sqlite-to-postgres-full.mjs [--dry-run] [--schema <path>]
 * 依赖环境变量：DATABASE_URL；可选 SQLITE_DATABASE_PATH、DATABASE_SSL
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import initSqlJs from "sql.js";
import pg from "pg";

const { Pool } = pg;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const schemaArg = args.indexOf("--schema");
const schemaPath =
  schemaArg >= 0 && args[schemaArg + 1]
    ? path.resolve(args[schemaArg + 1])
    : path.join(process.cwd(), "schema-auth.sql");

const sqlitePath = process.env.SQLITE_DATABASE_PATH
  ? path.resolve(process.env.SQLITE_DATABASE_PATH)
  : path.join(process.cwd(), "data", "niannian-auth.sqlite");

const databaseUrl = process.env.DATABASE_URL;
if (!dryRun && !databaseUrl) {
  throw new Error("DATABASE_URL is required unless --dry-run is used");
}

// ---------- 1. 读 SQLite ----------
const SQL = await initSqlJs({
  locateFile: (file) => path.join(process.cwd(), "node_modules", "sql.js", "dist", file),
});
const sqlite = new SQL.Database(await readFile(sqlitePath));

function sqliteAll(sql) {
  const stmt = sqlite.prepare(sql);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

const tables = sqliteAll(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
).map((r) => r.name);

const sqliteCounts = {};
const payload = {};
for (const table of tables) {
  const rows = sqliteAll(`SELECT * FROM "${table}"`);
  sqliteCounts[table] = rows.length;
  payload[table] = rows;
}
sqlite.close();

console.log("== SQLite 源 ==  " + sqlitePath);
for (const t of tables) {
  if (sqliteCounts[t] > 0) console.log(`   ${t.padEnd(28)} ${sqliteCounts[t]}`);
}
console.log(`   非空表 ${Object.values(sqliteCounts).filter((n) => n > 0).length} / 共 ${tables.length}`);

if (dryRun) {
  console.log(JSON.stringify({ dryRun: true, sqlitePath, tables: sqliteCounts, migrated: false }));
  process.exit(0);
}

// ---------- 2. 建表（幂等）----------
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});
const client = await pool.connect();

let schemaApplied = false;
try {
  const ddl = await readFile(schemaPath, "utf8");
  await client.query(ddl);
  schemaApplied = true;
} catch (error) {
  console.log("!! 建表 DDL 未执行：" + String(error.message).slice(0, 160));
  console.log("   预期路径 " + schemaPath + " —— 若缺失，请先 docker cp 进去再跑。");
}

// ---------- 3. 逐表写入 ----------
const pgColumns = {};
const colRes = await client.query(
  `SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema='public' ORDER BY table_name, ordinal_position`,
);
for (const row of colRes.rows) {
  (pgColumns[row.table_name] ||= []).push(row.column_name);
}

// 3a. 按外键依赖做拓扑排序（否则会撞 FK，例：asset_reference_metadata → uploaded_assets）
const fkRes = await client.query(
  `SELECT tc.table_name AS child, ccu.table_name AS parent
     FROM information_schema.table_constraints tc
     JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`,
);
const parentsOf = new Map(tables.map((t) => [t, new Set()]));
for (const row of fkRes.rows) {
  if (row.child === row.parent) continue; // 自引用忽略
  if (parentsOf.has(row.child) && tables.includes(row.parent)) parentsOf.get(row.child).add(row.parent);
}

const ordered = [];
const visited = new Map();
function visit(table, stack) {
  if (visited.get(table) === "done") return;
  if (visited.get(table) === "visiting") {
    console.log("!! 检测到外键环，环内改用 deferrable 顺序：" + [...stack, table].join(" -> "));
    return;
  }
  visited.set(table, "visiting");
  for (const p of parentsOf.get(table) ?? []) visit(p, [...stack, table]);
  visited.set(table, "done");
  ordered.push(table);
}
for (const t of tables) visit(t, []);
const insertOrder = ordered.filter((t) => (payload[t] || []).length > 0);

console.log("== 插入顺序（按外键依赖）== " + insertOrder.join(" -> "));

const skipped = [];
const inserted = {};
try {
  await client.query("BEGIN");
  for (const table of insertOrder) {
    const rows = payload[table];
    if (!rows.length) continue;
    const cols = pgColumns[table];
    if (!cols) {
      skipped.push(table);
      continue;
    }
    const usable = Object.keys(rows[0]).filter((c) => cols.includes(c));
    if (!usable.length) {
      skipped.push(table);
      continue;
    }
    const columnList = usable.map((c) => `"${c}"`).join(", ");
    const placeholders = usable.map((_, i) => `$${i + 1}`).join(", ");
    const sql = `INSERT INTO "${table}" (${columnList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
    let n = 0;
    for (const row of rows) {
      const values = usable.map((c) => {
        const v = row[c];
        return v instanceof Uint8Array ? Buffer.from(v) : v ?? null;
      });
      const res = await client.query(sql, values);
      n += res.rowCount ?? 0;
    }
    inserted[table] = n;
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
}

// ---------- 4. 对账 ----------
const mismatches = [];
const pgCounts = {};
for (const table of tables) {
  if (!pgColumns[table]) continue;
  const r = await client.query(`SELECT count(*)::int c FROM "${table}"`);
  pgCounts[table] = r.rows[0].c;
  if (r.rows[0].c !== sqliteCounts[table]) {
    mismatches.push({ table, sqlite: sqliteCounts[table], postgres: r.rows[0].c });
  }
}

console.log("== 迁移结果 ==");
for (const t of Object.keys(inserted)) console.log(`   ${t.padEnd(28)} +${inserted[t]}`);
if (skipped.length) console.log("   跳过（Postgres 无此表）：" + skipped.join(", "));

console.log(JSON.stringify({ schemaApplied, sqliteCounts, pgCounts, inserted, mismatches }));

client.release();
await pool.end();

if (mismatches.length) {
  console.error("!! 对账失败：" + JSON.stringify(mismatches));
  process.exit(1);
}
console.log("OK 全表行数一致");
