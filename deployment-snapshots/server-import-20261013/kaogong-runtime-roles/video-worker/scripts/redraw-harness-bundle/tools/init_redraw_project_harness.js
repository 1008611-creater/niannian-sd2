#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[key] = argv[++i];
    else out[key] = true;
  }
  return out;
}

function writeNew(file, value) {
  if (fs.existsSync(file)) throw new Error(`Refusing to overwrite existing harness file: ${file}`);
  fs.writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function main() {
  const args = parseArgs(process.argv);
  const root = path.resolve(args.root || ".");
  const jobId = String(args["job-id"] || "").trim();
  const projectName = String(args["project-name"] || jobId).trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(jobId)) throw new Error("--job-id must be 2-64 characters using letters, numbers, underscore, or hyphen");
  const jobsRoot = path.join(root, "jobs");
  const jobDir = path.join(jobsRoot, jobId);
  fs.mkdirSync(jobsRoot, { recursive: true });
  fs.mkdirSync(jobDir, { recursive: false });
  fs.mkdirSync(path.join(jobDir, "inputs"));
  fs.mkdirSync(path.join(jobDir, "outputs"));
  fs.mkdirSync(path.join(jobDir, "deliverables"));

  const createdAt = new Date().toISOString();
  writeNew(path.join(jobDir, "task.json"), {
    schema_version: "employee_redraw_task_v1",
    job_id: jobId,
    project_name: projectName,
    route_kind: args["route-kind"] || "commercial_video_redraw",
    created_at: createdAt,
    source_video: null,
    target_product: null,
    required_capabilities: [],
    output_target: { aspect_ratio: null, duration_seconds: null, channel: null },
    authorization: { provider_submit: false, spend: false, package_send: false, local_image_edit: false },
  });
  writeNew(path.join(jobDir, "status.json"), { schema_version: "employee_redraw_status_v1", job_id: jobId, status: "prepared", current_node: "step01_evidence", updated_at: createdAt });
  writeNew(path.join(jobDir, "checkpoint.json"), { schema_version: "employee_redraw_checkpoint_v1", job_id: jobId, current_node: "step01_evidence", blockers: [], next_action: "Register exact source video and target-product authority inputs.", updated_at: createdAt });
  writeNew(path.join(jobDir, "artifact_ledger.json"), { schema_version: "employee_redraw_artifact_ledger_v1", job_id: jobId, artifacts: [], gates: { provider_submit: false, package_send: false, delivery: false } });
  writeNew(path.join(jobDir, "gate_dashboard.json"), { schema_version: "employee_redraw_gate_dashboard_v1", job_id: jobId, current_node: "step01_evidence", blockers: [], projection_only: true });
  writeNew(path.join(jobDir, "result_manifest.json"), { schema_version: "employee_redraw_result_manifest_v1", job_id: jobId, status: "prepared", outputs: [], delivered: false });
  writeNew(path.join(jobDir, "conversation_log.md"), `# ${projectName} Conversation Log\n\n- ${createdAt}: Harness initialized.\n`);
  writeNew(path.join(jobDir, "codex_prompt.md"), `# ${projectName}\n\nUse the installed commerce-video-redraw-router and this project's AGENTS.md. Start from the exact job-local route decision and earliest broken contract.\n`);
  process.stdout.write(`${JSON.stringify({ status: "PASS_HARNESS_INITIALIZED", root, jobDir, jobId }, null, 2)}\n`);
}

try { main(); } catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
}
