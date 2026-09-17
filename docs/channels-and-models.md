# 渠道与模型：事实、决策与实现约束

> 状态：**待 老大 拍板**（本文给出建议值，确认后转入 `CONSTRAINTS.md` 与 ADR）
> 最后核实：2026-09-17（基于部署现场与紫域 API 实测）

---

## 一、事实层（已验证，不是推测）

### 1.1 渠道从哪来

- 网站**没有自有模型**。全部生成能力来自第三方渠道 **紫域（ziyuai.vip）**，通过 `Authorization: Bearer <ZIYU_API_KEY>` 调用。
- 代码位置：`lib/ziyu-api.ts`（默认 `DEFAULT_BASE_URL = "https://ziyuai.vip"`，可用 `ZIYU_BASE_URL` 覆盖）。
- 紫域接口：`GET /api/v1/models`（模型目录）、`POST /api/v1/uploads`（素材）、`POST /api/v1/jobs`（下单）、`GET /api/v1/jobs/:id`（查状态）、`GET /api/v1/jobs?limit=N`（历史）。
- 计价单位：紫域 `cost` = **点数**，非人民币。实测图片 5~20 点，视频 50~2000 点。

### 1.2 模型从哪来

- **动态下发**，不是静态清单。`GET /api/v1/models` 当前返回 **54 个模型**。
- 模型 ID 形如 `zy_model_xxxxxxxxxxxx`；名称是中文线路描述（"满血2.5 720p 不卡人脸 官转"等）。
- 模型**会下线、会变价**。证据：历史任务中出现 `model not found`、`model unavailable for external api`（各 1 条）。
- 每个模型声明：`modes`（i2v/t2v/t2i）、`allowedDurations`、`allowedRatios`、`allowedAssetTypes`、`assetLimits`、`resolution`、`cost`。
- 有 `activeModelId` 字段（当前 `zy_model_a9725c3ba64bc52e741a`），可作为兜底。

### 1.3 其它渠道真实现状

| 渠道 | 结论 | 依据 |
|---|---|---|
| Seedance 2 | ❌ 未配置 | `NIANNIAN_SEEDANCE_API_BASE_URL`/`_KEY` 均为空 |
| MIMO | ❌ 残缺 | 只有 `MIMO_BASE_URL`，用户名/密码/Token 为空 |
| MIORA | ❌ 停用 | `MIORA_COOKIE` 为空，`MIORA_PROVIDER_SUBMIT_ENABLED=false` |
| 视频派发服务 | ❌ 未配置 | `VIDEO_SERVER_DISPATCH_URL`/`_TOKEN` 为空 |
| RunningHub | ⚠️ 已配置未验证 | 有 base/key，但前端无入口 |
| GPT 中转 | ⚠️ 部分可用 | 有 base/key/GPT-5.6 模型；GPT-5.5 模型变量缺失 |

---

## 二、决策层（建议，待确认）

### D1. MVP 只保留紫域一个渠道 ✅ 建议

- UI 的"渠道"下拉只显示紫域；Seedance / MIMO / MIORA 相关入口**隐藏**（不是灰掉，是直接不出现）。
- 理由：其它渠道不可用，展示出来只会造成"点了没反应"的假象。
- 实现：`lib/provider-contract.ts` 中 `providerDescriptors` 增加 `enabled` 开关，由环境变量驱动；未启用的渠道不进入前端。

### D2. 禁止硬编码 modelId ✅ 建议

- 每次进入工作台时拉取 `GET /api/v1/models`，缓存 5 分钟。
- 下单前校验 `modelId` 仍在目录中；不在则回退到 `activeModelId` 并提示用户。
- 前端只展示 **3~5 个推荐档位**，用**能力标签**而非模型名映射：

| 档位 | 选取规则 | 典型成本 |
|---|---|---|
| 省钱 | `type=video` 中 cost 最低且 `modes` 含 i2v | ~50 点 |
| 均衡 | cost 在 100~200 区间、720p、i2v/t2v | ~150 点 |
| 高质量 | resolution=720p 且 cost 300~500，名称含"不卡人脸" | ~300~500 点 |
| 长时长 | `allowedDurations` 含 ≥15s | ~400~2000 点 |
| 图片 | `type=image` | 5~20 点 |

> 映射规则写进代码常量，规则失效（无匹配）时降级为"按 cost 排序取前 3"，绝不写死某个 `zy_model_xxx`。

### D3. 积分汇率与退款 ✅ 建议

- **汇率**：1 紫域点 = 1 积分（对外展示时再乘对外倍率，默认 1.0，可配置 `CREDIT_EXCHANGE_RATE`）。
- **预扣费**：下单前冻结，任务终态后结算。
- **退款规则**（需与紫域确认后定稿）：
  - `任务提交失败，未扣费`（紫域明确未扣）→ 全额解冻，不扣积分。
  - `系统异常` → 全额退还。
  - `内容审核未通过` → **待确认**（紫域侧 cost 仍显示 300，是否真的扣费未知）。确认前按"不退款"处理并在 UI 明示。
- 每次扣费写入 `credit_ledger`，记录 `provider_job_id`、`provider_cost`、前后余额，用于对账。

### D4. 提交前自检（降低 30% 失败率）✅ 建议

针对实测失败原因逐条设防：

| 失败原因 | 防线 |
|---|---|
| 内容审核未通过（2/20） | 提示词敏感词前置检查 + 素材上传后做首帧审核 + 失败后明确提示"请修改提示词/素材"并保留原参数一键重试 |
| 系统异常（1/20） | 自动重试 1 次（指数退避 3s），仍失败才报错 |
| model not found / unavailable（2/20） | 动态模型目录 + 失效回退 `activeModelId` |
| prompt is required（1/20） | 前端必填校验 + 服务端二次校验 |

### D5. 产物存储 ✅ 建议

- 所有生成结果落**腾讯云 COS**（`TENCENT_COS_*` 已配置），返回可签名 URL。
- 本地 `data/video-assets` 仅做临时中转，任务完成后 24h 内清理。
- 素材上传统一走 `POST /api/v1/uploads`（紫域）拿 URL，不在本地长期留存原始大文件。

### D6. 注册与账号 ✅ 建议

- 当前仅 4 个用户。MVP 阶段采用**邀请制/白名单**，不开放自助注册。
- 登录方式保持邮箱 OTP（SMTP 已配置），OTP 有效期与频次限制需有明确数值（见 `acceptance.md`）。

---

## 三、实现约束（确认后即为硬规则）

1. 任何"模型名/模型ID"只允许出现在**运行时从紫域获取的数据结构**里，代码与文档中引用具体 `zy_model_xxx` 将被 review 打回（测试用例除外，且必须注明"快照，勿依赖"）。
2. 新增渠道必须同时提供：凭据环境变量、`enabled` 开关、连通性自检接口、失败语义映射表；四者缺一不得上线。
3. 渠道凭据只允许服务端读取，禁止进入任何客户端 bundle 或日志。
4. 计费与退款规则必须有对应单测，不允许"口头约定"。
