# 发布到 GitHub

仓库已在本地初始化并完成首个提交（`4bb9f81`，1874 个文件，工作区干净）。

> 推送前自检已通过：`bash scripts/secret-scan.sh` → `OK 未发现密钥`；仓库中不含任何真实 `.env` 文件（仅 `.env.example` / `.env.docker.example` 占位模板）。

## 1. 在 GitHub 建空仓库

不要勾选 "Add a README / .gitignore / license"，保持空仓库。

## 2. 关联并推送

```bash
cd E:/codex/niannianai/zhuanhuiyuangong/sd2

git remote add origin git@github.com:<你的账号>/<仓库名>.git
git branch -M main
git push -u origin main
```

若用 HTTPS：

```bash
git remote add origin https://github.com/<你的账号>/<仓库名>.git
git branch -M main
git push -u origin main
```

> 当前 `gh` 未登录（本机执行 `gh auth status` 提示未登录），所以未自动创建远端仓库。可先 `gh auth login` 后用 `gh repo create --private --source=. --push`。

## 3. 立刻开启分支保护（对应 ADR-0004）

在 GitHub → Settings → Branches → Add rule（branch name pattern `main`）：

- [x] Require a pull request before merging（至少 1 个 approval）
- [x] Require status checks to pass：勾选 `verify`
- [x] Do not allow bypassing the above settings
- [ ] 不要勾选 "Allow force pushes"

L3 变更（鉴权/数据/部署/架构）按 `CONSTRAINTS.md` 需**双人 review**：在规则里把 Required approvals 设为 2，或至少对 `deploy/`、`lib/server`、`lib/auth.ts` 路径用 CODEOWNERS 强制。

## 4. 推送后立刻验证

```bash
# CI 是否真的跑起来
git commit --allow-empty -m "ci: verify workflow" && git push
# 然后在 GitHub Actions 页面确认 verify job 有运行记录
```

预期首次 CI 结果（诚实预警）：

| 步骤 | 预期 |
|---|---|
| Env keys check | 跳过（无 env 文件） |
| Typecheck | 可能失败——源码来自 8 月快照，未经 CI 验证 |
| Lint | 等同 typecheck（ESLint 尚未引入，技术债 T2-3） |
| Tests | 3 个契约测试，需实测确认 |
| Secret scan | 通过 |
| Build | 可能失败——依赖完整 `npm ci`，需实测确认 |
| Smoke | 依赖 build 成功 |

**首次 CI 红灯是预期内的**，红灯本身就是这次审计的价值：它让"从来没跑过的 CI"开始说真话。按 `docs/implementation-plan.md` 逐个修。

## 5. 仓库体积

约 76MB（主要是 `public/` 下的示例图片与 demo 视频）。若嫌大，可后续把 `public/media/generated/` 迁到对象存储并从仓库移除——本快照已排除该目录。
