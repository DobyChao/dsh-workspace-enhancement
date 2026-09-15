# R26 — REQ-I5 远端一个核心（Go + 成帧 RPC）

## 目标

落地 ADR-0023 / ADR-0024：围栏档远程 fs、spawn、browse 改走单一 Go 核心；
`off` 保持 SFTP + 裸 exec。不 bump 0.1.4、不打 tag。

## 拆解

1. 协议：TS codec + 假核心单测
2. Go `dsh-core serve`：hello / fs / spawn / 自 jail / `profile.json` embed
3. 部署：`core.deploy` / `core.status` + 设置页按钮
4. 切流：`CoreRoutingFileSystem`、`CoreSubprocessHandle`、browse RPC；栏杀改为 `hub.require`
5. 文档 + UAT 反转 I9-9 + CI `setup-go`

## 验证

- `npm run check:static && npm run typecheck && npm run test:agent`（代理沙箱）
- 有 shell 时 `npm run check`；Linux 上 `go test` / `go build`
- 真机 UAT：改走 `docs/uat/R27-req-i13-remote-session-sandbox.md`（与 REQ-I13 合验；原 R26 脚本已作废）

## 结果

短分支 `feat/REQ-I5-remote-core`。产物 tarball 不入库（`core/dist/`）。
预定随 0.2.0 发布。

## 遗留

- 捆绑 `bwrap`/`rg` 需操作者放入 `core/vendor/` 后再 `npm run build:core`
- aarch64 / Windows 远端不在 v1
- `REQ-I12` ①②③；`PUB-4` 已 shipped

来源：`docs/decisions/ADR-0024-remote-core-protocol.md`；`docs/backlog.md` REQ-I5
