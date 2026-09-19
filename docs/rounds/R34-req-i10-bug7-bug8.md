# R34 — REQ-I10 / BUG-7 / BUG-8

- **日期**：2026-09-19
- **需求**：`REQ-I10`、`BUG-7`、`BUG-8`（同一 PR，三项都小）
- **范围**：工具面日落、跨传输 `FsVersion`、宿主 tar 解压

## 目标

把三条 P2 小项一次收口：模型不再有 `sw_pick_workspace`；SFTP 与核心的 CAS `version` 同一套算法；`core.deploy` 在只有 MSYS `tar` 的 Windows 宿主上也能读 MANIFEST / 抽 `rg`。

## 拆解

1. **REQ-I10**：删工具与 6 个词典键；`sw_status` / `sw_connect` 改为「工作区来自会话 cwd / 目录流」。[ADR-0027](../decisions/ADR-0027-sunset-sw-pick-workspace.md) 取代 ADR-0001 的工具清单。
2. **BUG-7**：`src/fs-version.ts` + Go `versionOf` 都 hash `[posixPath, size, mtimeMs 量化到秒]`。SFTP attrs 只有秒，不量化会和核心的 UnixMilli 永远对不上。
3. **BUG-8**：两条宿主 `spawnSync('tar')`（`readTarballManifest`、vendor `extractMember`）改 `src/gzip-tar.ts`。失败抛带档案名的原因。远端安装脚本仍是 Linux GNU `tar -xzf`。

## 验证

`npm run check:static`、`npm run typecheck`、`npm run test:agent`（含 `fs-version` / `gzip-tar` / vendor 夹具不再 spawn tar）。Go `TestVersionOfMatchesJSTuple` 走 CI `go test`。

## 结果

三项进 backlog §4。旧会话再调 `sw_pick_workspace` 会未知工具——有意为之。

## 遗留

无。远端四组合 UAT、`REQ-I15` 读面降级仍在 §2。
