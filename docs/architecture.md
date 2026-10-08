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

`src/` 现 **67** 个文件：宿主 45、客户端 18、词典 4。下表按职责分组，不堆导出清单。

### 3.1 宿主

| 组 | 文件 | 职责 |
|---|---|---|
| 入口 | `index.ts` `plugin.ts` `css-modules.d.ts` | 公共 API、聚合行、混合 provider 安装 |
| SSH 世界 | `runtime.ts` `ssh-core.ts` `connection.ts` `transport.ts` `subprocess.ts` `process.ts` `terminal.ts` `output.ts` `environment.ts` `filesystem.ts` `fs-version.ts` `listing.ts` `picker.ts` | 跳板链、exec/SFTP/PTY、环境、目录遍历、`ssh://<id>/<path>` 路由、跨传输 `FsVersion` |
| 远程组件（代码中称 core） | `core-protocol.ts` `core-client.ts` `core-fake.ts` `core-session.ts` `core-hub.ts` `core-fs.ts` `core-process.ts` `core-deploy.ts` `gzip-tar.ts` | 成帧 RPC、jail 身份、会话缓存、围栏档 fs/spawn、设置页部署、宿主侧 gzip/ustar |
| 注册表与密钥 | `registry.ts` `hostkey.ts` `credential.ts` | machines.json、TOFU、OS 钥匙串、`~/.ssh/config` |
| 混合门面 | `mixed.ts` | `ctx.subprocess` / `ctx.fs` 的唯一实现：按 cwd / targetKey 路由 |
| 会话状态 | `session-workspaces.ts` `session-connections.ts` `session-remote-context.ts` | 副根清单、本会话已连接机器、提示注入判定 |
| 远程策略 | `remote-approval-gate.ts` `remote-sandbox.ts` `remote-sandbox-fence.ts` `remote-policy.ts` `remote-confine.ts` | 审批门；远程组件拒绝文案与 bwrap 档位常量；会话 `/permission`→远程组件 `--sandbox`；远程 cwd 上 confine 短路 |
| 通道与工具 | `web.ts` `web-channel.ts` `tools.ts` `exec-tools.ts` `model-prompts.ts` | `/api/dsw/*`、`sw_*`、win32 `bash`、model-facing 英文常量 |

### 3.2 客户端

| 组 | 文件 | 职责 |
|---|---|---|
| 入口 | `index.ts` | 词典、槽位、行徽标层 |
| 添加工作区 | `flow.tsx` `form.tsx` `flow.module.css` `local-directory.ts` | 连接侧栏 + 目录浏览；本机目录走 `uiWorkspace` |
| 机器表单 | `machine-form.tsx` `machine-payload.ts` `settings.tsx` `core-status.ts` | 共享表单、payload 纯函数、设置页、远程组件状态文案 |
| 副工作区 | `side-workspaces.tsx` `side-workspaces.module.css` | 标题栏按钮与面板 |
| 状态与徽标 | `status.tsx` `row-badges.ts` `remote-status.ts` `remote-status-entry.tsx` `route-id.ts` | 三态连接、行增辉、会话头远程状态 |
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
| 远端围栏 | 权限跟会话 `/permission` + 官方 `sandbox_permissions` 提权（ADR-0025）。有 Linux 远程组件则 fs/spawn/browse 走 RPC，`--sandbox` 来自本次 policy（`danger` → `off`）。无组件且围栏档 → 写/spawn `SANDBOX_UNAVAILABLE`，**读**降 SFTP（REQ-I15）；无组件且 danger → 今天的 SFTP + SSH。逐格见 §4.1。交互终端在围栏档拒绝。活 `serve` 按 `(machine, mode, workspaceRoot?)` 缓存。写面与 spawn 都吃一次提权：官方 bash/pwsh 经 shell 上的 `sandboxPolicy`，win32 bash / `sw_exec` 自带两参（`REQ-I18`）。宿主静默项目根探测见 [`notes/host-silent-fs.md`](./notes/host-silent-fs.md)（`BUG-4` 已修）。 | `core-*.ts` `core/` `remote-policy.ts` `remote-confine.ts` `remote-spawn-policy.ts` [ADR-0025](./decisions/ADR-0025-remote-session-sandbox.md) [ADR-0024](./decisions/ADR-0024-remote-core-protocol.md) |
| 浏览器通道 | 官方共享 `/api` 上的精确 Fetch 路由 `/api/dsw/<endpoint>`（`connection.fetch.register`）。端点清单以 `web.ts` 的 `CHANNEL_ENDPOINTS` 为准，含 `session.ws.*`、`session.conn.*`、`core.deploy` / `core.status`。 | `web.ts` `web-channel.ts` [ADR-0018](./decisions/ADR-0018-browser-channel-on-shared-api.md) |
| `sw_*` 工具 | `sw_status` / `sw_connect` / `sw_exec`；win32 宿主按会话 cwd 注入 `bash`（本地不出现，远程 Linux 工作区才注册）。工作区目录是会话 cwd，不是工具。提示按会话事实按需注入，纯本地零噪音。 | `tools.ts` `exec-tools.ts` `model-prompts.ts` [ADR-0027](./decisions/ADR-0027-sunset-sw-pick-workspace.md) [ADR-0014](./decisions/ADR-0014-model-facing-prompts-are-english.md) |
| i18n | 人类面走 `dsw` 词典（设置页 Language）；系统提示与工具 schema 是英文常量（ADR-0014 / `UX-6`）。执行错误与工具输出仍按宿主语言。 | `src/locale/` `src/tool-schema.ts` [ADR-0010](./decisions/ADR-0010-runtime-i18n-dsw-namespace.md) [ADR-0014](./decisions/ADR-0014-model-facing-prompts-are-english.md) |

### 4.1 权限真值表（AUDIT-7）

「本次档」= 会话 `/permission`，若这次调用带了已批准的 `sandbox_permissions` 则以它为准
（单次提权，下一次调用回到会话档）。远程组件 = 部署到远端的 Linux 二进制（代码与协议中称 core）。

**A. 远程世界：谁执行、拦什么**

| 本次档 | 远程组件 | 文件读 | 文件写 | 命令 | 交互终端 | 证据 |
|---|---|---|---|---|---|---|
| read-only | 可用 | 组件 RPC | 拒，`FS_SANDBOX_DENIED` + 提权提示 | 组件 jail `--sandbox read-only` | 拒 | `core-routing.test.ts`、UAT R27 |
| workspace-write | 可用 | 组件 RPC | 目标所在根内可写（见表 B），其余拒 + 提权提示 | 组件 jail `--sandbox workspace-write --workspace <根>` | 拒 | `core-routing.test.ts`、`mixed-routing.test.ts`、UAT R27 / R37 |
| danger-full-access | 可用 | 组件 RPC | 组件 RPC，`--sandbox off` | 组件 `--sandbox off` | 允许（裸 SSH PTY） | `core-routing.test.ts`（`--sandbox off`） |
| read-only / workspace-write | 不可用 | 降级 SFTP（REQ-I15） | `SANDBOX_UNAVAILABLE` | `SANDBOX_UNAVAILABLE` | 拒 | `core-routing.test.ts`（REQ-I15）、UAT R35 |
| danger-full-access | 不可用 | SFTP | SFTP | 裸 SSH | 允许 | `core-routing.test.ts`、`core-version-gate.test.ts` |

「不可用」含：未部署、非 linux x86_64、版本跨 major.minor 线、sha256 不在白名单（REQ-I17 / REQ-I21），
以及组合里没挂 `coreHub`（子路径行）或调用没有注册表连接 id（聚合传输）。宿主没有 `sandboxPolicy`
服务时本次档按 `read-only`（fail-safe）。远程执行只有这一条路径：机器字段 `remoteSandbox` 与宿主侧
bwrap 包装已删除（AUDIT-7），旧 machines.json 里的该键读入时忽略、下次保存时丢弃。
证据：`remote-sandbox-wiring.test.ts`、`registry-remote-sandbox-legacy.test.ts`。

**B. workspace-write 下的可写区域**（ADR-0028 §5；本机副根随 `REQ-I24` 改为与远程同规则）

| 区域 | 本机 | 远程 |
|---|---|---|
| 主根（会话 cwd） | 可写 | 可写（主根一条 serve） |
| 副根，嵌套在主根下 | 可写 | 可写（共用主根 serve） |
| 副根，与主根并列 | 写入目标或命令 cwd 落在该副根内即可写；在主根里跑的命令写不了它 | 同左（该副根一条 serve） |
| 其余路径 | 拒 + 提权；`/tmp` 与 `os.tmpdir()` 可写 | 拒 + 提权；shell 写 `/tmp` 落 jail 内 tmpfs（serve 重启即丢） |

粒度是「一次写 / 一条命令只写一个根」；一条命令同时写主根和并列副根要提权（ADR-0029 §4.3）。
包含主根的祖先副根与盘符根不放宽（Windows ACL 授权常驻且可继承，见 ADR-0028 §5）。

**C. 单次提权覆盖的入口**

| 入口 | 怎么带到执行处 |
|---|---|
| 官方 Write / Edit | 写接口自带 `sandboxPolicy` |
| 官方 bash / pwsh（0.1.7：`shell.run` / `start`；0.2.0：`shell.resolve` + `execute`） | `remote-spawn-policy.ts` 包住上述方法，本次策略经 `AsyncLocalStorage` 进入 spawn（BUG-12 补上 0.2.0 形状） |
| win32 `bash`、`sw_exec` | 工具自己审批后写入同一存储 |

**D. 拦不住的（诚实边界）**

- 会话连接门只管可见性：模型直接拼 `ssh://<id>/…` 走注册表级路由，不查会话（ADR-0021）。
- 档位只管文件效果：网络与进程可见性不在其内（与官方 `dsh-sandbox` 同义）。
- 可选审批门（`remoteApproval`，默认 `off`）不是围栏；界面已移除（`UX-7`），执行门保留。
- 挂副根即放宽写范围：挂载只能由人在面板上做，模型工具不能挂副根。

## 5. 已知边界

完整安全模型与诚实边界在 [`SECURITY.md`](../SECURITY.md)。这里只列接手时必须知道的：

1. **远端权限跟会话 `/permission`**——与本地同一套提权卡；无远程组件的围栏档写/spawn fail-closed，读面降 SFTP（ADR-0025 / REQ-I15）。可选审批门默认 `off`，与提权卡同时开会弹两张。Write、官方 bash/pwsh、win32 bash、`sw_exec` 都可以一次提权（`REQ-I18`，2026-09-22 用户 lab 简验）；没有 overlay 的下一次调用仍跟会话档。
2. **会话连接门拦不住会拼路径的模型**——`ssh://<id>/…` 走注册表级路由，不查会话（ADR-0021）。
3. **副根 = 工作区的延伸**（ADR-0019 / ADR-0028 §5 / `REQ-I24`）：没有逐根开关；workspace-write 下一次写（按目标）或一条命令（按 cwd）落在哪个根就以哪个根为准，本机与远程同规则。挂副根即放宽写范围，只能由人在面板上挂（表 §4.1 D）。
4. **远端前置**：围栏档要先从设置页部署远程组件（`core.deploy`，linux x86_64）。Windows / 非 amd64 在 workspace-write 下会拒绝，直到 `/permission danger-full-access` 或以后有 Windows 版组件。交互终端仍需远端 `bash`/`pwsh`，且围栏档拒绝 PTY。
5. **SSH 协议**：远端 `pid` 恒为 -1，无 `inspectForeground` / `signalForeground`。直连腿停止靠远端 steward（SSH stdin EOF → `kill -TERM 0`），不把 OS pid 交给宿主；有远程组件时 danger 仍走组件 RPC（`--sandbox off`）。
6. **`resolveExecutable` 恒走本地**（接缝无 cwd；未来若远程会话解析出本地绝对路径，会被 `remoteArgvOf` 削成裸名）。
7. **官方工作区注册表看不见远程工作区**（占位目录方案，镜像已砍）。
8. **宿主会静默 `ctx.fs.resolve` 往上找 `.git`**（定 `AGENTS.md` / skills 根，轨迹里没有 Git 工具）。探测路径不得当成 workspace-write jail 根（`BUG-4` 已修：只传 `path`）。专题附录 [`notes/host-silent-fs.md`](./notes/host-silent-fs.md)。无 `.git` 的远程会话实机尾巴仍待验。

## 6. 契约侦察

子代理禁止调用 `cordis_inspect_list` / `cordis_inspect_query`（页面不响应会永久挂起）。槽位/服务/事件契约走磁盘权威源，读取器是 `npm run slots -- --list|--key|--diff`。路径与失效条件见 `AGENTS.md` §5 红线 7；槽位 diff 的方法学见 [ADR-0017](./decisions/ADR-0017-rc2-client-slot-recon.md) §1.1。**行号不是契约**，只认 `key` / 字段名 / 符号名。
