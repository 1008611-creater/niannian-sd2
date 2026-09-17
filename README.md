# 念念 AI 视频工作台（sd2.cauai.fun）

线上地址：<https://sd2.cauai.fun>
源码快照：部署服务器 `/srv/kidswear-data/staging/niannian-sd2-4998bd8`（2026-09-17 拉取）
镜像：`niannian-sd2:957e1ff`（构建于 2026-08-16） · Next.js 15.5.20 · Node 22

> ⚠️ 本仓库顶部的"审计与整改"章节为 2026-09-17 新增；源码自带的项目说明保留在文末《原始项目 README》。

---

## 一、审计结论速览（先看这里）

**能打开、能登录、能出片；但"记不住账"，底座是能跑的原型，不是能交付的产品。**

- ✅ **紫域渠道实测可用**：模型目录 54 个；最近 20 条任务 14 条成功，最近一次成功 `2026-09-17 13:59:24`（i2v，300 点）
- ❌ **其它渠道全不可用**：Seedance 未配置、MIMO 缺用户名/密码/Token、MIORA Cookie 为空且提交开关 `false`、视频派发未配置
- ⚠️ **失败率约 30%**（20 条中 6 条）：内容审核拦截 2、系统异常 1、模型 ID 失效 2、空提示词 1
- 🚨 **根因**：`.env.production` 首行被污染成 `nnvlwyufbemejgjfPOSTGRES_DB`，容器内键名真的就叫 `nnvlwyufbemejgjfPOSTGRES_DB`，且**没有 `DATABASE_URL`** → 应用退回 `sql.js`（WASM SQLite 单文件）兜底，Postgres 完全闲置、0 张表、迁移从未执行
- 🚨 **无备份、无 Git**：服务器源码目录无 `.git`，CI 从未真正运行

判定：`可用（内部 L1）`，未达到 `可对外交付（L3）`。

完整证据：[`docs/audit/2026-09-17-sd2-website-audit.md`](docs/audit/2026-09-17-sd2-website-audit.md)

---

## 二、文档导航

| 文件 | 用途 |
|---|---|
| [`docs/audit/2026-09-17-sd2-website-audit.md`](docs/audit/2026-09-17-sd2-website-audit.md) | 审计报告：能不能用、渠道能不能用、证据与命令 |
| [`docs/channels-and-models.md`](docs/channels-and-models.md) | 模型与渠道从哪来、哪些能用、该拍板的决策 |
| [`CONSTRAINTS.md`](CONSTRAINTS.md) | 不可协商的工程约束 |
| [`docs/product-spec.md`](docs/product-spec.md) | 产品范围、流程、失败场景、验收标准 |
| [`docs/architecture.md`](docs/architecture.md) | 架构、数据模型、技术债清单 |
| [`docs/acceptance.md`](docs/acceptance.md) | 验收清单 + 变更风险分级（L0~L3） |
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | 整改计划（阶段 0 止血 → 阶段 3 清理） |
| [`docs/risk-register.md`](docs/risk-register.md) | 风险登记表 R1~R16 |
| [`docs/adr/`](docs/adr/) | 架构决策：渠道选型 / 数据持久化 / 计费退款 / 源码与发布 |
| [`AGENTS.md`](AGENTS.md) | 项目铁律（含 2026-09-17 审计后补充约束） |

---

## 三、快速开始

```bash
npm ci
cp .env.example .env.local     # 填写真实值，切勿提交
npm run verify                 # 统一质量门（见下）
npm run dev                    # 本地 http://localhost:3026
```

**`npm run verify`**（Windows 用 `npm run verify:win`）串联：

```
env 键名校验 → typecheck → lint → 单测/契约测试 → secret 扫描 → build → 冒烟
```

> 说明：当前 `lint` 仍是 `tsc --noEmit`（技术债 T2-3）；`test` 聚合了 `test:date-display`、`test:video-task-public-state`、`test:video-workbench-harness`。

环境变量校验（只报键名与是否为空，不打印值）：

```bash
npm run check:env
```

---

## 四、必须拍板的事项（阻塞整改）

1. **数据源**：补齐 `DATABASE_URL` 切到 Postgres，并执行已有迁移 `npm run db:migrate:dry-run` → `npm run db:migrate:sqlite-to-postgres`（建议）
2. **渠道**：MVP 只保留紫域，其余渠道从 UI 移除（建议）
3. **模型**：禁止硬编码 `zy_model_*`，动态拉取 + 失效回退（建议）
4. **积分汇率**：源码说明为 `1 积分 = ¥0.10`、4-15 秒按每秒 4 积分；需与紫域点数（5~2000 点/次）对齐
5. **审核失败是否扣费**：紫域侧 cost 仍显示 300，需确认后定退款规则
6. **注册策略**：当前 4 个用户，是否开放注册

详见 [`docs/channels-and-models.md`](docs/channels-and-models.md) 与 [`docs/product-spec.md`](docs/product-spec.md#8-待确认事项阻塞开工)。

---

## 五、目录结构

```text
app/          路由与页面            components/  UI 组件
lib/          领域逻辑与渠道适配     scripts/     worker、校验、备份、验证脚本
deploy/       compose / nginx / migrations / runbook
docs/         产品、架构、验收、审计、ADR
CONSTRAINTS.md  工程约束（硬规则）
```

依赖方向（不可违反）：

```text
app → components → lib/domain
app/api → lib/server → lib/domain → lib/<channel>
```

---
---

# 原始项目 README（源码自带，2026-09-17 快照）

# 念念AI Web

参考 `http://nas.mimo.fashion:5001/` 与其公开页面的视觉语言、入口结构制作的本地"念念AI视频工作台"。当前已具备真实邮箱注册登录、PostgreSQL 项目与任务持久化、素材上传、受保护的自动任务队列、客户成片交付、管理员控制台和后台执行器。渠道真实闭环仍待一条经本次成本授权的受控任务验证；不得以 UI、模拟测试或已退款任务宣称已完成成片交付。

## 本地运行

```powershell
npm install
npm run dev
```

打开 `http://localhost:3026`。

生产模式：

```powershell
npm run build
npm run start
```

认证本地演示（验证码仅写入本机服务日志）：

```powershell
npm run start:local
```

面向真实用户部署前，复制 `.env.example` 为部署环境变量，并配置 `AUTH_OTP_PEPPER`、`AUTH_SESSION_SECRET`、`DATABASE_URL` 与 SMTP 凭据。设置 `DATABASE_URL` 后认证自动使用 PostgreSQL；本地未设置时使用运行目录的 `data/niannian-auth.sqlite`。没有 SMTP 配置时生产模式会拒绝发送验证码，不会创建未验证账户。

> ⚠️ 审计注记：**生产环境当前正是缺少 `DATABASE_URL`，因此实际走 sql.js SQLite 兜底**（风险 R2/R3）。上线整改必须补齐该变量。

容器化 PostgreSQL 部署已提供。先复制环境变量模板，再启动：

```powershell
Copy-Item .env.docker.example .env.docker.local
docker compose --env-file .env.docker.local up --build -d
```

现有 SQL.js 用户迁移到 PostgreSQL：

```powershell
npm run db:migrate:dry-run
docker compose --env-file .env.docker.local run --rm -v "${PWD}/data:/app/data:ro" app npm run db:migrate:sqlite-to-postgres
```

生产环境必须把 `AUTH_COOKIE_SECURE` 设置为 `true`，并把 `APP_ORIGIN` 设置为正式 HTTPS 域名。真实密钥保存在部署平台的秘密管理中，不要提交到版本库。

渠道 M 当前入口是 `https://fd.aancn.cn`。服务器诊断可通过 `MIMO_BASE_URL` 显式覆盖入口，并需要二选一的 `MIMO_TOKEN` 或 `MIMO_USERNAME`、`MIMO_PASSWORD`。新建客户 Mimo 任务由独立 Windows Mimo CDP Worker 领取；是否允许接单以该 Worker 上报的新鲜 production readiness 为准，服务器端 Mimo 诊断不能替代 Windows 本机浏览器登录、CDP、`ffprobe`、Skill 路由和工作目录检查。网站与 Windows Agent 之间使用专用 `MIMO_WINDOWS_AGENT_TOKEN`，该秘密只应存在于部署秘密管理和 Windows 安全环境中。历史 `mac_codex` 任务仍使用 `MAC_CODEX_AGENT_TOKEN`，但不会接管新 Mimo 任务。所有预检均为只读，不上传素材、不调用生成。不要把任何凭据写入仓库、镜像、任务规格、日志或客户侧接口。

## 页面

- `/`：官网首页
- `/projects`：项目管理
- `/showcase`：作品展示
- `/guide`：创作指引
- `/workspace/[id]`：与持久化项目绑定的制作工作台
- `/team`：成员、角色、项目分工与活动记录
- `/settings`：GPT-5.5、GPT-5.6、Seedance 2 服务端配置清单
- `/api/health`：本地健康检查
- `/api/providers`：逻辑模型能力和配置状态
- `/api/workflow`：转绘节点、权威账本和提交门禁
- `/api/team`：团队演示数据与持久化状态
- `/api/auth/register/start`：发送注册验证码
- `/api/auth/register/verify`：验证邮箱并创建账户
- `/api/auth/password-reset/start`、`/verify`、`/resend`：密码重置
- `/api/auth/login`、`/api/auth/session`：登录、读取和注销会话
- `/home`：人物、商品、场景和动作素材上传，创建受保护的视频任务并在完成后预览、下载成片
- `/admin`：用户、任务、渠道、成本授权、自动执行器和审计记录
- `/api/credits`：用户积分余额、积分流水、报价和充值申请
- `/api/admin/overview`：管理员受保护的任务与运行状态接口
- `/api/internal/windows-mimo/*`：Windows Mimo CDP Worker 领取、心跳、素材与回执
- `/api/internal/mac-codex/*`：仅保留用于历史 `mac_codex` 任务的兼容接口

## 积分制内测 MVP

用户只购买一种视频制作服务，不需要选择自动或人工。系统默认通过 Windows Mimo CDP Worker 和渠道 M 自动执行；自动失败不会切换渠道或自动重试，不加价、不重复扣积分。当前 4-15 秒按每秒 4 积分报价（4 秒 16 积分，5/10/15 秒为 20/40/60 积分）。服务端在任务创建时原子保留积分；任务创建失败或管理员最终停止任务时只退款一次。Windows Worker 离线或未通过 production readiness 时任务保持 `queued_skill`，不会伪装成执行中。

积分固定按 `1 积分 = ¥0.10` 销售。用户在 LDXP（链动小铺）购买 `100 / 300 / 500 / 1000` 积分商品，平台付款后自动发放一次性签名兑换码；用户回到工作台粘贴兑换码，积分立即到账。兑换码由独立服务端密钥签名，数据库只保存哈希，同一码只能兑换一次。四档商品已发布到"念念AI积分"分类，每档首批 50 张卡密；真实支付、自动发码和到账仍须用一笔 ¥10 订单验收后才能宣称完整收款闭环通过。

管理员后台以运营待办为默认入口：服务端按任务最后更新时间计算紧急度、阶段 SLA、是否超时和下一步动作，并汇总紧急任务、超时任务、人工兜底、待质检、24 小时新用户和 24 小时 LDXP 兑换。任务列表每 30 秒刷新，仍沿用原有人工接单、成本授权、渠道登记、成片质检、交付和退款门禁。

根路由 `/` 是公开能力首页，不再把陌生访客直接重定向到登录。页面统一定位为"念念AI的视频生成基础能力"。人工兜底、渠道路由、成本授权和内部执行方式属于管理员策略，禁止出现在用户页面、公开元数据或对外营销文案中。没有得到公开授权的用户成片不得作为首页案例。

## 视频任务执行器

网站创建任务后会先写入 PostgreSQL 和统一 `video_task_spec.json`。执行器只领取同时满足 `submit_allowed=true` 与 `cost_gate.authorized=true` 的任务。

视频任务类型由服务端根据已确认素材推导：没有参考素材时创建 `text_to_video` 并锁定 `references=[]`；至少一张已确认人物、商品或场景图片时创建 `image_to_video`。`video_task_spec.json` 必须保存 `generation_type`，Windows Mimo Worker 对文生视频不得下载或上传参考素材。

客户新建任务固定写为 `execution_mode=codex_skill`、`channel=mimo`、`status=queued_skill`。用户确认锁定规格后才设置 `submit_allowed=true` 与 `cost_gate.authorized=true`。只有持有 `MIMO_WINDOWS_AGENT_TOKEN` 的 Windows Mimo CDP Worker 可以领取任务；领取前必须上报未过期的 production readiness。Worker 不可用时任务保持队列状态，客户只看到"正在排队"。已有 `provider_task_id` 的提交不明任务只允许同步和下载，禁止再次点击生成。

Windows Mimo Agent 位于 `scripts/niannian-windows-mimo-agent.mjs`，候选包由 `npm run worker:mimo-windows:package` 构建。它只通过本机 loopback CDP 操作官方可见 Mimo 页面，并为每个已领取任务保存锁定输入 SHA、可见 Provider 回执、下载结果与账本。完整安装入口是 `scripts/Install-NiannianMimoAgentTask.ps1`。`mac-agent/` 仅保留历史 `mac_codex` 兼容任务。

```powershell
npm run worker:mimo-windows:contract
npm run test:mimo-windows-visible-sync
npm run worker:mimo-windows:preflight
npm run worker:mimo-windows:package
```

Windows Mimo 部署后的只读验收使用 `npm run release:postdeploy:readonly -- --origin https://sd2.cauai.fun --worker windows-mimo`。

### 真实渠道回归

`scripts/run-real-mimo-app-task.mjs` 是一条受授权保护的真实渠道回归路径：创建本地人工任务、读取 Mimo 额度、上传已确认图片参考、提交一次真实生成、轮询下载、运行 `ffprobe` 并留下待内容 QA 的任务证据。命令行必须携带 `--authorized`。

渠道 M（Mimo）是客户新任务的默认执行渠道。客户任务默认进入 Windows Mimo `codex_skill` 队列；人工任务由管理员在后台接单后处理。当前客户自动制作固定为已验证的 `720P`。

### Dola Skill 渠道

Dola 已作为 Windows Skill 渠道接入。管理员可以在任务尚未成本授权、尚未产生渠道任务 ID 时把统一视频任务从渠道 M 路由到 Dola。路由动作会把任务切换为 `codex_skill` 队列，并写入固定 Skill 链：

```text
ai-video-production-router
-> sd2-video-generation
-> prompt-skill-router
-> ai-video-channel-router
-> dola-video-channel
```

`POST /api/admin/dola-preflight` 只通过本机 `Dola2API` 检查登录、代理地区、CDP 和两个扩展，不上传、不提交、不扣点。

服务器自动模式通过 `VIDEO_SERVER_DISPATCH_URL` 接入外部执行服务。

Windows Mimo 自动交付只有在真实视频已下载、JSON ledger 合法、`ffprobe` 与时长校验通过、COS 上传及下载回读 SHA 校验通过后才能写入 `completed`。Docker 部署中的通用 `video-worker` 默认只处理 `server_auto`，并与网站共享 `/app/data`。

## 模型接入边界

统一协议在 `lib/provider-contract.ts`，转绘权威链路在 `lib/shortdrama-contract.ts`。GPT-5.5/5.6 与 Seedance 2 当前是用户指定的逻辑别名，不假定未确认的接口格式。真实密钥不得写入前端；正式接入应通过服务端环境变量、已登录渠道 Skill 或独立执行服务器完成。

Seedance 2 真实提交默认禁止。必须同时满足 `video_task_spec`、参考资产确认、费用/配额回读和本次用户授权。
