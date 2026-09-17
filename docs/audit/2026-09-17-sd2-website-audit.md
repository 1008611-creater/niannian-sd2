# sd2.cauai.fun 网站审计报告

- **审计日期**：2026-09-17
- **审计对象**：https://sd2.cauai.fun（念念 AI 视频工作台）
- **审计方式**：外部 HTTP 探测 + 部署服务器只读取证（SSH `haika-kidswear-1757`）+ 渠道侧只读调用
- **取证原则**：不写入、不改配置、不读取密钥明文（只统计长度）、不消耗渠道额度生成内容
- **结论一句话**：**网站能打开、能登录、能出片；但工程底座是"能跑的原型"，不是"能交付的产品"。**

> **2026-09-18 更新**：本报告第五节列出的 P0 数据层问题（R1/R2/R3/R4/R6）**已在老大授权下修复完成**，
> 数据已全量迁入 Postgres，备份已自动化。详见
> [`2026-09-18-fix-and-migration-record.md`](./2026-09-18-fix-and-migration-record.md)。
> 本报告的审计结论与证据保持原样，作为修复前的基线留档。

---

## 一、顶层结论（先看这里）

| 问题 | 结论 | 证据 |
|---|---|---|
| 网站能不能访问 | ✅ 能。HTTPS 正常，Caddy 反代到容器 | `HTTP 200`，TLS 正常 |
| 能不能登录 | ✅ 能。邮箱 OTP，SMTP 已配置 | SMTP_HOST/USER/PASS 均有值；`users=4` |
| 能不能真的生成视频 | ✅ 能，且今天仍在产出 | 紫域侧最近 20 条任务：14 条 `completed`，最近一条成功 `2026-09-17 13:59:24` |
| 模型和渠道从哪来 | 紫域（ziyuai.vip）API 动态下发，54 个模型 | `GET /api/v1/models` → `count: 54` |
| 其它渠道能用吗 | ❌ 全部不能用（未配置/已停用） | 见第三节凭据矩阵 |
| 稳定性如何 | ⚠️ 20 条任务失败 6 条（30%） | 见第四节失败分类 |
| 数据安全吗 | ⚠️ 高危。Postgres 0 张表，历史数据在遗留 SQLite，无备份、无版本控制 | 见第五节 |

**判定：`可用（L1 内部可用）`，未达到 `可对外交付（L3）`。**

---

## 二、运行环境事实（全部有命令/文件证据）

| 项 | 事实 | 证据来源 |
|---|---|---|
| 域名 | `sd2.cauai.fun` | Caddyfile 第 45-48 行 |
| 反向代理 | Caddy（`deeptutor-public-caddy`，80/443）→ `niannian-sd2-app:3026` | `/etc/caddy/Caddyfile` |
| 服务器 | `haika-kidswear-1757` → 38.76.193.254，`root` | `~/.ssh/config` |
| 部署路径 | `/srv/kidswear-data/staging/niannian-sd2-4998bd8` | 服务器目录 |
| 技术栈 | Next.js 15.5.20（App Router）+ Node 22 + TypeScript | 容器日志 `▲ Next.js 15.5.20`；`package.json` |
| 运行方式 | Docker 容器 `niannian-sd2-app`（镜像 `niannian-sd2:957e1ff`，构建于 2026-08-16） | `docker inspect` |
| 数据库 | Postgres 容器 `niannian-sd2-postgres`（healthy，但 **0 张表**） | `information_schema` 查询 |
| 挂载 | 仅 `/srv/.../data` → `/app/data` | `docker inspect Mounts` |
| 版本信息 | `niannian-mimo-efficiency-20260728-rc1` / `2026.07.28-mimo-efficiency-rc1` / contract v3 / macWorker 1.4.12 / windowsMimoWorker 1.4.13 | `GET /api/health` |
| 源码管理 | ❌ **服务器上没有 git 仓库**（`NO_GIT`） | `ls -d .git` |
| CI | `.github/workflows/ci.yml` 存在，只做 `typecheck + build`；因无 git，**实际从未运行** | ci.yml 内容 |

### 接口清单（从前端 chunk 与探测获得）

| 接口 | 未登录响应 | 说明 |
|---|---|---|
| `GET /api/health` | `200` | 公开，泄露版本与迁移信息 |
| `GET /api/auth/session` | `200 {"user":null}` | 会话读取 |
| `POST /api/auth/login` | `405`（GET） | 登录入口存在 |
| `GET /api/providers` | `401` | 渠道/模型目录 |
| `GET /api/credits` | `401` | 积分余额 |
| `GET/POST /api/video-tasks` | `401` | 视频任务 |
| `GET/POST /api/ziyu/jobs` | `401` | 紫域任务（核心链路） |
| `GET/POST /api/projects` | `401` | 项目分组 |
| `GET/POST /library/assets` | `401` | 素材库 |

---

## 三、渠道与模型：凭据矩阵（关键交付物）

> 取值方式：只读取环境变量**长度**，不打印明文。`长度 = 0` 表示未配置。

| 渠道 / 能力 | 环境变量 | 长度 | 状态 | 说明 |
|---|---|---|---|---|
| **紫域 ZIYU** | `ZIYU_API_KEY` | 48 | ✅ **可用** | 默认 `https://ziyuai.vip`；`ZIYU_BASE_URL` 未设置（走默认值，OK） |
| Seedance 2 | `NIANNIAN_SEEDANCE_API_BASE_URL` / `_KEY` / `NIANNIAN_SEEDANCE2_MODEL` | 0 / 0 / - | ❌ 未配置 | 但 UI 模型清单里仍显示 Seedance 2 |
| MIMO | `MIMO_BASE_URL` | 19 | ❌ 残缺 | `MIMO_USERNAME`/`MIMO_PASSWORD`/`MIMO_TOKEN` 全为 0 |
| MIORA | `MIORA_BASE_URL` / `MIORA_CDP_URL` / `MIORA_COOKIE` / `MIORA_PROVIDER_SUBMIT_ENABLED` | 20 / 32 / 0 / 5 | ❌ 停用 | Cookie 为空；开关为 `false`（5 字符） |
| 视频派发服务 | `VIDEO_SERVER_DISPATCH_URL` / `_TOKEN` | 0 / 0 | ❌ 未配置 | 本地任务队列不会被执行 |
| RunningHub | `RUNNINGHUB_BASE_URL` / `_API_KEY` | 25 / 28 | ⚠️ 已配置未验证 | 前端未暴露入口 |
| GPT 中转 | `NIANNIAN_GPT_API_BASE_URL` / `_KEY` / `NIANNIAN_GPT56_MODEL` | 22 / 28 / 7 | ⚠️ 部分可用 | `NIANNIAN_GPT55_MODEL` 缺失 → GPT-5.5 不可用 |
| 腾讯云 COS | `TENCENT_COS_BUCKET` / `_REGION` / `_SECRET_ID` / `_SECRET_KEY` | 27 / 19 / 有 / 有 | ✅ 已配置 | 产物存储 |
| 邮件 OTP | `SMTP_HOST` / `_USER` / `_PASS` | 11 / 17 / 16 | ✅ 已配置 | 登录链路 |
| Worker 令牌 | `MAC_CODEX_AGENT_TOKEN` / `DOLA_CODEX_AGENT_TOKEN` | 有 / 有 | ⚠️ 无 worker 在运行 | 服务端无对应进程 |
| 积分商城 | `LDXP_SHOP_URL` / `LDXP_REDEEM_SECRET` | 有 / 有 | ⚠️ 未验证 | 兑换链路 |

### 紫域模型目录实测（`GET /api/v1/models`，HTTP 200）

- 模型总数：**54**；`activeModelId = zy_model_a9725c3ba64bc52e741a`
- 模型 ID 形如 `zy_model_xxxxxxxxxxxx`，名称是中文"线路/规格"描述（如"满血2.5 720p 不卡人脸"）
- 计价：`cost` 为单次点数，实测区间 **图片 5~20 点，视频 50~2000 点**
- 代表性档位（审计时快照，**会变动，禁止硬编码**）：

| 用途 | 模型名 | 模式 | 成本(点) | 分辨率 |
|---|---|---|---|---|
| 图片 | `image-2-1k` | t2i | 5 | - |
| 视频·低价快 | `H3 速度快 720p 9图3音频 不卡人脸` | i2v/t2v | 50 | 720p |
| 视频·均衡 | `H3 720p 不卡人脸 质量超高` | i2v/t2v | 150 | 720p |
| 视频·主力 | `特价2.0满血 720p 933 不卡脸 s线路` | i2v/t2v | 300 | 720p |
| 视频·长时长 | `官转满血2.5 720p 6分钟出 不卡人脸` | i2v/t2v | 2000 | 720p（4~15s） |

**结论：模型和渠道 = 紫域一家提供，动态拉取，非自有模型。这是必须写进产品事实的核心约束。**

---

## 四、真实任务历史（紫域侧 `GET /api/v1/jobs?limit=20`）

- 返回 20 条，**14 条 completed / 6 条 failed**，时间跨度 2026-09-14 ~ 2026-09-17
- 最近一条：`5953a81e | completed | i2v | 2026-09-17 13:59:24 | cost 300`
- 失败分类：

| 失败原因 | 条数 | 归属 | 该谁改 |
|---|---|---|---|
| 内容审核未通过，请修改后重试 | 2 | 提示词/素材命中渠道审核 | 产品：提交前自检 + 可重试 |
| 系统异常，请重新提交 | 1 | 渠道侧抖动 | 产品：自动重试 1 次 |
| 任务提交失败，未扣费：model unavailable for external api | 1 | **模型 ID 失效** | 工程：动态模型目录 + 失效回退 |
| 任务提交失败，未扣费：model not found | 1 | **模型 ID 失效** | 同上 |
| HTTP 400: prompt is required | 1 | 空提示词 | 工程：前端必填校验 |

> 注意：两条"未扣费"失败说明紫域在提交失败时不扣点，但"内容审核未通过"的任务 **cost=300 仍计入**（需与紫域确认是否扣费，直接影响积分是否退款）。

---

## 五、数据层：本次审计最严重的问题

1. **Postgres 容器是空的**：`information_schema` 查询 `public` schema 表数量为 **0**；`deploy/migrations/` 下有两个迁移文件（`20260713_asset_reference_metadata.sql`、`20260728_asset_library_visibility.sql`）**未执行**。
2. **根因（决定性证据）**：应用容器里根本没有 `POSTGRES_DB`，也没有 `DATABASE_URL`，`printenv` 实际只有三个库相关变量：

   ```
   POSTGRES_PASSWORD
   nnvlwyufbemejgjfPOSTGRES_DB   ← 键名被污染！
   POSTGRES_USER
   ```

   也就是说 `.env.production` 首行那串 `nnvlwyufbemejgjf` 前缀被拼进了键名，导致 **`POSTGRES_DB` 与 `DATABASE_URL` 两个应用真正需要的变量全部缺失** → 应用连不上库 → Postgres 保持 0 张表。
   **这是本次审计最关键的发现：数据层不是"没设计"，是被一个污染字符整段废掉。**

   代码侧确认（`package.json` 依赖 `sql.js` + `pg`，README 明确"设置 `DATABASE_URL` 后认证自动使用 PostgreSQL；未设置时使用运行目录的 `data/niannian-auth.sqlite`"）：

   **当前生产实际在跑 sql.js（WASM SQLite 单文件）兜底，Postgres 完全闲置。** 这解释了全部现象：
   - 紫域下单能成功（同步代理，不依赖库）
   - 登录能用（会话为签名 Cookie / 或写 SQLite）
   - `video_tasks = 0`、`channel_* = 0`：任务与渠道回执**根本没有落库**
   - SQLite 文件最后写入停在 2026-08-23，之后再无写库动作

   **一句话：网站"能出片，但记不住账"**——积分、项目、素材、任务对账全部没有可靠持久化。
3. **数据实际落在 sql.js SQLite 单文件**：`/app/data/niannian-auth.sqlite`（372KB，最后写入 2026-08-23 21:55），内含 `users=4 / sessions=5 / user_credits=4 / credit_ledger=1 / projects=1 / uploaded_assets=2 / **video_tasks=0 / video_task_events=0 / channel_*=0**`。依赖 `sql.js`（WASM SQLite），无并发安全、无备份、随容器/磁盘损坏即全丢。
   - ✅ 好消息：源码里**已存在迁移脚本** `npm run db:migrate:dry-run` / `npm run db:migrate:sqlite-to-postgres`（`scripts/migrate-sqlite-to-postgres.mjs`），整改只需补齐 `DATABASE_URL` 后执行，不必重写。
4. **无任何备份**：`data` 目录为唯一 bind mount，无快照、无异地备份。
5. **无版本控制**：服务器源码目录无 `.git`，无法回滚、无法审计变更、CI 形同虚设。

**影响**：注册/积分/项目/素材等一切写库功能处于"看起来能用、实际无持久化保证"的状态；一旦容器或数据目录损坏，用户与账目全部丢失。

---

## 六、其它发现

| 级别 | 问题 | 证据 |
|---|---|---|
| **高** | `.env.production` 为 CRLF 换行（41 行含 `\r`），且**首行被污染**为 `nnvlwyufbemejgjfPOSTGRES_DB=...` → 直接导致 `POSTGRES_DB`/`DATABASE_URL` 缺失、数据层全废 | `file .env.production`；`head -1`；容器内 `printenv` 出现 `nnvlwyufbemejgjfPOSTGRES_DB` |
| 中 | 无任何视频 worker / dispatcher 进程在运行 | `docker ps` 无相关容器；`ps aux` 无相关进程 |
| 中 | 容器镜像停留在 2026-08-16，已 32 天未重新构建 | `docker inspect Created` |
| 中 | CI 只有 `tsc --noEmit` + `build`，没有单测、契约测试、secret 扫描 | `.github/workflows/ci.yml` |
| 中 | `npm run lint` 实际是 `tsc --noEmit`，**没有 ESLint** | `package.json` |
| 低 | `/api/health` 公开暴露版本号、迁移名、worker 版本 | `GET /api/health` |
| 低 | 无 `robots.txt`、无 `sitemap.xml` | 均返回 404（落到 404 页） |
| 低 | 容器日志反复出现 `Failed to find Server Action "x"` | `docker logs`，多为旧客户端/扫描器，需排除真实用户故障 |

---

## 七、必须拍板的决策（待 老大 确认）

1. **数据源**：Postgres（补齐迁移、修 `POSTGRES_DB`）还是退回 SQLite？→ 建议 Postgres 单库 + 立即执行迁移 + 每日备份。
2. **渠道**：MVP 只保留紫域；Seedance / MIMO / MIORA / 视频派发在 UI 中隐藏或标记"未接入"。
3. **模型**：禁止硬编码 `modelId`；只暴露 3~5 个推荐档位，动态拉取 + 失效回退到 `activeModelId`。
4. **积分汇率**：紫域 1 点 = ？积分；提交失败/审核失败是否退款。
5. **注册策略**：当前仅 4 个用户 → 是否开放注册（建议邀请制/白名单）。
6. **产物存储**：统一入 COS，本地 `data/video-assets` 仅作临时目录并加清理。

---

## 八、审计方法说明

本报告结论均来自可执行命令的直接输出，不使用推测：

```bash
curl -sS -o /dev/null -w "%{http_code}" https://sd2.cauai.fun/api/health
curl -sS https://sd2.cauai.fun/api/health                 # 版本与 providers 状态
curl -sS https://sd2.cauai.fun/api/auth/session           # {"user":null}
docker ps --format '{{.Names}} | {{.Status}}'             # 容器状态
docker inspect niannian-sd2-app --format '{{.Config.Env}}' # 环境变量（脱敏）
psql -c "select count(*) from information_schema.tables where table_schema='public'"
python3 -c "import sqlite3; ..."                          # 遗留库表行数
node /tmp/probe_ziyu.mjs                                  # 紫域 /api/v1/models
node /tmp/probe_jobs2.mjs                                 # 紫域 /api/v1/jobs?limit=20
```

所有探测均为只读，未提交任何生成任务，未消耗渠道额度。

取证脚本已归档在 `docs/audit/evidence/`（`probe1.sh` ~ `probe13.sh`），可原样复跑复核：

```bash
ssh -o BatchMode=yes haika-kidswear-1757 'bash -s' < docs/audit/evidence/probe13.sh
```
