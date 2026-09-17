#!/bin/bash
echo "=== tables ==="
docker exec niannian-sd2-postgres sh -c 'psql -U "$POSTGRES_USER" -d niannian -tAc "select table_schema||'"'"'.'"'"'||table_name from information_schema.tables where table_schema not in ('"'"'information_schema'"'"','"'"'pg_catalog'"'"') order by 1 limit 80"'
echo "=== ziyu models ==="
cat > /tmp/probe_ziyu.mjs <<'EOF'
const base = (process.env.ZIYU_BASE_URL || "https://ziyuai.vip").replace(/\/$/, "");
try {
  const r = await fetch(base + "/api/v1/models", { headers: { Authorization: "Bearer " + process.env.ZIYU_API_KEY, Accept: "application/json" } });
  const t = await r.text();
  console.log("HTTP", r.status);
  console.log(t.slice(0, 1800));
} catch (e) {
  console.log("ERR", e.message);
}
EOF
docker cp /tmp/probe_ziyu.mjs niannian-sd2-app:/tmp/probe_ziyu.mjs >/dev/null 2>&1
docker exec niannian-sd2-app node /tmp/probe_ziyu.mjs
