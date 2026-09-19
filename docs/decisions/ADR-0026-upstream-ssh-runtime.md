# ADR-0026: 上游官方 SSH 运行时（0.1.6-alpha.1）事实与我方定位

- 状态: proposed（**事实已核实**；§5 定位待所有者拍板）
- 日期: 2026-09-16
- 范围: 上游新发的 SSH provider 家族、其远端 helper 部署模型、由此暴露的哨兵盲区，
  以及 `UPSTREAM-5` 收口时的实现注意
- 关联: 承接 **UPSTREAM-5**（接缝加宽的收口；实现注意见 §4）；派生出 **UPSTREAM-6**
  （定位拍板 + 新包巡检）。与 **ADR-0002** **无血缘**——那里二开的 `dsh-ssh` 是**社区包**
  （UynajGI，0.3.0-pre），与官方 `@deepseek-ai/dsh-ssh` 仅重名。我方远端路线仍认
  **ADR-0021**（会话级机器连接）/ **ADR-0022** / **ADR-0024**（核心线协议）

## 0. 结论

1. 2026-09-15 上游在 `0.1.6-alpha.1` **首发**整套 POSIX SSH provider 家族。四个包在 npm 上
   **此前不存在任何版本**（唯一版本 = `0.1.6-alpha.1`）：`@deepseek-ai/dsh-ssh`（OpenSSH 连接 +
   远端 helper）、`dsh-fs-ssh`、`dsh-subprocess-ssh`、`dsh-sandbox-ssh`。
   即**官方自建了 SSH 工作区通道**。
2. **`UPSTREAM-5` 与这批包是同一件事**：`@deepseek-ai/dsh-subprocess@0.1.6-alpha.1` 同批加宽的四个
   成员 （`control` / `terminalType` / `resize` / `terminalEnvironment`）正是为远端 provider 铺路的
   **通用抽象**，不是针对我方的私有约定——对我们反而有利（对齐官方抽象，好过逆向私有扩展）。
3. 今天它**不构成功能替代**：宿主**硬拒非 POSIX**（`dsh-ssh@0.1.6-alpha.1` `lib/index.js:46`）、
   Web 面未接、一 profile 一别名、要求远端**预装** helper + 整棵依赖 + SHA-256 pin、
   无重连/重放/自动供给。
4. **哨兵看不见它**：`upstream.yml` 只装固定的 seam 家族清单，新包不在清单里 ⇒ 通道"绿"
   并不等于"上游没做新东西"。这是本次真正的流程缺口（→ `UPSTREAM-6`）。

## 1. 事实

### 1.1 包族（registry `versions` / `dist-tags` / `time.created`，2026-09-16 核）

| 包 | 描述（原文） | 版本 | 首发（UTC） |
|---|---|---|---|
| `@deepseek-ai/dsh-ssh` | Shared OpenSSH connection and versioned POSIX remote helper | 仅 `0.1.6-alpha.1` | 2026-09-15T03:25:06Z |
| `@deepseek-ai/dsh-fs-ssh` | Filesystem provider over the shared POSIX SSH helper | 仅 `0.1.6-alpha.1` | 2026-09-15T03:25:10Z |
| `@deepseek-ai/dsh-sandbox-ssh` | Remote POSIX sandbox argv provider over the shared SSH helper | 仅 `0.1.6-alpha.1` | 2026-09-15T03:25:34Z |
| `@deepseek-ai/dsh-subprocess-ssh` | Subprocess and terminal provider over the shared POSIX SSH helper | 仅 `0.1.6-alpha.1` | 2026-09-15T03:26:10Z |

四者的 `dist-tags` 都只有 `alpha` 与 `latest` 指向同一个 `0.1.6-alpha.1`；**没有** 0.1.5 及以前版本，
也没有 `next`（rc）版本。上游 `@deepseek-ai/dsh` CLI 与 `dsh-base` 的依赖里**都没有**这四个包
（默认组合仍装 `dsh-fs-local` / `dsh-subprocess-local`）⇒ 它们是**自定义 profile 的 opt-in 能力**，
不是默认装配。

> **2026-09-18 修订**：四包现已各发 **`0.1.6-alpha.2`**（`npm view` 核实），上游在持续推进；
> 这正是 §5「哨兵盲区处置」想要的信号形态。本 ADR 其余行号仍属 alpha.1 解包产物；
> alpha.2 的增量diff未做（无收口需要，`UPSTREAM-5` 动 pin 时再补）。

### 1.2 同批接缝加宽（这就是 `UPSTREAM-5`）

`@deepseek-ai/dsh-subprocess@0.1.6-alpha.1` 相对 `0.1.5-rc.2` 的差异（解包 `lib/types/*.d.ts` 比对）：

| 变化 | 签名 | 我方失配点 |
|---|---|---|
| 新增 | `SubprocessHandle.control: Duplex \| undefined`（必填属性，允许 `undefined`） | `src/core-process.ts:47` `CoreSubprocessHandle` |
| 新增 | `SubprocessStdio.control?: 'pipe'` + 新模块 `lib/control.js`（`SUBPROCESS_CONTROL_FD = 7`、`SUBPROCESS_CONTROL_ENV = "DSH_SUBPROCESS_CONTROL"`、`openInheritedControlChannel()`） | 同上（继承型 fd 7，本地 launcher↔子进程协议） |
| 新增（必填） | `SubprocessTerminalSpawnSpec.terminalType: string` | `src/terminal.ts:28` `SshTerminalHandle` 的 spawn 路径（现硬编码 `term: 'xterm-256color'`，`src/terminal.ts:134`） |
| 新增 | `SubprocessTerminalHandle.resize(cols, rows): Promise<void>` | 同上（我们无 resize） |
| 新增（抽象成员） | `SubprocessRuntime.terminalEnvironment(signal?): Promise<SubprocessTerminalEnvironment>`（`{ platform: 'posix' \| 'windows'; defaultShell?: string }`） | `src/subprocess.ts:338` `SshSubprocessRuntime` |

`drift (alpha)` 的 typecheck 红**全部**来自这张表；`upstream.yml` 的 rc 通道（现 `next` = `0.1.5-rc.2`）
不红，因为它还没有这些成员。

> **证据**：`drift (alpha)` run 34950619028、issue #7；上表我方行号属 master `e96284a`
> （行号不是契约，只在该快照内有效）。本次是 `INFRA-14` 修好哨兵装机缺陷后**首次现形的真信号**，
> 不是旧假警报。

> **重名提醒**：上游 `dsh-subprocess-ssh@0.1.6-alpha.1` 的类**也叫**
> `SshSubprocessRuntime`（`lib/types/index.d.ts:5`），与我方 `src/subprocess.ts:338` 同名但无关系。
> 引用时**必须带包名 + 版本**，否则会读成同一件事（`docs/compatibility.md` §5.3 的引用纪律）。

### 1.3 解包核实的实现细节（引用均带「包 + 版本 + 符号/文件」）

| 事实 | 证据（`dsh-ssh@0.1.6-alpha.1` 解包产物） |
|---|---|
| 宿主必须是 POSIX | `lib/index.js:46`：`process.platform !== 'linux' && !== 'darwin'` → 抛 `SSH runtime requires a POSIX client` |
| 启动远端 helper 的 argv | `lib/index.js:288-313`（`ssh -T -M -S … -o ControlPersist=no -o BatchMode=yes -o StrictHostKeyChecking=yes -o ForwardAgent=no -o ClearAllForwardings=yes -o ServerAliveInterval=10 -o ServerAliveCountMax=3 <alias> '<remote-node>' --disable-sigusr1 '<remote-helper>'`） |
| 摘要校验 | `lib/index.js:343`：`hello.hash !== config.helperHash` → 抛 `SSH helper digest differs from the configured artifact` |
| 逐流转发 | `lib/index.js:124-131`：`ssh -O forward -o ExitOnForwardFailure=yes -L <local-socket>:<remote-socket>`，再 `createConnection({ path })` |
| helper 复用官方 local 实现 | `lib/helper.js:12-20`：import `dsh-fs-sandbox` / `dsh-subprocess-local` / `dsh-sandbox-local` / `dsh-sandbox-policy` / `dsh-session-projection` |
| 平台/成熟度限制 | `dsh-ssh@0.1.6-alpha.1` README「Known Limitations」：No Windows endpoint / automatic provisioning / reconnect or replay；Web workspace UI paths still assume host filesystem access |

## 2. 官方部署模型：「远端预装 Node helper」是什么

一句话：**helper 是一个跑在远端机器上的 Node 程序**，是把官方自己的本地 fs/subprocess/sandbox 实现
「搬」到远端的那半边；宿主侧 `SshConnection` 只负责连接、校验与转发。

1. **产物形态**：`dsh-ssh` 的 `./helper` 出口 = `lib/helper.js`（826 行）。部署方把它放到远端某绝对路径，
   并在配置里给出远端 node 绝对路径 + helper 路径 + helper 的 **SHA-256**（`host` / `node` / `helper` /
   `helperHash` / `workspace` 五个必填字段）。
2. **启动**：宿主用 §1.3 的 ssh argv 把 helper 作为远端命令拉起；helper 的 **stdin/stdout 就是分帧
   JSON-RPC 控制通道**，`-M/-S` 是 OpenSSH 连接多路复用（后续所有流共用这条 master）。
3. **握手**：客户端发 `hello{protocol:1, workspace, leaseMs, bootstrapPath?}`，helper 回自己的摘要
   `hash` + 私有 socket 根目录 `root`；客户端比对 `helperHash`，不一致**拒绝连接**。
   `--disable-sigusr1` 防止同用户信号打开它的 Node debugger。
4. **数据面**：helper 在远端 `0700` 私有目录为每个流起 Unix socket + TLS 服务器，每条流的 256-bit PSK
   只经管理 RPC 下发；客户端逐流 `-L` 转发后本地连过去。**不是**把进程输出塞进主通道。
5. **远端要有整棵依赖**：helper import 的是官方 local 包（§1.3 末行）⇒ 远端需装好
   `dsh-fs-sandbox` / `dsh-subprocess-local` / `dsh-sandbox-local` / `dsh-sandbox-policy` 等，
   README 要求它们位于**工作区与可写临时目录之外**（否则等于把可执行文件放进模型可写目录，
   摘要校验也不构成安全保障）。
6. **生命周期**：心跳租约 `leaseMs`（默认 30s，3s–600s）；SSH EOF / 信号 / 租约过期 → helper 自己清理
   远端受管进程；连接断开后**不重连、不重放**，客户端无法确认远端结果。PTC 另需一对
   `bootstrapPath` + `bootstrapHash`。

**对比我方**：我们走 `ssh2` 协议直连远端的 shell/SFTP（`src/transport.ts`），**远端零预装**；
只有开启「沙箱围栏档」时才从设置页往远端 `core.deploy` 部署一个核心，且目前限 **linux x86_64**
（Windows / 非 amd64 在 workspace-write 下会拒绝，见 `docs/architecture.md` §4 第 4 条）。
⇒「免远端安装」本身就是差异点；官方 helper 模式在**远端没有 node、或不允许在远端放运行时**的环境里
根本用不了。

## 3. 与我们的差异（今天的口径）

| 维度 | 官方 SSH 家族（`0.1.6-alpha.1`） | 本插件 |
|---|---|---|
| 宿主平台 | **仅 Linux/macOS**（硬编码拒绝其它平台） | Windows 为主战场 |
| 远端前置 | 预装 node + helper + 整棵依赖 + SHA-256 pin | 零预装（`ssh2` 直连）；围栏档才需部署核心 |
| 机群模型 | 一 profile 一 OpenSSH 别名 = 一个远端世界 | 机器注册表 + `ssh://<id>/` 路由（注册表级，`ADR-0021`） |
| 认证 | 交予既有 OpenSSH 配置（`BatchMode` + 严格 host key，无交互流程） | 插件内注册表 + OS 钥匙串 + TOFU 主机指纹 |
| 工作面 | headless / 自定义 profile；**Web 路径仍假设宿主文件系统** | 浏览器面板、目录选择、审批门（`ADR-0020`）、状态点 |
| 成熟度 | 只有 `alpha.1` 一版，无重连/重放/自动供给 | 已发布 `v0.1.4`；`0.1.6` 兼容待收口（`UPSTREAM-5`） |

## 4. `UPSTREAM-5` 收口注意（实现前必读）

1. **按官方签名补齐，不自造扩展。** 四处加宽都是**对等抽象**；除"补必填成员"外不要引入私有变体。
2. **`control` 是必填属性、允许 `undefined`。** 我们走 ssh2，没有"继承型 fd 7"端点 ⇒
   `CoreSubprocessHandle` 与 SSH 侧 handle 都**显式声明** `readonly control = undefined`，
   并在代码注释里写明「本 provider 不提供继承型控制通道」。不要为了"看起来对齐"硬造一条控制流。
3. **`terminalEnvironment` 必须报远端事实。** 语义是「**本 provider 执行世界**的 shell 选择事实」；
   SSH provider 要经连接探测 + 缓存给远端 `platform` / `defaultShell`，**绝不回落 `process.platform`**；
   断链 / `dispose` 后要能重算。枚举只有 `'posix' | 'windows'`——我方支持 Windows 远端，
   需要自己的映射与 `defaultShell` 来源，别照抄只支持 POSIX 的上游实现。
4. **`terminalType` 转正。** `src/terminal.ts:134` 现在硬编码 `term: 'xterm-256color'`，必须改成转发
   `spec.terminalType`（TERM 由消费者决定）。这是**行为变化**，要有单测钉住默认值来源。
5. **`resize(cols, rows)` 与 ssh2 参数顺序相反。** `ClientChannel.setWindow(rows, cols, height, width)`；
   接口是 `(cols, rows)` ⇒ **必须换序**（本项最易写错）。退出后语义与 `write` 一致（拒绝或幂等）。
6. **两个 handle 都要过。** `CoreSubprocessHandle`（`src/core-process.ts:47`）同样
   `implements SubprocessHandle`，别只修 SSH 面。
7. **升 pin 的前置条件。** 家族升级要整体走（peer 带 `-rc.`、dev 同步；闸门 #6 要求每个声明家族在
   `upstream.yml` 里有通道）。`0.1.6` 还在 **alpha** 时**不要**改 pin；等 `^0.1.6-rc.1`（或正式版）
   出现且 `next` 通道真的解析到它，再连 boot smoke 一起切。
8. **顺手看一眼新包。** 每次 alpha 红/绿都按 §6 的命令 `npm view` 一下 scope 新增包——
   `UPSTREAM-5` 的"绿"只证明接缝兼容，**不证明上游没换赛道**（本次就是例证）。

## 5. 我方定位与哨兵盲区（待拍板）

> **2026-09-18 补充（调查事实，替选项拍板供料；由 BUG-9 调查带出）**
>
> **两头门槛是独立的，都要过才算可用**：
>
> | | 宿主（跑 DSH 的机器） | 远端（被连机器） |
> |---|---|---|
> | 官方 `dsh-ssh` | **硬卡 POSIX**：`lib/index.js:46`（alpha.2 同）`process.platform !== linux/darwin` 即抛 `SSH runtime requires a POSIX client`。根因是结构性的：连接模型依赖 OpenSSH ControlMaster（`ssh -T -M -S`）与 Unix socket 本地转发（`ssh -O forward -L <socket-path>`），两者在 Windows OpenSSH 上**不存在** | 预装 node + helper + 整棵依赖 + SHA-256 pin |
> | 本插件 | ssh2 纯 JS，Windows 主场 | 零预装；围栏档才要核心 |
>
> **解耦判断**：切 helper 与修 BUG-9 无关——helper 换不掉 ssh2 直连腿（零预装机器仍走它），
> 也上不了 Windows 宿主 ⇒ 无论 §5 拍成什么，两条腿的停止缺陷都要自修（→ backlog `BUG-9`）。
>
> **重估触发条件（任一命中即开新 spike 复评 B）**：① 官方支持 Windows 宿主；② 进 rc/正式通道
> 且接入 Web 路径；③ 我方维护 core + ssh2 直连的成本明显超过切换成本（如接缝再漂移两三代）；
> ④ 需要官方沙箱/LSP/PTC 全家桶覆盖。在那之前 `UPSTREAM-6` 巡检负责让信号「会响」
> （alpha.2 的出现即首次实绩，见 §1.1 修订）。
>
> **helper 实现状态（2026-09-18 解包核实）**：`dsh-ssh@0.1.6-alpha.2` `lib/helper.js`（834 行）为
> **完整实现**（prepare/start/terminate RPC、逐进程租约、断连/租约过期清理、TLS 流端点、PSK），
> 非占位。其 terminate 转调远端 `dsh-subprocess-local`：`detached` 组长 + `process.kill(-pid)` 组杀，
> Linux 再叠 systemd 瞬态 scope + 进程树跟踪——组杀是官方与我们核心（`BUG-9` 修法）共同的底线形态。

- **选项 A（暂推荐）**：差异化主线 = **Windows 宿主 + 浏览器化（面板/目录选择/审批门）+ 多机注册表 +
  免远端预装**；与官方 SSH 家族**并存不竞争**，`UPSTREAM-5` 按官方抽象对齐但**不引入**其依赖。
- **选项 B**：长期把远端执行面切到官方 seam（用 `dsh-ssh` 承担传输，我们只保留注册表与 UI）。
  代价：依赖远端预装 + 摘要 pin、放弃 Windows 宿主、丢掉 ssh2 直连的零预装；收益：随上游演进
  免费拿到 LSP / PTC / sandbox 全覆盖。
- **选项 C**：不评估、只做自有路线。风险：官方接入 Web / 多机时不掌握时间点——今天的哨兵盲区
  正是这种风险的具体形态。
- **哨兵盲区处置（代理侧可立即做）**：给"scope 新包"加一条巡检（定期 `npm view` 比对 dist-tags /
  包清单），把"上游新增能力包"变成会响的信号，而不是等人去翻 registry。

## 6. 复现证据的命令

```powershell
$cache = '<repo>\.tmp\npm-cache'   # 沙箱内 npm 缓存必须落在工作区
npm view @deepseek-ai/dsh-ssh versions dist-tags time.created description --json --cache $cache
npm pack @deepseek-ai/dsh-ssh@0.1.6-alpha.1 --cache $cache --pack-destination .tmp\<dir>
tar -xzf .tmp\<dir>\deepseek-ai-dsh-ssh-0.1.6-alpha.1.tgz -C .tmp\<dir>\x --strip-components 1
```

> 沙箱坑：`npm view` 走 `http_proxy`（本机 `http://localhost:7890`）；同一网络下
> `Invoke-RestMethod` **不读**该代理，会报 `Authentication failed`——用 npm CLI，不要改走 `curl`。
> 解包产物属**本地素材**（`.tmp/`，不入库）：**引用行号必须同时标注包与版本**（§5.3 引用纪律）。
