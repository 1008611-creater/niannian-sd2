# P0 后台运营地基：执行记录（定价 / 模型 / 数据看板）

> 日期：2026-09-18　|　范围：`docs/admin-capability-gap.md` 里的 **P0 三项**
> 原则：**每个能力都是"后台 + 源站"成对交付**，只做一半不算完成。

---

## 一、结论先说

P0 三项**已全部落地并本地实测通过**：

| 能力 | 之前 | 现在 | 实测证据 |
|---|---|---|---|
| **定价管理** | 价目表写死在 `lib/credits.ts`，改价要改代码 + 重新构建镜像 + 重启生产 | 存 `pricing_rules` 表，后台改完**立即生效**，不用发版 | 后台改 6→10 积分/秒后，源站 `/api/credits` 5 秒档从 30 变 50 |
| **模型管理** | 只能用紫域下发的模型，改不了名、上不了下架、加不了价 | `model_overrides` 表：中文名 / 上下架 / 排序 / 标签 / 加价系数；源站只展示已上架 | 后台写入 `zy_model_demo` 覆盖（下架 + 改名 + 加价 20%）成功 |
| **数据看板** | 只有 6 个静态数字 | 新增「数据看板」标签页：用户/任务趋势、积分消耗与充值、收入与渠道成本、失败原因分布、Top 模型 | `/api/admin/analytics` 返回完整结构 |

**未做完的**：P1（素材、项目）、P2（模板）、P3（团队）尚未开工。

---

## 二、交付清单

### 数据库（新增 2 张表，写在 `lib/auth.ts` 的权威 schema 里）

```sql
pricing_rules   -- id / mode / credits_per_second / flat_credits / min_seconds / max_seconds / enabled / note / updated_by / 时间戳
model_overrides -- model_id / display_name / enabled / sort_order / tags / surcharge_percent / note / updated_by / 时间戳
```

两张表都随应用启动自动 `CREATE TABLE IF NOT EXISTS`（SQLite 与 Postgres 同一份 schema），
**不需要手工迁移**。首次访问会自动播两条默认价（6 积分/秒，等价于改造前的 `4 点/秒 × 1.5`），**不涨价**。

### 库逻辑

| 文件 | 作用 |
|---|---|
| `lib/pricing.ts` | 价目表唯一权威来源。内存缓存 30 秒 + 写操作主动失效；`pricingCostFor` / `pricingTable` / `pricingCoverage` |
| `lib/model-catalog.ts` | 紫域渠道模型 ⋈ 后台覆盖。`listPublicModels`（源站）/ `adminModelCatalog`（后台）/ `catalogModelById`（下单校验） |
| `lib/analytics.ts` | 只读聚合：趋势、收入、成本、失败原因、Top 模型 |
| `lib/credits.ts` | `taskCreditCost` / `creditPricing` 改为读库；`reserveTaskCredits` 支持 `surchargePercent` |
| `lib/ziyu-billing.ts` | 下单时把模型加价系数带进扣费 |
| `lib/video-tasks.ts` | 下单与授权前先 `ensurePricingLoaded()`，避免用到冷启动默认值 |

### API

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/admin/pricing` | GET / PATCH / DELETE | 价目表读写，`action=restore_default` 一键回出厂价 |
| `/api/admin/models` | GET / PATCH / DELETE | 模型覆盖读写 |
| `/api/admin/analytics` | GET | 经营看板数据 |

三个接口都强制 `ADMIN_REQUIRED`（实测未登录返回 **403**），写操作校验 `validRequestOrigin`（CSRF）。

### 后台 UI（`app/admin/page.tsx` 新增三个标签页）

- **数据看板**：6 张指标卡 + 4 组 14 天趋势条 + 失败原因 / Top 模型 / 渠道分布
- **定价管理**：规则表 + 编辑表单 + 1~30 秒逐秒价格预览 + 覆盖率缺口告警 + 遮蔽告警
- **模型管理**：全量目录（含「渠道已移除」残留）+ 上下架 / 改名 / 排序 / 加价 / 标签

### 源站（用户侧，成对交付的另一半）

- `/api/providers` 改走 `listPublicModels()` —— **下架的模型源站看不到**
- `POST /api/ziyu/jobs` 校验改用合并目录：下架模型返回 `MODEL_DISABLED`，渠道已移除返回 `MODEL_NOT_FOUND`
- `/api/credits` 的输出直接来自 `pricing_rules`，改价即所见
- 模型加价在下单扣费时生效：`ceil(基础价 × (1 + 加价%))`

---

## 三、实测记录（本地 SQLite，2026-09-18）

```
1. 注册 1453637677@qq.com          → 201，OTP 投递成功
2. 验证 OTP 拿会话                  → 201
3. GET  /api/admin/pricing          → 200，两条默认规则，1~30 秒全覆盖
4. GET  /api/credits                → 自动模式 5s=30 / 10s=60（改造前一致）
5. PATCH /api/admin/pricing 改成 10 → 200
6. GET  /api/credits                → 5s=50 / 10s=100  ← 源站跟着变了
7. PATCH restore_default            → 200，5s 回到 30
8. GET  /api/admin/models           → 200（本地无 ZIYU_API_KEY，channelError 如实上报，不谎报空列表）
9. PATCH /api/admin/models          → 200，覆盖写入成功
10. GET /api/admin/analytics        → 200，完整结构
11. 未登录访问 /api/admin/pricing   → 403
```

---

## 四、过程中发现并修掉的两个坑

### 坑 1：新增同区间规则不生效（**已修**）

**现象**：后台新增一条「1~30 秒 · 10 积分/秒」，源站价格一动不动。
**根因**：新旧两条规则区间宽度相同，命中顺序依赖数组原顺序，旧规则先被选中。
**这最危险** —— 管理员以为自己改过价了，实际没变，而且表面上看不出任何异常。

**修法**：
1. 命中优先级改成确定的三级：**区间更窄 → 最近保存 → 一口价**；
2. 后台对「1~30 秒里一秒都命中不到」的规则打 **「被遮蔽（不生效）」** 标记并弹告警条。

### 坑 2：冒烟测试报 HTTP 308 + 50 次重定向（**已修，环境问题**）

**现象**：`scripts/smoke.sh` 访问 `http://127.0.0.1:3999/` 死循环。
**根因**：环境里设了 `HTTP_PROXY=http://127.0.0.1:52161`，curl 把本地回环也发给代理，代理绕圈子。
**与应用无关**（`--noproxy '*'` 后：单跳 307 → `/home` → 200，完全正常）。
**修法**：`scripts/smoke.sh` 所有 curl 加 `--noproxy '*'`，并写下原因注释。

---

## 五、已知未决（不藏）

| 项 | 状态 | 说明 |
|---|---|---|
| **契约测试红灯（R30）** | ❌ 未修 | `scripts/video-workbench-harness.contract.test.mjs` 13 用例 12 通过，第 1 个报 `QUEUE_PACKET_HASH_MISMATCH`。**非本次改动引入**（该测试只 import node 内置 + 两个未改动的 harness 脚本）。没擅自改 fixture 掩盖 —— 要先确认是「fixture 被手改过」还是「哈希算法变更」 |
| **渠道成本是估算（R31）** | ⚠️ 已披露 | 看板按「用户价 ÷ 1.5」反推，UI 上强制显示口径说明。真实账单要去紫域后台对账 |
| **模型管理的真实模型未测** | ⚠️ 未测 | 本地没有 `ZIYU_API_KEY`，只验证了覆盖配置的读写；54 个真实模型的上下架要上线后看 |
| **t2i 定价未校准（R25）** | ⚠️ 待老大 | 现在按 5 秒档（30 积分）兜底，紫域 t2i 真实点数成本未知 |
| **真实出片链路未验证（R26）** | ⚠️ 待老大 | 需要兑换码充值后跑一次（约 40 渠道点 / 60 积分） |

---

## 六、下一步

按 `docs/admin-capability-gap.md` 的分期，进入 **P1**：

1. **素材库管理** —— 管理员全局视图 + 违规下架 + 设公共素材（`uploaded_assets` 加治理字段）
2. **项目管理** —— 后台项目列表 + 异常处置

两者同样按「后台 + 源站」成对验收。
