# 架构决策记录（ADR）

一决策一文件。**本文是索引，不是现状**：当前系统怎么跑见 [`../architecture.md`](../architecture.md)。

| ADR | 一句话 | 状态 |
|---|---|---|
| [0001](./ADR-0001-package-name-and-tool-prefix.md) | 包名 `dsh-workspace-enhancement`，工具前缀 `sw_` | **superseded by 0027** |
| [0002](./ADR-0002-fork-dsh-ssh-and-merge-dsh-remote.md) | 以 dsh-ssh 为 base 二次开发、合并 dsh-remote | accepted |
| [0003](./ADR-0003-drop-mirror-and-sync.md) | 镜像/同步明确不做 | accepted |
| [0004](./ADR-0004-drop-audit-log.md) | 审计日志砍掉（会话轨迹替代） | accepted |
| [0005](./ADR-0005-defer-port-forwarding.md) | 端口转发延后 | accepted |
| [0006](./ADR-0006-integrate-external-sidebar-only.md) | 侧边栏只对接独立安装的 dsh-better-sidebar | accepted |
| [0007](./ADR-0007-session-side-workspaces-without-focus-switch.md) | 会话关联副工作区：不做焦点切换、主 cwd 不变 | accepted（范围被 0019 收窄） |
| [0008](./ADR-0008-side-workspace-permission-first-cut.md) | 副工作区权限第一刀（fs × exec） | **superseded by 0019** |
| [0009](./ADR-0009-host-shared-packages-as-peer-dependencies.md) | 宿主共享包进 peerDependencies，`dependencies` 只留 ssh2 | accepted |
| [0010](./ADR-0010-runtime-i18n-dsw-namespace.md) | 运行时 i18n：命名空间 `dsw`、单一共享词典 | accepted |
| [0011](./ADR-0011-withdraw-upstream-pr.md) | 上游 PR 撤销；行级徽标改 DOM 增辉层 | accepted |
| [0012](./ADR-0012-fs-readonly-with-exec-on-bypass.md) | 副根 `fs:只读 + exec:开` 已知绕过 | **作废**（对象随 0019 退役） |
| [0013](./ADR-0013-local-root-keys-are-realpath-canonical.md) | 本地副根键按 realpath 规范化 | accepted |
| [0014](./ADR-0014-model-facing-prompts-are-english.md) | model-facing 文案统一英文；win32 bash 按会话 cwd 注入 | accepted |
| [0015](./ADR-0015-remote-composer-permission-preset.md) | 远程会话 composer 显示 Custom：部署表补 `remote-full` | **superseded**（勿补预设；见 ADR-0025 / UX-1） |
| [0016](./ADR-0016-conversation-panel-tab-slot.md) | 对话/轨迹区可扩展 Tab 的槽位契约（REQ-I1 前置） | proposed |
| [0017](./ADR-0017-rc2-client-slot-recon.md) | rc.2 客户端槽位侦察与 REQ-I1 路线 | proposed |
| [0018](./ADR-0018-browser-channel-on-shared-api.md) | 浏览器通道改走官方共享 `/api` 精确 Fetch 路由 | accepted |
| [0019](./ADR-0019-side-workspace-permission-retirement.md) | 副工作区权限档位退役，降为薄声明清单 | accepted |
| [0020](./ADR-0020-remote-approval-gate.md) | 远程 spawn 接缝审批门 + AI 自动放权 | accepted |
| [0021](./ADR-0021-session-machine-connections.md) | 会话级机器连接与远程工具门控（`sw_connect` 重塑） | accepted |
| [0022](./ADR-0022-remote-sandbox-runner.md) | 远端沙箱围栏（bwrap 兼容 runner over SSH） | accepted |
| [0023](./ADR-0023-one-remote-core.md) | 远端一个核心：围栏执行 + 远端读写共用可校验产物 | accepted |
| [0024](./ADR-0024-remote-core-protocol.md) | 核心线协议、自 jail、进程寿命与工作区键 | accepted |
| [0025](./ADR-0025-remote-session-sandbox.md) | 远端权限对齐会话 `/permission` 与官方提权 | accepted |
| [0027](./ADR-0027-sunset-sw-pick-workspace.md) | 日落 `sw_pick_workspace`；工具面只留 status/connect/exec | accepted |
