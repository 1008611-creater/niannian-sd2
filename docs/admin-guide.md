# 后台管理指南

> 老大问："我有没有后台管理界面能管理这个网站？"
> 答：**有**，在 `https://sd2.cauai.fun/admin`。下面写清它能管什么、谁能进、怎么改。

---

## 一、入口与权限

| 项 | 值 |
|---|---|
| 地址 | **https://sd2.cauai.fun/admin** |
| 谁能进 | 登录用户中，邮箱属于 `ADMIN_EMAILS` 的那些 |
| 当前管理员 | `1453637677@qq.com`（2026-09-18 起**显式配置**在 `ADMIN_EMAILS`，不再依赖代码默认值） |
| 鉴权实测 | 非管理员访问 `/api/admin/overview` → `403 ADMIN_REQUIRED` ✅ |

**怎么加管理员**：改 `ADMIN_EMAILS`，多个用逗号分隔。已在 `.env.production` 里，
改完需要重建容器才生效（`deploy/switch-app-image.sh` 支持直接带 `KEY=VALUE` 传）。

```bash
ssh haika-kidswear-1757 'bash -s -- <当前镜像> ADMIN_EMAILS=a@b.com,c@d.com' \
  < deploy/switch-app-image.sh
```

---

## 二、能管什么（5 个页签）

后台首页 `app/admin/page.tsx`，数据来源 `GET /api/admin/overview`。

| 页签 | 能力 |
|---|---|
| **任务** | 任务看板：状态、阻塞原因、SLA、优先级（critical/warning/normal/done）、是否逾期、"下一步该做什么"建议；可直接改任务状态 |
| **用户** | 用户列表：邮箱、注册时间、项目数、任务数、是否管理员 |
| **积分** | 积分概览 + **充值申请审批/驳回**（确认收款后入账） |
| **渠道** | 各渠道健康度：紫域 / MIMO / MIORA 等，含可达性、认证状态、余额回读 |
| **审计** | 事件流：谁在什么时候做了什么 |

### 关于积分，这里要特别说清楚

- 用户侧充值 **不是自动到账**：用户在 `/api/credits` 提交 `create_recharge_request`，
  生成一条 `pending` 记录；**管理员在后台"积分"页确认收款后点批准**，积分才入账。
- 兑换码（`NN-100-...` 这类）是**另一条路**：用户自助兑换，立即到账，不需要审批。
- 生成兑换码（100/300/500/1000 四档）：

  ```bash
  docker exec -w /app niannian-sd2-app node scripts/generate-ldxp-credit-codes.mjs \
    --credits=100 --count=10 --output=/tmp/ldxp-100-$(date +%s).txt
  docker cp niannian-sd2-app:/tmp/ldxp-100-XXXX.txt ./ldxp-codes.txt
  ```

- ⚠️ **后台没有"直接给某人加积分"的按钮**。要人工加积分，目前只能走兑换码
  （给他一个码让他自己兑）。需要直接加余额的话，得新做一个 admin 动作。

---

## 三、不能管什么（别误会）

| 你以为能管 | 实际情况 |
|---|---|
| 改模型价格 | ❌ 价目表写死在 `lib/credits.ts`（6 积分/秒，t2i 按 5 秒档） |
| 上下架渠道 | ❌ `provider-contract.ts` 静态描述 + env 配置，改代码才生效 |
| 改模型目录 | ❌ 来自紫域，我们只做 10 分钟快照同步（ADR-0005） |
| 直接加积分 | ❌ 只能走兑换码或审批充值 |
| 看渠道花了多少钱 | ⚠️ 后台能看到渠道余额回读，但没有"我方成本 vs 用户付费"的对账报表 |

---

## 四、相关文件

| 文件 | 作用 |
|---|---|
| `app/admin/page.tsx` | 后台 UI（client component） |
| `app/api/admin/overview/route.ts` | 后台数据接口 + 任务/充值审批写操作 |
| `lib/admin.ts` | 聚合逻辑、管理员判定 `isAdminEmail` |
| `lib/credits.ts` | 积分总览、充值审批、退款 |
