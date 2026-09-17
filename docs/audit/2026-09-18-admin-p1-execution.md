# P1 内容与资产：执行记录（素材库治理 / 项目管理）

> 日期：2026-09-18　|　范围：`docs/admin-capability-gap.md` 里的 **P1 两项**
> 原则：**每个能力都是"后台 + 源站"成对交付**，只做一半不算完成。
> 前情：P0（定价 / 模型 / 数据看板）已交付，见 `docs/audit/2026-09-18-admin-p0-execution.md`。

---

## 一、结论先说

P1 两项**已全部落地，37 步端到端实测全过**：

| 能力 | 之前 | 现在 | 实测证据 |
|---|---|---|---|
| **素材库管理** | 素材是纯私有的，管理员看不到全局、下架不了违规内容、设不了公共素材 | 后台「素材库」标签页：全局视图（归属 / 用途 / 大小 / 可见性 / 处置说明 / 预览）+ 三档可见性切换；源站 `/assets` 新增「公共素材」分区 | 管理员设公共 → 另一个账号的 `publicAssets` 立刻出现并能预览；下架 → 该账号列表与直链都 404；管理员自己仍能预览复核 |
| **项目管理** | 后台没有项目列表，管理员看不到也管不了 | 后台「项目管理」标签页：归属 / 状态 / 素材数 / 任务数 + 状态强制修正；**「已冻结」在源站真实生效** | 冻结后挂素材、建任务、提剧本三条写入路径全部 409 `PROJECT_FROZEN`；解冻后同样的操作恢复 201 |

**刻意不做的**：项目删除。删项目会连带删掉画布、任务关联、素材关联，不可逆。要处置异常项目，改状态为「已冻结」。

**没做完的**：P2（模板素材）、P3（团队）。

---

## 二、交付清单

### 数据库（新增 2 张表，写在 `lib/auth.ts` 的权威 schema 里）

```sql
asset_moderation -- asset_id / visibility(owner|public|taken_down) / reason / updated_by / 时间戳
admin_audit      -- id / actor_email / target_type / target_id / action / detail / created_at
```

**为什么素材治理单独建一张表，而不是给 `uploaded_assets` 加列：**

1. 生产库是 Postgres，加列要写 `ALTER` 迁移；新建表随应用启动自动建好，**零迁移**；
2. 素材本体和字节是**历史任务的证据**，下架只能影响"展示"，不能污染原始记录。
   这也是 R36 里登记的取舍：满足"隐藏 + 可追溯"，**不满足**"物理删除"。

| 文件 | 作用 |
|---|---|
| `lib/asset-library.ts` | 三档可见性 `owner` / `public` / `taken_down`；`setAssetModeration`（下架必填理由）/ `adminAssetList` / `listPublicAssets` / `publicAssetUsable` / `previewForViewer` |
| `lib/project-admin.ts` | `adminProjectList`（带素材数 / 任务数子查询）/ `setProjectStatus`；五种状态：准备中 / 进行中 / 已暂停 / 已完成 / 已冻结 |
| `app/api/admin/assets/route.ts` | GET 列表（支持 query + 可见性筛选）+ PATCH 改可见性 |
| `app/api/admin/projects/route.ts` | GET 列表 + PATCH 改状态 |

### 源站侧（不是只做后台）

| 文件 | 改动 |
|---|---|
| `app/api/assets/route.ts` | GET 同时返回 `{ assets, publicAssets }` |
| `app/assets/page.tsx` | 新增「我的素材 / 公共素材」切换；公共素材卡片打「公共素材」标签，不能直接引用隐藏（非本人无隐藏权限） |
| `app/media/assets/[id]/route.ts` | 改用 `previewForViewer`：已下架任何人不可见，但**管理员仍可预览复核** |
| `lib/video-tasks.ts` | `loadAssets()` 支持引用公共素材；`listReusableImageAssets()` 排除已下架 |
| `lib/project-workspace.ts` | 新增 `writableProject()`：冻结项目在挂素材 / 挂任务 / 提剧本三处抛 `PROJECT_FROZEN` |
| `app/api/video-tasks/route.ts` | 建任务前用 `writableProject` —— **在扣积分之前拦住**，避免扣了分才报错 |

### 后台 UI

`app/admin/page.tsx` 标签页 8 → 10，新增「素材库」「项目管理」，均带：
- 搜索框（素材：文件名 / ID / 上传者邮箱；项目：项目名 / ID / 归属邮箱）
- 操作说明文案（写清"下架只影响展示"、"不做删除"的原因）
- 素材面板额外有：可见性筛选、下架理由必填弹区

---

## 三、实测（37 步，全部通过）

脚本：`scripts/admin-p1-assets-projects.e2e.mjs`（`npm run test:admin-p1:e2e`，需先 `npm run build`）

**为什么不用单账号测**：后台改一次可见性会同时影响「管理员视图 / 上传者视图 / 其他人视图 / 下单引用」
四个地方。只测后台接口返回 200 毫无意义。所以脚本开了三个独立账号交叉验证：

- **上传者 A**：上传素材、建项目
- **管理员**：改可见性、改项目状态
- **路人 B**：验证"别人到底看不看得见"

关键几步：

```
PASS 11 后台设为公共素材
PASS 12 路人 B 的公共素材里出现了它 :: publicAssets=1
PASS 13 路人 B 能预览这个公共素材 :: status=200
PASS 14 下架不带理由被拒 :: status=400 error=ASSET_TAKEDOWN_REASON_REQUIRED
PASS 16 下架后路人 B 看不到它 :: publicAssets=0
PASS 17 下架后路人 B 直链也取不到 :: status=404
PASS 18 管理员仍能预览已下架素材（可复核） :: status=200
PASS 20 上传者 A 仍能看到自己的素材（字节没被污染） :: assets=1
PASS 28~29 冻结项目成功 / 冻结状态真的落库了
PASS 30~32 冻结项目不能挂素材 / 建任务 / 提剧本 :: 409 PROJECT_FROZEN
PASS 33 冻结项目仍可只读（冻结不是消失） :: status=200
PASS 35 解冻后又能挂素材（闸门没误伤） :: status=201
```

**PASS 35 这条是专门加的正向对照**：只测"冻结后拦住"是不够的，
万一闸门写错把正常项目也拦了，测试反而全绿。所以必须再验证一次"解冻后确实恢复"。

---

## 四、过程中发现并修掉的问题

### 1. 「已冻结」是个空状态（最该修的一个）

后台能给项目设「已冻结」，但源站完全不认这个状态——用户照样挂素材、建任务、提剧本。
**这个状态当时只是一个汉字，没有任何约束力。**

修法：加 `writableProject()` 闸门，替换三个写入口的 `ownedProject()`。
其中「建任务」这条特别处理：`/api/video-tasks` 里把校验**前置到扣积分之前**，
否则用户会被扣了分才收到报错。

### 2. 第一版实测漏掉了项目冻结的正路径

第一次跑 26 步全绿，但「冻结项目」那条被 `if (firstProject)` 跳过了——本地库里没有项目。
**全绿是因为没测到，不是因为通过了。**

修法：脚本里先用 A 的账号真建一个项目再测，并加断言"后台列表能看到刚建的项目"。
补完后 32 步 → 加冻结闸门断言后 37 步。

### 3. 后台素材预览链接原本打不开

后台列表的预览链接指向 `/media/assets/<id>`，而那个路由原本只认"所有者本人"。
管理员点开会 404，等于看得到管不了。

修法：`previewForViewer()` 显式区分三种身份——本人 / 公共素材使用者 / 管理员，
管理员对已下架素材也能预览（否则没法复核自己下了什么）。

---

## 五、质量门

| 步骤 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ |
| secret scan | ✅ |
| `npm run build` | ✅ |
| smoke 3/3 | ✅ |
| `npm run test:admin-p1:e2e` | ✅ 37 步 |
| `npm run verify` | ⚠️ **1 个红灯**（R30，非本次引入） |

R30：`scripts/video-workbench-harness.contract.test.mjs` 第 1 用例
`QUEUE_PACKET_HASH_MISMATCH`（13 用例 12 通过）。
**判定非本次改动引入** —— 该测试只 import node 内置模块 + 两个本次未改动的 harness 脚本
（`git status` 确认这两个文件无改动）。**未擅自改 fixture 掩盖**，登记在 `docs/risk-register.md`。

---

## 六、遗留与下一步

| 项 | 状态 |
|---|---|
| 生产部署（P0 + P1 一起） | **待老大批准**，未动生产 |
| R30 harness 红灯 | 待老大定夺是 fixture 被手改还是哈希算法变更 |
| R35 公共素材需不需要通知上传者 | 目前只做了「管理员才能设 + 全量审计」，没做站内通知 |
| R36 物理删除 vs 隐藏 | 当前是"隐藏 + 可追溯"；若合规要求物理删除需另做 |
| R25 t2i 定价校准、R26 真实出片链路 | 仍待老大授权 |

**下一步 P2：模板素材** —— `templates` 表 + 后台 CRUD + 源站模板市场入口与一键套用。
