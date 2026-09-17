# implementation-plan.md — 整改实施计划

> 排序原则：**先让"能用"变可靠，再谈体验与扩展**。
> 每个任务：只改少量文件 / 有独立验证命令 / 不与他人共享未提交状态 / 完成即原子提交。

---

## 阶段 0：止血（P0，1~2 天内）

### T0-1 源码入 Git 并建立分支纪律
- 改：仓库初始化、`main` 保护、`CONSTRAINTS.md`、`.github/pull_request_template.md`
- 验：`git log --oneline` 有记录；`gh pr create` 流程可用
- 风险：L3（架构/流程）

### T0-2 修复环境变量文件
- 改：`.env.production`（LF、去 BOM、修复首行污染 `nnvlwyufbemejgjfPOSTGRES_DB`）、新增 `scripts/check-env.sh`
- 验：`file .env.production` 为 `ASCII text`；`bash scripts/check-env.sh --keys-only` 全绿
- 风险：L3

### T0-3 修复数据库连接与迁移
- 改：compose 环境变量（补齐 `POSTGRES_DB`/`POSTGRES_HOST`）、`deploy/migrations` 执行脚本
- 验：`psql -c "select count(*) from information_schema.tables where table_schema='public'"` > 0
- 风险：L3

### T0-4 单一数据源：处理遗留 SQLite
- 改：**复用已有脚本** `npm run db:migrate:dry-run` → `npm run db:migrate:sqlite-to-postgres`；迁移后归档 SQLite，删除业务引用
- 验：新库 `users/sessions/user_credits` 行数与遗留库一致；`grep -rn sqlite lib app` 无业务引用
- 风险：L3（双人 review + 备份 + 回滚）

### T0-5 建立每日备份
- 改：`scripts/backup-db.sh` + crontab
- 验：手动执行一次，产出 `pg_dump` 文件并成功 `pg_restore` 到临时库
- 风险：L3

---

## 阶段 1：让核心链路可依赖（P0）

### T1-1 新增 `provider_jobs` 对账表
- 改：`deploy/migrations/2026xxxx_provider_jobs.sql`、`lib/server`（写入）、任务创建流程
- 验：下单后表内有 `job_id / model_id / cost / status`；与紫域返回一致
- 风险：L3

### T1-2 动态模型目录替换静态 provider 描述
- 改：`lib/provider-contract.ts`（增加 `enabled` 与环境变量驱动）、`app/api/providers/route.ts`
- 验：所有渠道的 `configured` 与真实环境变量一致；未配置渠道不出现在响应里
- 风险：L2

### T1-3 档位映射与模型失效回退
- 改：`lib/ziyu-contract.ts`（档位规则）、下单前校验与回退逻辑
- 验：构造无效 modelId → 自动回退 `activeModelId` 并提示；单测覆盖
- 风险：L2

### T1-4 素材与提示词前置校验
- 改：`lib/ziyu-contract.ts`、前端投放区
- 验：超量/错类型/空提示词均被拦下并给出明确文案
- 风险：L1

### T1-5 失败语义映射与重试/退款
- 改：`lib/ziyu-api.ts`（错误码分类）、`lib/credits.ts`（退款）
- 验：四类失败（审核/系统异常/模型失效/参数错误）各有断言与单测
- 风险：L3（涉及资金）

---

## 阶段 2：质量门（P1）

### T2-1 `npm run verify` 统一入口
- 改：`package.json`、`scripts/verify.sh`、`scripts/verify.ps1`
- 验：`npm run verify` 在本地跑通；CI 调用同一入口
- 风险：L1

### T2-2 CI 升级
- 改：`.github/workflows/ci.yml`（typecheck + eslint + 单测 + 契约测试 + secret 扫描 + build）
- 验：故意引入一个类型错误与一个假密钥，CI 均失败
- 风险：L2

### T2-3 ESLint 引入
- 改：`.eslintrc*`、`package.json`（`lint` 改为真 ESLint，`typecheck` 独立）
- 验：`npm run lint` 有实际规则输出
- 风险：L1

### T2-4 契约测试：核心链路
- 改：`tests/`（登录 → 素材 → 下单 → 状态 → 下载，渠道用契约假实现）
- 验：`npm run verify` 包含且通过；提供一份真实渠道人工 smoke 记录
- 风险：L2

---

## 阶段 3：清理与体验（P2）

- T3-1 删除无 worker 的队列死代码或真正启用 worker（二选一，须拍板）
- T3-2 `/api/health` 字段收敛
- T3-3 `robots.txt` / `sitemap.xml`
- T3-4 未启用渠道相关文件（`mimo-*` / `miora-*` / `dola-*` / `astorie-*`）归档到 `_archive/`
- T3-5 移动端窄屏降级方案

---

## 任务模板

```text
任务号：
风险等级：
涉及文件（≤5）：
实现步骤：
验证命令：
完成条件：
依赖任务：
```
