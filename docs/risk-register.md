# risk-register.md — 风险登记表

> 登记日期：2026-09-17　|　等级：P0 阻塞 / P1 高 / P2 中

| ID | 风险 | 等级 | 证据 | 影响 | 处置 | 负责人 |
|---|---|---|---|---|---|---|
| R1 | Postgres 0 张表，迁移从未执行 | P0 | `information_schema` 计数为 0 | 所有写库功能无持久化保证 | T0-3 + T0-4 | 待定 |
| R2 | 应用容器缺 `DATABASE_URL`，且 `POSTGRES_DB` 被污染成 `nnvlwyufbemejgjfPOSTGRES_DB` | P0 | 容器内 `printenv` 键名证据 | 应用退回 sql.js SQLite 单文件兜底，Postgres 闲置 | T0-2 + T0-3 | 待定 |
| R3 | 生产数据实际落在 sql.js SQLite 单文件（无并发安全、无备份） | P0 | `data/niannian-auth.sqlite` 372KB，最后写入 2026-08-23 | 磁盘/容器损坏即丢失全部用户与账目 | T0-4 + T0-5 | 待定 |
| R4 | 无备份 | P0 | 无 crontab/备份脚本 | 数据不可恢复 | T0-5 | 待定 |
| R5 | 源码无 Git，无回滚能力 | P0 | `ls -d .git` 失败 | 故障无法回滚、CI 空转 | T0-1 | 待定 |
| R6 | `.env.production` CRLF + 首行污染 | P1 | `file` 输出 CRLF；首行 `nnvlwyufbemejgjfPOSTGRES_DB` | 凭据解析错误（R2 的根因） | T0-2 | 待定 |
| R7 | 本地任务表从未落库（`video_tasks=0`） | P1 | SQLite 计数 | 无法对账、无法重试、无法审计 | T1-1 | 待定 |
| R8 | 渠道模型 ID 会失效 | P1 | 历史任务 `model not found`、`unavailable` | 下单直接失败 | T1-3 | 待定 |
| R9 | 生成失败率约 30%（含审核拦截） | P1 | 20 条任务 6 条失败 | 用户体验差、可能白扣积分 | T1-5 | 待定 |
| R10 | 未启用渠道仍在 UI/接口描述中出现 | P1 | `provider-contract.ts` 静态描述 | 假能力，误导用户 | T1-2 | 待定 |
| R11 | 无 worker/dispatcher 但保留队列代码 | P2 | `docker ps`、`ps aux` 无进程 | 死代码误导维护 | T3-1 | 待定 |
| R12 | `lint` 实际是 `tsc --noEmit` | P2 | `package.json` | 无静态检查 | T2-3 | 待定 |
| R13 | `/api/health` 暴露内部版本与迁移名 | P2 | 接口响应 | 信息泄露（低危害） | T3-2 | 待定 |
| R14 | 镜像 32 天未重建（2026-08-16） | P2 | `docker inspect` | 与源码漂移 | T0-1 后纳入 CI 构建 | 待定 |
| R15 | 依赖紫域单一渠道 | P1 | 凭据矩阵 | 渠道停摆即全线停摆 | 预设备用渠道 + 优雅降级提示 | 待定 |
| R16 | 积分与渠道点数汇率未定义 | P1 | 无相关配置 | 成本失控、对账困难 | 决策 D3 | 老大 |
| R17 | **官方迁移脚本只搬 `users` 一张表** | P0 | `scripts/migrate-sqlite-to-postgres.mjs` 全文 101 行，只 INSERT users | 直接跑官方脚本 = 丢失积分/项目/资产/审计 | 已改用 `scripts/migrate-sqlite-to-postgres-full.mjs`（全表 + FK 拓扑序 + 逐表对账） | 已处置 2026-09-18 |
| R18 | 表间存在外键，朴素批量插入会撞 `23503` | P1 | 迁移实测 `asset_reference_metadata_asset_id_fkey` | 迁移中断、数据半截 | 已按 `information_schema` 外键依赖拓扑排序插入 | 已处置 2026-09-18 |
| R19 | Postgres 角色名被 CRLF 污染成 `niannian\r` | P1 | `cat -A` 显示 `niannian^M$` | `DATABASE_URL` 用干净用户名无法认证 | 新建干净角色 `niannian` + 文件化 SQL 设密；旧带 CR 角色暂留 | 已处置 2026-09-18 |
| R20 | 迁移后尚未做真人登录 + 下单验证 | P1 | 只能用探针证明"写在 Postgres" | 老用户能否登录仍未证实 | **已降级**：老大确认无老用户；改用新用户链路实测，注册/登录/渠道均通（2026-09-18） | 已降级 |
| R21 | **紫域下单路径完全不计费** | P0 | `grep "credit\|balance\|deduct\|charge" lib/ziyu-api.ts` → 0 命中 | 余额 0 也能无限出片，成本裸奔、无法商业化 | **已处置**：接入 `lib/ziyu-billing.ts`（先扣费后打渠道，402 不碰渠道），2026-09-18 上线 | 已处置 |
| R22 | 紫域下单不写 `video_tasks` | P1 | 写入点仅 `lib/video-tasks.ts:581`（另一条路径） | 历史空、失败无法重试、无法对账 | **已处置**：同一封装内先落库再提交 | 已处置 |
| R23 | 新用户注册不送积分、不建 `user_credits` 行 | P1 | `verifyRegistration` 只 INSERT users | 一旦接计费，新用户注册即被挡 | **已按老大决策**：送 0，走兑换码充值；`reserveTaskCredits` 内 `ensureWallet` 会按需建钱包 | 已处置（策略：送 0） |
| R24 | 价目表只覆盖 4~15 秒，渠道支持 1~30 秒 | P1 | `lib/credits.ts` 原常量表；紫域 `allowedDurations` 分布 | 选 16~30 秒会抛 `CREDIT_QUOTE_INVALID`，把用户挡在门外 | **已处置**：改为 1~30 秒按秒线性（4 点/秒），4~15 秒价格不变 | 已处置 |
| R25 | t2i（文生图）按时长计费会多收 | P2 | t2i 无时长概念 | 生图按 10 秒收 = 60 积分，明显偏高 | 已按 5 秒档（30 积分）兜底；**真实成本待老大按账单校准** | 老大 |
| R26 | 真实出片链路尚未跑通验证 | P1 | 需真扣积分 + 消耗渠道点数 | 无法确认"充值后能真正出片" | 待老大授权后跑一次（约 40 渠道点 / 60 积分） | 老大 |
| R27 | 模型目录全实时拉取，上游抖动即全线不可用 | P1 | `lib/ziyu-api.ts` 原实现 `cache:"no-store"`，下单校验也实时拉 | 紫域抖一下 → 工作台打不开、下单 502 | **已处置**：快照 + 实时兜底（TTL 600s，上游挂则退回旧快照并标记 degraded），见 ADR-0005 | 已处置 2026-09-18 |
| R28 | 管理员身份依赖代码硬编码默认邮箱 | P1 | `lib/admin.ts:16 DEFAULT_ADMIN_EMAIL`；容器内 `ADMIN_EMAILS` 未配置 | 换环境/改代码可能丢失管理员身份 | **已处置**：`ADMIN_EMAILS=1453637677@qq.com` 显式写入 `.env.production` 与容器 env | 已处置 2026-09-18 |
| R29 | 后台无法直接给用户加积分 | P2 | `app/admin/page.tsx` 只有充值审批，无加余额动作 | 人工补偿/赠送只能发兑换码 | 需要时再补 admin 动作 | 待定 |

---

## 状态更新（2026-09-18）

| ID | 原状态 | 现状态 | 说明 |
|---|---|---|---|
| R1 | P0 未处置 | **已关闭** | Postgres 现有 27 张表，12 张非空表数据与 SQLite 一致 |
| R2 | P0 未处置 | **已关闭** | `POSTGRES_DB` 键名已修正，`DATABASE_URL` 已注入并生效 |
| R3 | P0 未处置 | **已关闭** | 写入落点已确认为 Postgres（`auth_rate_events` 32→34） |
| R4 | P0 未处置 | **已关闭** | 每日 03:10 `pg_dump` + 14 天保留，首个备份已校验（52K / 27 表） |
| R6 | P1 未处置 | **已关闭** | CRLF 0 行、污染键名 0 |
| R5/R7~R16 | — | 未变 | 仍需进入阶段 1~3 整改 |
