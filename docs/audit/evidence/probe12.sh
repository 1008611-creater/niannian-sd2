#!/bin/bash
echo "=== app PG env (len only) ==="
docker exec niannian-sd2-app sh -c 'printenv | grep -iE "^(POSTGRES|DATABASE|PG|PGHOST)" | while IFS= read -r line; do k="${line%%=*}"; v="${line#*=}"; printf "%s=%s\n" "$k" "${#v}"; done'
echo "=== pg connectivity from app ==="
cat > /tmp/pg_probe.mjs <<'EOF'
import pg from "pg";
const cfg = {
  host: process.env.POSTGRES_HOST || "niannian-sd2-postgres",
  port: Number(process.env.POSTGRES_PORT || 5432),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
};
console.log("host=", cfg.host, "db=", JSON.stringify(cfg.database), "user=", JSON.stringify(cfg.user));
const c = new pg.Client(cfg);
try {
  await c.connect();
  const r = await c.query("select current_database() db, current_user u");
  console.log("connected:", JSON.stringify(r.rows[0]));
  const t = await c.query("select table_schema, table_name from information_schema.tables where table_schema not in ('pg_catalog','information_schema') order by 1,2 limit 60");
  console.log("tables:", t.rowCount);
  for (const row of t.rows) console.log("  ", row.table_schema + "." + row.table_name);
  for (const tbl of ["users", "sessions", "video_tasks"]) {
    try {
      const q = await c.query('select count(*)::int c from "' + tbl + '"');
      console.log("count", tbl, q.rows[0].c);
    } catch (e) { console.log("count", tbl, "ERR", e.message.slice(0, 90)); }
  }
  await c.end();
} catch (e) { console.log("PG_ERR", e.message.slice(0, 200)); }
EOF
docker cp /tmp/pg_probe.mjs niannian-sd2-app:/tmp/pg_probe.mjs >/dev/null 2>&1
docker exec -w /app niannian-sd2-app node /tmp/pg_probe.mjs
