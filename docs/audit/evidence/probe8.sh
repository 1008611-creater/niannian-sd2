#!/bin/bash
cat > /tmp/probe_jobs.mjs <<'EOF'
const base = (process.env.ZIYU_BASE_URL || "https://ziyuai.vip").replace(/\/$/, "");
const h = { Authorization: "Bearer " + process.env.ZIYU_API_KEY, Accept: "application/json" };
try {
  const r = await fetch(base + "/api/v1/jobs?limit=20", { headers: h });
  const t = await r.text();
  console.log("HTTP", r.status);
  console.log(t.slice(0, 3000));
} catch (e) { console.log("ERR", e.message); }
EOF
docker cp /tmp/probe_jobs.mjs niannian-sd2-app:/tmp/probe_jobs.mjs >/dev/null 2>&1
docker exec niannian-sd2-app node /tmp/probe_jobs.mjs
echo "=== big files in public (>2M) ==="
find /srv/kidswear-data/staging/niannian-sd2-4998bd8/public -type f -size +2M -printf '%s %p\n' 2>/dev/null | sort -rn | head -15
echo "=== rsync? ==="
command -v rsync || echo NO_RSYNC
