import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  buildCodexPrompt,
  isExecutableReference,
  normalizeWorkerResult,
  selectTaskChannel,
  validateTaskSpec,
} from "./video-task-worker.mjs";
import { isPathInside } from "../lib/video-output-gate.mjs";

const authorizedSpec = {
  task_id: "task-1",
  prompt_sha256: "abc",
  references: [{ path: "asset.png" }],
  allowed_channels: ["artflash", "mimo"],
  submit_allowed: true,
  cost_gate: { authorized: true },
};

test("authorized specs pass dispatch preflight", () => {
  assert.deepEqual(validateTaskSpec(authorizedSpec), []);
});

test("unauthorized specs cannot dispatch", () => {
  const errors = validateTaskSpec({
    ...authorizedSpec,
    submit_allowed: false,
    cost_gate: { authorized: false },
  });
  assert.ok(errors.includes("submit_not_authorized"));
  assert.ok(errors.includes("cost_not_authorized"));
});

test("automatic routing skips disabled channels and selects Mimo", () => {
  assert.equal(selectTaskChannel({ channel: "auto" }, authorizedSpec), "mimo");
});

test("disabled channels remain unavailable while Mimo stays active", () => {
  assert.equal(selectTaskChannel({ channel: "mimo" }, authorizedSpec), "mimo");
  assert.throws(() => selectTaskChannel({ channel: "artflash" }, authorizedSpec), /NO_ALLOWED_ACTIVE_CHANNEL/);
});

test("Dola is active only when the locked task spec selects it", () => {
  const dolaSpec = {
    ...authorizedSpec,
    prompt: "镜头缓慢向前移动，画面稳定。",
    allowed_channels: ["dola"],
    skill_route: ["ai-video-production-router", "sd2-video-generation", "prompt-skill-router", "ai-video-channel-router", "dola-video-channel"],
  };
  assert.equal(selectTaskChannel({ channel: "dola" }, dolaSpec), "dola");
  assert.deepEqual(validateTaskSpec(dolaSpec), []);
  assert.ok(validateTaskSpec({ ...dolaSpec, prompt: "第 1 秒展示商品" }).includes("dola_prompt_seconds_forbidden"));
});

test("explicit channels must be approved by the task spec", () => {
  assert.throws(
    () => selectTaskChannel({ channel: "tmlab" }, authorizedSpec),
    /CHANNEL_OUTSIDE_TASK_SPEC/,
  );
});

test("reference input flags are explicit and enforceable", () => {
  assert.equal(isExecutableReference({ actual_video_input: true }), true);
  assert.equal(isExecutableReference({ actual_video_input: false }), false);
  assert.equal(isExecutableReference({ upload_eligible: true }), true);
});

test("worker results normalize terminal fields", () => {
  assert.deepEqual(
    normalizeWorkerResult({
      status: "running",
      providerTaskId: "provider-1",
      outputPath: null,
      blocker: null,
      summary: "submitted",
      mediaProbePassed: false,
      contentQaPassed: false,
      ledgerPath: null,
    }),
    {
      status: "running",
      providerTaskId: "provider-1",
      outputPath: null,
      blocker: null,
      summary: "submitted",
      mediaProbePassed: false,
      contentQaPassed: false,
      ledgerPath: null,
    },
  );
});

test("Codex handoff locks Mimo and the authoritative spec", () => {
  const prompt = buildCodexPrompt(
    { id: "task-1", provider_task_id: null },
    "C:\\tasks\\task-1.json",
    authorizedSpec,
    "mimo",
  );
  assert.match(prompt, /mimo-8001-video-channel/);
  assert.match(prompt, /C:\\tasks\\task-1\.json/);
  assert.match(prompt, /Never use a different channel/);
});

test("Codex handoff locks the complete Dola Skill route", () => {
  const prompt = buildCodexPrompt(
    { id: "task-dola", provider_task_id: null },
    "C:\\tasks\\task-dola.json",
    { ...authorizedSpec, allowed_channels: ["dola"] },
    "dola",
  );
  assert.match(prompt, /ai-video-production-router -> sd2-video-generation -> prompt-skill-router -> ai-video-channel-router -> dola-video-channel/);
  assert.match(prompt, /Channel skill: dola-video-channel/);
});

test("completion output paths cannot escape task directories", () => {
  const root = path.resolve("data", "video-outputs", "task-1", "downloads");
  assert.equal(isPathInside(root, path.join(root, "final.mp4")), true);
  assert.equal(isPathInside(root, root), false);
  assert.equal(isPathInside(root, path.resolve(`${root}-other`, "final.mp4")), false);
  assert.equal(isPathInside(root, path.resolve(root, "..", "ledger", "final.mp4")), false);
});
