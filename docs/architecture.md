# dsh-workspace-enhancement 架构文档

> 面向接手者（新 agent / 新贡献者）。本文只陈述来源里已有的事实，来源见 §8；
> 来源未明确的点一律标注「（来源未明确）」，不做推测。
> 工作规则见仓库根 `AGENTS.md`；当前状态见 `docs/status.md`；待办真相源见 `docs/backlog.md`；
> 路线图见 `docs/ROADMAP.md`。
> 公开文档中的主机/用户/指纹/路径一律为占位符：`user@host`、`%DSH_HOME%`、`$HOME`、`<repo>`、
> `<fingerprint>`；本机回环地址（lab 端口 50599）非敏感，按原样书写。

## 1. 一句话定位

把 DSH 生态里散落的「工作区」能力（远程 SSH 工作、目录选择、机器/连接管理）收进**一个**插件包：
`ctx.subprocess` / `ctx.fs` 的远程 provider 让框架里**所有**消费这两条接缝的工具（bash、文件读写、
PTY 终端、LSP、子代理进程）**零改动**地跑在远端；多机注册表 + `ssh://<id>/<path>` 路由决定「在哪台机、
哪个目录」；会话可以再挂若干**副工作区**并逐目录设权限（`drafts/CONTEXT.md` §1、§3.1、`drafts/r5-design.md` §1）。

## 2. 核心原则

**「本地大脑、远程手脚、一层配置」**（`drafts/CONTEXT.md` §1）：

1. 一个包承载工作区全部职能：本地 + 远程（SSH）、选择/浏览、连接与机器管理（镜像/同步与审计已明确不做，
   见 ADR-0003 / ADR-0004）；
2. **引擎走 DSH 的能力接缝** —— `ctx.subprocess` / `ctx.fs` / 目录选择器（`ctx.directoryPicker`）/ 工具注册
   （`ctx.tools`）/ 系统提示（`ctx.systemPrompt`）/ RPC 通道（`ctx.connection.rpc`）/ 国际化（`ctx.locale`）。
   官方与社区工具不用改一行就能工作在所选工作区上，而不是各插件再造一套平行工具；
3. 面向模型与 UI 的接口保持窄而稳：一个系统提示 section、一组精简工具（`sw_*`）、一套配置。

工程约束（`AGENTS.md` §2）：Node >= 22、ESM only、TS + `tsc` + `tsdown`；宿主插件对象永远是纯 JavaScript；
宿主已提供的共享包只进 `peerDependencies`（见 §6）。

## 3. 运行形态

### 3.1 宿主半与客户端半的边界

| 面 | 源 | 构建 | 产物 | 加载方式 |
|---|---|---|---|---|
| 宿主（Node） | `src/*.ts`（除 `src/client/`） | `tsc` | `lib/**` | 插件加载器导入 `lib/index.js` |
| 客户端（浏览器） | `src/client/**`（TSX） | `tsc` → `tsdown` | `lib/client/index.js` → **单文件** `lib/client.js` | `window.__ModuleLoader__.load({ id, factory })` |
| 共享词典 | `src/locale/` | 两条链各取一次 | 宿主编到 `lib/locale/`（**不进** `exports` 表）；客户端被 tsdown 内联 | 两侧 import 同一批源文件 |

- `package.json` 的 `exports` 表：`.` 入口 + 六条子路径（`./ssh`、`./subprocess`、`./fs`、`./picker`、`./web`、`./client`）
  + `./package.json`。
- `tsdown.config.ts`（客户端构建）：平台模块（react / react-dom / `@deepseek-ai/cordis` /
  `dsh-client-ui-slots` / `dsh-client-web-react` / `dsh-client-ui-primitives` / `dsh-client-ui-attachment` /
  `dsh-client-schema-form` / `dsh-client-runtime/client`）从加载器模块表解析，**其余全部内联**；
  「bundle purity gate」把任何非平台模块的 `@deepseek-ai/*` **值**导入当作构建错误
  （跨插件协作只能走 Cordis 服务；类型导入被擦除）；CSS Modules 由 lightningcss 编译成自注入 `<style>`。

### 3.2 挂载：`cordis.patch.yml`

`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，该 patch 分两组动作（关掉三行默认 provider + 插入三行本插件行）：

| 行 | 动作 | 说明 |
|---|---|---|
| `directory-picker`（`@deepseek-ai/dsh-host-directory-picker-auto`） | `disabled: true` | 默认选择器关闭，添加工作区流程由本插件接管 |
| `subprocess`（`@deepseek-ai/dsh-subprocess-local`） | `disabled: true` | 本地 provider 行让位给混合 provider |
| `fs-sandbox`（`@deepseek-ai/dsh-fs-sandbox`） | `disabled: true` | 同上 |
| `ssh-remote`（`dsh-workspace-enhancement`） | insert | 聚合行：挂 `ctx.ssh`，并把 `ctx.subprocess` / `ctx.fs` 换成混合门面；config 是一组占位连接参数（懒连接，真实连接来自 UI 里创建并持久化的注册表条目） |
| `directory-picker-ssh`（`dsh-workspace-enhancement/picker`） | insert | `maxEntries: 1000` 的目录 browse 后端 |
| `ssh-web-channel`（`dsh-workspace-enhancement/web`） | insert | 注册表 + `/api/dsw/*` 浏览器通道 |

- 注释与源码都强调：profile 自身的 `cordis.patch.yml` 与 `--patch` 覆盖在本层之后生效，部署可以改写或关掉任意行；
  sandbox 策略行与沙箱化 shell 执行器保持启用，它们消费的是混合 `ctx.subprocess`（`src/plugin.ts` 文件头）。
- 聚合行等价于三条子路径行（`/ssh` + `/subprocess` + `/fs`），**但混合接线只在聚合行发生**；
  子路径行保留纯 SSH 形态，供逐个组合 provider 的部署使用。

### 3.3 客户端 slot 注入

`src/client/index.ts` 的 `inject = ['slots', 'workspaces', 'sessions', 'locale']`，`apply()` 依次注册：

| 槽位 | id / order | 组件 | 作用 |
|---|---|---|---|
| `conversation.hero.workspace.directoryFlow` + `sidebar.workspaces.directoryFlow` | — | `SshWorkspaceFlow` | 添加工作区目录流（`slots.inject` 事务式注册两个洞） |
| `settings.section` | `dsh-workspace-enhancement` / order 40 | `RemoteWorkspaceSettingsPage` | 设置页「远程工作区」机器管理 |
| `conversation.session.header.actions` | `dsh-workspace-enhancement-side` / order 25 | `SideWorkspacesAction` | 会话标题栏「工作区」按钮与副工作区面板 |

- 每个注册都带 `locale: 'dsw'`（拿到类型化 `t`）与 `inject`（`listLocalDirectory` / `createLocalDirectory` /
  `rpc('/api', 'dsw/…')`）；列表标签用 label thunk（`() => t('settings.label')`）读时求值。
- 会话栏**行级**徽标没有官方槽位，由 `installRowBadges`（`src/client/row-badges.ts`）用 DOM 增辉层 +
  MutationObserver 注入，随 `ctx.effect` 回收（上游 PR 提案已撤销，见 ADR-0011）。

## 4. 模块地图

`src/` 共 42 个文件：顶层 25、`src/client/` 13、`src/locale/` 4。

### 4.1 宿主（顶层 25）

| 模块 | 职责 | 关键导出 |
|---|---|---|
| `src/index.ts` | 包入口：重导出宿主公共 API | `apply`、`SshRuntime`、`SshSubprocessRuntime`、`SshFileSystem`、`SshDirectoryPicker`、`SshRegistry`、`SshConnection`、`HostKeyStore`、`saveSecret`/`getSecret`/`deleteSecret`、`parseSshTargetKey`、`resolveSshCwd` |
| `src/plugin.ts` | 聚合行插件：挂 `ctx.ssh`、安装混合 provider、远程会话沙箱模式适配 | `apply`、`installMixedProviders` |
| `src/runtime.ts` | `ctx.ssh` 服务：一个 SSH 执行世界的所有权（认证/保活/主机校验/跳板） | `SshRuntime`、`Config`、`JumpConfig`、`quoteShellArg`、`wrapCwd` |
| `src/ssh-core.ts` | 共享连接机制：跳板链打开、exec 通道、远端环境缓存、SFTP 缓存、shell 引号 | `SshSession`、`openChain`、`execChannel`、`toConnectConfig`、`resolvePrivateKey`、`hostVerifierFor` |
| `src/connection.ts` | 注册表拥有的单连接：spec → 跳板链、主机校验策略解析、错误脱敏 | `SshConnection`、`SshConnectionSpec`、`resolveHostKeyPolicy`、`redactSpecMessage` |
| `src/transport.ts` | 执行世界传输 + `ssh://<id>/<path>` 路由与本地占位目录 | `SshTransport`、`sshTargetKey`、`parseSshTargetKey`、`sshRoutePlaceholder`、`remoteRouteFromCwd`、`resolveSshCwd`、`resolveSshTargetKey` |
| `src/subprocess.ts` | `ctx.subprocess` 远程 provider（进程接缝） | `SshSubprocessEngine`、`SshSubprocessRuntime` |
| `src/process.ts` | 一个异步启动的 SSH 命令在进程接缝上的投影 | `SshSubprocessHandle` |
| `src/terminal.ts` | SSH PTY 分配与终端句柄 | `spawnSshTerminal`、`SshTerminalHandle` |
| `src/output.ts` | 远程输出流的有界收集 + 私有（0700）spill 文件 | `SshOutputCollector` |
| `src/environment.ts` | 远端登录环境读取与 scrub（剔 `DSH_*` / 凭据形变量） | `readRemoteEnvironment`、`scrubRemoteEnvironment`、`serializeEnvironment` |
| `src/filesystem.ts` | `ctx.fs` 远程 provider（SFTP；原子写、写意图/版本） | `SshFileSystemEngine`、`SshFileSystem`、`isOwnStagingDirectory`、`overwritePublicationCommand` |
| `src/listing.ts` | 远程目录单层遍历（picker 与通道 `browse` 端点共用） | `listRemoteLevel`、`remoteHome`、`ancestryCrumbs`、`asError`、`raceAbort` |
| `src/picker.ts` | `ctx.directoryPicker` browse 后端（本机/远程统一；win32 双根） | `SshDirectoryPicker`、`Config` |
| `src/registry.ts` | 机器注册表服务 `ctx.sshRegistry`：持久化、CRUD、TOFU、keychain、`~/.ssh/config` 解析、连接状态/探测/重连 | `SshRegistry`、`loadMachinesState`、`normalizeMachine`、`parseSshRoute`、`deriveConnectionState` |
| `src/hostkey.ts` | TOFU 主机指纹：模式、指纹计算、known_hosts 存取、`%DSH_HOME%` 路径 | `HostKeyMode`、`HostKeyStore`、`HostKeyGuard`、`keyFingerprint`、`dshHome`、`remoteWorkspacesRoot`、`defaultKnownHostsFile`、`defaultSecretsDir` |
| `src/credential.ts` | OS 钥匙串密码存取（DPAPI / security / secret-tool，best-effort 回退明文） | `platformBackend`、`saveSecret`、`getSecret`、`deleteSecret` |
| `src/mixed.ts` | 混合 provider 门面（`ctx.subprocess`/`ctx.fs` 唯一实现）+ 路径路由 + 逐副工作区权限门 | `MixedSubprocessRuntime`、`MixedFileSystem`、`worldOfCwd`、`worldOfTargetKey`、`remoteArgvOf` |
| `src/session-workspaces.ts` | 副工作区状态服务 `ctx.sideWorkspaces`：roots/sessions 双映射、最长前缀匹配、CRUD | `SessionSideWorkspaceStore`、`sideWorkspaceOf`、`normalizeSideRootKey`、`loadSideWorkspaces` |
| `src/web.ts` | 浏览器通道的宿主半：`/api/dsw/*` 精确 Fetch 路由注册与端点派发 | `apply`、`Config`、`WebChannelConfig`、`CHANNEL_ENDPOINTS`、`inject` |
| `src/web-channel.ts` | 通道线协议单一来源（两半共用）：路径、命名空间、信封校验与 Fetch 适配器 | `API_CHANNEL`、`CHANNEL_NAMESPACE`、`channelPathOf`、`channelEndpointOf`、`channelRouteOf`、`isAlreadyRegistered` |
| `src/tools.ts` | 3 个 `sw_*` 管理工具 + 每会话远程认知提示 section | `registerWorkspaceTools`、`renderRemotePrompt`、`renderSideWorkspaces`、`composeWorkspacePrompt`、`renderRemoteEnvProbe` |
| `src/model-prompts.ts` | **model-facing 英文文案常量**（系统提示段 + 远端工具箱提示），刻意不入 i18n（ADR-0014） | `MODEL_PROMPTS`、`modelPrompt`、`ModelPromptKey` |
| `src/session-remote-context.ts` | 每会话工作区事实（cwd / sessionId / 副工作区）与「是否远程世界」判定，供三条提示 section 共用 | `sessionWorkspaceContextOf`、`hasRemoteWorkspaceContext`、`PromptAgentFace` |
| `src/exec-tools.ts` | `sw_exec`（跨服务器执行）+ win32 宿主 `bash` 接缝 | `registerSwExec`、`registerWin32Bash`、`swExecCore`、`resolveRemoteOs`、`buildShellArgv`、`renderSwExecForeground` |
| `src/css-modules.d.ts` | CSS Modules 类型声明（构建期内联） | 无运行时导出 |

### 4.2 客户端（`src/client/` 13）

| 模块 | 职责 | 关键导出 |
|---|---|---|
| `index.ts` | 客户端入口：注册词典、4 个槽位、安装行徽标层 | `apply`、`inject` |
| `flow.tsx` | 添加工作区目录流（连接侧栏 + 目录浏览，VS Code Remote Explorer 式） | `SshWorkspaceFlow`、`FlowProps`（含 `suppressSessionRoute` / `initialConnectionId` / `pickOnly`） |
| `form.tsx` | flow 的连接表单外壳（模态框 + 共享 MachineForm） | `ConnectionForm`、`ConnectionDraft` |
| `machine-form.tsx` | 共享机器/连接表单（设置页与 flow 字段并集，`mode` 只决定提交动作） | `MachineForm`、`parseJumpText`、`jumpChainOf`、`formatResolvedSummary`、`createActionGate` |
| `machine-payload.ts` | 机器表单 payload 纯函数（keychain ↔ 明文切换规则可单测） | `machinePayload`、`EMPTY_MACHINE_FORM` |
| `settings.tsx` | 设置页「远程工作区」机器列表与表单 | `RemoteWorkspaceSettingsPage`、`savedBanner` |
| `side-workspaces.tsx` | 会话标题栏「工作区」按钮 + 副工作区面板（复用 flow 浏览） | `SideWorkspacesAction`、`SideWorkspacesPanel` |
| `status.tsx` | 连接状态 UI：wire 契约、TTL 状态中心、三态徽标与重连 | `createStatusCenter`、`useConnStatus`、`ConnStatusBadge`、`CONN_STATE_LABEL_KEY` |
| `row-badges.ts` | 会话栏行级徽标 DOM 增辉层（无官方行级槽位时的兼容层） | `installRowBadges`、`badgeTextsOf`、`routeIdOf`、`isOwnBadgeMutation` |
| `icons.tsx` | 内联 SVG 图标集（零依赖，currentColor） | 18 个图标组件 |
| `ui.ts` | 客户端 UI 工具：类名拼接、对话框无障碍（Esc 栈 / 焦点陷阱） | `cx`、`useDialogA11y` |
| `flow.module.css` | flow 主题样式（token 锚点 `--dshssh-*`，深浅色 + 窄屏） | 无导出（CSS Modules 类映射） |
| `side-workspaces.module.css` | 副工作区面板样式（token 锚点 `--dswsw-*`，与 flow 同构） | 无导出 |

> 注：两份样式表的 token 锚点前缀不一致（`--dshssh-*` 是历史命名、`--dswsw-*` 是 R5 新表），
> 两者都走「宿主自定义属性 → 泛型变量 → 静态回退」+ `color-mix` 双声明 + `prefers-color-scheme: light` 覆盖；
> 前缀未统一的理由**来源未明确**。

### 4.3 词典（`src/locale/` 4）

| 模块 | 职责 | 关键导出 |
|---|---|---|
| `dsw.ts` | zh 词典 = 键集真源；`LocaleNamespaceMap` 增强声明 | `zh`、`DswKey` |
| `dsw.en.ts` | en 词典，声明为 `Record<DswKey, string>`（缺/多键即编译错） | `en` |
| `index.ts` | 词典出口 + 纯 `lookup` + 客户端注册原语 | `zh`、`en`、`lookup`、`registerDswLocale`、`LocaleId` |
| `host.ts` | 宿主语言解析与工具本地化 helper | `hostLocaleOf`、`localeOf`、`localizeTool` |

## 5. 关键机制

### 5.1 混合 provider 与路径路由（`src/mixed.ts`）

- **动机**：Cordis 同名服务只能注册一次，所以聚合行成为 `ctx.subprocess` / `ctx.fs` 的**唯一实现**，
  官方工具（`tool-bash` / `tool-pwsh` / `tool-fs`）保持原样绑定服务名，路由发生在服务内部（`drafts/CONTEXT.md` §6.2 R4）。
- `installMixedProviders(ctx)`：本地实现类在**本 fiber** 构造（`LocalSubprocessRuntime`；存在 `sandboxPolicy`
  服务时在 `ctx.inject(['sandboxPolicy'])` 子纤维内构造 `SandboxedFileSystem`，否则 `LocalFileSystem`），
  再 `ctx.set('subprocess'|'fs', 门面)`；provide + set 同步完成，消费者纤维不会在两步之间醒来。
- 路由判定（纯函数，可单测）：
  - `worldOfCwd(cwd)`：命中 `ssh://`、`dsw-routes` 占位树或旧 `dsh-ssh-routes` 树 → `remote`；
    win32 宿主上裸 POSIX 绝对路径（`/…` 且非 `//…`）→ `remote`；其余（含 **cwd 缺失**）→ `local`。
  - `worldOfTargetKey(targetKey)`：`ssh://` → `remote`，否则 `local`。
  - `remoteArgvOf(argv)`：Windows 绝对 argv[0]（`C:\…`、`\\…`）改写为裸命令名并去掉 `.exe`；其余原样。
- `MixedFileSystem.resolve` / `lstat` **先看副工作区路径**（绝对路径落在远程副根上时，即使会话 cwd 是本地也走该机器），
  再看 cwd 世界；`stat` / 读类 / `listDir` 按 targetKey 路由；`writeText` / `editText` 先过 fs 写门（§5.5）。
  `sandboxMode` 继承本地委托（诚实上报部署默认），per-call `sandboxPolicy` 只传给本地委托（远端写入不可能被本地沙箱围栏）。
- `resolveExecutable` 恒走本地（接缝无 cwd 参数，调用方是宿主诊断工具；bash/pwsh 执行器不调用它）。
- 兜底：混合安装抛错时回退到纯 SSH 挂载（`SshSubprocessRuntime` + `SshFileSystem`），并 `logger.warn`。
- 远程会话执行适配：`forceRemoteSandboxMode` 监听 `session/created`，cwd 是远程路由时写入
  `sandbox/mode = danger-full-access`（避免沙箱化 shell 执行器把命令包进不存在的本地 runner）。

### 5.2 机器注册表与 `ssh://<id>/<path>` 路由（`registry.ts` / `transport.ts`）

- `ctx.sshRegistry`（`SshRegistry extends Service`）是**唯一真相**：UI 的 `connections.*` 端点、`ssh://` 路由、
  fs/subprocess provider 全部经它解析，每个条目共享一条活连接。
- 持久化 `<dsh home>/remote-workspaces/machines.json`（`{ list, currentId }`，沿用 dsh-remote 的路径与形状）；
  首次迁移：machines.json 缺失或空表且旧 `dsh-ssh-connections.json` 存在时逐条导入（**保留 id**，使
  `ssh://c1/…` 继续有效），旧文件改名 `dsh-ssh-connections.json.bak`；非空 machines.json 永不被覆盖，
  损坏文件保持原样并告警。
- 路由：`ssh://<id>/<path>`；同时识别本地占位目录 `<dsh home>/dsw-routes/<id>/<path>`（旧 `dsh-ssh-routes/` 树
  继续为活会话路由）——因为宿主 session 服务会对本地目录硬 `mkdir`，客户端只能拿占位路径过 `sessions.create`；
  两种拼写最终落到同一注册表连接。
- `~/.ssh/config`：手写 parser（Host / HostName / User / Port / IdentityFile / ProxyJump，通配块匹配，
  递归跳板深度 ≤ 8），`listConfigHosts()` 只列精确别名，`resolveSshConfig(host)` 给出含跳板链的生效配置。
- 连接状态面：`statusOf` / `probe` / `reconnect`（探测超时 `PROBE_TIMEOUT_MS` = 8s，状态 TTL
  `DEFAULT_STATUS_TTL_MS` = 5s，`deriveConnectionState` 派生三态）；凭据解析 `resolvePassword` 先明文后钥匙串；
  对外视图 `SshConnectionView` / `MachineView` 剔除密码与私钥。

### 5.3 TOFU 主机指纹（`hostkey.ts`）

- 三模式 `accept-new`（**默认**）/ `verify` / `off`；指纹 = sha256(blob) base64；首次记录、之后密钥一变即拒；
  `forgetHostKey` 可重置。
- 持久化 `<dsh home>/remote-workspaces/known_hosts.json`，键 `host:port` → `{ algo, fingerprint, firstSeen }`，
  **沿用 dsh-remote 的路径与格式**，已有安装零迁移。
- ssh2 v1.17 的 `hostVerifier` 收到的是原始 host-key blob Buffer（而非旧的 `{ algo, hash }` 对象），
  两种形状都接受，契约漂移时 **fail closed** 而不是每次连接抛 crypto 错误。
- 策略解析顺序：`spec.hostKeyMode`（TOFU）→ 旧 `strictHostKeyChecking` / `knownHosts`（手动档）→ 注册表默认模式。

### 5.4 OS 钥匙串（`credential.ts`）

- 逐机器可选的密码存储后端：darwin `security`（login keychain）、win32 DPAPI（PowerShell，CurrentUser 作用域，
  文件在 `<dsh home>/remote-workspaces/.secrets/`）、linux `secret-tool`，其余平台 `plain`。
- 所有后端都是 best-effort：失败返回 `{ ok: false }`，调用方回退明文——该功能绝不阻塞连接；
  `credentialBackend` 是逐机器字段，UI 对加密回退态有诚实提示。
- 错误脱敏由 `connection.ts` 的 `redactValues` / `redactSpecMessage` 承担；凭据永不进日志、不进 git。

### 5.5 副工作区与逐工作区权限门（`session-workspaces.ts`）

- 实体 `SideWorkspaceItem`：`id` / `kind: 'local' | 'remote'` / `path`（本地绝对路径，或 `ssh://<machineId>/<posix>`）/
  `label` / `fs: 'r' | 'rw'` / `exec: 'on' | 'off'`。
- 状态文件 `<dsh home>/dsw-session-workspaces.json`，两个映射：
  - `roots`：rootKey → 记录，**一个根一份记录**，因此一个目录的权限是全局的（两个会话挂同一目录共享 fs/exec 档位）；
  - `sessions`：sessionId → 有序 rootKey 列表（展示与提示顺序）。
- 匹配 `sideWorkspaceOf` / store 的 `match(path)` 做**最长前缀匹配**（跨 `local` / `ssh://` 家族，含分隔符边界、
  win32 大小写与正斜杠归一）。
- 两道门都在门面内：
  - **fs 写门**：`writeText` / `editText` 的 targetKey 命中 `fs:'r'` 根 → 抛 `FsError(FS_PERMISSION_DENIED)`
    （异步方法，抛的是 promise rejection）；
  - **exec 门**：`spawn` / `spawnTerminal` 只看 `spec.cwd` 与 `spec.argv[0]`，命中 `exec:'off'` 根 → 抛
    `dsw: execution is disabled for the side workspace "…" (exec: off) …`。
- 提示注入：`composeWorkspacePrompt` 渲染主工作区事实行 + 副工作区清单（`fs` / `exec` 标记；无副工作区 = 零注入）；
  文案是 model-facing 英文常量（`src/model-prompts.ts`，ADR-0014）。
- RPC：`session.ws.list` / `add` / `update` / `remove`（远程机器先校验存在再落盘）。
- 语义与边界：只读/禁执行是**启动层**强制，命令文本有意不扫描；已知绕过见 §7 与 ADR-0012。

### 5.6 浏览器通道 `/api/dsw/*`（`web.ts` + `web-channel.ts`）

- 通道是**官方共享 `/api` 传输上的精确 Fetch 路由**：`ctx.connection.fetch.register({ path, methods: ['POST'],
  requestBody: 'buffered', fetch })`，路径 `/api/dsw/<端点的点号名>`，disposer 随 `ctx.effect` 回收；
  `inject = ['connection', 'tools', 'systemPrompt']`。
  - **为什么不是 `rpc.handle('/dsw', …)`**：`dsh-client-connection` 的 `register` 末行读 `owner.webServer`，
    而 `owner` 是 **Connection 服务自己的 ctx**；该包在 0.1.5 上只声明 `["credentials"]` ⇒ 任何调用者都会抛
    `cannot get property "webServer" without inject`（F1 启动崩溃 / F2 `/dsw` 405，见 `docs/rounds/R18-F2-dsw-405.md`）。
  - **为什么不是 `rpc.intercept('/api', …)`**：共享通道的拦截器是**单占位**（`registerInterceptor` 二次注册抛错），
    `@deepseek-ai/dsh-api-gateway` 已占用；精确 Fetch 路由在分发时**先于**拦截器被查（`createSharedFetchHandler`），
    且物理载波仍会先做 loopback/Host 栅栏与浏览器会话校验。决策见 `ADR-0018`。
- **线协议单一来源**：`src/web-channel.ts`（两半共用）给出通道路径、命名空间与信封校验；客户端只发
  `connection.rpc.call('/api', 'dsw/<endpoint>', payload)`，服务端回
  `{type:'server-response', rpcId, result}`（信封与上游一致，`method` 取 `/api` 之下的完整端点路径）。
- 端点分组（`src/web.ts` 的 `switch`，与 `CHANNEL_ENDPOINTS` 由用例锁定一致）：`connections.list|resolve|add|remove|test`、
  `config.hosts`、`machines.list|current|setCurrent|add|remove|test`、`hostkey.forget`、`status`、
  `conn.status|probe|reconnect`、`browse.home|list|mkdir`、`session.route`、`local.pickNative`、
  `session.ws.list|add|update|remove`。
- 重载语义：路由是**无状态**的（按请求从 `liveDispatch` 取当前 dispatch）。注册落在 Connection 服务的
  effect 作用域内，因此「重装后旧路由仍在」时第二次注册会撞 `already registered`——此时**捕获并继续**
  （旧路由已服务新 handler），不得抛错（`AGENTS.md` §6 的可逆性红线）。
- 远程目录列举与 picker 共用 `listRemoteLevel`（`src/listing.ts`）；`maxEntries` 默认 1000。
- 错误契约：协议层 `bad-request: …` 保留英文；业务/路由错误用 `dsw:` 前缀并按宿主语言取词；
  非法信封由 `web-channel.ts` 以 `gateway/bad-request`（与上游同码）回答；通道失败映射到宿主封闭的
  rpc 错误词表（`connection-failed` / `internal` 等）。

### 5.7 `sw_*` 工具（`tools.ts` / `exec-tools.ts`）

- `tools.ts` 注册三个管理工具：`sw_status`（主机/工作区/连接/主机指纹/后端 + ping + 远端环境自检）、
  `sw_connect`（含 `save:false` 临时连接）、`sw_pick_workspace`（校验存在后设远程工作区）；
  外加系统提示 section `sw-remote`（order 90，按 `context.scope` 反查会话，本地零噪音）。
- **提示 section 的注入判定（REQ-I6 ②）**：`session-remote-context.ts` 的
  `hasRemoteWorkspaceContext(context, sides)` = 会话 cwd 解析出远程路由 **或** 该会话有副工作区。
  `sw-remote`（order 90）按会话事实组合；`tool:sw-exec` / `tool:bash`（order 105）由静态字符串改为
  `text: context => 判定 ? 文案 : ''`——纯本地会话三段**全部零注入**。
- `exec-tools.ts` 注册：
  - **`sw_exec`**：在**指定服务器**上执行命令。`server` 接受注册表机器 id 或 `sw_connect save:false` 的临时 id，
    缺省 = 会话主工作区机器，未知 id 报错并列出已知 id；目标 OS 每连接探测一次
    （`uname -s` → `cmd /c ver` → `unknown`，进程内 Map 缓存），POSIX/unknown 用 `bash -c`、win32 用 `pwsh -Command`；
    spawn 经混合 provider（cwd = `ssh://<server>/<workdir 或机器工作区>`），因此机器路由与副工作区 exec 门原样生效；
    非 0 退出**报告而非报错**；`run_in_background` 走可选服务 `ctx.jobs`（缺服务明确报错）；不做 escalation；
    v1 不接受本地 server。
  - **win32 宿主 `bash` 接缝**：仅 `process.platform === 'win32'` 注册（POSIX 宿主有官方 `bash`，重名注册会失败）；
    执行期按 `worldOfCwd(会话 cwd)` 判定，远程 Linux 会话真跑远端，本地 Windows 会话抛清晰错误引导 pwsh，
    绝不静默降级。
- 工具描述与参数走 getter 化（§5.8），工具注册与提示 section 都挂在 `ctx.effect` 上。

### 5.8 运行时国际化（`src/locale/`，命名空间 `dsw`）

- **单一共享词典**：`src/locale/dsw.ts`（zh，键集真源）与 `dsw.en.ts`（en，`Record<DswKey, string>`）——
  en 缺键或多键即编译错；两侧 import 同一批源文件（宿主 tsc 编到 `lib/locale/`，客户端被 tsdown 内联）。
- **命名空间必须是 `dsw`**：官方 client 包已注册 `sidebar` / `conversation` / `workspace` /
  `settings` / `settings.locale` / `common` 等，而 `ctx.locale.register` 对重复 (ns, locale) **抛错** ——
  用 `workspace` 会与 `dsh-client-ui-workspace` 直接冲突崩溃。
- 键命名 `<surface>.<scope>.<item>`，surface ∈ {flow, form, side, settings, status, rpc, tool, permission}；
  模板参数 `{name}`，不做复数逻辑；禁止字符串拼接键名。
  > **注（REQ-I6 / ADR-0014）**：`prompt` surface 已废弃并从词典删除——**model-facing 文案（系统提示段、
  > 远端工具箱提示）统一为英文常量**，放在 `src/model-prompts.ts`，不随 UI 语言切换；词典只保留
  > 人类面（客户端 UI + 用户能读到的宿主消息/工具错误）。键集因此从 340 降到 328（zh/en 仍严格相等）。
- 客户端：`ctx.effect(() => ctx.locale.register('dsw', { zh, en }))`；槽位注册带 `locale: 'dsw'` 拿到类型化 `t`；
  非渲染路径用 `ctx.locale.bind('dsw')`；语言解析、`<html lang>` 同步、设置页 Language 行全部交给框架，
  本插件不写 preference、不加语言 UI。
- 宿主：`hostLocaleOf(ctx)` = `ctx.get('settings')?.get('locale')?.preference ?? 'en'`，**每次求值即时读**
  （无缓存、无订阅；`settings` 是可选服务）；`localizeTool` 把工具的 `description` / `parameters` 换成 getter
  （官方 `run_code` 自证范式，路线 B），错误与输出在执行时取词。
- 会话栏徽标：`CONN_STATE_LABEL_KEY` 单一键源 + 切语言就地重绘（`paintBadge` 变值守卫，不重建 DOM、不触发扫描风暴）。
- 例外边界（`drafts/i18n-design.md` §13-1~8）：机器可 parse 标记（`[exit code: N]`、`[stderr]`、
  `[timed out after Nms]` 等）两语**逐字节一致**；`tool call aborted`、`bad-request: …`、品牌与枚举值
  （`Agent`、`accept-new`/`verify`/`off`、`linux`/`win32`/`unknown`、色值、符号）、库原始错误、注释/日志保持原文。

## 6. 依赖与单例约束

- **宿主已共享的 `@deepseek-ai/*` 一律进 `peerDependencies`**（当前 15 项，含 RC 通道范围，例如
  `^0.1.2-rc.1`；另有 `@deepseek-ai/cordis` `^4.0.2`、`@deepseek-ai/schemastery` `^3.18.2`）。
- **理由**：Cordis 的服务身份是**模块级 Symbol**。若把宿主已装的包放进 `dependencies`，会被当成自有运行时依赖
  装出更近的副本，**遮蔽宿主单例**，导致 Cordis `Symbol` / `instanceof` 身份分裂 —— service 注册失效、
  `HarnessError` 判类失效（`AGENTS.md` §2）。
- **`dependencies` 只留 `ssh2`**；同一批包在 `devDependencies` 同步保留（供 `tsc` / `tsdown` 取类型）。
- 客户端**运行时零新增依赖**：只经 `ctx.locale` 服务与类型导入（`dsh-client-locale` 不进 tsdown EXTERNALS，
  值导入会被纯度门禁拒绝，类型导入被擦除）；`dsh.client.inject` 列出 6 个包。
- 教训（`drafts/CONTEXT.md` 2026-08-30 补记）：v0.1.1 自身的 `dependencies` 家族劈叉（部分包停留在
  `^0.1.0-rc.6`、个别精确版本），使 web profile 出现 6 条风险级 peer 不匹配；处置 A = profile 级
  `pnpm.overrides` 钉版本（脚本由用户在外部终端执行），B = 仓库 `package.json` 对齐 rc.2 家族；
  0.1.2 的发布口径 = 依赖对齐修复 + R6 i18n 同发。

## 7. 已知边界

1. **远端环境要求**：模型 `pwsh` 工具需远端装 pwsh，`glob` 需远端 ripgrep；终端（bash）开箱即用。
   `sw_status` 有三行自检，缺 pwsh/rg 时工具诚实返回 127。
2. **SSH 协议固有**：远端 `pid` 恒为 -1，无 `inspectForeground` / `signalForeground`，前台进程组不可见；
   退出码/信号以 SSH channel close 为准。
3. **exec 门是启动层强制**：只看 `spec.cwd` 与 `spec.argv[0]`；命令文本有意不扫描
   （扫描不可靠，且 fs 只读是文件工具级的门）。
4. **副工作区 `fs:'r' + exec:'on'` 可被绕过**（2026-08-26 用户实测 + 2026-09-02 lab 审计）：
   主工作区命令用**绝对路径**写只读副根（`exec:on`/`off` 都拦不住）、`workdir` 相对写、只读根内文件可被**删除**
   （无完整性保护）；`workspace-write` 档位下 runtime 层也没有进程围栏。补强方案尚未拍板 → ADR-0012。
   门禁在其声明范围内（文件工具写、exec 门含嵌套路径/PTY/大小写归一）8/8 符合文档行为，无实现级 bug。
5. **远程会话 composer 预设显示 Custom**（已拍板仅记录）：远程会话只被写入 `sandbox/mode=danger-full-access`，
   审批旋钮仍是 `ask`，组合不匹配任何预设整组 → 解析为 `custom`；候选方案 A/B/C 见 `drafts/CONTEXT.md` §7。
6. **官方工作区注册表看不见远程工作区**：占位目录方案下 remote 会话的 cwd 是本地占位路径；镜像已砍，
   没有「真实本地副本」这条绕开路径。
7. **会话栏副工作区徽标延后**：v1 只有标题栏「工作区」按钮 + 面板，不做焦点指示。
8. **双机同名裸 POSIX 路径归因 machine-agnostic**：`ssh://` 拼写精确，裸 POSIX 路径不带机器信息
   （fs 侧遗留项；`sw_exec` 因 `server` 显式而无歧义）。
9. **i18n 不一致窗口**：无持久化偏好 + 中文浏览器时，客户端 UI 是 zh、宿主模型面是 en
   （框架 `FALLBACK_LOCALE = 'en'` 语义；在设置页 Language 选一次即收敛为三面一致）。
10. **面板终端保持本地**：用户可见的侧栏终端由 dsh-better-sidebar 提供（直连 node-pty，不经 `ctx.subprocess` 接缝）；
    本项目插件保持独立，不 monkey-patch 第三方内部实现；远程终端的可用路径是模型终端工具
    （`dsh-bash-terminal` 经 `ctx.subprocess.spawnTerminal` 已远程）。
11. **UI 一致性（已记录，不急着改）**：flow 表单与设置页表单曾字段不一致，R2 已用共享 `MachineForm` 收敛；
    认证 tabs 无「SSH Agent」第三档（`drafts/ui-merge-design.md` §6.1 决定 R2 不做）。
12. **上游漂移**：两份合并分析基于下载快照（dsh-ssh main 0.3.0-pre、dsh-remote 0.8.7），复核时以上游最新代码为准；
    历史快照中 `dsh-ssh` main 曾存在不能过 typecheck 的文件，因此二开采用「按文件摘录 + 自行重构」而非整库照搬。

## 8. 来源

> 注：`drafts/` 是仓库本地草稿（按 `AGENTS.md` §3 不入库）；列出它是为了标明每条事实的出处，
> 公开读者可跳过这些路径，只看 `src/` 与已入库的 `docs/`、`README`、`CHANGELOG`。

- `drafts/CONTEXT.md`（§0 进度快照、§1 愿景、§3 历史分析、§4 合并设计、§5 决策记录、§6 里程碑、§7 风险与开放问题）
- `drafts/features-breakdown.md`（特性拆解、§4 合并映射表、§5 dsh-ssh 精简审计）
- `drafts/r5-design.md`（副工作区实体/路由/权限门/UI 设计与实现记录）
- `drafts/i18n-design.md`（运行时国际化设计：命名空间、键命名、宿主语言、工具 getter 化、例外清单）
- `drafts/security-audit.md`（副工作区权限门 case 矩阵与结论）
- `drafts/sw-exec-requirement.md`（`sw_exec` 与 win32 `bash` 接缝需求与规格）
- `drafts/ui-merge-design.md`（共享 MachineForm 字段并集与交互语义）
- `AGENTS.md`（工程约定、依赖单例约束、安全红线、开发流程）
- `src/` 源码本身（模块结构、导出、服务名、门禁实现、构建配置）
- 交叉引用：`package.json`、`cordis.patch.yml`、`tsdown.config.ts`、`CHANGELOG.md`、`docs/ROADMAP.md`

### 来源未明确之处（本文不猜测，逐条标注）

- **决策日期粒度**：包名/前缀、镜像放弃、审计砍掉、端口转发延后、侧边栏对接这几条只记到「2026-08 会话」，
  具体日来源未明确（见各 ADR 的「日期」行）；R0.5/R0.6 的完成日同样只有月粒度。
- **`cordis.patch.yml` 里 `ssh-remote` 行的占位连接参数**（host/username/cwd 取值）为何取该组值、
  是否沿用上游默认——来源未明确；patch 注释只说明它是占位、懒连接。
- **两份客户端样式表的 token 前缀**为何一为 `--dshssh-*`、一为 `--dswsw-*` 而未统一——来源未明确。
- **双机同名裸 POSIX 路径的 fs 归因**在来源中只记为「遗留 a（machine-agnostic）」，
  无拍板日期与处置计划——来源未明确。
- **各 ADR 被否方案的最终放弃时点**（例如镜像草案、`ws_*` 命名）只有「被某条决策取代」的记录，
  没有单独的撤销日期——来源未明确。

### 8.1 契约侦察的磁盘权威源（`cordis_inspect_*` 的等价物）

`AGENTS.md` §5 红线 7 禁止子代理调用 `cordis_inspect_list` / `cordis_inspect_query`（client 查询依赖
页面应答，页面不响应会**永久挂起**）。但这两个工具**供模型读取的那份数据本身就在磁盘上**，因此契约
侦察完全不必碰 Inspect：

| 项 | 事实 |
|---|---|
| 路径 | `<npm root -g>/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-cordis-client-runner/lib/client.js`（本机实测：只有全局安装树有该包；部署包 `$DSH_HOME/profiles/web/node_modules/` 与本仓库 `node_modules/` 均无） |
| 包身份 | `@deepseek-ai/dsh-cordis-client-runner`，`@deepseek-ai/dsh` 的直接依赖（同家族 `0.1.2-rc.1`） |
| 槽位目录 | `CLIENT_SLOT_API`（约 `:2135` 起，至 `:4198`；`SLOT_CATALOG = new Map(...)` 在 `:4199`）——宿主 web bundle 声明的**每一个**槽位 |
| 服务目录 | Service Catalog，模块头注释在 `:1105`（`//#region lib/types/client/api-catalog.js` 起于 `:1099`） |
| 事件目录 | Event Catalog，见 `:2103` 的投影注释（同一 `api-catalog` 模块） |
| 槽位条目字段 | `key` / `kind` / `scope` / `summary` / `doc` / `registerOptions`（name + requirement + type + doc）/ `ownerProps` / `ownerPropsReferences` / `standardProps` / `keyDomain` / `hookContext` / `slotInject` / `declaredBy` / `occupants` / **`replaceRisk`** / `example` / `source`（上游源码路径:行） |

**用途**：给「这个槽位能不能插、插进去会不会遮蔽官方 UI、注册要传哪些 options、组件实收哪些 props」
一次性答案。`replaceRisk` 是上游自己的判断（`none` = 新 id 追加在既有 entry 旁边；
`shadows-shipped-ui` = 注册即替换），比自行推断可靠；`example` 直接给出可用的
`ctx.slots.inject(...)` 骨架；`source` 指回上游 `src/`，可继续深挖。

**与 `cordis_inspect_*` 的关系**：**替代，不是补充**。这份 `client.js` 就是 Inspect 的 Slot / Service /
Event provider 的**数据源**（文件头注明 `Generated by scripts/gen-cordis-inspect-catalog.ts`），
所以「以后槽位/服务/事件契约侦察走磁盘，不必碰 Inspect」——两者读的是同一份生成数据，
磁盘路径只是绕开了那次需要页面应答的 client 往返。

**失效条件**（命中任一条即需重新核对，不可继续引用旧行号）：

1. 上游家族升级（peer 范围 `^0.1.2-rc.1` 变更，见 `docs/compatibility.md` §1）或 `dsh` 升级导致该包换版；
2. 全局安装树被重装 / `npm root -g` 变化，或该包不再作为 `dsh` 的直接依赖（路径失效）；
3. 行号漂移——`client.js` 是**生成产物**（文件头 `do not edit by hand`），只能**只读引用**，
   任何编辑都会被上游的 `verify-cordis-inspect-catalog` 判为过期；
4. 槽位契约与包内 `.d.ts` 出现分歧时，**以部署包的 `lib/types/**/*.d.ts` 为准**，目录仅用于
   补 `replaceRisk` / `occupants` / `example` 这类类型文件里没有的信息。

**已用案例**：`docs/decisions/ADR-0016-conversation-panel-tab-slot.md` 用该目录确认
`conversation.view` 的 `replaceRisk: none`、occupants（`chat` / `trajectory`）与上游注册示例，
并与 `dsh-client-ui-conversation` 的 `.d.ts` / `client.js` 双向核对。
