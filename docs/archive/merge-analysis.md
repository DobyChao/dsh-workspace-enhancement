# 归档：合并分析历史稿

> 本文件是 2026-08 早期「dsh-ssh × dsh-remote 合并分析」的**历史记录**。
> 内容保留供回溯，**不再代表当前设计**——实际交付以 CONTEXT.md §0/§5/§6 为准。
> 归档日期：2026-08-23，R0.6 上线后。

---

## 归档 1：两个插件的功能定位与关键差异（原 CONTEXT §3）

### 3.1 dsh-ssh（UynajGI，v0.3.0-pre，TS，~6.6k 行 src）

**定位：远程执行引擎 ——「本地大脑、远程手脚」**。通过实现 DSH 两个能力接缝的
远程 provider，让框架里**所有**消费 `ctx.subprocess` / `ctx.fs` 的工具（bash、
文件读写、PTY 终端、LSP、子代理进程）**零改动**透明地跑在远程。

| 面 | 实现 |
|---|---|
| 连接 | `SshConnection`（ssh2）：密码 / 私钥(PEM 内容或路径) / passphrase / agent / Pageant；**多级跳板**（direct-tcpip 等价 ProxyJump，每级独立认证）；`~/.ssh/config` 解析（HostName/User/Port/IdentityFile/ProxyJump 递归解析、通配符匹配、精确别名清单）；`readyTimeout`/keepalive；`strictHostKeyChecking`+`knownHosts`（手动指纹，非 TOFU） |
| 进程 | `SshSubprocessRuntime extends SubprocessRuntime`：collect（内存 tail + 本地 spill）/ pipe / inherit / 批量 stdin；`resolveExecutable` 走远程 `command -v`；PTY（`spawnTerminal`，TERM→KILL 清理）；退出码/信号以 SSH channel close 为准；UTF-8 整段解码 |
| 文件 | `SshFileSystem`（SFTP）：read / streamText / readBytes / listDir / stat / lstat / 原子写（临时文件 + rename 保留 mode）；写操作按 targetKey 串行化 |
| 会话落地 | `session.route`：远程路径 → 本地占位目录 `<DSH_HOME>/dsh-ssh-routes/<id>/<path>`，再 `sessions.create({cwd})`——绕开 session 服务对本地 `mkdir` 的硬性要求；`ctx.subprocess`/`ctx.fs` 同时识别 `ssh://<id>/<path>` 与占位前缀 |
| 多连接 | `SshRegistry` 服务：`ssh://<id>/<path>` 路由；`dsh-ssh-connections.json` 持久化（明文，含密钥路径）；`test` 连接；`config.hosts` 端点每次重读 `~/.ssh/config` |
| UI | `picker`（`ctx.directoryPicker` browse 后端）+ 客户端 `flow.tsx`（VS Code Remote Explorer 式：左连接侧栏 `~/.ssh/config` 主机直达 / 已保存连接 / 本机，右目录浏览）+ 系统原生选择器按钮；注册两个 directoryFlow 槽位 |
| 工程 | `tsc` + `tsdown`；`exports` 子路径（`./ssh` `./subprocess` `./fs` `./picker` `./web` `./client`）；`dsh.client.inject` 5 个包 |

**局限**（明确写入 README）：无 TOFU（需手工 knownHosts）；无本地镜像/同步；
远程会话**不进 DSH 本地 workspace 注册表**（占位目录即 cwd）；单连接断线不自动重连；
`pid` 恒 -1；无 `inspectForeground`/`signalForeground`；无端口转发；无审计日志；
无设置页式机器管理。

### 3.2 dsh-remote（flymysql，v0.8.7，纯 ESM JS，~5.4k 行 lib）

**定位：远程工作助手 ——「镜像工作区 + rw_* 工具集」**。不碰 `ctx.subprocess` /
`ctx.fs`；维护多台机器，选一个远程目录 → 创建**真实本地镜像**（fs 收养为普通
工作区），供给 21 个 `rw_*` 模型工具显式远程操作 + SFTP 增量双向同步。

| 面 | 实现 |
|---|---|
| 连接 | `SshPool`：单级 proxy 跳板；TOFU 主机指纹（`accept-new`/`verify`/`off`，`known_hosts.json`）；OS keychain 密码（credential.js 分平台后端）；agent / keyboard-interactive；`commandTimeoutMs`/`connectTimeoutMs` |
| 机器 | `machines.json`（`list + currentId`）；设置页 `settings.section` 槽位（priority 40）机器 CRUD + 测试连接 + 设为当前；CLI config 默认机；临时连接（不存表） |
| 工作区 | 选远程目录 → 镜像 `$DSH_HOME/remote-workspaces/<host>-<user>-<port>/<basename>`（同名冲突加短 hash）+ `.dsh-remote-meta.json`；`resolve-mirror` 路由（本地路径→远程路径，含会话日志兜底）；工作区持久化到机器 |
| 工具 | `rw_info / rw_connect / rw_pick_workspace / rw_list_dir / rw_read_file / rw_write_file / rw_edit / rw_append / rw_mkdir / rw_remove / rw_move / rw_stat / rw_exec / rw_search / rw_download / rw_upload / rw_sync / rw_push / rw_forward / rw_disconnect`（约 21 个）+ 系统提示注入（当前 `user@host:/path` 每次注入） |
| 同步 | 三方冲突感知（两侧都改则报告、不覆盖，`force` 覆盖）；size+mtime 跳过；单文件大小上限；有界并发；`rw_sync`（远程→镜像）/`rw_push`（镜像→远程）；可选 `autoPush` 监听回推 |
| UI | 客户端：居中双 tab 选择器（**本机**：原生系统对话框/输入路径 → 普通本地工作区；**远程**：机器下拉 + `/` 预填 + 级联补全 + 「浏览…」浮层回填）；priority -100 填两个 directoryFlow 槽位；dsh-better-sidebar 硬依赖（守卫式挂载，独立安装时退避） |
| 其它 | 端口转发（ForwardManager）、命令审计日志（auditLog）、任务管理器（TaskManager）、更新检查（updateMode）、编码（iconv-lite）、移植 POSIX 命令（ls/sed/find -exec grep，BSD/GNU 双兼容） |

**局限**：只能单级跳板；无 `~/.ssh/config` 别名解析；无 PTY；agent 必须学会
`rw_*` 工具集（与官方工具平行）；改动远程必须先 `rw_sync`/`rw_push` 或直接
`rw_write_file`（心智模型有两套）；内嵌侧边栏与宿主已装版本有重复挂载风险
（它的守卫专门处理了这个，但仍是包袱）。

### 3.3 关键差异（合并必须消解的冲突）

| 维度 | dsh-ssh | dsh-remote | 当时合并策略 |
|---|---|---|---|
| 引擎模型 | **接缝 provider**（bash/文件/LSP/终端全透明远程） | 平行 `rw_*` 工具集 + 本地镜像 | **保留接缝引擎（dsh-ssh）**——实际交付如此 |
| 远程文件操作 | 官方文件工具直接走 SFTP | 自研 `rw_read/write/…` + 镜像同步 | 官方工具为主（实际交付砍掉全部 rw_* 文件工具） |
| 连接管理 | `SshRegistry`（`ssh://` 路由 + `~/.ssh/config` 直达 + 占位目录） | `SshPool` + machines 表 + 设置页 CRUD | 统一注册表（实际交付：machines 为单一真相） |
| 主机校验 | 手工 `knownHosts`（不默认开启） | **TOFU**（默认开启，变化即拒） | **采用 TOFU**（实际交付默认 accept-new） |
| 跳板 | **多级**（每级独立认证） | 单级 | 多级（实际交付内建于 connection） |
| 工作区落地 | 占位目录（不进 workspace 注册表） | **真实镜像**（进注册表、可同步） | 当时设想双模式；**实际决定：镜像完全放弃**（§5.8） |
| UI 槽位 | 左右分栏（连接侧栏 + 浏览） | 居中双 tab（本机/远程） | 当时设想一个流程；**实际：保留 flow 左右分栏 + 独立设置页**（表单差异记录于 §7） |
| 侧边栏 | 无 | 内嵌（依赖） | 不捆绑（实际交付完全不关联侧边栏） |
| 状态目录 | `dsh-ssh-connections.json` + `dsh-ssh-routes/` | `remote-workspaces/` | 实际交付：machines.json + known_hosts.json 于 remote-workspaces/，旧文件归档 `.bak` |
| 附加能力 | 环境 scrub、UTF-8、spill | 转发、审计、keychain、编码、更新检查 | 实际：keychain/TOFU 并入；转发延后；审计/更新/编码/镜像砍掉 |

---

## 归档 2：合并设计草案（原 CONTEXT §4）

### 4.1 总体形态（草案）

- **一个 npm 插件包**，宿主半 + 客户端半，结构沿用 dsh-ssh 的 TS + tsdown 工程：
  - 引擎层（dsh-ssh 移植）：`connection.ts`、`runtime.ts`、`subprocess.ts`、
    `filesystem.ts`、`terminal.ts`、`transport.ts`、`environment.ts`；
  - 机器注册表（dsh-remote 移植 + dsh-ssh 融合）：`registry.ts`；
  - 通道与工具：`web.ts`（JSON RPC）+ 精简工具集；
  - 客户端：`flow.tsx`（添加工作区）+ `settings.tsx`（机器管理页）。
- **挂载形态**：一行聚合 + 可选子路径行；关掉默认 `dsh-host-directory-picker-auto`；
  **不挂** dsh-better-sidebar。

### 4.2 工作区双模式（草案，已被否决）

- **模式 A：远程原生（默认）** —— dsh-ssh 式，透明远程、无本地副本。
- **模式 B：镜像（按需）** —— dsh-remote 式，本地副本 + 三方冲突同步。
- 判定：A 覆盖 90%；B 留给本地工具链/离线/大文件场景。
- **最终决策（§5.8）：镜像完全放弃**，只交付模式 A。

### 4.3 工具与提示词精简（草案 → 实际有出入）

- 草案：保留 `ws_status/ws_connect/ws_pick_workspace/ws_sync/ws_push/ws_forward`
  （兼容 `rw_` 别名）。
- **实际**：前缀定为 `sw_`（§5）；只有 3 个工具 `sw_status/sw_connect/sw_pick_workspace`
  （sync/push 随镜像砍掉、forward 延后）；系统提示只注入一行。

### 4.4 数据迁移（草案 → 实际）

草案：id 重命 `c1`→`m-…`、TOFU 直搬、镜像 meta 重建、占位目录清理。
**实际**：c1 **保 id** 迁移（路由/占位兼容）；TOFU 直搬（路径格式零迁移）；
镜像相关不迁移（已放弃）；占位目录保留（c1 路由仍兼容，列 R1 清理项）。

### 4.5 兼容与退避（草案 → 实际）

- dsh-better-sidebar 退避：实际交付完全不关联（宿主独立安装，无冲突）。
- 旧插件共存警告：真实 profile 中 dsh-ssh 已消失，无共存问题。
- 机器表 super-set 字段：实际交付 machines.json 含 dsh-ssh spec + dsh-remote rec 超集。
