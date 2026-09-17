#!/bin/bash
cat > /tmp/probe_models2.mjs <<'EOF'
const base = (process.env.ZIYU_BASE_URL || "https://ziyuai.vip").replace(/\/$/, "");
const h = { Authorization: "Bearer " + process.env.ZIYU_API_KEY, Accept: "application/json" };
const r = await fetch(base + "/api/v1/models", { headers: h });
const j = await r.json();
const m = j.models || [];
console.log("activeModelId:", j.activeModelId);
console.log("count:", m.length);
for (const x of m) {
  console.log([x.id, x.name, x.type, (x.modes || []).join("/"), x.enabled ? "enabled" : "disabled", "cost=" + (x.cost ?? "-"), "ratios=" + (x.allowedRatios || []).join(","), "dur=" + (x.allowedDurations || []).slice(0, 12).join(","), "res=" + (x.resolution || "-")].join(" | "));
}
EOF
docker cp /tmp/probe_models2.mjs niannian-sd2-app:/tmp/probe_models2.mjs >/dev/null 2>&1
docker exec niannian-sd2-app node /tmp/probe_models2.mjs
