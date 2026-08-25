# 特性拆解：dsh-ssh × dsh-remote

> **📌 归档标注（截至 R0.6，2026-08）**：本文件是合并前的特性拆解与精简审计
> 快照，反映的是 **dsh-ssh v0.3.0-pre × dsh-remote v0.8.7 两个上游**的功能面，
> 供取舍与移植对照使用，**不代表当前代码状态**。当前仓库为合并精简后的
> `dsh-workspace-enhancement`：引擎（ctx.ssh/subprocess/fs）+ machines 注册表 +
> TOFU + keychain + 3 个 `sw_*` 工具 + 设置页，渠道统一为 `/dsw`（更名前的
> `/dsh-ssh` 为历史名称；占位目录新根 `dsw-routes`，旧 `dsh-ssh-routes` 仍兼容
> 路由）。正文中「上游 main 有不能过 typecheck 的文件」等表述均为当时快照的
> 历史事实，与当前 main 无关。当前功能与用法以 [../README.zh.md](../README.zh.md)
> 为准，里程碑进度见 [../CONTEXT.md](../CONTEXT.md) §6。
>
> 把两个插件的功能按层拆开：连接 → 进程 → 文件 → 工作区 → 注册表 →
> 界面 → 工具/命令 → 附加。给以 dsh-ssh 为 base 的合并二开做取舍参考。
>
> 源码快照：`dsh-ssh` GitHub main（v0.3.0-pre，TS），`dsh-remote` v0.8.7（纯 ESM JS）。
> 文件路径都是各仓库内的相对路径。

---

## 0. 一句话定位

| 插件 | 定位 | 核心思路 |
|---|---|---|
| **dsh-ssh** | 远程执行引擎 | 接上 DSH 的两条能力接缝（`ctx.subprocess` / `ctx.fs`），官方 bash、文件、终端、LSP 工具不用改就能在远端跑 |
| **dsh-remote** | 远程工作助手 | 不碰接缝。管多机 SSH：选远程目录、建本地镜像、21 个 `rw_*` 工具、SFTP 同步，再加上 TOFU、转发、审计、keychain |

---

## 1. dsh-ssh（UynajGI）功能清单

### 1.1 连接层 — `SshRuntime`（`ctx.ssh`，`runtime.ts` / `connection.ts`）

| # | 特性 | 说明 |
|---|---|---|
| 1.1.1 | 认证：密码 | `password` 字段 |
| 1.1.2 | 认证：私钥（PEM 内容或路径） | `privateKey`：含 `-----BEGIN` 当内容，否则当本地文件读 |
| 1.1.3 | 认证：passphrase | 加密私钥 |
| 1.1.4 | 认证：ssh-agent / Pageant | `agent`：Unix socket 路径，Windows 填 `pageant` |
| 1.1.5 | OpenSSH 缺省私钥回退 | 没配任何认证时，依次试 `~/.ssh/id_ed25519 → id_ecdsa → id_rsa`（和 ssh 客户端一样） |
| 1.1.6 | 多级跳板链 | `jump[]`：direct-tcpip（等价 ProxyJump），每级可单独配 host/port/user/私钥/密码/passphrase/agent/超时；逐级递归建链 |
| 1.1.7 | 跳板默认值下传 | 每级缺的 port/user/超时/保活，继承父级（目标机） |
| 1.1.8 | 连接超时 | `readyTimeout`（默认 45s，照顾慢中继） |
| 1.1.9 | TCP 保活 | `keepaliveInterval`（默认 0=关）/ `keepaliveCountMax`（默认 3） |
| 1.1.10 | 主机校验（手动档） | `strictHostKeyChecking` + `knownHosts[]`：SHA256 指纹或原始 base64 key，不是 TOFU |
| 1.1.11 | 连接复用 | `ctx.ssh` 三个 provider 共用一条链；SFTP 懒开，断线后失效再建 |
| 1.1.12 | 远程环境缓存 | `env -0` 读一次并缓存（随连接生命周期） |
| 1.1.13 | 配置校验 | host/username 必填、port 1..65535、cwd 必须是 POSIX 绝对路径、跳板 host 非空；逐条 fail loud |
| 1.1.14 | 错误重包装 | 连接失败 → `dsh-ssh: cannot connect to "<label>" (user@host): …`（下游好匹配封闭词表） |
| 1.1.15 | 卸载清理 | 卸载时先关目标机再关跳板（逆序），SFTP 一并关掉 |

### 1.2 传输/路由机制 — `transport.ts`

| # | 特性 | 说明 |
|---|---|---|
| 1.2.1 | `ssh://<id>/<path>` 路由 | cwd / 文件 targetKey 都可以是 `ssh://`，解析成注册表连接 + 远程路径 |
| 1.2.2 | 本地占位目录 | `<DSH_HOME>/dsh-ssh-routes/<id>/<path>`；`session.route` 创建，客户端拿它过 `sessions.create`（绕开 session 服务本地 `mkdir` 限制）；两种拼写落到同一连接 |
| 1.2.3 | 目标 key 编码 | 文件 targetKey = `ssh://<id>/<path>` 或占位路径，`parseSshTargetKey` 两边都能认 |
| 1.2.4 | cwd 重定向规则 | POSIX 绝对路径直接当远程路径；Windows 盘符 / UNC / 相对路径 → 落到连接默认 cwd |
| 1.2.5 | 传输抽象 | `SshTransport` 接口（endpoint/cwd/getClient/getSftp/getRemoteEnvironment/exec/resolveRemoteCwd）：`ctx.ssh` 和注册表连接走同一套契约 |

### 1.3 进程层 — `subprocess.ts` / `process.ts` / `terminal.ts` / `output.ts`

| # | 特性 | 说明 |
|---|---|---|
| 1.3.1 | `ctx.subprocess` 远程 provider | `SshSubprocessRuntime extends SubprocessRuntime`，语义对齐官方 |
| 1.3.2 | 输出模式：collect | 内存 tail 上限 + 可选本地 spill 文件（0700 私有目录，随机名，`wx` 创建防符号链接攻击）；溢出时 spill 全量；超 spill 上限就丢掉 spill |
| 1.3.3 | 输出模式：pipe | PassThrough 流 |
| 1.3.4 | 输出模式：inherit | 直连宿主 stdout/stderr |
| 1.3.5 | stdin：pipe / 批量写入 | PassThrough，或一次性 `data` 对象 |
| 1.3.6 | `resolveExecutable` | 远程 `command -v` / `test -x` 解析，校验绝对路径，结果归一成绝对路径 |
| 1.3.7 | PTY 终端 | `spawnTerminal`：`client.shell` 分配 xterm-256color，写入 `cd && exec env -i … argv` 替换登录 shell |
| 1.3.8 | 终止语义 | TERM → graceMs 后 KILL（SSH channel signal）；退出码/信号以 channel close 为准（远端事实为准） |
| 1.3.9 | `waitForExit` / 结束回调 | 对齐 seam 的 promise 契约 |
| 1.3.10 | 环境 scrub + `env -i` | 远端登录环境剔掉 `DSH_*` 和凭据形变量（`SENSITIVE_ENV_PATTERN`），显式 env 覆盖（`undefined` 当墓碑删除），`env -i --` 启动，保留 PATH/HOME |
| 1.3.11 | 命令拼接 | `shq` 单引号转义（`'` → `'"'"'`）；`wrapCwd` = `cd -- '<cwd>' && …` |
| 1.3.12 | UTF-8 安全 | exec 输出整段 buffer 后再 decode（避免 SSH 分包切断多字节字符） |
| 1.3.13 | 已知限制 | `pid` 恒为 -1；`inspectForeground` / `signalForeground` 不可用（SSH 协议本身限制） |
| 1.3.14 | 卸载清理 | 卸载时终止全部 live 句柄和终端（waitForExit 后再删） |

### 1.4 文件层 — `filesystem.ts`（`ctx.fs` 远程 provider，SFTP）

| # | 特性 | 说明 |
|---|---|---|
| 1.4.1 | `resolve` | 远程 `realpath -mz … \| base64 -w0` 取规范路径（NUL 帧校验、UTF-8 校验），targetKey=规范路径 |
| 1.4.2 | `stat` / `lstat` | type（file/directory/symlink/other）+ size + version（sha256(path,size,mtime,mode)） |
| 1.4.3 | `readText` / `readBytes`(限量) | 文本：前 8KB 含 NUL → `FS_NOT_TEXT`；`TextDecoder(utf-8, fatal)`；字节流带 maxBytes 上限 |
| 1.4.4 | `streamText` | SFTP 流式解码（带 binary 采样），配合官方大文件读取 |
| 1.4.5 | `listDir` | SFTP readdir，逐项 realpath 规范化，排序；区分目录和软链 |
| 1.4.6 | `writeText`（原子写） | 同目录 staging + 临时文件 + chmod（保留原 mode 或 600）→ `sftp.rename` 原子替换；`createIfAbsent` 用 `ln -T` 做无覆盖创建（防 TOCTOU） |
| 1.4.7 | `editText` | 字面量 old/new + CRLF 归一化/还原（detectCrlf）；保留原来的行尾风格 |
| 1.4.8 | 写意图 | `createIfAbsent` / `replaceIfVersion`（`FS_NOT_OBSERVED` / `FS_STALE_VERSION`） |
| 1.4.9 | 并发串行化 | 写操作按 targetKey 加锁 |
| 1.4.10 | 错误映射 | SFTP/exec 错误 → `FS_NOT_FOUND / FS_PERMISSION_DENIED / FS_IO_ERROR / FS_NOT_TEXT / FS_TOO_LARGE / FS_STALE_VERSION …` |
| 1.4.11 | 文件 URL | `file://` + 逐段 encodeURIComponent |

### 1.5 注册表 — `registry.ts`（`sshRegistry` 服务）

| # | 特性 | 说明 |
|---|---|---|
| 1.5.1 | 多连接持久化 | `<DSH_HOME>/dsh-ssh-connections.json`（`{connections:[…]}`，含密码/私钥路径明文，按设计如此） |
| 1.5.2 | id 规则 | `c1, c2, …`（加载时按最大数字续号） |
| 1.5.3 | `~/.ssh/config` 解析 | 手写 parser：Host/HostName/User/Port/IdentityFile/ProxyJump；支持通配块匹配（`*` 前缀/精确）、递归解析跳板（深度 ≤ 8） |
| 1.5.4 | 精确别名清单 | `listConfigHosts()`：只列不含 `*?!` 的精确别名，带 user@host:port、有无 IdentityFile / ProxyJump 标记 |
| 1.5.5 | `resolveSshConfig(host)` | 别名 → 完整生效配置（含跳板链） |
| 1.5.6 | `test(input)` | 临时建链跑 `true`，不入库 |
| 1.5.7 | 视图脱密 | `SshConnectionView`：无密码/私钥，标注 `auth: password|key|agent`、`jumpHosts[]` |
| 1.5.8 | 删除清理 | remove 时清掉该连接的占位目录树 |
| 1.5.9 | 损坏容错 | 状态文件缺失/损坏 → 空表 + warn |

### 1.6 RPC 通道 — `web.ts`（`/dsh-ssh`，loopback）

| 端点 | 功能 |
|---|---|
| `connections.list` | 连接列表（脱密视图） |
| `config.hosts` | 重读 `~/.ssh/config` 精确别名（每次打开都刷新） |
| `connections.resolve` | 解析别名 → 完整配置（含跳板） |
| `connections.add` | 校验/入库/持久化（返回 id + 视图） |
| `connections.remove` | 删除 + 清占位目录 |
| `connections.test` | 连接测试（fail 映射为 `connection-failed`） |
| `browse.home` | 远端 HOME（登录环境 HOME，缺则用 spec cwd） |
| `browse.list` | 单层目录浏览：面包屑 + 目录条目 + hidden 标记 + `truncated`（maxEntries 默认 1000）；软链指向目录可进入 |
| `browse.mkdir` | 远端建一层目录（拒绝 `.` / `..` / 含斜杠名、拒绝已存在） |
| `session.route` | 远程路径 → 本地占位目录（mkdir），返回 `{cwd}` |
| `local.pickNative` | 宿主 OS 原生文件夹选择器（`pickNativeDirectory`） |
| 错误契约 | 封闭错误词表：`bad-request` / `connection-failed` / `internal`（client 好做判别联合） |

### 1.7 客户端 UI（`src/client/`：flow.tsx 1077 行 / form.tsx 550 行 / icons / ui）

| # | 特性 | 说明 |
|---|---|---|
| 1.7.1 | 槽位注入 | `conversation.hero.workspace.directoryFlow` + `sidebar.workspaces.directoryFlow` 双槽位（`slots.inject` 嵌套，事务式注册） |
| 1.7.2 | 界面形态 | VS Code Remote Explorer 风格：左栏连接列表（SSH 配置主机 / 已保存连接 / 本机目录）+ 右栏目录浏览器（面包屑 + 列表 + 新建目录） |
| 1.7.3 | `~/.ssh/config` 主机直达 | 点别名 → 解析 → 自动进注册表并打开目录浏览（免填表）；没配 User → 打开预填表单；没配 IdentityFile → 报错，并给「补全认证」入口 |
| 1.7.4 | 新建连接表单 | 主机字段优先当别名（失焦/粘贴自动解析预填）；密码/私钥/passphrase/agent/跳板链（可增删）；摘要行显示解析结果 |
| 1.7.5 | 本机目录 | 走宿主 `workspaces.listDirectory`（directoryPicker browse）+ 原生系统选择器按钮 |
| 1.7.6 | 提交工作区 | 远程目录 → `session.route` 拿占位 cwd → `sessions.create` |
| 1.7.7 | 目录排他 | 只显示目录和可进入的软链；隐藏文件打标记 |

### 1.8 picker（`picker.ts`，`ctx.directoryPicker` browse 后端）

| # | 特性 | 说明 |
|---|---|---|
| 1.8.1 | 本机/远程统一后端 | 实现 directory-picker 接缝 browse；`maxEntries`（默认 1000）截断 |
| 1.8.2 | 挂载方式 | `dsh-ssh/picker` 独立行；要先 `disabled: true` 关掉官方 `-auto` 行（补丁 name 是校验字段） |

### 1.9 工程形态

TS + `tsc`（类型检查）+ `tsdown`（打包）；`exports` 六个子路径（`./ssh` `./subprocess` `./fs` `./picker` `./web` `./client`）；`dsh.client.inject` 五个包（connection/runtime/ui-conversation/ui-sidebar/ui-workspace）；Node ≥ 22。

---

## 2. dsh-remote（flymysql）功能清单

### 2.1 连接层 — `SshPool`（`index.js`）

| # | 特性 | 说明 |
|---|---|---|
| 2.1.1 | 认证：密码 / 私钥路径 / passphrase / agent / keyboard-interactive | `useAgent`（读 `SSH_AUTH_SOCK`）/ `keyboardInteractive`（复用配置密码走 MFA） |
| 2.1.2 | 单级跳板 | `proxy`（一个 bastion，经它 `forwardOut` 到目标；跳板本身是嵌套 SshPool） |
| 2.1.3 | TOFU 主机指纹 | `hostKeyMode`: `accept-new`（默认）/ `verify`（拒陌生主机）/ `off`；指纹 = sha256(blob) base64，存 `known_hosts.json`；密钥一变立刻拒连；`forgetHost()` 可重置 |
| 2.1.4 | OS keychain 密码 | 按机器开关：macOS `security`、Windows DPAPI（`.secrets/*.bin`，CurrentUser）、Linux `secret-tool`；best-effort，失败回退明文 |
| 2.1.5 | epoch 防串线 | 切换目标/断开时令牌递增，落后连接直接废弃（不会连到旧主机） |
| 2.1.6 | 连接参数 | `connectTimeoutMs`（默认 15s）、`keepaliveInterval: 15000` / `keepaliveCountMax: 3`（固定） |
| 2.1.7 | 单执行器 | 同时只绑一台「当前机」，`setTarget` 会关掉旧连接 |
| 2.1.8 | 密码懒解析 | `passwordResolver`：先查明文，没有再查 keychain |

### 2.2 机器注册表

| # | 特性 | 说明 |
|---|---|---|
| 2.2.1 | 持久化 | `$DSH_HOME/remote-workspaces/machines.json`：`{list:[…], currentId}` |
| 2.2.2 | 字段 | name/host/port/username/password/privateKeyPath/passphrase/workspace/hostKeyMode/useAgent/keyboardInteractive/proxy/credentialBackend/recentWorkspaces[8] |
| 2.2.3 | 当前机来源优先级 | 临时连接（`rw_connect save:false`）> `currentId` > CLI config 默认机 |
| 2.2.4 | 配置默认机 | cordis.yml `config: {host, port, username, privateKeyPath, workspace}`（host 空 = 断开） |
| 2.2.5 | 机器备份 | 更新密码时旧密码留作兜底（`rec.password || machines[i].password`） |
| 2.2.6 | 脱敏视图 | `sanitizeMachine`：去掉 password / proxy.password，只回 `passwordSet` 布尔 |

### 2.3 工作区（镜像模式）

| # | 特性 | 说明 |
|---|---|---|
| 2.3.1 | 镜像目录规则 | `<DSH_HOME>/remote-workspaces/<host>-<user>-<port>/<basename>`；同机另一远程路径撞同名 basename 时追加短 hash |
| 2.3.2 | 镜像元数据 | `.dsh-remote-meta.json`：`{host, port, username, remotePath, createdAt}` |
| 2.3.3 | 工作区持久化 | `persistWorkspace`：写 `rec.workspace` + `recentWorkspaces`（最近 8 个） |
| 2.3.4 | resolve-mirror 路由 | 本地路径/会话 id → 远程路径：先查内存 session header，再查历史 session 日志（jsonl / .gz / 多帧 zstd 首帧），最后落到机器默认工作区 |
| 2.3.5 | 旧数据迁移 | pre-0.6 `~/.dsh/remote-workspaces` → `$DSH_HOME/remote-workspaces`（只在未显式设 DSH_HOME 时执行；rename，EXDEV 则拷贝） |
| 2.3.6 | 会话 cwd 识别 | 侧边栏用 index≥0 判断镜像内的会话 cwd |

### 2.4 同步（`sync.js`，三方冲突感知）

| # | 特性 | 说明 |
|---|---|---|
| 2.4.1 | 三方冲突算法 | 快照 `relPath → {size, mtime}`（`.dsh-remote-sync-state.json`）为 S，比较远端 R / 本地 L / S：R==S&&L==S 跳过；R≠S&&L==S 拉/推；R==S&&L≠S 拉=冲突、推=正常；R≠S&&L≠S&&R==L 跳过；R≠S&&L≠S&&R≠L 冲突（不静默覆盖） |
| 2.4.2 | `force` / `dryRun` | force 把冲突当覆盖；dryRun 只算计划 |
| 2.4.3 | 边界 | `maxDepth`（默认 5，夹 1..8）、`maxFiles`（默认 500，夹 1..2000）、`maxFileBytes`（默认 50MB，0=不限）、并发 4 |
| 2.4.4 | ignore 规则 | gitignore 语法（`compileIgnore`），默认排除 `.git/ node_modules/ target/ dist/ build/ .venv/ __pycache__/ …`，可加 `.dsh-remote-ignore` |
| 2.4.5 | mtime 对齐 | 拉后本地 mtime=远端 mtime；推后本地 mtime=远端服务器赋值（维持 L==R==S） |
| 2.4.6 | stale 统计 | 拉：远端已删的留在本地并计数；推：本地已删的留在远端并计数（真删要显式 `rw_remove`） |
| 2.4.7 | autoPush | 镜像目录 watcher（防抖）+ `pushOneFile`（单文件三方守卫），默认关 |
| 2.4.8 | 后台任务 | `async:true` → TaskManager，`/dsh-remote/task?id=` 查进度 |

### 2.5 模型工具（20 个，全部 `rw_` 前缀）

| 工具 | 一句话 |
|---|---|
| `rw_info` | 当前机/工作区/连接健康/转发/主机指纹状态 + ping |
| `rw_connect` | 连主机（可保存或临时）；连完还要 `pick_workspace` |
| `rw_pick_workspace` | 设远程工作区根（校验存在）+ 建本地镜像 + 启 autoPush |
| `rw_list_dir` | 列远程目录（类型/大小/UTC mtime），默认工作区 |
| `rw_stat` | 单路径 stat（size/mtime/mode） |
| `rw_read_file` | 按行读文本（startLine/endLine/maxLines/encoding，含 gbk 等） |
| `rw_write_file` | 创建/覆盖远程文件（自动建父目录） |
| `rw_edit` | 文本替换（old→new，可 replaceAll） |
| `rw_append` | 远程文件追加 |
| `rw_mkdir` | 远程建目录（递归） |
| `rw_remove` | 远程删除（目录递归） |
| `rw_move` | 远程重命名/移动 |
| `rw_exec` | 远程执行（默认在工作区，可 cwd=，可 async） |
| `rw_search` | 移植式递归 grep（glob、maxDepth 12/500 匹配，BSD/GNU 通用） |
| `rw_download` | 单文件拉进镜像 |
| `rw_upload` | 单文件推回远端 |
| `rw_sync` | 整树拉取（三方冲突，见 2.4） |
| `rw_push` | 整树回推（三方冲突） |
| `rw_forward` | 端口转发（local/reverse） |
| `rw_disconnect` | 断开，机器保留 |
| 系统提示 | 每次注入当前 `user@host:/path`，并提示用 `rw_*` 操作 |

### 2.6 斜杠命令（3 个）

`/remote`（状态速览）、`/remote-forget-key`（重置 TOFU）、`/remote-ignore`（看 ignore 规则和文件位置）。

### 2.7 JSON 路由（23 个，`/dsh-remote/*`）

`status` `resolve-mirror` `connect` `ls` `read`（文本/二进制头 + 截断） `write`（乐观锁：expectedMtime 不符回 409） `fs`（mkdir/rename/remove/write/append/download） `workspace`（设工作区+镜像） `mirror`（同 workspace） `local-pick`（原生选择器：osascript/zenity→kdialog/PowerShell FolderBrowser） `local-list` `local-mkdir` `machines`（CRUD+current） `test-connect`（测延迟） `current` `forget-key` `forwards` `task`/`tasks` `audit` `ssh-config`（导入列表） `home` `update-check/update-apply/update-mode`。

### 2.8 客户端 UI（`client.js`，React.createElement 风格）

| # | 特性 | 说明 |
|---|---|---|
| 2.8.1 | 设置页 | `settings.section`（priority 40）：「远程工作区」机器列表（增/删/改/设当前/测连）+ 表单（密码不回显；高级折叠：私钥/Passphrase/默认工作区/hostKeyMode/agent/keyboard-interactive/proxy/keychain）+ 从 `~/.ssh/config` 导入 |
| 2.8.2 | 转发管理 | local/reverse 隧道增删 + autoStart + 状态 |
| 2.8.3 | 审计 | audit.log 最近 30 条 |
| 2.8.4 | 更新检查 | 对比 npm latest；自动/手动/关三模式（`update-mode` 文件） |
| 2.8.5 | 双 tab 工作区选择器 | 两个 directoryFlow 槽位（priority -100）：本机 tab（系统选择器/输入路径）→ 普通本地工作区；远程 tab（机器下拉 + `/` 预填 + 实时目录补全/级联 + 「浏览…」浮层回填）→ 镜像工作区 |
| 2.8.6 | 侧边栏文件树 | 依赖 `dsh-better-sidebar`（硬依赖 + 守卫式挂载：别处已挂则退避）；远程文件树 + 查看器（读写走项目路由） |

### 2.9 附加设施

| 设施 | 说明 |
|---|---|
| 审计日志 | exec/write/mkdir/remove/connect 追加到 `remote-workspaces/audit.log`（`auditLog` 开关） |
| TaskManager | 后台任务（sync/push/exec）的注册/进度/取消 |
| 编码 | `iconv-lite`：读写 utf-8/gbk 等（`encoding` 全局默认） |
| 错误分类器 | `classifyError`：SSH/SFTP 错误 → 中文可读提示（认证失败/密钥权限/TOFU 变更等） |
| 路径工具 | `shq`、`normalizeRemotePath`、`mkdirRemoteDirs`、`shortHash`、`truncate` 等 |
| 更新检查 | npm registry `/latest`；auto 模式定时轮询（≥1min）；tarball 内自更新（写包目录） |
| 工程 | 纯 ESM（无编译）；`node --test`；`check.mjs`（命令名正则等静态闸门）；`dev-run.sh` 沙箱 |

---

## 3. 重叠与冲突（两边都有）

| 功能 | dsh-ssh | dsh-remote | 冲突点 |
|---|---|---|---|
| SSH 认证 | 密码/私钥(PEM/路径)/passphrase/agent/Pageant/缺省私钥 | 密码/私钥路径/passphrase/agent/keyboard-interactive | dsh-ssh 更全（PEM 内容、Pageant、缺省回退） |
| 跳板 | 多级链（每级独立认证） | 单级 proxy | dsh-ssh 胜 |
| `~/.ssh/config` | 深度解析（通配、递归跳板、精确别名直达） | 轻量导入（只读 Host 块，导入表单） | dsh-ssh 胜 |
| 主机校验 | 手动 knownHosts（默认关） | TOFU（默认开） | dsh-remote 胜（安全默认更好） |
| 多机管理 | 连接注册表 + picker 侧栏 | machines 表 + 设置页 | dsh-remote 更完整（CRUD+当前机+keychain+测试） |
| 远程文件操作 | 官方工具走 SFTP（版本/意图/原子写） | 自研 rw_* + 路由（语义更简） | dsh-ssh 胜（不用另学一套工具） |
| 远程命令 | 官方 bash（collect/pipe/inherit/PTY） | `rw_exec` 单命令 | dsh-ssh 胜 |
| 工作区落地 | 占位目录（不进 workspace 注册表） | 真实镜像（进注册表、可同步） | 互补：默认 A，可选 B |
| 添加工作区 UI | 左右分栏（连接侧栏+浏览） | 双 tab（本机/远程）+ 设置页 | 同一个槽位，不能并存 |
| 状态目录 | `dsh-ssh-connections.json`、`dsh-ssh-routes/` | `remote-workspaces/`（machines/known_hosts/mirrors/forwards/audit） | 要统一并做迁移（见 CONTEXT.md §4.4） |
| 侧边栏 | 无 | 内嵌 dsh-better-sidebar | 宿主已装 0.15.0 → 只对接 |

---

## 4. 合并映射（dsh-ssh 为 base）

图例：✅ 直接继承 / 🔀 改造 / ➕ 从 dsh-remote 移植 / ✂️ 砍掉 / ⏸ 可选项

| 面 | 决策 |
|---|---|
| 连接引擎 | ✅ `connection/runtime/transport`（1.1/1.2 全部） |
| 进程/文件 provider | ✅ 1.3/1.4 全部；PTY 保留 |
| 跳板 | ✅ 多级链（替换 dsh-remote 单级 proxy） |
| 主机校验 | 🔀 `strictHostKeyChecking` 留作手动档；默认改成 TOFU（➕ 移植 `hostkey.js` + `known_hosts.json`，三模式可配） |
| 密码存储 | ➕ `credential.js`（keychain 按机器开关，失败回退明文） |
| 多机注册表 | 🔀 合并：dsh-ssh 的 `sshRegistry` 扩成 machines 表形态（➕ recentWorkspaces/当前机/默认机），`ssh://<id>` 继续当路由键 |
| `~/.ssh/config` | ✅ 深度解析保留（跳板递归、精确别名、直达注册） |
| 添加工作区 UI | 🔀 以 dsh-ssh 左右分栏为底，补上 dsh-remote 的本机/远程 tab 和设置页入口；两套 UI 不各留一份 |
| 镜像/同步 | ➕ `sync.js`（三方冲突）作按需模式 B（`sw_sync`/`sw_push`/autoPush/ignore）；兼容 `.dsh-remote-meta` |
| 工具集 | 🔀 20 个 `rw_*` → `sw_` 前缀约 6 个：`sw_status` `sw_connect` `sw_pick_workspace` `sw_sync` `sw_push` `sw_forward`；其余 list/read/write/edit/exec/search/mkdir/remove/move/stat/download/upload/append/disconnect 交给接缝引擎下的官方工具 |
| 端口转发 | ➕ `forwards.js`（local/reverse + autoStart） |
| 审计 | ➕ `audit` 覆盖 exec/文件写/连接 |
| 斜杠命令 | ➕ `/remote` 系 3 个改成 `sw` 命名（状态/忘指纹/ignore） |
| 忽略规则 | ➕ `ignore.js`（gitignore 语法 + 默认集）给同步用 |
| 侧边栏 | ✂️ 不捆绑、不对接 dsh-better-sidebar（宿主已有） |
| 更新检查 | ✂️ 砍掉（轮询 npm registry，收益不值噪音和风险） |
| 编码 | ⏸ `iconv-lite` 留作配置项（gbk 等）；默认 utf-8 |
| 本机原生选择器 | ✅ `pickNativeDirectory`（dsh-ssh 已有）；dsh-remote 的 osascript/zenity 兜底作 POSIX 桌面回退 ⏸ |
| 状态目录 | 🔀 统一 `<DSH_HOME>/<新目录>/`（machines.json + known_hosts.json + forwards.json + audit.log + mirrors + sync-state）；一次性迁移 dsh-remote 的 `remote-workspaces/` 和 dsh-ssh 的 `dsh-ssh-connections.json` |
| 已知限制继承 | ⚠️ `pid=-1`、无前台进程组、占位目录不进 workspace 注册表（镜像模式可绕开） |

---

## 5. 附：dsh-ssh 自身可精简审计（src 共 4617 行）

| 类别 | 对象 | 行数 | 结论 |
|---|---|---|---|
| **死代码** | `filesystem.ts` | 497 | 无人 import（只有 final 被 index/plugin 引用）→ 删 |
| **死代码（且坏的）** | `filesystem-routed.ts` | 521 | 无人 import，且 `listDir` 内 `const remotePath` **重复声明**（295/297 行）→ 无法通过 `tsc`；是未完成半成品 → 删（final 是它的修正版） |
| **半死代码** | `invariant.ts` | 31 | 无内部引用，仅 exports 子路径暴露；合并后可删 |
| **重复实现** | `runtime.ts` ↔ `connection.ts` | ~200 | `toConnectConfig` / `connectReady` / `forwardThrough` / `hostVerifierFor` / channel-exec / `readRemoteEnvironment` / 多跳链 open 几乎逐行重复，且已开始漂移（connection 多了 `rewrapConnectError`/`readIdentityFile` 的 `~` 展开/agent 回退；runtime 多了 strict 布线）→ 提取 `ssh-core.ts` 基座 |
| **重复实现** | `picker.listRemote` ↔ `web.listRemote` | ~120 | 同语义（SFTP readdir、仅目录、软链跟随、crumbs、maxEntries+truncated）两处实现 → 共享一个 `listRemoteLevel(transport,path,limit)` |
| **结构冗余** | 双连接主人 | runtime ~200 | `ctx.ssh`（config 型聚合占位）与 `SshConnection`（注册表 spec 型）并存；合并后机器表为唯一真相，默认传输=当前机器连接 → 只留一个类，`ssh://<id>` 仅作多机路由 |
| **结构冗余** | 配置面 | — | `strictHostKeyChecking`+`knownHosts`（手动指纹）→ 并入 TOFU 的 `accept-new/verify/off`；`privateKey`(PEM 或路径) 与 `privateKeyPath`(仅路径) 双字段 → 统一 |
| **客户端** | `flow.tsx`+`form.tsx`+`icons`+`ui` | ~1900 | 别名自动解析/预填表单等逻辑在设置页（dsh-remote 式机器 CRUD）接管后可压缩 ~1/3 |
| **不可砍** | `output.ts` 溢出收集、`environment` scrub、registry 的 ssh-config 解析、原子写/版本锁定语义、web 错误词表 | — | 都是接缝契约/安全边界，保留 |

**净效果估算**：仅删死代码 + 内部去重，dsh-ssh 从 ~6600 行（.ts 4617 + client ~1900）→ **~4200-4500 行**（约 -30%），功能零损失；再叠加合并期的「单连接主人 + TOFU 化配置」，可再挤出几百行。合入 dsh-remote 机器层/镜像/转发后，比「两插件相加」至少省 ~35-40%。

> ⚠️ 审计发现上游 main（0.3.0-pre）存在**不能过 typecheck** 的文件（filesystem-routed 重复 const），
> 说明主分支处于重构中间态——二开时**不要整库照搬**，按「按文件摘录 + 自行重构」方式移植，
> 并对照 npm 稳定版（0.2.0）与最新 GitHub main 的差异。
