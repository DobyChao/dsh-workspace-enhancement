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

## 2. 一轮的完整流程（短分支 + PR）

**分支模型**：`master` 只收经过 CI 的提交。改动一律走短分支 + PR + **squash merge**
（全历史保持线性，当前 0 个 merge 提交）。

1. **入账**：在 `docs/backlog.md` 加一行（ID + `todo`），写清目标与验收标准。
2. **开工**：状态改 `doing`；从 `master` 拉短分支 `feat/<ID>-slug` / `fix/<ID>-slug` / `chore/<ID>-slug`。
3. **实现**：小步提交，Conventional Commits；提交信息尾行写 `Refs: <ID>`。
4. **验证**：`npm run check`；UI 改动加 `npm run e2e`；组合改动跑 `--dump-config` 断言。
5. **交付**：代理 push 分支、开 PR 并盯 CI 到绿（2026-09-09 用户授权）。

   ```powershell
   git push -u origin <branch>
   # PR 标题必须是 Conventional Commit：squash 合并会把它当成 master 上的提交标题，
   # 而静态闸门校验的正是这个标题。浏览器新建 PR 默认填分支名，必须改。
   gh pr create --title "fix(<scope>): <what>" --body-file .github/PULL_REQUEST_TEMPLATE.md
   gh pr checks --watch           # CI：PR 标题 + ubuntu 22/24 + windows 22
   gh pr merge --squash --delete-branch
   ```

   > `--fill` 在多提交时会把分支名当标题，容易与最终 squash 语义不符——显式写 `--title` 最稳。
   > PR 标题不合法时 `PR title (squash subject)` 作业会直接拦下（2026-09-10 加，起因是一次
   > PR 绿、合并后 master 红：squash 标题是分支名）。

6. **验收**：涉及用户可见行为时，随 PR 附 `docs/uat/` 脚本，由用户走查并回填反馈。
7. **收口**：状态改 `done`/`shipped`，`npm run status` 刷新看板，`docs/rounds/` 写一份报告。

> 例外：错别字、一行文案、纯注释这类不可能改变行为的改动可直接提交到 `master`；
> 但第 4 步不能跳。**分支上永远不要直接 push 到 `master`。**

## 3. 发布清单

发布由仓库所有者执行（npm 2FA）。发版前逐条确认：

- [ ] `npm run check` 全绿（本地与 CI 都跑过；PR 上 CI 绿才算）
- [ ] 待发布的改动已通过 PR **squash 合并**到 `master`
- [ ] `docs/compatibility.md` 支持窗口已更新
- [ ] `CHANGELOG.md` 有该版本小节（静态闸门会校验）
- [ ] `npm run status` 已刷新，`docs/status.md` 与 package.json 版本一致
- [ ] `docs/rounds/` 有本轮报告，`docs/backlog.md` 状态已更新
- [ ] 工作树干净、`master` 与 `origin/master` 同步
- [ ] 打 tag 放在**发布成功之后**：`git tag vX.Y.Z && git push origin vX.Y.Z`
- [ ] 发布后在 `docs/compatibility.md` 记录实际发布版本

> **`v0.1.2` tag 待修正**：它当前指向 `d30dc57`（准备发布时的中间提交，从未发布，之后又落了提交）。
> 发布 0.1.2 时应在发布成功后重打：
> `git tag -f v0.1.2 <被发布的提交> && git push -f origin v0.1.2`（仅此一次；此后 tag 一律只打一次）。

`npm run release` 会跑 `commit-and-tag-version --no-git-tag-version`：它更新版本号、锁文件与 CHANGELOG，
**不打 tag**——tag 是发布的产物，不是准备动作的产物（历史上出现过 tag 指向中间提交、与 HEAD 不一致）。

## 4. 约定

- 提交信息：Conventional Commits（静态闸门校验 HEAD）。
- 文档中文，代码标识符与命令英文。
- 逻辑放 `.ts`，`.tsx` 只做视图（否则沙箱内单测覆盖不到）。
- 不提交：凭据、真实主机/用户名、`machines.json`、`known_hosts.json`、`drafts/`。
- 不要手工编辑产品 profile（`$DSH_HOME/profiles/web`）；装/卸一律 `dsh plugin add|remove`。
- 开发一律在隔离 lab（`DSH_HOME=.dsh-lab`，端口 50599），**绝不碰 3080**。
