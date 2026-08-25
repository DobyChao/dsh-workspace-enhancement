# dsh-workspace-enhancement

[English](README.md) | 中文

<p align="center">
  <img src="https://img.shields.io/npm/v/dsh-workspace-enhancement" alt="npm 版本">
  <img src="https://img.shields.io/npm/l/dsh-workspace-enhancement" alt="许可证">
  <img src="https://img.shields.io/badge/node-%3E%3D22-339933" alt="Node 版本">
  <img src="https://img.shields.io/github/actions/workflow/status/UynajGI/dsh-workspace-enhancement/ci.yml?label=CI" alt="CI 状态">
  <img src="https://img.shields.io/github/stars/UynajGI/dsh-workspace-enhancement" alt="GitHub Stars">
  <img src="https://img.shields.io/badge/dsh-plugin-2ea44f" alt="dsh-plugin">
</p>

**[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 SSH 远程开发插件**。一个包回答「工作区从哪里来、在哪里、如何被操作」：远程执行引擎（Bash / 文件工具 / PTY 终端 / LSP 走同一条 SSH 连接，支持多级 ProxyJump 跳板链）、多机注册表（machines 表、TOFU 主机指纹、OS 钥匙串密码、`~/.ssh/config` 识别）与 Web UI（添加工作区侧栏 + 目录浏览、机器设置页），配 3 个 `sw_*` 模型工具用于定位与连接。基于 [ssh2](https://github.com/mscdex/ssh2)。

> 由 dsh-plugin 生态的两款 SSH 插件（dsh-ssh 引擎 + dsh-remote 工作区助手）合并精简而来——对外渠道已统一为 `/dsw` 命名。已通过真实跳板环境（双跳、密钥认证、SFTP 读写）端到端验证。

## 包含什么

| 层 | 交付 |
|---|---|
| 引擎 | `ctx.subprocess` + `ctx.fs` 远程 provider 共享一条 SSH 链；跳板、SFTP 原子写、PTY、环境 scrub |
| 注册表 | `<DSH_HOME>/remote-workspaces/machines.json` 机器表（`{list, currentId}`）、`ssh://<id>/<path>` 路由、`~/.ssh/config` 别名识别 |
| 安全 | TOFU 主机指纹（`remote-workspaces/known_hosts.json`，`accept-new`/`verify`/`off`）、按机器的 OS 钥匙串密码（Windows DPAPI / macOS `security` / Linux secret-tool）、错误消息凭据脱敏 |
| Web UI | 添加工作区流程（连接侧栏 + 远程目录浏览）、机器设置页（增删改 / 测试 / 设当前 / 忘指纹）、`~/.ssh/config` 导入 |
| 工具 | `sw_status`（定位 + ping）、`sw_connect`（连接/临时连接）、`sw_pick_workspace`（设远程工作区根） |

## 架构：本地大脑，远程手脚

```
你的本机 (deepseek-harness)                    远程主机
┌───────────────────────────────────┐   SSH   ┌──────────────────────┐
│ agent loop（模型编排、会话、日志） │◄────────►│  bash / 命令执行      │
│ LLM API 调用（本机直连，不出网）   │ exec    │  文件系统 (SFTP)      │
│ 凭证 / 配置 / 会话状态             │ pty     │  PTY 交互终端         │
│ ctx.subprocess → dsh-workspace-enhancement          │ sftp    │  LSP / git / 编译     │
│ ctx.fs → dsh-workspace-enhancement                  │         │                      │
└───────────────────────────────────┘         └──────────────────────┘
```

**不需要把 dsh 部署到远程。** dsh-workspace-enhancement 实现 deepseek-harness 两个能力缝隙（capability seam）的远程 provider——`ctx.subprocess`（远程进程）与 `ctx.fs`（远程文件）。框架里所有消费这两个缝隙的工具（bash、文件读写、终端、LSP、子代理进程）**零改动**自动切到远端执行：模型在本地思考，命令在远程跑，结果回传本地进模型上下文。

## 安装

```sh
# 本地检出安装（当前开发流程——插件尚未发布 npm）：
dsh plugin --profile web add <本仓库路径>

# 未来（npm 发布后）：
# dsh plugin --profile web add dsh-workspace-enhancement
```

宿主加载器导入的是 `lib/` 编译产物；从源码安装前先 `npm run build`。

## 快速开始（cordis.yml）

**一行挂载全部**——共享连接 + 两个远程 provider：

```yaml
- id: ssh-remote
  name: dsh-workspace-enhancement
  config:
    host: server.example.com  # 目标主机（必填；也可用 ~/.ssh/config 别名，如 prod）
    port: 22
    username: root            # 必填
    privateKey: ~/.ssh/id_ed25519   # 私钥文件路径，或直接写 PEM 内容
    # password: 'xxx'               # 密码认证（可与 privateKey 并存）
    # agent: 'pageant'              # Windows Pageant；Unix 填 SSH_AUTH_SOCK 路径
    cwd: /root/workspace           # 远程工作目录（必填，绝对 POSIX 路径）
    # --- 跳板链（可选，按序：先连第一个跳板，最后连目标）---
    jump:
      - host: bastion.example.com
        # port: 22             # 缺省跟随目标机
        # username: ubuntu     # 缺省跟随目标机
        privateKey: ~/.ssh/id_ed25519
      # - host: 第二级跳板 ...
    # --- 连接与安全 ---
    readyTimeout: 45000        # 等价 ConnectTimeout（毫秒，默认 45s，中继链路常见慢握手）
    keepaliveInterval: 0       # 等价 ServerAliveInterval（毫秒，0 禁用）
    keepaliveCountMax: 3       # 等价 ServerAliveCountMax
    strictHostKeyChecking: false   # true 时校验主机指纹
    knownHosts:                    # strictHostKeyChecking: true 时必填
      - 'SHA256:xxxxxxxx...'
```

聚合行等价于三个子路径行——只有需要单独组合 provider 时才分开挂载：

```yaml
- id: ssh
  name: dsh-workspace-enhancement/ssh            # ctx.ssh 连接（上面的 config）
- id: subprocess-ssh
  name: dsh-workspace-enhancement/subprocess     # ctx.subprocess 远程 provider
- id: fs-ssh
  name: dsh-workspace-enhancement/fs             # ctx.fs 远程 provider（SFTP）
```

## 机器注册表（多机）

Web 通道行（`dsh-workspace-enhancement/web`）挂载注册表与 `/dsw` RPC 通道；Web 包里的机器管理在设置页（设置 → 远程工作区）与添加工作区侧栏。

- **持久化**：`<DSH_HOME>/remote-workspaces/machines.json`——`{ list: [...], currentId }`；机器 id 为 `c1, c2, …`（分配后不复用）；每台机器可设 `workspace`（默认远程目录）与 `recentWorkspaces`（最近 8 个）。
- **TOFU 主机指纹**：默认首次连接记录主机密钥到 `remote-workspaces/known_hosts.json`，之后密钥变化**直接拒连**（`accept-new`）；`verify` 对未知主机直接拒绝；`off` 关闭校验（不推荐）。忘记录在设置页或 `hostkey.forget` 端点。
- **钥匙串密码**：按机器勾选「加密保存密码」把密码存入 OS 存储——Windows DPAPI（`remote-workspaces/.secrets/*.bin`）、macOS `security`、Linux `secret-tool`；否则明文存 machines.json。尽力而为：OS 后端失败时回退明文，并在 UI 以 **⚠ 标记诚实提示**（不静默降级）。测试 keychain 机器会按真实连接同一路径解析存储的密钥。
- **`~/.ssh/config`**：侧栏列出精确 Host 别名（通配符隐藏），从配置导入时带解析后的 user/port/私钥/跳板；表单同样别名优先（失焦/粘贴自动解析）。
- **模型工具**：`sw_status`（当前机、工作区、连通 ping、主机指纹状态、密码后端）、`sw_connect`（连接并可保存，`save:false` = 临时）、`sw_pick_workspace`（校验并持久化远程工作区根）。
- **`/dsw` RPC 端点**：`connections.*`（旧式单连接列表）、`machines.*`（list / add / remove / test / setCurrent）、`config.hosts`、`hostkey.forget`、`status`、`browse.home` / `browse.list` / `browse.mkdir`、`session.route`、`local.pickNative`。

### 机器字段（machines.add）

`id`（upsert）、`label`/`name`、`host`（必填）、`port`、`username`、`password`、`privateKeyPath`、`passphrase`、`agent`、`jump[]`、`cwd`/`workspace`、`hostKeyMode`、`credentialBackend: plain|keychain|windows|secret`、`encryptPassword`，另有兼容字段 `strictHostKeyChecking`/`knownHosts`。

## 界面上的「添加工作区」走 SSH（Web GUI）

Web 界面的**添加工作区**流程（对话首屏的工作区选择器、侧边栏的工作区浏览）
由 dsh-workspace-enhancement 的客户端 UI 接管，布局为**左侧连接侧栏 + 右侧目录浏览**（VS Code
Remote Explorer 式）：侧栏依次列出「SSH 配置主机」「已保存连接」和「本机目录」，
右侧是与当前选中目标对应的目录浏览器。本机列表继续走 `ctx.directoryPicker`
的 `browse` 能力；远程列表、连接管理与远程目录浏览走 dsh-workspace-enhancement 自己的
`/dsw` RPC 通道。浏览本机时，工具栏还有「**系统选择器**」按钮（`local.pickNative`
端点，复用宿主的 OS 原生文件夹对话框）——弹窗里选中的目录直接成为工作区，
不必在列表里逐层点开。

### `~/.ssh/config` 主机直达（`config.hosts`）

侧栏的「SSH 配置主机」分区由 `config.hosts` 端点驱动：每次打开对话框都会
**重新读取**宿主机的 `~/.ssh/config`，列出其中的**精确 Host 别名**（通配符
模式如 `*.example.com` 不列出），每个条目带解析出的 `user@host:port`、是否
配置 IdentityFile、是否有 ProxyJump：

- 点击一个别名：解析其完整配置（用户名、端口、私钥、跳板链）→ **自动注册
  进连接注册表并直接进入该主机的目录浏览**，免表单（VS Code Remote-SSH 式）；
  已注册过的别名标「已添加」，点击直接切换。
- 别名未配置 `User`：不自动注册，而是打开**预填好的表单**（端口 / 私钥 /
  跳板已填入），只需补用户名。
- 别名未配置 `IdentityFile`：可以注册，但连接会在认证处失败——右栏会把
  `All configured authentication methods failed` 翻译成可读提示，并提供
  「补全认证」按钮打开预填表单。

「新建连接」表单本身也是别名优先：主机字段填 `~/.ssh/config` 别名，失焦或
粘贴时自动解析预填（「识别 ssh 配置」按钮保留为兜底），解析成功后表单内会
显示一行摘要（别名 → user@host:port、私钥路径、跳板链）。

选中远程目录后，客户端先经 `/dsw` 的 `session.route` 拿到一个**本地占位
目录**（`<DSH_HOME>/dsw-routes/<连接id>/<远程路径>`，宿主侧自动创建），
再用它创建会话：

```ts
const { cwd } = await rpc('session.route', { id: connectionId, path: remotePath })
ctx.sessions.create({ cwd })
```

之所以绕这一步：宿主的 session 服务会用 `node:fs` 对项目目录做本地
`mkdir`，`ssh://…` 形式的 cwd 过不了这一关；而 `mkdir` 对已存在的目录静默
成功。`ctx.subprocess` 与 `ctx.fs` 同时识别 `ssh://<id>/<path>` 与这个本地
占位前缀，把该会话的 bash / 文件 / 终端操作路由到对应注册连接的对应目录。
远程会话不会写入 DSH 本地 workspace 注册表（见「已知限制」）；删除连接时会
一并清掉它的占位目录树。

> 占位目录说明：更名前的会话占位在 `<DSH_HOME>/dsh-ssh-routes/…`。新根为
> `dsw-routes/`；**旧树仍保持可路由**（兼容层），存量会话 cwd 不会失效。
> 旧树的清理是人工、运维自管的步骤——确认无活跃会话引用后再做。

挂载三行：聚合 provider 行 + 本机/远程目录 browse 后端 + 连接注册表与 RPC
通道。补丁层的 `name` 是**校验字段**（名字对不上会跳过整条补丁，不是替换），
所以要用 `disabled` 按 id 关掉 Web 包默认挂载的
`@deepseek-ai/dsh-host-directory-picker-auto` 行（它动态挂载的界面随之
消失）。在 Web profile（`$DSH_HOME/profiles/web/cordis.patch.yml`）中：

```yaml
# 关闭启动时自动选择的 picker（它动态挂载的界面一起消失）
- id: directory-picker
  name: '@deepseek-ai/dsh-host-directory-picker-auto'
  disabled: true

- insert:
    - id: ssh-remote
      name: dsh-workspace-enhancement
      config: { ...同快速开始的 config... }

    # 本机目录 browse 后端（dsh-workspace-enhancement 客户端会注册两个 directoryFlow 槽位）
    - id: directory-picker-ssh
      name: dsh-workspace-enhancement/picker
      config:
        maxEntries: 1000

    # 多连接注册表 + /dsw RPC（连接持久化与远程目录浏览）
    - id: ssh-web-channel
      name: dsh-workspace-enhancement/web
      config:
        maxEntries: 1000
```

远程会话打开后，bash / 文件 / 终端工具都跑在所选连接的 `ssh://` 路径上。

### 选择器配置（`dsh-workspace-enhancement/picker`）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `maxEntries` | number | 1000 | 单层目录行数上限（隐藏行计入；超出时 `truncated` 标记截断） |
| `remoteLabel` | string | — | 保留字段：当前客户端流程不再使用钉住入口，远程入口在左侧连接侧栏里 |

`dsh-workspace-enhancement/picker` 现在只承担 `ctx.directoryPicker` 的 browse 后端（Windows 上
本机目录照常可用，POSIX 绝对路径走聚合 SSH 连接）。客户端 UI 的远程连接
列表与目录浏览改走 `dsh-workspace-enhancement/web` 的 RPC。

## 配置参考（`dsh-workspace-enhancement/ssh`）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `host` | string | — | 目标主机（必填） |
| `port` | number | 22 | 目标 SSH 端口 |
| `username` | string | — | 登录用户（必填） |
| `password` | string | — | 密码认证 |
| `privateKey` | string | — | PEM 私钥内容或本地私钥文件路径 |
| `passphrase` | string | — | 加密私钥的密码 |
| `agent` | string | — | ssh-agent socket 路径或 `pageant` |
| `jump` | JumpConfig[] | `[]` | 跳板链，每级可独立配 port/username/认证 |
| `cwd` | string | — | 远程工作目录（必填，绝对 POSIX 路径） |
| `readyTimeout` | number | 45000 | 连接超时（毫秒） |
| `keepaliveInterval` | number | 0 | SSH 层保活间隔（毫秒） |
| `keepaliveCountMax` | number | 3 | 保活失败判定次数 |
| `strictHostKeyChecking` | boolean | false | 是否校验主机指纹 |
| `knownHosts` | string[] | `[]` | 信任的主机指纹（`SHA256:…`）或原始 base64 公钥 |

### OpenSSH `~/.ssh/config` 映射

| OpenSSH 配置 | dsh-workspace-enhancement 字段 |
|---|---|
| `HostName` / `Port` / `User` | `host` / `port` / `username` |
| `IdentityFile` / `IdentitiesOnly` | `privateKey`（路径或 PEM） |
| `PasswordAuthentication` | `password` |
| `ForwardAgent` | `agent` |
| `ProxyJump`（逗号分隔多级） | `jump` 数组（逐级） |
| `ConnectTimeout` | `readyTimeout` |
| `ServerAliveInterval` / `ServerAliveCountMax` | `keepaliveInterval` / `keepaliveCountMax` |
| `StrictHostKeyChecking` + `UserKnownHostsFile` | `strictHostKeyChecking` + `knownHosts` |
| `RemoteCommand` / `RequestTTY` | 见 `spawnTerminal`（PTY 由消费者请求） |

## 能力

| 能力 | 实现 |
|---|---|
| 跳板链 | `jump` 数组，多级跳板（direct-tcpip，等价 OpenSSH `ProxyJump`），每级独立认证 |
| 认证 | 密码、私钥（PEM 内容或路径）、passphrase、ssh-agent / Pageant；全部未配置时回退 `~/.ssh` 默认私钥（id_ed25519 / id_ecdsa / id_rsa，等价 OpenSSH 行为） |
| 多机注册表 | machines 表（`machines.json`）、`ssh://<id>/<path>` 路由、每机 workspace + recentWorkspaces、`~/.ssh/config` 别名识别 |
| 主机校验 | TOFU 默认（`accept-new` / `verify` / `off`，`known_hosts.json`，密钥变化拒连）；兼容 `strictHostKeyChecking` + `knownHosts` 手动档 |
| 密码存储 | 按机器 OS 钥匙串（Windows DPAPI / macOS `security` / Linux secret-tool），尽力而为 + 明文回退诚实标记；错误消息对凭据值脱敏 |
| 近端上传 | SFTP 原子写（同目录临时文件 + rename，保留原 mode） |
| 远端下载 | fs provider 全套：read / streamText（流式解码）/ readBytes（限量）/ listDir / stat / lstat |
| 远程命令 | subprocess provider：collect（tail 保留 + 本地 spill 文件）、pipe、inherit、批量 stdin |
| 交互终端 | PTY（`spawnTerminal`），输入输出 + TERM→KILL 清理 |
| 添加工作区 GUI | `dsh-workspace-enhancement/picker`：directory-picker 接缝的 `browse` 后端；客户端 UI 为左侧连接侧栏（`~/.ssh/config` 主机直达 + 已保存连接 + 本机）、右侧目录浏览 |
| 机器管理 UI | 设置页（设置 → 远程工作区）：增删改、设当前、测试连接、忘记指纹、`~/.ssh/config` 导入 |
| 模型工具 | `sw_status`、`sw_connect`、`sw_pick_workspace`（定位 / 连接 / 选工作区） |
| 环境隔离 | 远端登录环境 scrub（剔除 `DSH_*` 与凭据形变量）+ 显式 env 覆盖，`env -i` 启动 |
| 并发安全 | fs 写操作按 targetKey 串行化（防并发写同一文件） |

## 迁移与旧数据

插件有意复用 dsh-remote 时代的路径并归档 dsh-ssh 时代的文件：

- **从旧插件升级**——先卸载旧插件行：`dsh plugin --profile web remove dsh-ssh` 和/或 `dsh plugin --profile web remove dsh-remote`（旧的 SSH 插件不能与本插件并存挂载；profile 管理器只重管它注册过的行，用 `dsh plugin add/remove` 本仓库路径即可干净替换）。数据无需手工迁移——见下。
- **`$DSH_HOME/remote-workspaces/`** 不变（dsh-remote 路径）：`machines.json`（机器表）、`known_hosts.json`（TOFU 信任记录）、`.secrets/`（DPAPI 加密密码——**保留**）。废弃的**镜像目录**（`$DSH_HOME/remote-workspaces/<host>-<user>-<port>/…`，只含 `.dsh-remote-meta.json`）属于被砍掉的同步功能遗留，可删除。
- **`<DSH_HOME>/dsh-ssh-connections.json`**——首次运行、machines.json 不存在或为空时，旧 dsh-ssh 连接文件被原样导入（id 保留，`ssh://c1/…` 继续可用），文件名改为 `dsh-ssh-connections.json.bak` 归档。`.bak` 是旧含密码文件的唯一归档。
- **`<DSH_HOME>/dsh-ssh-routes/`**——旧会话占位，**保留不清**（它们是存量远程会话的 cwd 承载，删除会破坏会话 resume/继续）；仍经兼容层路由（见上方占位目录说明）。确认无任何会话引用后可手动删除。
- **RPC 通道**——`/dsh-ssh` → `/dsw`；错误/日志前缀 `dsh-ssh:` → `dsw:`。端点名不变，旧客户端接线只需改通道字符串。

## 性能

- **连接复用**：三个 provider 共享一个 SSH 连接（含跳板链）；SFTP 通道懒打开、复用，断线自动失效重建。
- **环境缓存**：远程登录环境只读一次并缓存（`env -0` 一次开销），每次 spawn 不再重复探测。
- **输出本地 spill**：collect 模式的内存 tail + 本地 spill 文件，与官方本地 provider 同语义。
- **零轮询**：spawn 一条 exec 通道完成命令（`cd && exec env -i -- …`），无轮询、无中间状态文件。

## 可靠性

- **退出事实权威**：exit code / signal 来自 SSH channel close 事件（真实远端进程事实）。
- **UTF-8 安全**：exec 输出整段 buffer 后统一解码，SSH 分包不会损坏多字节字符。
- **失败即报错**：连接失败、认证失败、跳板失败、SFTP 错误都 fail loud，携带可读信息；`browse.home` 报告连接失败而非返回假 home。
- **清理兜底**：插件卸载时终止全部活动进程/终端并关闭连接；临时文件（staging dir、spill）随写失败清理。

## 故障排查

| 症状 | 原因与处理 |
|---|---|
| `All configured authentication methods failed` | 认证配置错误：核对 username / privateKey 路径 / passphrase；私钥权限过宽（chmod 600） |
| `Cannot read private key` | `privateKey` 不是 PEM 内容且文件路径不存在 |
| 跳板连接超时 | 检查跳板 host/port 可达性、`readyTimeout`；跳板机的 User/认证单独核对 |
| `Host key verification failed` | TOFU `verify` 档或 `strictHostKeyChecking: true` 且无匹配信任记录；`ssh-keyscan` 取指纹 / 忘记已记录密钥 |
| exec 返回 127 | 远程命令不存在；确认远程 PATH（scrubbed 环境保留远端 PATH） |
| 写文件报 `FS_NOT_OBSERVED` | 文件已存在且用了 `createIfAbsent`（防覆盖语义，非 bug） |
| keychain 机器测试/连接报空密码 | OS 存储查找失败（尽力而为）：在设置表单重新录入密码（钥匙串或明文） |

## 已知限制

- **远端 pid 不可见**：SSH channel 不暴露远端 pid，`SubprocessHandle.pid` 恒为 `-1`。
- **终止不保证进程树**：`terminate` 通过 channel 信号（SIGTERM → grace → SIGKILL）作用于远程直接进程，不保证覆盖其子进程树（SSH 协议固有，与本地 provider 的进程组语义有差距）。
- **终端前台进程组**：`inspectForeground` 返回 `undefined`，`signalForeground` 不可用（SSH channel 无法解析远端前台进程组）。
- **单连接不重连**：连接断开后需重启插件；失败的连接在连接生命周期内缓存（重试需重建连接）。
- **远程执行的 shell 与 rg（⑧⑨）**：终端/命令工具在远端用 `bash`（POSIX）或 `pwsh` 依远端安装情况运行——Windows 宿主上 `tool-bash` 按官方 preset 的 `process.platform == 'win32'` 条件默认禁用（宿主组合/preset 层决定，本包不覆盖），因此远程会话建议远端安装 bash 或 pwsh 其一；`sw_status` 会探测远端 `bash`/`pwsh`/`rg` 的存在并一行列出缺失项。glob/搜索工具需要远端安装 ripgrep（`rg`）——缺失时工具诚实报 127，提示安装后重试；本包不做本地式 find/grep 降级（保证 glob 语义与官方工具一致）。
- **远程目录以会话落地**：多连接界面选中远程目录后，经 `session.route` 取本地占位目录并 `session.create({ cwd })` 打开远程会话（占位目录形如 `<DSH_HOME>/dsw-routes/<id>/<path>`，会话列表里 cwd 显示的就是它；更名前的 `dsh-ssh-routes/<id>/<path>` 仍可路由）；它不会在 DSH 的本地 workspace 注册表里创建 workspace 记录（`dsh-workspace` 仍只接受本地 `fs.realpath` 目录）。
- **POSIX 主机上选择器仅远程**：任何绝对路径都是远程路径，本机文件系统无法与远程共用选择器（Windows 主机通过盘符/UNC 路由两者共存）。
- **`streamText` 仅文本**：二进制文件抛 `FS_NOT_TEXT`（与官方 provider 一致）。

## 开发

```sh
npm i
npm run typecheck
npm run build       # 产出 lib/ —— harness 加载器实际导入的编译产物
npm test            # node --test 回归套件
```

- **Git hooks**（husky）：`pre-commit` 跑 typecheck；`commit-msg` 强制 [Conventional Commits](https://www.conventionalcommits.org/)；`pre-push` 拒绝与 `package.json` 版本不一致的版本 tag。
- **CI**（GitHub Actions）：每次 push/PR 跑 typecheck + 发布载荷检查。
- **发布**（GitHub Actions）：推送版本 tag 自动发布 npm 并生成 GitHub Release：

```sh
npm version patch -m "chore(release): v%s"   # 改版本 + 提交 + 打 tag 一步完成
git push origin main && git push origin --tags
```

tag 必须与 `package.json` 的 `version` 字段一致（本地 hook 与 release workflow 双重强制）。发布使用仓库的 `NPM_TOKEN` secret（npm **Automation token**，CI 发布可绕过 2FA）。

## License

MIT
