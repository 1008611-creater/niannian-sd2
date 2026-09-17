# architecture.md — 技术架构与现状

> 基于 2026-09-17 部署现场取证编写。标注 `【现状】` 的是当前真实状态，标注 `【目标】` 的是整改后应达到的状态。

---

## 1. 部署拓扑

```
用户浏览器
   │ HTTPS
   ▼
Caddy（deeptutor-public-caddy，80/443，自动证书）
   │ reverse_proxy sd2.cauai.fun → niannian-sd2-app:3026
   ▼
Docker 容器 niannian-sd2-app（Next.js 15.5.20，next start -p 3026）
   │                    │                        │
   │                    │                        └─ 腾讯云 COS（产物存储）
   │                    └─ 紫域 API ziyuai.vip（模型目录 / 上传 / 下单 / 查询）
   └─ Postgres 容器 niannian-sd2-postgres  【现状：0 张表，实际未承载数据】
```

- 服务器：`haika-kidswear-1757`（38.76.193.254，root）
- 部署目录：`/srv/kidswear-data/staging/niannian-sd2-4998bd8`
- 挂载：仅 `data/` → `/app/data`
- 镜像：`niannian-sd2:957e1ff`，构建于 2026-08-16
- **【现状】无 worker / dispatcher 进程在跑**：`docker ps` 与 `ps aux` 均无 `video-task-worker`、`harness-dispatcher`
- **【目标】**：引入 worker 或明确"同步代理提交"为唯一模式，并删除无用的队列代码

## 2. 分层与依赖方向

```text
app/           路由与页面（App Router，客户端工作台为主）
components/    UI 组件
lib/domain     领域逻辑（任务状态机、积分、素材校验）
lib/server     服务端能力（auth / credits / projects / video-tasks）
lib/ziyu-*     渠道适配（唯一允许直连第三方的位置）
lib/mimo-*     渠道适配（未启用）
lib/miora-*    渠道适配（未启用）
lib/dola-*     渠道适配（未启用）
lib/astorie-*  渠道适配（未启用）
lib/video-cos  对象存储适配
scripts/       worker、构建、验证脚本
deploy/        compose override、nginx、migrations、runbook
```

**依赖方向（不可违反）**：

```text
app → components → lib/domain
app/api → lib/server → lib/domain
                    → lib/<channel>
```

## 3. 关键模块现状

| 模块 | 现状 | 风险 |
|---|---|---|
| `lib/auth.ts` | 邮箱 OTP + 签名 Cookie（`AUTH_SESSION_SECRET`/`AUTH_OTP_PEPPER`） | 中：会话存储依赖数据库，而库为空 |
| `lib/ziyu-api.ts` | 紫域适配，含错误码到中文提示的映射 | 低：实现完整 |
| `lib/provider-contract.ts` | 静态渠道描述（`configured: false` 硬编码），未接真实环境变量 | 高：UI 与实际可用性不一致 |
| `lib/credits.ts` | 积分余额与账本 | 高：账本仅 1 条记录，说明几乎未走通 |
| `lib/video-tasks.ts` | 本地任务表逻辑 | 高：`video_tasks` 表 0 行，与紫域任务无对应关系 |
| `lib/video-cos.ts` | COS 上传/签名 | 中：已配置未验证 |
| `deploy/migrations/` | 2 个迁移文件 | 高：**从未执行** |

## 4. 数据模型（目标态）

| 表 | 用途 | 现状 |
|---|---|---|
| `users` | 用户 | 遗留 SQLite 4 行 |
| `sessions` | 会话 | 遗留 SQLite 5 行 |
| `otp_codes` | 登录验证码 | 遗留 SQLite 4 行 |
| `user_credits` / `credit_ledger` | 积分与账本 | 4 / 1 行（遗留） |
| `projects` / `project_assets` | 项目与素材 | 1 / 2 行（遗留） |
| `uploaded_assets` | 上传素材 | 2 行（遗留） |
| `video_tasks` / `video_task_events` | 本地任务与事件 | **0 行：从未落库** |
| `provider_jobs`（新增） | 渠道任务对账（job_id、model_id、cost、状态） | 缺失，建议新增 |

> 【目标】新增 `provider_jobs` 作为对账真相表，把紫域任务与本地积分流水一一对应。

## 5. 状态机（任务）

```
draft → submitting → queued → processing → completed
                           ↘ failed（区分：审核失败 / 渠道异常 / 模型失效 / 参数错误）
```

- 状态必须以渠道返回为准，禁止本地推断成功。
- `failed` 必须细分原因码，用于退款决策与用户提示。

## 6. 技术债清单（必须处理）

1. Postgres 空库 + 应用缺 `POSTGRES_DB` + 迁移未执行 → 数据层形同虚设。
2. 遗留 SQLite 与 Postgres 双真相源 → 必须单一化。
3. 服务器源码无 Git → 无法回滚、CI 空转。
4. `.env.production` CRLF + 首行污染 → 凭据解析隐患。
5. 未启用渠道仍出现在 UI 与 provider 描述 → 假能力。
6. 无 worker 但保留队列代码 → 死代码误导。
7. `npm run lint` 实为 `tsc --noEmit` → 无静态检查。
8. `/api/health` 暴露版本细节 → 建议收敛为最小字段。
9. 无 `robots.txt` / `sitemap.xml`。
