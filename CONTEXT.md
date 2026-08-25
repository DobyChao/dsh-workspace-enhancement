# CONTEXT.md — dsh-workspace-enhancement 研究上下文与合并设计

> 本文件是项目的**事实与决策记录**：部署现状、两个待合并插件的架构分析、
> 合并设计与路线图。改设计先改这里。工作规则见 [AGENTS.md](./AGENTS.md)。

---

## 0. 进度快照（2026-08-23）

**一句话**：`dsh-workspace-enhancement`（= 精简 dsh-ssh 引擎 + dsh-remote 最小合并包）
已上线真实 3080 实例，c1 迁移完成、TOFU 保护中——项目的第一个可用产品形态达成。

| 面 | 状态 |
|---|---|
| **产品（3080）** | ✅ 运行中：引擎（`ctx.ssh`/`ctx.subprocess`/`ctx.fs` 透明远程）+ machines 注册表（c1, currentId=c1）+ TOFU（accept-new，指纹 BC4J1v… 续用）+ DPAPI keychain（backend=windows）+ 设置页「远程工作区」+ 3 个 `sw_*` 工具 + `/dsh-ssh` RPC 通道（兼容端点 connections.* 无感映射） |
| **仓库** | 源码 ~23 文件 + client/（flow + settings）；单测 18/18；typecheck 0 错误；build（tsc+tsdown）产物 lib/ 已随 link 依赖生效；`.npmrc`（legacy-peer-deps 注记） |
| **质量** | 三轮 AgentTeams 全闭环：R0.5（精简）reviewer approve → R0.6（合并）t4 needs-fix→t5 修、B1-B4→t7/t9 修、t10 真实边界修 → 最终 approve + browser-use E2E PASS |
| **测试基建** | `scripts/dev-lab.ps1`（DSH_HOME=.dsh-lab / 端口 50599 / 拒绝 3080）+ browser-use 0.13.8（uv venv py3.12 + 本地 chromium）+ 证据在 `.dsh-lab/e2e/` |
| **部署基建** | `scripts/restart-3080.ps1`（会话外重启 + 三项验证 + 回滚提示）；真实 profile 备份 `package.json.bak-20260823191155`；旧连接文件已归档 `.bak` |
| **已知边界** | 5 项非阻塞（§6.1c）+ 2 项记录（UI 表单不一致 §7；keychain→明文 UI 缺口） |
| **未做** | 端口转发（延后）、发布 npm、UI 统一、抛光轮（边界清理）、更名轮（/dsh-ssh 渠道名·错误前缀·状态文件名） |

**下一轮候选**（R1/R2 已全部完成并部署，见 §6.2 行内 ✅）：**抛光轮**（P2 四项：MachineForm 交互守卫与缓存一致性 + F2 提示瞬失 + 已知边界）→ 发布 npm → 端口转发 → 愿景延伸。历史归档见 §3/§4 页签与 [docs/archive/merge-analysis.md](./docs/archive/merge-analysis.md)。

## 1. 项目愿景

DSH 生态中「工作区」相关能力散落在多个社区插件里：远程工作（SSH/SFTP）、
目录选择体验、机器/连接管理、终端、侧边栏文件树、工作区切换……每个插件各自
实现一套连接管理、一套 UI、一套工具集，互相不兼容甚至抢占同一个 UI 槽位。

本项目要做一个**统一的工作区插件**，按「本地大脑、远程手脚、一层配置」的原则：

1. 一个包承载「工作区」的全部职能：本地 + 远程（SSH）、选择/浏览、连接与机器
   管理、镜像与同步、可选的终端/转发/审计；
2. **引擎走 DSH 的能力接缝**（`ctx.subprocess` / `ctx.fs` / 目录选择器 / 工具注册），
   让官方与社区工具零改动地工作在所选工作区上，而不是各插件再造一套工具；
3. 面向模型与 UI 的接口保持窄而稳：一个系统提示注入、一组精简工具、一套配置。

**第一批合并对象**：`dsh-ssh`（UynajGI）+ `dsh-remote`（flymysql）。

---

## 2. 本机部署与数据现状（2026-08 快照）

### 2.1 DSH 与 profile

| 项 | 值 |
|---|---|
| DSH 版本 | `@deepseek-ai/dsh` `0.1.1-rc.1`（npm 全局安装于 `C:\Users\Admin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh`） |
| `$DSH_HOME` | `C:\Users\Admin\.dsh` |
| 使用中的 profile | `~/.dsh/profiles/web`（`pnpm-workspace.yaml`：`nodeLinker: hoisted`、`autoInstallPeers: false`、`allowBuilds: ssh2/cpu-features: false`） |
| profile 注入口 | `package.json` 的 `dsh.profile.bundles` |

### 2.2 当前 bundle 列表（`~/.dsh/profiles/web/package.json`，2026-08-23 实测）

```
@deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app, dsh-find-plugin, dshmarket,
dsh-better-sidebar, dsh-bash-terminal, @nanmicoder/dsh-agent-teams,
@dsh-external/dsh-sidechain, dsh-workspace-enhancement(link:D:/ZCodeProject/…)
```

注意：**dsh-ssh 已不在列表**（曾于 0.3.0-pre 安装，期间被 profile 重管移除）——
新包以纯新增方式装入，无需替换动作。

### 2.3 接缝包（profile `node_modules/@deepseek-ai/`）

`cordis`、`cosmokit`、`dsh-fs`、`dsh-host-directory-picker`、
`dsh-host-directory-picker-native`、`dsh-invariants`、`dsh-native-command`、
`dsh-subprocess`、`dsh-timeout`、`schemastery` —— 即 dsh-ssh 依赖的那一排，
**都在**；dsh-remote 需要的 `dsh-tools` / `dsh-host-webserver` / `dsh-system-prompt`
属于 `dsh-base`/`dsh-web-app` 提供（其 peer 依赖随 host 半生效）。

### 2.4 侧边栏独立安装

`dsh-better-sidebar@0.15.0` 已**独立安装**且独立挂载（bundle 列表里有），
dsh-remote 内嵌侧边栏的「硬依赖 + 自动挂载」策略在这里**必须退避** ——
合并插件不得再捆绑或重复挂载侧边栏。

### 2.5 数据现状（2026-08-23 实测，绝大部分已迁移/归档）

| 路径 | 内容 | 状态 |
|---|---|---|
| `~/.dsh/remote-workspaces/machines.json` | `{list:[c1], currentId:"c1"}`（c1: uuz@127.0.0.1:22, cwd=/home/uuz, auth=key） | ✅ 现役注册表 |
| `~/.dsh/remote-workspaces/known_hosts.json` | `127.0.0.1:22` → `{algo: ssh-ed25519, fingerprint: BC4J1v…}`（TOFU 记录） | ✅ 续用（dsh-remote 时代） |
| `~/.dsh/dsh-ssh-connections.json.bak` | 旧 dsh-ssh 连接文件（c1 原文 264B） | ✅ 已归档 |
| `~/.dsh/dsh-ssh-routes/` | 会话占位目录（R0.5 遗留） | ⚠️ 可清（c1 路由仍兼容） |
| `~/.dsh/remote-workspaces/127.0.0.1-uuz-22/uuz/.dsh-remote-meta.json` | dsh-remote 镜像 meta（镜像已放弃） | ⚠️ 可清 |
| `.dsh-lab/` | 隔离测试实例（50599 当前未运行；e2e 证据、credentials 副本） | 测试台 |
| `~/.dsh/.credentials.yaml` | DSH provider 凭据（本次仅只读引用；key 复用于 lab） | 真实凭据（勿动） |

---

## 3. 历史分析（已归档）

> ⚠️ 本节（原 §3：两插件功能定位与关键差异）及 §4（原合并设计草案）为 2026-08
> 早期分析的历史稿，已整体归档至 [docs/archive/merge-analysis.md](./docs/archive/merge-analysis.md)。
> 此处保留原文供快速比对，**不代表当前设计**——实际交付以 §0 快照、§5 决策、§6 里程碑为准。

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
| UI | 客户端：居中双 tab 选择器（**本机**：原生系统对话框/输入路径 → 普通本地工作区；**远程**：机器下拉 + `/` 预填 + 级联补全 + 「浏览…」浮层回填）；priority -100 填两个 directoryFlow 槽位；dsh-better-sidebar 硬依赖（守卫式挂载，独立安装时退避）遥测 |
| 其它 | 端口转发（ForwardManager）、命令审计日志（auditLog）、任务管理器（TaskManager）、更新检查（updateMode）、编码（iconv-lite）、移植 POSIX 命令（ls/sed/find -exec grep，BSD/GNU 双兼容） |

**局限**：只能单级跳板；无 `~/.ssh/config` 别名解析；无 PTY；agent 必须学会
`rw_*` 工具集（与官方工具平行）；改动远程必须先 `rw_sync`/`rw_push` 或直接
`rw_write_file`（心智模型有两套）；内嵌侧边栏与宿主已装版本有重复挂载风险
（它的守卫专门处理了这个，但仍是包袱）。

### 3.3 关键差异（合并必须消解的冲突）

| 维度 | dsh-ssh | dsh-remote | 合并策略 |
|---|---|---|---|
| 引擎模型 | **接缝 provider**（bash/文件/LSP/终端全透明远程） | 平行 `rw_*` 工具集 + 本地镜像 | **保留接缝引擎（dsh-ssh）**，工具集精简为少量兼容/管理工具 |
| 远程文件操作 | 官方文件工具直接走 SFTP | 自研 `rw_read/write/…` + 镜像同步 | 官方工具为主；`rw_*` 降级为别名/兼容层 |
| 连接管理 | `SshRegistry`（`ssh://` 路由 + `~/.ssh/config` 直达 + 占位目录） | `SshPool` + machines 表 + 设置页 CRUD | 统一注册表：dsh-remote 的机器表为主体，融合 dsh-ssh 的 `~/.ssh/config` 识别与跳板链 |
| 主机校验 | 手工 `knownHosts`（不默认开启） | **TOFU**（默认开启，变化即拒） | **采用 TOFU**（dsh-ssh 的 strictHostKeyChecking 降级为手动档） |
| 跳板 | **多级**（每级独立认证） | 单级 | 多级（dsh-ssh 语义） |
| 工作区落地 | 占位目录（不进 workspace 注册表） | **真实镜像**（进注册表、可同步） | **双模式**：默认「远程原生」（占位/live），可选「镜像」（需要本地副本/同步时） |
| UI 槽位 | 左右分栏（连接侧栏 + 浏览） | 居中双 tab（本机/远程） | **一个**流程：远程 tab = 机器/别名侧栏 + 目录浏览；本机 tab = 原生选择器。设置页负责机器管理 |
| 侧边栏 | 无 | 内嵌（依赖） | 不捆绑，对接独立 `dsh-better-sidebar`（存在即退避） |
| 状态目录 | `dsh-ssh-connections.json` + `dsh-ssh-routes/` | `remote-workspaces/` | 统一到新目录 + 一次性迁移（见 §4.4） |
| 附加能力 | 环境 scrub、UTF-8、spill | 转发、审计、keychain、编码、更新检查 | 按价值取舍：**保留** 转发/审计/keychain/TOFU；编码、更新检查可选；环境 scrub/UTF-8/spill 随引擎保留 |

---

## 4. 合并设计（历史草案，已归档）

> ⚠️ 本节草案已完成其使命：实际交付与其中的部分建议有出入
> （镜像已砍、工具前缀为 `sw_`、转发延后、审计/镜像弃用、双模式未做），
> 完整归档见 [docs/archive/merge-analysis.md](./docs/archive/merge-analysis.md)；
> 此处保留作设计演进对照，最终结论以 §5 决策与 §6 里程碑为准。

### 4.1 总体形态

- **一个 npm 插件包**（命名见 §5.1），宿主半 + 客户端半，结构沿用 dsh-ssh 的
  TS + tsdown 工程：
  - 引擎层（dsh-ssh 移植）：`connection.ts`（多级跳板 + 多认证）、`runtime.ts`
    （`ctx.ssh` 服务）、`subprocess.ts`、`filesystem.ts`、`terminal.ts`、
    `transport.ts`（`ssh://` 路由）、`environment.ts`（scrub）；
  - 机器注册表（dsh-remote 移植 + dsh-ssh 融合）：`registry.ts`（机器 CRUD、
    持久化、TOFU 主机指纹、`~/.ssh/config` 别名解析、keychain 密码、审计）；
  - 通道与工具：`web.ts`（JSON RPC：machines / ls / read / write / task /
    forwards / ssh-config / resolve-mirror / …）+ 精简工具集（见 §4.3）；
  - 客户端：`flow.tsx`（添加工作区）+ `settings.tsx`（机器管理页）。
- **挂载形态**：一行聚合（`name: <pkg>`）+ 可选子路径行；关掉默认
  `dsh-host-directory-picker-auto`（disabled 按 id）；**不挂** dsh-better-sidebar。

### 4.2 工作区双模式（本次合并的核心取舍）

- **模式 A：远程原生（默认）** —— dsh-ssh 式：选机器 + 远程目录 →
  `ssh://` 会话（占位目录兜底 session 服务），`ctx.subprocess` / `ctx.fs`
  全透明远程，模型不需要知道路径是远程的。**不产生本地副本**。
- **模式 B：镜像（按需）** —— dsh-remote 式：显式 `rw_sync`/`rw_push` 或
  设置里开启镜像，本地副本 + `.dsh-remote-meta` → 官方工作区工具可直接用，
  三方冲突感知保留。
- 判定建议：模式 A 能覆盖 90% 用例且零同步心智负担；模式 B 留给需要
  「本地工具链 / 离线改 / 大文件分段」的场景。每个连接记录 `mode`。

### 4.3 工具与提示词精简

- **保留**（管理/连接/状态）：`ws_status`、`ws_connect`、`ws_pick_workspace`、
  `ws_sync`、`ws_push`、`ws_forward`（命名待定；若求兼容可保留 `rw_` 前缀别名）。
- **移除**：`rw_list_dir/read/write/edit/append/mkdir/remove/move/stat/exec/
  search/download/upload` —— 全部由接缝引擎下的官方工具替代（README 明确
  「模型可直接用 bash/文件工具」）。
- 系统提示注入保留并**收紧**：只注入「当前工作区类型（本地/远程/镜像）+
  user@host:path + 可用管理工具」，不再罗列 21 个工具。

### 4.4 数据迁移

首次启动执行一次（幂等）：

1. `dsh-ssh-connections.json` → 机器表：id 重命（`c1` → `m-…`），
   `privateKeyPath` 保留（含 Windows 路径），`jump` → 跳板链，`cwd` →
   默认工作区；旧文件重命名备份（`*.bak`）。
2. `remote-workspaces/known_hosts.json` → 新 TOFU 文件（格式近乎兼容，直接搬）。
3. 镜像目录：读 `.dsh-remote-meta.json` 重建机器→镜像映射；空机器表时保留目录
   不删除，等用户重新认领。
4. `dsh-ssh-routes/` 占位目录：保留（引用方是旧连接 id，迁移后作废 → 清理并
   提示用户重建会话）。

### 4.5 兼容与退避

- 检测到 host 环境已有 `dsh-better-sidebar`（或任何行挂载同名包）→ 跳过侧边栏
  能力，只注册自己的槽位。
- 检测到旧 `dsh-ssh` / `dsh-remote` 行同时挂载 → 文档明确「只能二选一」，
  新包提供 `check` 脚本/启动警告。
- 机器表字段设计上同时接受 dsh-ssh spec 与 dsh-remote rec 的超集。

---

## 5. 决策记录与待定项

**已由用户确认**（2026-08 会话）：

- **包名**：`dsh-workspace-enhancement`（沿用工作区文件夹名，即「工作区增强」）。
- **工具前缀**：`sw_`（例：`sw_status`、`sw_connect`、`sw_pick_workspace`）。
- **二开路线**：以 **dsh-ssh 为 base** 二次开发（保留其接缝引擎，移植 dsh-remote 的
  机器层/TOFU/镜像/转发等，见 [docs/features-breakdown.md](./docs/features-breakdown.md)
  第 4 节映射表）。
- **工程形态**：TS + tsc + tsdown（dsh-ssh 式）。

| # | 问题 | 结论/建议 |
|---|---|---|
| 5.3 | 默认工作区模式 | A 远程原生**默认**（实际交付即模式 A；镜像已砍，见 5.8） |
| 5.5 | 侧边栏 | **只对接**独立安装的 dsh-better-sidebar（宿主已装 0.15.0），不捆绑不重复挂载 —— 实际交付完全未关联侧边栏 |
| 5.6 | 更新检查、审计、编码 | 更新检查**裁掉**；编码未移植（引擎 UTF-8 为主）；审计→见 5.9 |
| 5.7 | 迁移时机 | 首次启动自动（幂等）+ 日志；真实部署经 t10 补丁（空表放行导入）后验证 |
| 5.8 | **镜像/同步** | **完全放弃**（sync/ignore/tasks/mirror 目录逻辑一律未移植；需要时再做开关） |
| 5.9 | **审计日志** | **砍掉**——用户判断会话轨迹已能说明在干什么（工具调用都在对话历史上） |
| 5.10 | 端口转发 | 延后（独立价值但非工作区核心，未移植） |
| 5.11 | UI 一致性 | 已记录不急着改：flow 表单 vs 设置页表单字段不一致（详见 §7「UI 一致性」，统一方案=并集） |

> 注意：将来若包名用 `dsh-workspace-enhancement`，`dsh plugin add` 与 npm 包名
> 须先查 npm 可用性；不可用则退 `dsh-workspace-enhancement` 前端加后缀的方案
> （如 `dsh-workspace-enhancement-x`），决策时一并记录。

---

## 6. 里程碑与路线图

### 6.1 已完成

0. ✅ **工作区初始化**：git init、`.gitignore`、`AGENTS.md`、`CONTEXT.md`（本文档）。
1a. ✅ **R0.5：dsh-ssh 精简版独立落地**（2026-08，AgentTeams 一轮完成；dsh-remote
    功能块未纳入——决策：整体移到下一里程碑）：
    - 按文件摘录+重构移植为新包 `dsh-workspace-enhancement`：删死代码
      （filesystem.ts / filesystem-routed.ts / invariant.ts）、提取 `src/ssh-core.ts`
      （runtime 532→263 / connection 365→176）、`src/listing.ts` 共享 listRemoteLevel
      （picker/web 去重）、hostVerifierFor 单一实现、registry 连接
      strictHostKeyChecking/knownHosts 接线（默认关，修复上游硬编码 false）；
    - 质量门：typecheck 0 错误 / build（tsc+tsdown）成功 / reviewer approve
      （3 条 nit：① dsh-invariants 死依赖已清；② 错误前缀 `dsh-ssh:` 与渠道/状态文件名
      更名留给「更名与迁移」轮；③ terminal.ts `cd` 无 `--` 继承上游）；
    - 验收：`scripts/dev-lab.ps1`（`DSH_HOME=C:\Users\Admin\.dsh-lab`、端口 50599、
      拒绝 3080、不碰 `~/.dsh`）+ browser-use 0.13.8（uv venv py3.12，actor API 免 LLM，
      复用本地 playwright Chromium）E2E **全流程 PASS**：新建连接
      （uuz@127.0.0.1 真实 SSH 测试成功）→ 保存 → 远程浏览 /home/uuz →
      「连接并打开」→ **工作区会话创建成功**（workspace `72336120-…` path
      `dsh-ssh-routes\c1\home\uuz` + session `session-45049714-…`）；
    - 已披露：为消除 lab「添加 API Key」引导，`~/.dsh/.credentials.yaml` 只读复制到
      `.dsh-lab/.credentials.yaml`（用户授权「复用」；真实 home 零改动）；
    - 双对话框叠加 = provider 未就绪态的次生现象，非缺陷（用户理解与上游双槽设计一致）；
    - 证据：`C:\Users\Admin\.dsh-lab\e2e\`（artifacts/v10-01..03、workspace-created.json、
      registry-after-pick.json、e2e-run.log；脚本 5 个）；
    - 遗留建议：最终选目录落在 /home/uuz（.zcode 点击有自动化竞态），
      建议 3080 真实 GUI 人工复核一次 .zcode 精确路径与结尾步。
1b. ✅ **R0.5 部署到真实 3080 实例**（2026-08-23）：`dsh plugin --profile web add
    <repo>` 装入（link 依赖；自动检出 dsh-ssh 已不在 bundles——profile 期间已被
    重管为 9 bundle，无替换动作，其余 8 个 bundle 原样保留）；`--dump-config`
    三行注入 + `c1` 连接数据完好；备份
    `C:\Users\Admin\.dsh\profiles\web\package.json.bak-20260823191155`；写
    `scripts/restart-3080.ps1`（会话外执行：PID 探测/日志/三项验证/回滚提示）；
    重启后运行态验证通过：GET / 200、client.js 注入 200、
    POST /dsh-ssh/connections.list → ok:true（c1：uuz@127.0.0.1:22，auth=key）。
1c. ✅ **R0.6：dsh-remote 最小合并包落地**（2026-08 本轮 AgentTeams 完成）：
    - 并入：TOFU（`src/hostkey.ts`，默认 accept-new，三模式，known_hosts.json 沿用
      dsh-remote 路径格式零迁移）、OS keychain（`src/credential.ts`，Windows DPAPI
      修好 `Add-Type -AssemblyName System.Security` + 加密回退诚实性 encryptFallback
      标记与 UI ⚠ 提示）、machines 注册表融合（`machines.json` 单一真相，c1 保 id
      迁移 + `.bak` 幂等）、3 个 `sw_*` 工具 + 一行系统提示、最小设置页
      （src/client/settings.tsx，settings.section 槽位 order:40）；
    - 全砍：镜像/同步、审计、端口转发（延后）、rw_* 其余 15 个、内嵌侧边栏、
      更新检查、双 tab 选择器、23 个 HTTP 路由（统一 RPC 通道）；
    - 质量历程：t4 needs-fix（keychain 同会话注入 BUG）→ t5 修 + 4 单测；
      t3 E2E 报 B1-B3 → t7 修；B4（DPAPI 不可用→静默明文）→ t9 修（后端真实可用化
      + UI 诚实性）；最终 reviewer approve + tester 增量重验 PASS
      （keychain 整链含真实 sshd 接受）；单测 15/15；
    - 已知边界（记入 docs）：① 设置页无法把 keychain 机器切回明文（与 dsh-remote
      行为一致，无安全风险；API `credentialBackend:'plain'` 可绕过）；② browse.home
      吞连接错误（fallback 返回默认 cwd，真实错误由 browse.list 浮现）；③ 失败连接
      同会话缓存；④ 错误消息含私钥路径（ref 同款）；⑤ registry.test() 不接 keychain；
    - 部署：link 依赖已装，重启 3080 即生效（构建产物 lib/ 已更新）。
1d. ✅ **R0.6 部署到真实 3080 实例**（2026-08-23，二次重启后运行态验证全绿）：
    - 首启发现真实边界：dsh-remote 遗留**空 machines.json** 挡住迁移 → t10 修复
      （空表放行导入 + 3 回归单测）后重启；
    - 最终验证：`machines.list` → c1（currentId=c1, auth=key, credentialBackend=plain）；
      `connections.list` 兼容映射 c1 ✓；`status` → connected=true, workspace=/home/uuz,
      hostKeyMode=**accept-new**（TOFU 全局默认生效，c1 直接受保护）, hostKeyKnown=true,
      指纹 BC4J1v…（dsh-remote 时代记录续用），backend=windows（DPAPI 可用）；
      client.js 133KB 注入 ✓；磁盘 `dsh-ssh-connections.json.bak` 已归档 ✓；
    - 遗留 UI 差异记录（flow 表单 vs 设置页表单，见 §7「UI 一致性」）。
    - 原路线 §6「引擎移植/注册表与 TOFU/工具精简」已分别并入 1a/1c；「统一添加
      工作区流程」「发布」见下方未来轮。

### 6.2 后续轮候选（R1/R2/R3 已完成；以下未开工）

| 轮 | 内容 | 状态 |
|---|---|---|
| **R1 抛光轮** | 5 项已知边界（browse.home 错误透传、keychain→明文 UI、错误消息脱敏、test() 接 keychain、nextId 竞态）+ **更名**（/dsh-ssh→/dsw、`dsh-ssh:`→`dsw:`、dsw-routes 新根+旧树兼容）+ 清理（镜像 meta 目录已删）+ README/docs 更新 | ✅ **完成并已部署 3080**（2026-08-23）：51/51 单测；t6 修 W1（picker 惰性连接，挂载零连接）+ 缺陷2（test 空串未配置）+ 观察项（.secrets 切换清理）；t8 三小修（`~` 展开路径脱敏 / runtime secretValues 补全 / README 占位符）；真实实例验证全绿（/dsw 通道、旧渠道 405、status connected=false=零连接启动、TOFU intact） |
| **R2 UI 统一轮** | ① flow 表单 × 设置页表单并集（认证 tabs + 别名/导入 + HostKey + 加密 + 跳板链）；② **会话栏**：远程工作区与本地不同标识；远程工作区在线状态显示 **未知/活跃/离线**，未知/离线时提供**「重新检测并尝试连接」按钮** | ✅ **完成并已部署 3080**（2026-08-23）：共享 MachineForm（73/73 + 干净 npm ci 复验，approve）；会话栏 🌐+三态徽标+重连（C1 设置页 / C2 flow / C3 会话栏 DOM 增辉）；`/dsw/conn.{status,probe,reconnect}`；F0/F1/F3 全修；运行态 client.js 159KB、零连接语义 |
| **R3 A1 抛光轮** | P2 四项（inflight 端点位键控 / 坏跳板提交阻塞 / 同步 busy 守卫 / upsert undefined=保留·''=清空 + 编辑认证不丢失）+ F2 页面级提示 + C3 同名不误标 + t4 先清后标撤回 + t6 徽标自持循环根治（data-dsw-badge + 零写收敛 + 自诱扫描过滤）+ t8 编辑态跳板可清除（jump:[] 契约）+ ttl 死参清理 | ✅ **完成并已部署 3080**（2026-08-24）：100/100 单测；tester 三轮 E2E（26/26 + churn 0/0 + 跳板正证 9/9）；reviewer approve；运行态 client.js 173KB + conn.status 零连接 |
| **R4 I2+I4（并轨）** | 远程认知 + 真实远程执行：①按会话注入「⚠ 远程 SSH 工作区」提示（全局 section + context.scope→agent→session.header.cwd；本地零噪音）；②**混合 provider**（cordis 同名服务只能注册一次的实锤 → 聚合行成 ctx.subprocess/ctx.fs 唯一实现，worldOfCwd 判定，本地=官方原类委派，远程=SSH 引擎）；③执行适配（远程会话 setSandboxMode('danger-full-access') 官方写路径跳过 Windows 沙箱包装→bash -c 落远端；fs 经 inject 子纤维修 sandboxPolicy 契约；read/glob 分世界 + remoteArgvOf 重写）；④远程覆盖/编辑修复（ext_openssh_rename 原子 + mv -f 回退 + isOwnStagingDirectory 防御，真机 V1→V4 零残留——R0.5 遗留缺陷）；⑤诚实性（sw_status 三行自检；缺 pwsh/rg→工具诚实 127）⑥3080 终端面板经 dsh-bash-terminal→混合门面→远端 bash | ✅ **完成并已部署 3080**（2026-08-25）：134/134 单测；矩阵多轮 E2E（路由→适配→覆盖→策略→诚实性全闭环）；reviewer 终局 approve；运行态 conn.probe active 8ms、status connected、client 173KB、TOFU intact。**已知环境要求**：模型 pwsh 工具需远端装 pwsh；glob 需远端 ripgrep；终端面板（bash）开箱即用 |
| **R5 I3** | 单 session 多工作区 + 焦点 + 逐工作区权限（I4 认知保证已随 R4 达成） | 📋 排期 |
| **R6 I1** | 对话/轨迹区可扩展面板 Tab（better-sidecar 式） | 📋 排期 |
| A3/A4/A5 | 发布 npm / 端口转发 / 顺手清理（旧 dsh-ssh-routes 树人工清理说明） | 排后 |

每个里程碑独立可验：已在**沙箱**（隔离 `$DSH_HOME` + 50599 端口）验证后再部署，
部署后运行 `scripts/restart-3080.ps1` 重启生效。

---

## 7. 风险与开放问题

- **面板终端 seam 化（已决策：不做）**：用户可见的侧栏终端由 dsh-better-sidebar
  提供（`agent-pty` 直连 node-pty 本地 PTY，不经过 `ctx.subprocess` 接缝）——要变 SSH
  终端需改造该插件（spawn 点 seam 化）。**用户决策：暂不处理，且本项目插件保持独立**
  （不 monkey-patch/兜底第三方内部实现；只依赖官方接缝与官方路径）。当前远程终端的
  可用路径 = 模型终端工具（dsh-bash-terminal 经 `ctx.subprocess.spawnTerminal` 已远程）。
- **UI 一致性（已记录，用户要求不急着改）**：两个「连接/机器」创建入口并存且表单字段
  不一致——
  ①「添加工作区」流（继承 dsh-ssh flow/form）：主机名/别名（`~/.ssh/config` 别名识别 +
    「识别 ssh 配置」按钮）、认证方式 tabs（私钥文件/密码）、私钥口令、跳板链（多台）、
    工作目录、测试连接→connections.test / 保存连接；
  ②设置页「远程工作区」（迁移 dsh-remote settings）：名称/主机/端口/用户/密码/私钥路径/
    Passphrase/默认工作区、HostKey 模式 select、加密保存密码 checkbox、从 `~/.ssh/config`
    导入列表、测试连接→machines.test / 保存；
  - **互缺字段**：flow 无 HostKey 模式/加密开关/导入列表；settings 无跳板链/别名识别/
    认证 tabs；
  - **同一实体两套心智**：二者都创建 machines（connections.* 端点已映射 machines），
    但表单结构、字段名（工作目录 vs 默认工作区）、跳板编辑方式完全不同；
  - **统一方向（未来轮）**：flow 复用 settings 表单组件（或反向），字段取并集：
    认证 tabs + 别名/导入 + HostKey 模式 + 加密开关 + 跳板链；或至少双向补齐缺失字段。
- **上游漂移**：两份分析基于下载快照（dsh-ssh main = 0.3.0-pre、dsh-remote 0.8.7），
  合并时须重拉上游复核（README 声称的功能与代码可能已变）。
- **SSH channel 语义**：远端 pid / 前台进程组不可见是 SSH 协议固有，迁移后仍是
  「已知限制」，文档要保留。
- **Windows 路线**：占位目录 + session 服务的组合在 Windows 上已验证（dsh-ssh），
  但镜像模式的路径/权限/换行（iconv-lite）需在 Windows 单独过一遍。
- **模型双重心智**：旧提示词/工具名过渡期可能让模型混淆（远程原生 vs 镜像），
  用 `ws_status` 一次性澄清 + 镜像模式只对明确开启的连接生效。
- **dsh-workspace 注册表**：占位目录方案下官方注册表看不见远程工作区（dsh-ssh
  已知限制）；镜像模式可以看到。若用户需要「远程工作区也出现在侧边栏工作区
  列表」反馈，将推动镜像模式为默认（→ 重开 5.3 决策）。
