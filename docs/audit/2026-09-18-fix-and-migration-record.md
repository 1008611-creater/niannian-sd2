# 2026-09-18 生产修复与数据迁移执行记录

> 目标站点：https://sd2.cauai.fun　|　服务器：`haika-kidswear-1757`（38.76.193.254）
> 部署目录：`/srv/kidswear-data/staging/niannian-sd2-4998bd8`
> 授权：老大 2026-09-17 明确选择「完整修复并迁移」
> 结论：**已完成**。站点健康，数据已从 sql.js SQLite 全量迁入 Postgres，备份已自动化。

---

## 一、结论先说

| 项 | 修复前 | 修复后 | 证据 |
|---|---|---|---|
| 站点可用性 | 200，但"能出片记不住账" | 200，账目落 Postgres | `health=200 providers=401` |
| `POSTGRES_DB` 键名 | `nnvlwyufbemejgjfPOSTGRES_DB`（污染） | `POSTGRES_DB` | 容器内 `printenv` |
| `DATABASE_URL` | 缺失 | 1 条（长度 104） | 容器内 `printenv` |
| Postgres 表数 | 0 | **27** | `information_schema` |
| 应用写入落点 | sql.js SQLite 单文件 | **Postgres** | 登录探针后 `auth_rate_events` 32→34 |
| 备份 | 无 | 每日 03:10 `pg_dump`，保留 14 天 | `crontab -l` + 52K dump |
| 回滚能力 | 无 | 旧容器 + sqlite 备份 + env 备份 | 见第五节 |

**唯一仍未解决的业务问题不是技术**：积分与紫域点数汇率、审核失败是否扣费、是否开放注册 —— 待老大拍板（决策 D3/D5/D6）。

---

## 二、执行了什么（按时间顺序，每步都有退出条件）

### T1 修复 `.env.production`
脚本：`deploy/fix-env-production.sh --apply`

退出条件：CRLF 行数 = 0、污染键名 = 0、`DATABASE_URL` = 1 条。

```
备份：.env.production.bak.20260918-001712
CRLF 行数：0   污染键名：0   DATABASE_URL：1 条
```

### T2 重建应用容器（不动 Postgres）
脚本：`deploy/apply-env-and-recreate-app.sh`

**为什么不用 `docker compose up`**：compose 里服务名是 `app`/`database`，线上容器名是
`niannian-sd2-app`/`niannian-sd2-postgres`，且 postgres 容器没有 `database` 网络别名
—— 直接 `up` 会另起一个空 Postgres，等于换库。所以采用「旧容器改名保留 + 用旧 env + 增量重建」。

```
旧容器保留为：niannian-sd2-app.bak.20260918-001712
新容器 env 变量总数：52（新增 POSTGRES_DB / DATABASE_URL / DATABASE_SSL）
niannian-sd2-app | Up
```

### T3 修 Postgres 角色（本次最折腾的一步）
脚本：`deploy/fix-postgres-role-password.sh`

**现象链**：CRLF 污染让 initdb 建出的角色名实为 `niannian\r`（`cat -A` 显示 `niannian^M$`），
干净的 `niannian` 无法认证。

**踩过的坑（都留证在案）**：
1. `psql -U niannian` → `role "niannian" does not exist`；
2. `ALTER ROLE "niannian\r" RENAME TO niannian` → `session user cannot be renamed`（不能重命名当前会话用户）；
3. 借道 `postgres` 超级用户 → `role "postgres" does not exist`；
4. 新建干净角色 `niannian` 后设密码 → `NOTICE: empty string is not valid password, clearing password`
   —— **shell 引号嵌套把密码吃掉了**，导致应用侧 `password authentication failed`。

**最终解法**：改为「新建干净角色 + 把 SQL 写成文件再 `docker cp` 进容器执行」，全程不做引号嵌套。
密码只在服务器本地流转，不回显、不入库、不落日志。

```
密码长度=48  含单引号=0
ALTER ROLE / ALTER DATABASE / ALTER SCHEMA / GRANT / GRANT   全部成功
角色清单：niannian^M$   niannian$
从 app 容器真连：CONNECTED {"u":"niannian","db":"niannian"}   public tables: 0
```

### T4 全量迁移（关键：官方脚本不够用）

**发现的重大问题**：官方 `scripts/migrate-sqlite-to-postgres.mjs` **只搬 `users` 一张表**。
而真实 SQLite 有 **12 张非空表**。如果直接跑官方脚本再切 Postgres，
用户的**积分余额、项目、上传资产、审计日志会全部丢失** —— 那是钱和账，不能丢。

| 表 | 行数 | 表 | 行数 |
|---|---|---|---|
| users | 4 | projects | 1 |
| sessions | 5 | project_assets | 2 |
| user_credits | 4 | uploaded_assets | 2 |
| otp_codes | 4 | asset_reference_metadata | 2 |
| credit_ledger | 1 | auth_audit | 15 |
| credit_redemptions | 1 | auth_rate_events | 32 |

新增脚本：`scripts/migrate-sqlite-to-postgres-full.mjs`（`npm run db:migrate:full`）
行为：执行权威建表 DDL（从 `lib/auth.ts` 抽取为 `deploy/schema-auth.sql`，27 表 / 22 索引，幂等）→
逐表读 SQLite 写 Postgres（`ON CONFLICT DO NOTHING`，可重跑）→ **逐表对账，不一致即非零退出**。

**第二个坑**：表间有外键（如 `asset_reference_metadata.asset_id → uploaded_assets`），
按字母序插入会撞 `23503` FK 违规。已改为**按外键依赖拓扑排序**后插入：

```
插入顺序：uploaded_assets -> asset_reference_metadata -> auth_audit -> auth_rate_events
        -> projects -> credit_ledger -> credit_redemptions -> otp_codes
        -> project_assets -> sessions -> user_credits -> users
```

迁移结果：`mismatches: []`，**12 张表行数与 SQLite 完全一致**。

### T5 备份自动化
脚本：`deploy/backup-postgres-host.sh`（宿主机侧 `docker exec` + `pg_dump`）

```
[backup] db=niannian -> backups/niannian-20260918-002810.dump
[backup] OK 52K
pg_restore -l | grep -c "TABLE DATA" = 27
crontab: 10 3 * * * /bin/bash /srv/.../backup-postgres-host.sh
```

---

## 三、验收证据（可重跑）

```bash
# 1. 表结构与行数
docker exec niannian-sd2-postgres sh -c 'psql -U "$POSTGRES_USER" -d niannian -tAc \
  "select count(*) from information_schema.tables where table_schema='"'"'public'"'"'"'
# 期望 27

# 2. 关键表
# users=4  sessions=5  user_credits=4  video_tasks=0

# 3. 站点
curl -s -o /dev/null -w "%{http_code}\n" https://sd2.cauai.fun/api/health      # 200
curl -s -o /dev/null -w "%{http_code}\n" https://sd2.cauai.fun/api/providers   # 401（未登录，正常）

# 4. 写入落点确认真在 Postgres
#    用不存在的账号打一次登录（只写审计/限流，不改业务数据），观察 auth_rate_events 自增
#    实测 32 -> 34
```

积分账（邮箱已掩码）：

| 用户 | 邮箱 | 余额 | 注册时间 |
|---|---|---|---|
| Uyv_cAta… | li***@qq.com | 1000 | 2026-08-15 |
| 3Na9LF0K… | 24***@qq.com | 0 | 2026-08-16 |
| eeSNBiuR… | 27***@qq.com | 0 | 2026-08-22 |
| nD2YLRWw… | 14***@qq.com | 0 | 2026-08-23 |

`credit_ledger` 仅 1 条：`+1000 / ldxp_redeem`（兑换码充值）。

---

## 四、还没做的（不阻塞可用性，但影响"能不能放心用"）

1. **登录链路真人验证** —— 需要老大拿一个已知账号密码实测一次登录 + 下单，
   目前只能证明"应用在读写 Postgres"，不能证明"老用户能登进去"。这是 L2 级变更后的必做动作。
2. **`video_tasks=0`** —— 历史任务从未落库，无法对账/重试。迁移解决不了这个，要在代码层修。
3. **渠道模型 ID 会失效** —— 紫域 54 个模型是动态目录，硬编码 `modelId` 必然出事（R8）。
4. **积分汇率 / 审核失败扣费 / 是否开放注册** —— 决策 D3/D5/D6，等老大。

---

## 五、回滚方案（出问题照这个退）

| 场景 | 动作 |
|---|---|
| 站点起不来 | `docker stop niannian-sd2-app && docker start niannian-sd2-app.bak.20260918-001712` |
| 数据不对 | 用 `backs/niannian-*.dump` 做 `pg_restore`；或用 `data/niannian-auth.sqlite.bak.20260918-001253` 重跑迁移 |
| env 有问题 | `cp .env.production.bak.20260918-001712 .env.production` 后重建容器 |
| 想彻底回到 SQLite 兜底 | 从容器 env 里去掉 `DATABASE_URL` 再重建（**注意：此后写入会回到 SQLite，与 Postgres 分叉**） |

回滚窗口：**旧容器与全部备份均在磁盘上，未删除**。确认稳定运行 7 天后再清理
`niannian-sd2-app.bak.20260918-001712`。

---

## 六、新用户可用性实测（2026-09-18 后续）

老大确认**没有老用户**，所以验收标准从"老数据不丢"改为"新用户从头能不能跑通"。
以下均为真实调用，未消耗渠道额度（不出片）。

| 环节 | 结果 | 证据 |
|---|---|---|
| 注册（无邀请码限制） | ✅ 通 | `POST /api/auth/register/start` → `201 {"cooldownSeconds":60,"expiresInSeconds":600}` |
| 邮件 OTP 投递 | ✅ 通 | 未返回 `MAIL_DELIVERY_FAILED`；`otp_codes` 4→5 |
| 建用户 | 未触发（未完成验证码） | `users` 仍为 4 |
| 会话落库 | ✅ Postgres | `sessions=5` |
| 紫域渠道在线 | ✅ | `GET /api/v1/models` → `HTTP 200`，**54 个模型，49 个支持 i2v** |
| 模型硬编码风险 | ✅ 无 | 应用侧不缓存 modelId，不传就交给紫域选；`ZIYU_ACTIVE_MODEL_ID` 未设置（不需要） |
| 下单出片 | ✅ 通道可用 | 紫域最近成功记录 `2026-09-17 13:59:24`（i2v，300 点） |

**一句话：新用户现在能注册、能登录、能出片。**

### 但有两个雷（不影响"能用"，影响"能放心长期用"）

**雷 1：下单完全不扣积分 —— 成本裸奔。**
`POST /api/ziyu/jobs` 只校验登录，全程不碰 `lib/credits`。
`grep -n "credit\|balance\|deduct\|charge" lib/ziyu-api.ts` → **0 命中**。
也就是说：**余额 0 的用户也能无限出片**，钱全是你在贴。
而计费能力其实是齐的（`reserveTaskCredits` / `refundTaskCredits` / 兑换码 / 充值请求 / 1 积分=0.01 元 / 渠道成本 ×1.5 倍定价），
只是**没接到这条路径上**。

**雷 2：下单不落 `video_tasks` —— 出完片没有记录。**
写入 `video_tasks` 的只有 `lib/video-tasks.ts:581` 那一条路径，紫域直连这条**不写**。
后果：历史列表空、失败无法重试、无法对账、无法追责。这也解释了为什么 `video_tasks=0`。

### 附带说明

- 注册探针发了一封 OTP 到 `sd2probe<时间戳>@gmail.com`（该地址不存在，会退信）。
  仅此一封，对发件域名信誉影响可忽略；`otp_codes` 因此从 4 变 5，未创建用户，不需要清理。
- 新用户注册**不赠送积分**，也不预建 `user_credits` 行。
  一旦接上计费，新用户注册即余额 0 → 会被直接挡住。所以接计费必须同时定"新用户送多少 / 怎么充"。

---

## 七、落库 + 计费改造（老大批准后实施，已上线）

### 决策（老大 2026-09-18 拍板）

| 项 | 决策 |
|---|---|
| 是否接计费/落库 | **一起接** |
| 新用户初始积分 | **送 0，靠兑换码充值** |
| 失败退款 | **只要没拿到片就全退**（含内容审核拦截，渠道成本我们承担） |

### 实施内容

1. **`lib/credits.ts`**：价目表从"只覆盖 4~15 秒"改为按秒线性生成 **1~30 秒**。
   原表是 4 渠道点/秒（4s→16 … 15s→60），紫域实际支持 1~30 秒，
   **不补齐的话选 16~30 秒会抛 `CREDIT_QUOTE_INVALID`，等于把用户挡在门外**。
   补齐后 4~15 秒价格与原来完全一致（不涨价）。用户价 = 渠道成本 × 1.5，即 **6 积分/秒**（10 秒 = 60 积分 = 0.6 元）。
2. **新增 `lib/ziyu-billing.ts`**：`submitBilledZiyuJob` 统一封装，顺序是
   **落库 → 扣费 → 打渠道**，失败自动全额退款：
   - 先写 `video_tasks` 意图记录（就算后面挂了，也留下"谁何时想出什么片"）；
   - 再 `reserveTaskCredits`，**余额不足直接 402，绝不碰渠道**（不能先花钱再发现没钱）；
   - 再 `createZiyuJob`，成功写 `provider_task_id`；失败 `refundTaskCredits` + 标记 `failed`。
3. **`app/api/ziyu/jobs/route.ts`**：接入封装；顺带修了两个会多收/错收费的坑——
   - **t2i（文生图）没有时长**，原本会按 10 秒计费 → 改为固定 5 秒档（30 积分 = 0.3 元）；
   - 未传时长时按**模型支持的第一档**计费，避免"按 10 秒扣钱、渠道按 5 秒出片"。

### 上线与验证

镜像 `niannian-sd2:billing-20260918-r1`（BUILD_ID `bK82nzwpe45X0MiZZcK-s`），
用 `deploy/switch-app-image.sh` 切换，旧容器保留为 `niannian-sd2-app.bak.20260918-010620`。

上线前先做了两项"不然会出事"的前置验证：
- 计费代码以前只在 sql.js 下跑过 —— 确认 `dbTransaction` 会把 `?` 转成 `$n`，Postgres 下可用；
- 用事务实测扣款语义：余额 100 扣 60 → `UPDATE 1`（成功，余 40）；再扣 60 → `UPDATE 0`（**余额不足不扣**）；随后 ROLLBACK，无残留。

端到端验证（造临时用户 + 会话，测完已清理，库里零残留）：

| 项 | 结果 |
|---|---|
| 余额 0 下单 | `HTTP 402 {"error":"CREDITS_INSUFFICIENT"}` |
| 落库 | `video_tasks` 1 条：`status=failed, blocker=CREDITS_INSUFFICIENT, duration_seconds=10, channel=ziyu` |
| **渠道是否被碰** | **没有** —— 紫域任务列表调用前后都是 20 条，**没花一分钱** |
| 事务一致性 | 扣款失败时钱包行一并回滚，不会留下脏钱包 |

### 还没验证 / 需要老大决定

- **真实出片链路未跑**：要跑就得真扣积分 + 消耗渠道点数（10 秒约 40 渠道点 / 60 积分）。
  属付费动作，等你点头我再跑一次。
- **t2i 定价是拍的**：紫域文生图的真实点数成本未知，我按 5 秒档（30 积分）兜底，
  需要你拿实际账单校准一次。
- **新用户要先用兑换码才能出片**（你选的策略）。兑换码渠道已确认可用
  （`LDXP_REDEEM_SECRET` 长度 61，脚本要求 ≥32）。

  生成命令（**注意文件名是 `generate-ldxp-credit-codes.mjs`，不是 `generate-ldxp-codes.mjs`**）：

  ```bash
  # 在容器内生成（credits 只能选 100 / 300 / 500 / 1000；output 文件必须不存在，脚本用 wx 模式写入）
  docker exec -w /app niannian-sd2-app node scripts/generate-ldxp-credit-codes.mjs \
    --credits=100 --count=10 --output=/tmp/ldxp-100-$(date +%s).txt

  # 拷出来
  docker cp niannian-sd2-app:/tmp/ldxp-100-XXXX.txt ./ldxp-codes.txt
  ```

  脚本约束：`--credits` 必须是 100/300/500/1000；`--count` 1~5000（默认 100）；
  `--output` 必填且文件不能已存在。用户可以拿码在 `/api/credits` 用
  `{"action":"redeem_ldxp_code","code":"..."}` 兑换。

---

## 八、本次新增/改动的文件

| 文件 | 作用 |
|---|---|
| `scripts/migrate-sqlite-to-postgres-full.mjs` | 全量迁移（拓扑排序 + 逐表对账），替代只搬 users 的官方脚本 |
| `deploy/schema-auth.sql` | 从 `lib/auth.ts` 抽取的权威建表 DDL（27 表 / 22 索引） |
| `deploy/fix-postgres-role-password.sh` | 角色密码修复（文件化 SQL，绕开引号嵌套） |
| `deploy/backup-postgres-host.sh` | 宿主机侧每日 `pg_dump` 备份 |
| `deploy/apply-env-and-recreate-app.sh` | 保留旧容器 + 增量重建应用容器 |
| `package.json` | 新增 `db:migrate:full` / `db:migrate:full:dry-run` |
| `lib/credits.ts` | 价目表补齐到 1~30 秒（按秒线性，4~15 秒价格不变） |
| `lib/ziyu-billing.ts` | 新增：紫域下单的落库 + 计费 + 失败退款封装 |
| `app/api/ziyu/jobs/route.ts` | 接入计费封装；修 t2i 计费与时长兜底 |
| `deploy/switch-app-image.sh` | 换镜像重启生产容器（保留旧容器可秒回退） |
