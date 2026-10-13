# R54 — PUB-9：准备发布 0.2.4

> 插件与远程组件同升 `0.2.4`。tag `v0.2.4` 与 GitHub Release 在本 PR 合并后立刻打
> （本轮授权：合并 + 打 tag + `gh release create`）。npm publish 仍等 `npm-publish`
> environment 的所有者 Approve，本轮不点 Approve。

## 1. 目标

把 `v0.2.3` 之后已在 master 的改动收成 `0.2.4`：插件版本与 core 工件一起从 `0.2.3`
升到 `0.2.4`，重建 linux-x64 tarball，并把新二进制 sha256 追加进 `compatHashes`
（已有 0.2.2 / 0.2.3 哈希保留）。

## 2. 拆解

1. 版本：`package.json` / lock、`CHANGELOG` 0.2.4 段、`core/artifact.json`、
   Go `coreArtifactVersion`、`npm run sync:core-manifest` 投影的 `src/core-artifact.ts`。
2. **核心工件 `0.2.3` → `0.2.4`**：`node scripts/build-core.mjs` 按 artifact 版本出包，
   `ensure-core` 自登记哈希。围栏档（`REQ-I29`）在新二进制里；版本门仍按 major.minor，
   已部署的 0.2.x **不强制**重部署，要用档位再部署一次。
3. 支持窗口：`docs/compatibility.md` §1 当前发布改为 0.2.4，补上漏记的 0.2.3 行。
4. 合并后：`git tag v0.2.4 && git push origin v0.2.4`，再 `gh release create`。

## 3. 验证

发版 PR 上 CI（标题闸门 + ubuntu 22/24 + windows 22）。本地：core 重建后
`check:static` + `typecheck` + `test:agent`。WSL 复验在本环境不可用（无 WSL；
本机已是 Linux，单测与 Go 测试由 CI ubuntu 兜底）。browser-use 本轮未用（无新 UI）。

## 4. 结果

版本与工件备好。tag、GitHub Release URL、合并提交在 PR 描述里补齐（合并之后才存在）。

## 5. 遗留

- npm `latest` 仍是 0.2.3，直到所有者在 Actions 里 Approve `npm-publish`。
- 围栏档实机尾巴仍是 [R53](../uat/R53-req-i29-fence-tier.md)（真 Docker 降档、老 core unknown）。
- 0.2.x 同线不强制重部署；要 fenceinfo / Landlock 的机器需要再部署一次。

来源：`CHANGELOG.md` `[0.2.4]`；`docs/backlog.md` `PUB-9`。
