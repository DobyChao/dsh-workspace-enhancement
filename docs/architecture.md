# dsh-workspace-enhancement 架构

> **本文只陈述当前系统。** 为什么见 [`decisions/`](./decisions/)；某一轮怎么走到这见 [`rounds/`](./rounds/)（档案）；待办见 [`backlog.md`](./backlog.md)；规则见根目录 `AGENTS.md`。
> 公开文档中的主机/用户/指纹/路径一律为占位符：`user@host`、`%DSH_HOME%`、`$HOME`、`<repo>`、`<fingerprint>`。lab 回环地址（端口 50599）非敏感，按原样书写。

## 1. 定位与原则

把 DSH 生态里散落的「工作区」能力（远程 SSH、目录选择、机器/连接管理）收进**一个**插件包。
`ctx.subprocess` / `ctx.fs` 的远程 provider 让框架里所有消费这两条接缝的工具零改动地跑在远端。

**本地大脑、远程手脚、一层配置：**

1. 一个包承载本地 + 远程（SSH）、选择/浏览、连接与机器管理（镜像/同步与审计日志明确不做，见 ADR-0003 / ADR-0004）。
2. 引擎走 DSH 能力接缝（`subprocess` / `fs` / `directoryPicker` / `tools` / `systemPrompt` / 浏览器通道 / `locale`），不另造平行工具。
3. 面向模型与 UI 的接口保持窄：一组 `sw_*` 工具、一套注册表、按会话注入的提示。

工程约束：Node ≥ 22.8、ESM only、TS + `tsc` + `tsdown`。宿主已提供的 `@deepseek-ai/dsh-*` 一律 `peerDependencies`（当前范围 `^0.1.5-rc.1`），`dependencies` 只留 `ssh2`（ADR-0009）：Cordis 服务身份是模块级 Symbol，自装副本会遮蔽宿主单例。

## 2. 运行形态

| 面 | 源 | 构建 | 产物 |
|---|---|---|---|
| 宿主（Node） | `src/*.ts`（除 `src/client/`） | `tsc` | `lib/**`，入口 `lib/index.js` |
| 客户端（浏览器） | `src/client/**` | `tsc` → `tsdown` | 单文件 `lib/client.js` |
| 共享词典 | `src/locale/` | 两侧各取一次 | 宿主编到 `lib/locale/`（不进 `exports`）；客户端被 tsdown 内联 |

`package.json` `exports`：`.` + `./ssh` / `./subprocess` / `./fs` / `./picker` / `./web` / `./client`。tsdown 把平台模块（react、cordis、官方 UI 包）留在加载器模块表，其余内联；非平台 `@deepseek-ai/*` **值**导入是构建错误。

### 2.1 `cordis.patch.yml`

| 行 | 动作 |
|---|---|
| `directory-picker` / `subprocess` / `fs-sandbox` | `disabled: true`，把默认 picker 与本地 provider 让给本插件 |
| `ssh-remote`（包根） | 挂 `ctx.ssh`，并把 `ctx.subprocess` / `ctx.fs` 换成混合门面 |
| `directory-picker-ssh`（`/picker`） | 本机/远程 browse 后端 |
| `ssh-web-channel`（`/web`） | 注册表 + `/api/dsw/*` 通道 |

混合接线**只在聚合行**发生。子路径 `/ssh` `/subprocess` `/fs` 保留纯 SSH 形态。profile 自身的 patch 与 `--patch` 在本层之后生效。sandbox 策略行保持启用，它们消费的是混合 `ctx.subprocess`。

### 2.2 客户端槽位

`src/client/index.ts` 的 `inject = ['slots', 'workspaces', 'sessions', 'locale']`：

| 槽位 | 组件 | 作用 |
|---|---|---|
| `conversation.hero.workspace.directoryFlow` + `sidebar.workspaces.directoryFlow` | `SshWorkspaceFlow` | 添加工作区目录流 |
| `settings.section` | `RemoteWorkspaceSettingsPage` | 设置页机器管理 |
| `conversation.session.header.actions` | `SideWorkspacesAction` | 标题栏「工作区」按钮与副工作区面板 |
| `conversation.session.header.utilities`（`REMOTE_STATUS_SLOT`） | `RemoteStatusAction` | 会话头远程状态 |

会话栏**行级**徽标没有官方槽位，由 `installRowBadges` 用 DOM 增辉层注入（ADR-0011）。本机目录列举走可选服务 `uiWorkspace`，不走 `workspaces`（BUG-3）。

## 3. 模块地图

`src/` 现 **53** 个文件：宿主 30、客户端 19、词典 4。下表按职责分组，不堆导出清单。

### 3.1 宿主

| 组 | 文件 | 职责 |
|---|---|---|
| 入口 | `index.ts` `plugin.ts` `css-modules.d.ts` | 公共 API、聚合行、混合 provider 安装 |
| SSH 世界 | `runtime.ts` `ssh-core.ts` `connection.ts` `transport.ts` `subprocess.ts` `process.ts` `terminal.ts` `output.ts` `environment.ts` `filesystem.ts` `listing.ts` `picker.ts` | 跳板链、exec/SFTP/PTY、环境、目录遍历、`ssh://<id>/<path>` 路由 |
| 注册表与密钥 | `registry.ts` `hostkey.ts` `credential.ts` | machines.json、TOFU、OS 钥匙串、`~/.ssh/config` |
| 混合门面 | `mixed.ts` | `ctx.subprocess` / `ctx.fs` 的唯一实现：按 cwd / targetKey 路由 |
| 会话状态 | `session-workspaces.ts` `session-connections.ts` `session-remote-context.ts` | 副根清单、本会话已连接机器、提示注入判定 |
| 远程策略 | `remote-approval-gate.ts` `remote-sandbox.ts` `remote-sandbox-fence.ts` | 审批门纯逻辑；远端 bwrap 围栏与 fail-closed 探针 |
| 通道与工具 | `web.ts` `web-channel.ts` `tools.ts` `exec-tools.ts` `model-prompts.ts` | `/api/dsw/*`、`sw_*`、win32 `bash`、model-facing 英文常量 |

### 3.2 客户端

| 组 | 文件 | 职责 |
|---|---|---|
| 入口 | `index.ts` | 词典、槽位、行徽标层 |
| 添加工作区 | `flow.tsx` `form.tsx` `flow.module.css` `local-directory.ts` | 连接侧栏 + 目录浏览；本机目录走 `uiWorkspace` |
| 机器表单 | `machine-form.tsx` `machine-payload.ts` `settings.tsx` | 共享表单、payload 纯函数、设置页 |
| 副工作区 | `side-workspaces.tsx` `side-workspaces.module.css` | 标题栏按钮与面板 |
| 状态与徽标 | `status.tsx` `row-badges.ts` `sandbox-badge.ts` `remote-status.ts` `remote-status-entry.tsx` `route-id.ts` | 三态连接、行增辉、围栏档位、会话头远程状态 |
| 驾驶舱 / UI | `cockpit.ts` `ui.ts` `icons.tsx` | 会话连接驾驶舱纯逻辑、无障碍、图标 |

### 3.3 词典（`src/locale/`）

`dsw.ts`（zh，键集真源）+ `dsw.en.ts`（`Record<DswKey, string>`，缺/多键即编译错）+ `index.ts` + `host.ts`。命名空间必须是 `dsw`（ADR-0010）。

## 4. 机制索引

每条只给现状要点。细节与取舍在对应 ADR / 源文件，不在这里展开。

| 机制 | 现状 | 源 / 决策 |
|---|---|---|
| 混合门面与路由 | Cordis 同名服务只能注册一次，故聚合行是 `subprocess`/`fs` 的唯一实现。`worldOfCwd` / `worldOfTargetKey` 判定 local vs remote；`resolve`/`lstat` 先看副根。`resolveExecutable` 恒走本地。 | `mixed.ts` |
| 注册表与 `ssh://` | `ctx.sshRegistry` 是机器宇宙的唯一真相。持久化 `<dsh home>/remote-workspaces/machines.json`。路由 `ssh://<id>/<path>`，以及本地占位树 `dsw-routes/`（旧 `dsh-ssh-routes/` 仍为活会话服务）。 | `registry.ts` `transport.ts` |
| 会话连接门 | `sw_connect` 只接受**已注册**机器 id（`machines: string[]`），决定本会话看见哪些远程工具与提示。凭据永不进模型参数面。这是可见性门，不是强制门。 | `session-connections.ts` [ADR-0021](./decisions/ADR-0021-session-machine-connections.md) |
| 副工作区 | 薄声明清单：挂/卸 + label + 远程根路由。无 fs/exec 档位。 | `session-workspaces.ts` [ADR-0019](./decisions/ADR-0019-side-workspace-permission-retirement.md) |
| 审批门 | 混合 subprocess 远程分支上的可选门（`remoteApproval: off\|human\|ai`，默认 `off`）。拦 shell 形状的 spawn 与远程终端；SFTP 写路径不设门。 | `remote-approval-gate.ts` [ADR-0020](./decisions/ADR-0020-remote-approval-gate.md) |
| 远端围栏 | 远端 bwrap 兼容 runner，`remoteSandbox: off\|read-only\|workspace-write`，fail-closed。缺 runner 或探针失败即拒绝执行。**SFTP 写面此刻不在围栏内**（ADR-0022 §2.7）；收口是核心（ADR-0023）。 | `remote-sandbox.ts` `remote-sandbox-fence.ts` [ADR-0022](./decisions/ADR-0022-remote-sandbox-runner.md) |
| 浏览器通道 | 官方共享 `/api` 上的精确 Fetch 路由 `/api/dsw/<endpoint>`（`connection.fetch.register`）。端点清单以 `web.ts` 的 `CHANNEL_ENDPOINTS` 为准，含 `session.ws.*` 与 `session.conn.*`。 | `web.ts` `web-channel.ts` [ADR-0018](./decisions/ADR-0018-browser-channel-on-shared-api.md) |
| `sw_*` 工具 | `sw_status` / `sw_connect` / `sw_pick_workspace`（日落见 backlog `REQ-I10`）/ `sw_exec`；win32 宿主另注册 `bash`。提示按会话事实按需注入，纯本地零噪音。 | `tools.ts` `exec-tools.ts` `model-prompts.ts` [ADR-0014](./decisions/ADR-0014-model-facing-prompts-are-english.md) |
| i18n | 人类面走 `dsw` 词典（设置页 Language）；model-facing 文案是英文常量，不进 i18n。 | `src/locale/` [ADR-0010](./decisions/ADR-0010-runtime-i18n-dsw-namespace.md) [ADR-0014](./decisions/ADR-0014-model-facing-prompts-are-english.md) |
| 方向（未落地） | 远端部署**一个核心**：围栏执行 + 远端读写（`ctx.fs` 不再走 SFTP）+ 打包 `rg`。落地前不得宣称「已围栏」。 | [ADR-0023](./decisions/ADR-0023-one-remote-core.md) |

## 5. 已知边界

完整安全模型与诚实边界在 [`SECURITY.md`](../SECURITY.md)。这里只列接手时必须知道的：

1. **远程执行不受本地沙箱限制**——远程会话钉 `danger-full-access` 是 same-world 契约；可选审批门不覆盖 SFTP 写路径（ADR-0020）。
2. **会话连接门拦不住会拼路径的模型**——`ssh://<id>/…` 走注册表级路由，不查会话（ADR-0021）。
3. **副根无权限语义**（ADR-0019）。真正隔离是本地 `sandbox/mode`、审批门、远端围栏、操作者信任边界。
4. **远端前置（核心落地前）**：`pwsh`、`ripgrep`、围栏用的 `bwrap` 仍是分项安装；远程 `ctx.fs` 仍走 SFTP。核心落地后前置只剩「部署一个核心」（ADR-0023）。
5. **SSH 协议**：远端 `pid` 恒为 -1，无 `inspectForeground` / `signalForeground`。
6. **`resolveExecutable` 恒走本地**（接缝无 cwd；未来若远程会话解析出本地绝对路径，会被 `remoteArgvOf` 削成裸名）。正式 ADR 化仍是 `AUDIT-2`。
7. **远程会话 composer 常显示 `Custom`**：preset 表缺 `{danger-full-access, ask}` 这一组（ADR-0015，UX-1 blocked）。
8. **官方工作区注册表看不见远程工作区**（占位目录方案，镜像已砍）。

## 6. 契约侦察

子代理禁止调用 `cordis_inspect_list` / `cordis_inspect_query`（页面不响应会永久挂起）。槽位/服务/事件契约走磁盘权威源，读取器是 `npm run slots -- --list|--key|--diff`。路径与失效条件见 `AGENTS.md` §5 红线 7；槽位 diff 的方法学见 [ADR-0017](./decisions/ADR-0017-rc2-client-slot-recon.md) §1.1。**行号不是契约**，只认 `key` / 字段名 / 符号名。
