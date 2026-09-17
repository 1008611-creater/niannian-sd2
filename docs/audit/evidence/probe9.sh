#!/bin/bash
cat > /tmp/probe_jobs2.mjs <<'EOF'
const base = (process.env.ZIYU_BASE_URL || "https://ziyuai.vip").replace(/\/$/, "");
const h = { Authorization: "Bearer " + process.env.ZIYU_API_KEY, Accept: "application/json" };
const r = await fetch(base + "/api/v1/jobs?limit=20", { headers: h });
const j = await r.json();
const jobs = j.jobs || [];
console.log("total_returned:", jobs.length);
for (const x of jobs) {
  console.log([x.id, x.status, x.mode, x.modelId || x.model || "", x.createdAt || x.created_at || "", x.cost ?? "", x.failureReason || x.error || ""].join(" | "));
}
console.log("keys:", Object.keys(jobs[0] || {}).join(","));
EOF
docker cp /tmp/probe_jobs2.mjs niannian-sd2-app:/tmp/probe_jobs2.mjs >/dev/null 2>&1
docker exec niannian-sd2-app node /tmp/probe_jobs2.mjs
