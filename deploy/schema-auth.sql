-- 从 lib/auth.ts 抽取的应用侧权威建表 DDL（SQLite/Postgres 双兼容）
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT '准备中',
    episodes INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS projects_user_updated
    ON projects(user_id, updated_at);
  CREATE TABLE IF NOT EXISTS canvas_documents (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    document_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS canvas_documents_user_updated
    ON canvas_documents(user_id, updated_at);
  CREATE TABLE IF NOT EXISTS uploaded_assets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    local_path TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS uploaded_assets_user_created
    ON uploaded_assets(user_id, created_at);
  -- Library visibility is reversible presentation state. The uploaded asset
  -- row and bytes remain immutable for every locked historical task.
  CREATE TABLE IF NOT EXISTS asset_library_visibility (
    asset_id TEXT PRIMARY KEY REFERENCES uploaded_assets(id) ON DELETE RESTRICT,
    user_id TEXT NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS asset_library_visibility_user_hidden
    ON asset_library_visibility(user_id, hidden, updated_at);
  -- Metadata is additive so historical uploaded_assets rows and task manifests
  -- remain readable while newer tasks can express multi-reference intent.
  CREATE TABLE IF NOT EXISTS asset_reference_metadata (
    asset_id TEXT PRIMARY KEY REFERENCES uploaded_assets(id) ON DELETE CASCADE,
    reference_intent TEXT NOT NULL,
    is_primary INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    chinese_duty TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS video_tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    execution_mode TEXT NOT NULL,
    channel TEXT NOT NULL,
    prompt TEXT NOT NULL,
    model TEXT NOT NULL,
    resolution TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    aspect_ratio TEXT NOT NULL,
    asset_manifest TEXT NOT NULL,
    task_spec_path TEXT NOT NULL,
    status TEXT NOT NULL,
    blocker TEXT,
    provider_task_id TEXT,
    output_path TEXT,
    submit_allowed INTEGER NOT NULL DEFAULT 0,
    cost_authorized INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS video_tasks_user_updated
    ON video_tasks(user_id, updated_at);
  CREATE TABLE IF NOT EXISTS project_assets (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES uploaded_assets(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (project_id, asset_id)
  );
  CREATE INDEX IF NOT EXISTS project_assets_project_created
    ON project_assets(project_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS project_task_links (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES video_tasks(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (project_id, task_id)
  );
  CREATE INDEX IF NOT EXISTS project_task_links_project_created
    ON project_task_links(project_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS script_workflow_requests (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    source_text TEXT NOT NULL,
    requirements TEXT NOT NULL,
    canonical_project_id TEXT,
    status TEXT NOT NULL,
    blocker TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS script_workflow_requests_project_updated
    ON script_workflow_requests(project_id, updated_at DESC);
  -- Product names are public. Provider channels remain administrator-only
  -- routing decisions resolved when a new task is created.
  CREATE TABLE IF NOT EXISTS product_routing (
    product_code TEXT PRIMARY KEY,
    channel TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS video_task_events (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    event TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS video_task_events_task_created
    ON video_task_events(task_id, created_at);
  -- Channel state deliberately stores operational readbacks only.  Browser
  -- credentials, cookies, OAuth data and one-time codes never enter this DB.
  CREATE TABLE IF NOT EXISTS channel_sessions (
    channel TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    visible_project_url TEXT,
    credit_readback TEXT,
    model_readback TEXT,
    last_preflight_at TEXT,
    last_success_at TEXT,
    last_blocker TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS channel_handoffs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    action TEXT NOT NULL,
    state TEXT NOT NULL,
    instructions TEXT NOT NULL,
    browser_url TEXT,
    resume_from TEXT NOT NULL,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );
  CREATE INDEX IF NOT EXISTS channel_handoffs_task_state
    ON channel_handoffs(task_id, state, created_at DESC);
  CREATE TABLE IF NOT EXISTS channel_execution_receipts (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL UNIQUE,
    channel TEXT NOT NULL,
    provider_task_id TEXT,
    status TEXT NOT NULL,
    ledger_path TEXT,
    output_path TEXT,
    media_probe_passed INTEGER NOT NULL DEFAULT 0,
    content_qa_passed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS redraw_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_id TEXT,
    idempotency_key TEXT NOT NULL,
    source_asset_id TEXT NOT NULL,
    reference_asset_ids TEXT NOT NULL,
    requirements_json TEXT NOT NULL,
    skill_bundle_version TEXT NOT NULL,
    status TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 2,
    plan_json TEXT,
    provider_transaction_key TEXT NOT NULL,
    provider_task_id TEXT,
    output_artifact_id TEXT,
    qa_json TEXT,
    blocker TEXT,
    worker_claim_token TEXT,
    worker_claimed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS redraw_jobs_user_idempotency
    ON redraw_jobs(user_id, idempotency_key);
  CREATE UNIQUE INDEX IF NOT EXISTS redraw_jobs_provider_transaction
    ON redraw_jobs(provider_transaction_key);
  CREATE INDEX IF NOT EXISTS redraw_jobs_user_updated
    ON redraw_jobs(user_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS redraw_jobs_status_updated
    ON redraw_jobs(status, updated_at ASC);
  CREATE TABLE IF NOT EXISTS redraw_attempts (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL,
    transaction_key TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    provider_task_id TEXT,
    status TEXT NOT NULL,
    input_urls_json TEXT,
    output_sha256 TEXT,
    qa_json TEXT,
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(job_id, attempt_number)
  );
  CREATE INDEX IF NOT EXISTS redraw_attempts_job_number
    ON redraw_attempts(job_id, attempt_number);
  CREATE TABLE IF NOT EXISTS redraw_artifacts (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    object_key TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS redraw_artifacts_job_role_sha
    ON redraw_artifacts(job_id, role, sha256);
  CREATE INDEX IF NOT EXISTS redraw_artifacts_job_created
    ON redraw_artifacts(job_id, created_at);
  CREATE TABLE IF NOT EXISTS redraw_job_events (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    event TEXT NOT NULL,
    public_status TEXT NOT NULL,
    detail_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS redraw_job_events_job_created
    ON redraw_job_events(job_id, created_at);
  CREATE TABLE IF NOT EXISTS user_credits (
    user_id TEXT PRIMARY KEY,
    balance INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS credit_ledger (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reason TEXT NOT NULL,
    task_id TEXT,
    recharge_request_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS credit_ledger_user_created
    ON credit_ledger(user_id, created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_task_reason_unique
    ON credit_ledger(task_id, reason)
    WHERE task_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_recharge_unique
    ON credit_ledger(recharge_request_id)
    WHERE recharge_request_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS credit_recharge_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    requested_credits INTEGER NOT NULL,
    note TEXT,
    status TEXT NOT NULL,
    processed_by TEXT,
    processed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS credit_recharge_requests_user_created
    ON credit_recharge_requests(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS credit_recharge_requests_status_created
    ON credit_recharge_requests(status, created_at ASC);
  CREATE TABLE IF NOT EXISTS credit_redemptions (
    code_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    credits INTEGER NOT NULL,
    redeemed_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS credit_redemptions_user_redeemed
    ON credit_redemptions(user_id, redeemed_at DESC);
  CREATE TABLE IF NOT EXISTS otp_codes (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    purpose TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL,
    send_count INTEGER NOT NULL DEFAULT 1,
    last_sent_at TEXT NOT NULL,
    ip_hash TEXT,
    user_agent_hash TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS otp_lookup
    ON otp_codes(email, purpose, consumed_at, expires_at);
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_lookup
    ON sessions(token_hash, expires_at);
  CREATE TABLE IF NOT EXISTS auth_audit (
    id TEXT PRIMARY KEY,
    event TEXT NOT NULL,
    email_hash TEXT NOT NULL,
    ip_hash TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auth_rate_events (
    id TEXT PRIMARY KEY,
    key_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS auth_rate_events_lookup
    ON auth_rate_events(key_hash, created_at);
