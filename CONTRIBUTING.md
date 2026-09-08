# 贡献与开发流程

> 面向人类协作者。给 AI 代理的规则在 `AGENTS.md`，测试细节在 `docs/testing.md`。
> 目标是**个人级**流程：不冗长，但每步都留痕、可自动校验。

## 1. 真相源

| 想知道 | 看这里 |
|---|---|
| 现在能做什么 / 有哪些待办 | `docs/backlog.md`（**唯一待办真相源**） |
| 当前版本、提交、待办分布 | `docs/status.md`（由 `npm run status` 生成） |
| 架构、模块、机制 | `docs/architecture.md` |
| 为什么这么做 | `docs/decisions/ADR-*.md` |
| 每轮做了什么、怎么验的 | `docs/rounds/` |
| 测试怎么跑、沙箱限制 | `docs/testing.md` |
| 上游兼容与支持窗口 | `docs/compatibility.md` |
| 用户验收怎么走 | `docs/uat/` |
| 公开进度 | `docs/ROADMAP.md`（结果性摘要，不另立待办） |

`drafts/` 是本地草稿（不入库、可能含机器专属数据），**只作素材**：结论一旦拍板就搬进上面这些文件。

## 2. 一轮的完整流程

1. **入账**：在 `docs/backlog.md` 加一行（ID + `todo`），写清目标与验收标准。
2. **开工**：状态改 `doing`；从 `main` 拉短分支 `feat/<id>-slug` 或 `fix/<id>-slug`。
3. **实现**：小步提交，Conventional Commits；提交信息尾行写 `Refs: <ID>`。
4. **验证**：`npm run check`；UI 改动加 `npm run e2e`；组合改动跑 `--dump-config` 断言。
5. **评审**：开 PR（哪怕只有自己），PR 模板里的勾选项就是验收清单。
6. **验收**：涉及用户可见行为时，随 PR 附 `docs/uat/` 脚本，由用户走查并回填反馈。
7. **合并**：squash 合并到 `main`，状态改 `done`/`shipped`，`npm run status` 刷新看板。
8. **留痕**：在 `docs/rounds/` 写一份报告（目标/拆解/验证/结果/遗留）。

> 小修（一行文档、一个错别字）可以跳过 1 和 8，但 4 不能跳。

## 3. 发布清单

发布由仓库所有者执行（npm 2FA）。发版前逐条确认：

- [ ] `npm run check` 全绿（本地与 CI 都跑过）
- [ ] `docs/compatibility.md` 支持窗口已更新
- [ ] `CHANGELOG.md` 有该版本小节（静态闸门会校验）
- [ ] `npm run status` 已刷新，`docs/status.md` 与 package.json 版本一致
- [ ] `docs/rounds/` 有本轮报告，`docs/backlog.md` 状态已更新
- [ ] 工作树干净、`main` 与 `origin/main` 同步
- [ ] 打 tag 放在**发布成功之后**：`git tag vX.Y.Z && git push origin vX.Y.Z`
- [ ] 发布后在 `docs/compatibility.md` 记录实际发布版本

`npm run release` 会跑 `commit-and-tag-version --no-git-tag-version`：它更新版本号、锁文件与 CHANGELOG，
**不打 tag**——tag 是发布的产物，不是准备动作的产物（历史上出现过 tag 指向中间提交、与 HEAD 不一致）。

## 4. 约定

- 提交信息：Conventional Commits（静态闸门校验 HEAD）。
- 文档中文，代码标识符与命令英文。
- 逻辑放 `.ts`，`.tsx` 只做视图（否则沙箱内单测覆盖不到）。
- 不提交：凭据、真实主机/用户名、`machines.json`、`known_hosts.json`、`drafts/`。
- 不要手工编辑产品 profile（`$DSH_HOME/profiles/web`）；装/卸一律 `dsh plugin add|remove`。
- 开发一律在隔离 lab（`DSH_HOME=.dsh-lab`，端口 50599），**绝不碰 3080**。
