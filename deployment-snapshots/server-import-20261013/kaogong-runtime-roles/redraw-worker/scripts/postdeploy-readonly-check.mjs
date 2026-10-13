#!/usr/bin/env node

import process from "node:process";
import { releaseCandidate } from "./release-candidate-config.mjs";

const expected = {
  releaseId: releaseCandidate.releaseId,
  macWorkerVersion: releaseCandidate.macWorkerVersion,
  skillBundleVersion: releaseCandidate.skillBundleVersion,
  referenceContractVersion: releaseCandidate.referenceContractVersion,
};

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

async function json(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`READONLY_CHECK_HTTP_FAILED:${response.status}:${url.pathname}`);
  return payload;
}

const origin = new URL(argument("--origin", "http://127.0.0.1:3026"));
if (!new Set(["http:", "https:"]).has(origin.protocol)) throw new Error("ORIGIN_INVALID");
const health = await json(new URL("/api/health", origin));
if (health.release?.releaseId !== expected.releaseId || health.release?.referenceContractVersion !== expected.referenceContractVersion) {
  throw new Error("WEBSITE_RELEASE_IDENTITY_MISMATCH");
}
for (const pathname of ["/", "/login", "/guide", "/showcase"]) {
  const response = await fetch(new URL(pathname, origin), { redirect: "manual", signal: AbortSignal.timeout(15_000) });
  if (response.status !== 200) throw new Error(`PUBLIC_ROUTE_FAILED:${pathname}:${response.status}`);
}

const token = String(process.env.MAC_CODEX_AGENT_TOKEN || "").trim();
if (token.length < 24) throw new Error("MAC_CODEX_AGENT_TOKEN_REQUIRED_FOR_READONLY_STATUS");
const status = await json(new URL("/api/internal/mac-codex/status", origin), {
  headers: { authorization: `Bearer ${token}` },
});
if (status.diagnostics?.release?.macWorkerVersion !== expected.macWorkerVersion) throw new Error("SERVER_REQUIRED_MAC_VERSION_MISMATCH");
if (status.state?.version !== expected.macWorkerVersion) throw new Error("MAC_WORKER_VERSION_MISMATCH");
if (status.state?.readiness?.skills?.bundleVersion !== expected.skillBundleVersion) throw new Error("MAC_SKILL_BUNDLE_VERSION_MISMATCH");
if (status.state?.readiness?.readyToClaim !== true) throw new Error("MAC_WORKER_NOT_READY");
if (status.state?.readiness?.channel?.state !== "ready" || status.state?.readiness?.channel?.authenticated !== true) throw new Error("MIMO_READINESS_FAILED");
const queue = status.diagnostics?.queue || {};
if (queue.approvedForExecution || queue.runningOnMac || queue.staleRunningOnMac) throw new Error("POSTDEPLOY_QUEUE_NOT_EMPTY");

process.stdout.write(`${JSON.stringify({
  ok: true,
  readOnly: true,
  release: health.release,
  worker: {
    version: status.state.version,
    heartbeatAt: status.state.heartbeatAt,
    status: status.state.status,
    activeTask: Boolean(status.state.activeTaskId),
    readyToClaim: status.state.readiness.readyToClaim,
    skillBundleVersion: status.state.readiness.skills.bundleVersion,
  },
  mimo: {
    state: status.state.readiness.channel.state,
    authenticated: status.state.readiness.channel.authenticated,
    creditsReadbackPresent: Boolean(status.state.readiness.channel.credits),
    model: status.state.readiness.channel.model,
  },
  queue,
  recoveryPolicy: status.diagnostics.recoveryPolicy,
})}\n`);
