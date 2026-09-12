# ADR-0020: 远程会话权限——spawn 接缝审批门 + AI answerer 自动放权（AUDIT-6 路线 D+A）

- 状态: accepted（方向用户 2026-09-12 拍板：D+A 合并一轮、B 拆出 REQ-I9、要求「AI 审查自动放权」；本 ADR 定稿七项设计决策）
- 日期: 2026-09-12
- 范围: 设计定稿（本 ADR）+ **实施轮 R22 已落地**（`feat/audit-6-remote-approval-gate`；实现轮廓见 §3，
  实施偏差与证据见 `docs/rounds/R22-audit6-remote-approval-gate.md`：devDependency 偏离（结构化最小面
  替代）、白名单终稿、元字符守卫补 `\n`）
- 关联: `ADR-0019`（REQ-I7 权限档位退役——本 ADR 是其「远程命令围栏见 AUDIT-6/REQ-I9」承诺的前半）；
  `ADR-0015`（UX-1 `remote-full` 预设片段的正典位置，本 ADR 引用不复制）；
  `ADR-0014`（model-facing 文案英文常量）；`docs/backlog.md` AUDIT-6 / REQ-I9 / UX-1 / SEC-3 行；
  上游契约证据：`<npm root -g>/@deepseek-ai/dsh/node_modules/@deepseek-ai/` 下
  `dsh-user-approval`、`dsh-agent`、`dsh-agent-loop`、`dsh-tools`、`dsh-acp`、`dsh-api-remotes`、
  `dsh-jobs-local`、`cordis`（0.1.5-rc.1 磁盘权威源，行号属该快照）

## 0. 结论

远程会话的权限控制落成**一个位于混合 subprocess 接缝远程分支上的审批门**：
`MixedSubprocessRuntime` 的 `spawn` / `spawnTerminal` 在真正到达 SSH 之前，先经
`ctx.approval.request(...)` 问询（平台审批服务；`ask` 策略下由人类 UI answerer 或我们的
AI answerer 作答，`never` 策略下确定性拒绝）；逐机器三态开关 `remoteApproval:
'off' | 'human' | 'ai'`（machines.json，默认 `off`）；AI answerer 是宿主半
`approval/request` waterfall 监听器（`prepend` 注册、只认带本插件标记且机器为 `ai`
模式的请求、**纯规则白名单**自动放权、其余与异常一律 `next()` 委派人类）。
同时完成路线 D 的诚实化文案：系统提示明示「远端执行不受本地沙箱限制」。
七项决策逐条见 §2。

## 1. 背景

### 1.1 前提：REQ-I7 之后远程会话没有围栏

ADR-0019 退役了副工作区目录级权限档位后，远程会话的隔离手段只剩「每会话 sandbox/mode
（本地沙箱，对远端无意义——远程会话被 `forceRemoteSandboxMode` 钉成
`danger-full-access`，这是 same-world 契约内行为）」与「操作者信任边界」。远程命令的
结构性围栏被明确记为两半：**AUDIT-6（本 ADR：人审/AI 审门）与 REQ-I9（远端 bwrap
runner，真围栏；落地后本门收窄为无 runner 机器的兜底）**。

### 1.2 平台事实（0.1.5-rc.1 磁盘权威源，backlog AUDIT-6 行已采信）

- **`ctx.approval`（`dsh-user-approval`，公开宿主服务）**：
  `request({ agent, toolName, callId?, reason?, signal? }) → 'allowed-once' | 'rejected' |
  'cancelled' | 'unavailable'`。策略 `ask`（默认）/`never`——`never` 在 waterfall **之前**
  被确定性拒绝（`lib/index.js:178`）。fail-closed：无 answerer、answerer 抛错、越界返回值
  都归一为 `unavailable`（`:179`）。**需要 open turn**（`:133`）——空闲 asker 直接抛错。
  审计对 `approval/asked` + `approval/decided` 自动写进**发起会话**日志（`:135/:142`）。
  **ask 不携带工具参数**——answerer 只见 toolName/reason/callId（README Known Limitations）。
- **answerer = `approval/request` waterfall 监听器**：返回 outcome 即为所属 agent 作答，
  `next()` 委派；deployment 组**一个 terminal answerer**（现网是 web UI answerer，经
  `dsh-api-remotes` 把宿主事件按连接转发到浏览器）；服务自身从不弹人。
- **`ctx.agents`（`dsh-agent`，公开注册表服务）有 AsyncLocalStorage 发起者面**：
  `currentInitiator(): Agent | undefined`（`lib/index.js:334`）。agent-loop 把整个驱动链包在
  `withInitiator(this, () => this.kick())` 里（`dsh-agent-loop/lib/index.js:851`），工具执行
  自身就 `requireInitiator()`（`:513`）⇒ **工具执行契约性位于发起者边界内** ⇒ 接缝
  （工具调用栈之下同步调用的 `ctx.subprocess.spawn`）能读到发起 agent。服务接缝消费
  `currentInitiator()` 做归因的先例：`dsh-web-search-deepseek/lib/index.js:288`。
  上游明言「ambient presence 既非活性证明也非授权」——本设计只把它当**路由/归因**，
  不当授权。
- **`ctx.on` 支持 `{ prepend: true }`**（`cordis/lib/index.js:336,368-372`）——waterfall
  监听器可显式排前。
- **审批消费的既有范式** `dsh-tools` 的 `serviceAsk`（`lib/index.js:3314-3365`）：approval
  服务缺失 → 拒绝并给区分理由；`exec.agent` 缺失 → 拒绝并给区分理由；四种非 grant 结局
  各自映射为可区分的拒绝文案。本门的降级语义镜像它。
- **`PermissionPresetService` 0.1.5 无 add/register** ⇒ UX-1 只能用户在
  `$DSH_HOME/profiles/web/cordis.patch.yml` 手工补 `remote-full` 预设（ADR-0015 已有完整
  片段与整键替换警告；SEC-3 副作用已知）——本 ADR 不改此结论，只做引用与文档引导。

### 1.3 我们接缝的现状（本仓库 src）

- `MixedSubprocessRuntime.spawn` 是**同步**签名（接缝契约：`SubprocessRuntime.spawn`
  “returns a live handle synchronously”），但远程分支的 `SshSubprocessHandle` **本就是
  「同步构造 + 异步启动」**（`src/process.ts:47-94`：构造器建 PassThrough/收集器，
  `run()` 异步建命令→连接→exec）——审批问询可以干净地插进异步启动段，不破坏同步契约。
- `spawnTerminal` 是异步签名，直接前置 await。
- `sw_exec` 与官方 bash/pwsh、win32 bash 的远程执行**全部**经混合 spawn（`ssh://` cwd
  路由）；后台任务经 `ctx.jobs.start`，其 `run()` 在**工具调用内同步**执行
  （`dsh-jobs-local/lib/index.js:131-138`）⇒ 后台 spawn 也发生在 open turn +
  initiator 边界内。

## 2. 决策（七项，逐条结论与理由）

### D1 问询位置与覆盖面

**结论**：单一门放在 `MixedSubprocessRuntime` 远程分支的两条道上——`spawn`（问询插在
远程句柄的异步启动段之首，即连接/命令文本已解析、真正 exec 之前）与 `spawnTerminal`
（异步签名，前置 await）。**覆盖判定用「shell 形状」**：远程 argv[0] 的 basename ∈
`{bash, sh, zsh, dash, pwsh, powershell}` 且参数带 `-c` / `-Command` 的 spawn，加上
`spawnTerminal`（交互 shell 本身就是任意命令入口）。非 shell 形状的远程 spawn（LSP、
子代理进程等**宿主代码自组 argv** 的消费方）不拦。

**理由**：

- **为什么在接缝而不是逐工具**：官方 bash/pwsh/终端、我们的 `sw_exec`/win32 bash、
  后台任务——全部经过这一个点；逐工具设门是三处重复实现，漏一处即穿。`sw_exec`
  因此**天然同门**（它产出的就是 `bash -c` / `pwsh -Command` 形状），不需要也不应该
  有第二个门。
- **为什么用 shell 形状收敛而不是拦一切远程 spawn**：门的威胁面是「**模型撰写的命令
  文本**」。shell `-c` 形状正是模型命令文本的唯一常规载体；宿主自组 argv 的进程
  （LSP server 等）不含模型文本，拦它们只会把远程 LSP 打死（且这类调用若发生在
  open turn 之外，fail-closed 会直接致残）。形状规则让设计对「远程 LSP 是否实际经
  接缝」这一未验证事实不敏感（§6-2）。
- **后台任务语义**：`jobs.start` 同步调 `run()` ⇒ spawn（与问询）发生在工具调用的
  open turn 内，问询合法；`jobId` 照常立即返回，**拒绝在 job 结局可见**
  （`status: failed`，detail=拒绝理由）——与后台任务「先拿 id、后看结局」的既有语义
  一致，如实记录进 UAT 预期。
- **明确不覆盖（诚实边界，写进 SECURITY）**：
  1. **fs/SFTP 写路径**——v1 不设门；模型可经 fs 接缝在远端写文件（含「写脚本 +
     `bash script.sh`」组合绕过 shell 形状门）。结构性答案是 REQ-I9 的远端 runner，
     本门不假装补上这个洞。
  2. **插件自有固定探针**（注册表 `probe`/`reconnect`、`sw_status` 环境自检、
     `sw_exec` 的 OS 探针 `uname -s` / `cmd /c ver`、连接测试）——走
     `connection.exec` 直连通道而非接缝，且命令文本是插件常量、非模型输入。
  3. `resolveExecutable`（恒本地、无 cwd）；better-sidebar 终端（不经接缝，
     架构 §7-9）；`sw_connect save:false` 临时连接（门只认注册表机器标志；模型已能
     提供凭据时 SSH 边界本身已失守，对临时连接加门无实质增益——如实记录）。

### D2 触发面配置：逐机器三态，默认 off

**结论**：machines.json 机器记录加**单字段** `remoteApproval: 'off' | 'human' | 'ai'`
（默认 `'off'`）。`'off'` = 不设门（现状）；`'human'` = 每条远程命令问人类；
`'ai'` = 问询先过 AI answerer 白名单（命中自动放行），未命中落人类。该字段同时驱动
asker（门是否拦）与 answerer（是否自动放权）两半——**一份真相**。同步面：
`normalizeMachine` / `MachineInput` / `MachineView`（`src/registry.ts`）、设置页机器表单
checkbox/下拉（客户端半）、`machines.add` payload 白名单（`src/web.ts`）。旧 machines.json
记录缺字段 → 归一化默认 `'off'`，零迁移。

**理由**：

- **逐机器而不是全局+例外**：风险本来就是按机器不同的（一台实验机 vs 一台生产机）。
  注册表已是逐机器策略的真相源（`hostKeyMode`、`credentialBackend` 先例）。「全局开关 +
  例外」会造出第二份配置面（全局键 + 机器例外键两处可写），违反本仓库「没有第二份
  真相」的原则，且没有全局开关表达不了的真用例。
- **默认 `'off'`（保持现状）**：① 升级零行为变化——不破坏既有用户，这是 0.1.x minor
  的应有姿态；② 门是交互语义的重大变化（开启后每条远程命令多一次决定点），默认翻转
  等于替所有用户做了这个决定；③ 开启路径用文档引导（README/SECURITY/设置页提示，
  见 D6）。backlog 拍板倾向已明确「默认 off + 文档引导」。

### D3 agent 解析：`ctx.agents.currentInitiator()`

**结论**：门在问询前用 `ctx.get('agents')`（可选服务）→ `currentInitiator()` 取
「发起本次异步链的 agent」，作为 `ApprovalRequest.agent`。**仅作路由与归因**（决定
审计对写进哪个会话日志、哪个 UI answerer 有资格作答），绝不作授权依据。

**理由与证据链**：agent-loop 把整个驱动链包在 `withInitiator(this, () => this.kick())`
（`dsh-agent-loop/lib/index.js:851`），工具执行契约性位于边界内（`executeToolCalls`
自身 `requireInitiator()`，`:513`）⇒ 工具调用栈之下的接缝调用继承发起者。服务接缝
用 `currentInitiator()` 做归因有上游先例（`dsh-web-search-deepseek/lib/index.js:288`）。
不选 `requireInitiator()`（抛错版）：门要的是「拿不到就明确拒绝」而非异常穿透，
降级语义自己掌控。不选 cwd→session 反查：多会话可共享 cwd，歧义且脆弱。

**ApprovalRequest 其余字段的取法**：

| 字段 | 取法 | 理由 |
|---|---|---|
| `toolName` | 稳定伪工具名 `sw:remote-exec` | 接缝处没有发起工具的身份；伪名只用于呈现与审计，稳定可 grep |
| `callId` | 省略 | 同上。web UI answerer 不要求 callId；ACP answerer 无 callId 即 `next()`（`dsh-acp/lib/index.js:1117`）——委派语义正确 |
| `reason` | `[dsw-remote-gate] machine=<id> cmd=<预览>` | ask 不携带工具参数，**reason 是命令预览的唯一通道**（上游已知事实）；前缀标记同时是 AI answerer 的过滤锚（D4） |
| `signal` | spawn spec 的 signal | 撤销即 `cancelled`，与进程终止语义同源 |

**降级阶梯（全部 fail-closed，错误文案各自可区分，镜像 `serviceAsk` 范式）**：

1. `ctx.get('approval') === undefined` → 拒绝执行：机器 X 开了审批门，但组合里没有
   approval 服务；
2. `agents` 服务缺失或 `currentInitiator() === undefined` → 拒绝执行：无法解析发起会话
   的 agent。按当前组合，接缝的 shell 形状消费方全部工具驱动，此分支是异常路径——
   **宁可拒绝、不可静默绕过**；若未来出现非工具驱动的远程 shell 消费方，必须显式
   决策（携带 agent 上下文或明确豁免），不允许默认放行；
3. `request()` 抛错（典型：无 open turn）→ 拒绝执行并透传错误文本。

后果如实记录：门开启的机器上，任何走到远程 shell spawn 却解析不出 agent 的路径都会
被拒绝——这是刻意的保守面，不是缺陷。

### D4 AI answerer（自动放权）

**结论**：宿主半注册 `approval/request` waterfall 监听器：

```ts
ctx.effect(() => ctx.on('approval/request', handler, { prepend: true }))
```

（Cordis `on` 的 prepend 选项：`cordis/lib/index.js:336,368-372`；挂 `ctx.effect` 保证
可逆，AGENTS §6。）handler 行为：

1. `reason` 不以 `[dsw-remote-gate]` 开头 → `next()`（其它工具的 ask——沙箱升级等——
   原样穿行，行为零变化）；
2. 解析出 machine id，该机器 `remoteApproval !== 'ai'` → `next()`（`'human'` 机器每条
   都到人）；
3. 机器为 `'ai'` → **纯规则白名单**判定命令预览：先过「单命令且无 shell 元字符
   （`;` `|` `&` `(` `)` `` ` `` `>` `<` `$`）」守卫，再逐条匹配只读命令规则
   （program + 锚定参数模式；起步名单：`uname`/`pwd`/`ls`/`cat`/`head`/`tail`/`wc`/
   `echo`/`git status`/`git log`/`git diff`/`git show`/`rg --version`/`node -v` 等，
   最终短清单实施轮定稿并独立成可评审常量）。命中 → `'allowed-once'`；
   未命中 → `next()`。

**v1 分类器选纯规则白名单、不上 LLM**：权限路径必须可判定、可审计、可单测；每条远程
命令过 LLM 引入成本、延迟与不可复现三重代价，且安全性质不可证。LLM 分类器留 v2 接口
（同一函数签名替换实现），不进 v1。也不做「黑名单危险检测」——命令文本扫描不可靠且
承诺无法兑现（ADR-0019 §4 已否的同源思路）；白名单**只做放权优化、不做拒绝依据**：
不在名单上的一律到人，由人类决定。

**失败语义（实现红线）**：handler 体内**全量 try/catch，任何异常 → `return next()`**。
绝不因 AI 故障放行危险命令（异常不返回 `allowed-once`）；也绝不 `throw`——上游对
throwing listener 的容器化是**整条 waterfall 归一 `unavailable`**（`dsh-user-approval`
`lib/index.js:179`），throw 会把人类 UI answerer 一并饿死、变成「AI 故障拦死人类放权」。
catch 后 `next()` 是唯一正确动作：AI 坏了，决定权交还人类。

**与人类 UI answerer 的次序**：`prepend: true` ⇒ AI answerer 先看。白名单命中 →
自动放行，人类不被打扰；未命中/异常/非本门请求 → `next()` → web UI answerer
（`dsh-api-remotes` 按连接转发的宿主监听器）作答；无 answerer → 服务终哨
`'unavailable'`（fail closed）。对上游「sibling listener order 不是策略优先机制」告诫的
回应：AI answerer 不是策略主体，只是保守白名单下的**自动放权优化**——安全决策主体
仍是人类 answerer（未命中白名单的一切原样到达人类）；且 `'never'` 策略在 waterfall
之前就被服务确定性拒绝（`lib/index.js:178`），AI answerer 永远看不到，无法绕过。

### D5 approval 策略 `never`（CI/无人值守）

**结论**：**不特判**。`never` 下服务在 waterfall 之前把每次 ask 确定性拒绝为
`'rejected'`，门把它与人类显式拒绝同路处理——fail-closed 语义原样保留。错误呈现上，
门把每个非 `allowed-once` 结局映射为**各自可区分**的英文错误（模型可读，ADR-0014
精神），经既有 `spawnFailed` 包装出现在工具结果里：

| 结局 | 英文错误（要点） |
|---|---|
| `rejected` | remote command rejected — approval policy is `never` (unattended) or the answerer denied it; check `/permission` or disable the machine's gate |
| `cancelled` | approval request was cancelled before a decision |
| `unavailable` | no approval answerer available — failing closed |
| 无 agent / 无 approval 服务 | 见 D3 降级阶梯，各自独立文案 |

四类文案两两可区分，镜像 `serviceAsk` 的「让模型分得清人类说不要通道缺失」设计。

### D6 路线 D 文案（诚实化）

**结论**：

1. **系统提示（`src/model-prompts.ts` 新增英文常量，接 `sw-remote` 段）**：
   - `remoteNoSandbox`——远程会话**恒**注入：「Remote execution is not confined by the
     local sandbox: commands run with the remote OS account's permissions only.」（D 的
     核心诚实句：本地沙箱对远端无效，`forceRemoteSandboxMode` 钉 full 是 same-world
     契约内行为，向模型如实陈述）；
   - `remoteGateActive`——仅当会话主工作区机器 `remoteApproval !== 'off'` 时注入：
     「Commands on this machine additionally require an approval decision before they
     run; do not retry a rejected command unchanged.」（管理模型对拒绝的预期，防重试
     死循环）。注入判定复用 `sw-remote` 段既有的会话反查 + 注册表机器查找
     （`src/tools.ts` 既有代码路径）。
2. **README.md / README.zh.md / SECURITY.md**：边界句——「远端命令以远端 OS 账户权限
   执行，本地沙箱不适用；可按机器开启审批门（默认关闭）；主机指纹 TOFU 照旧」；
   SECURITY 的「已知边界」补 §D1-不覆盖清单（SFTP 写路径、固定探针、临时连接）。
3. **UX-1**：`cordis.patch.yml` 的 `remote-full` 预设片段**正典位置保持在
   ADR-0015**（含整键替换警告与 SEC-3 已知副作用）；README/SECURITY 只放指引链接，
   不复制片段（防两份漂移）。
4. **docs/uat 验收脚本**：实施轮落盘 `docs/uat/R22-audit6-remote-approval-gate.md`
   （本 ADR 定大纲，见附录 A）。

### D7 与 REQ-I7 的关系：不复活目录级粒度

**结论**：本门与 REQ-I7 退役的权限模型**轴不同、机制不同、配置面不同**，且明确不
恢复任何逐目录/逐副根档位：

| | 旧权限门（ADR-0008→0019 已退役） | 本审批门（ADR-0020） |
|---|---|---|
| 轴 | 逐**目录**静态档位（`fs: r\|rw` × `exec: on\|off`） | 逐 **spawn** 动态决定（每条远程命令一次） |
| 机制 | 门面内 advisory 检查 | 平台 `ctx.approval` waterfall + 人/AI answerer |
| 绕过面 | cwd/argv[0] 检查，绝对路径可绕 | 门在**一切远程 shell 进程之前**，与 cwd/目录无关 |
| 配置面 | 副根级两轴枚举 | 机器级单字段三态 |
| 审计 | 无 | `approval/asked`+`decided` 自动入发起会话日志 |

副工作区（ADR-0019 的薄声明清单）不回到权限业务；门开启时，对副根机器的命令与主
工作区命令走**同一个接缝同一扇门**——均匀、无目录语义。ADR-0019 §3 所说「远程命令
围栏见 AUDIT-6/REQ-I9 线」的前半即本 ADR；REQ-I9（远端 bwrap runner）落地后，本门
收窄为无 runner 机器的兜底（backlog REQ-I9 行已记）。

## 3. 实现轮廓（供实施轮开工，非本轮产出）

| # | 位置 | 动作 |
|---|---|---|
| 1 | `src/remote-approval-gate.ts`（新） | 纯逻辑模块：shell 形状判定、`reason` 标记/预览拼装、结局→错误映射、白名单规则表与匹配器（全部可单测的纯函数） |
| 2 | `src/mixed.ts` | 远程分支注入门：spawn 经引擎 preflight（见 #3）；spawnTerminal 前置 await 门 |
| 3 | `src/process.ts` / `src/subprocess.ts` | `SshSubprocessHandle.run()` 之首 await 可选 preflight 钩子（门在连接/命令已解析处触发，argv 是 `remoteArgvOf` 改写后的最终形态）；拒绝 → `done` reject。同步契约不动（构造器建流、异步启动，现状即此形状） |
| 4 | `src/plugin.ts` | 装配门（`ctx.get('approval')`/`ctx.get('agents')` 运行时判空，可选服务不进 inject）+ AI answerer 注册（`ctx.effect` + `prepend`，全量 catch） |
| 5 | `src/registry.ts` + `src/web.ts` + 客户端表单 | `remoteApproval` 三态字段贯穿（normalize/Input/View/RPC 白名单/设置页 UI；旧记录缺字段默认 `'off'`） |
| 6 | `src/model-prompts.ts` + `src/tools.ts` | `remoteNoSandbox` / `remoteGateActive` 两常量 + `sw-remote` 段注入逻辑 |
| 7 | `src/locale/` | 设置页/机器表单的人类面文案键（zh 真源、en 同键；模型面错误是英文常量**不进词典**，ADR-0014） |
| 8 | README / README.zh / SECURITY | D6 边界句与指引 |
| 9 | `docs/uat/R22-audit6-remote-approval-gate.md` | 附录 A 大纲落盘 |
| 10 | 依赖 | `dsh-user-approval` 加 **devDependencies**（类型；消费走 `ctx.get('approval')` 字符串名，可选服务不进 peer）；`dsh-agent` 已在 dev |
| 11 | 测试 | 假 ApprovalService 单测（ask→allowed-once/rejected/cancelled/unavailable/never 五结局）、形状判定、answerer 过滤/机器模式/异常安全（throw 不得逃逸）、配置解析、后台任务拒绝结局、spawnTerminal 门；`check:static`/`typecheck`/`test:agent`/`build`/`boot-smoke --no-channel` 全绿（backlog 验收标准） |

生命周期红线：监听器/钩子全部挂 `ctx.effect`；重挂不得抛 already registered
（waterfall 监听随 effect disposer 回收，`approval/request` 是事件不是服务占位，无重复
注册冲突，但按仓库惯例仍走 effect）。

## 4. 后果

- **正向**：远程会话第一次有了平台级人审/AI 自动放权决定点；审计对（asked/decided）
  免费落发起会话日志；模型与文档对「远端不受沙箱限制」的认知诚实化（D）；
  `remoteApproval: 'ai'` 下白名单命令零打扰直行，交互成本可控。
- **代价与风险（如实）**：
  - `prepend` 次序是上游告诫的灰色地带（sibling order 非策略机制）。缓解：白名单
    极保守、人类仍是终哨；最坏退化（次序反转）是白名单命中也先问人类——**安全
    方向**的失效，不会出现危险自动放行（§6-1）。
  - shell 形状匹配存在已知绕面：`bash script.sh` 非壳形状 + fs 写脚本 = 组合绕过。
    v1 明示不堵（§D1 不覆盖清单），REQ-I9 收口。
  - SFTP 写路径、固定探针、`sw_connect save:false` 临时连接不设门（§D1）。
  - answerer 若 throw 会饿死人类 answerer（上游容器化语义）——实现红线强制全 catch。
  - `'human'` 模式下每条远程命令一次人审，交互成本真实存在；这是用户显式开启的
    语义，`'ai'` 模式缓解。
- **兼容性**：默认 `'off'` ⇒ 升级零行为变化；machines.json 旧记录零迁移；门关闭时
  AI answerer 对一切请求 `next()`，其它工具的审批流零影响。

## 5. 被否方案

- **逐工具各设门（bash/pwsh/sw_exec/终端各问各的）**：三处重复实现、漏一即穿；
  接缝才是唯一交点。否。
- **门=拦截一切远程 spawn（非 shell 也拦）**：会把远程 LSP/子代理进程打死；威胁面是
  模型命令文本而非宿主自组 argv。否（以 shell 形状收敛）。
- **门挂工具层（exec 上下文里有 agent/callId）而非接缝**：只能覆盖自家工具，官方
  bash/pwsh/终端全覆盖即失；且上游工具不可改。接缝方案丢失的 `callId` 用 reason
  预览补偿（D3 表）。否。
- **设置页全局开关+例外**：双配置面/双真相（D2）。否。
- **v1 LLM 分类器**：权限路径要可判定可复现；LLM 的位置应是 v2 可选增强，不是 v1
  安全性质的组成部分（D4）。否。
- **命令文本黑名单危险检测**：扫描不可靠、承诺无法兑现（ADR-0019 §4 同源结论）；
  本设计白名单只做放权优化、拒绝一律交人类。否。
- **特判 `never` 策略**：服务已在 waterfall 前确定性拒绝；门内再特判只会造出第二份
  语义（D5）。否。
- **monkey-patch `PermissionPresetService` 补 `remote-full`**：ADR-0015 方案 C 已否，
  不重复。

## 6. 未验证假设

1. **AI answerer 与 UI answerer 的实际运行时次序**：磁盘读出 api-remotes 的宿主转发
   监听器按连接注册（`remoteEventSource` 工厂，`dsh-api-remotes/lib/index.js:105-129`），
   本插件监听器在 boot 时 `prepend` 注册 ⇒ 预期 AI 先看；未运行时插桩确认。缓解：
   即使反转，最坏是白名单命中也先问人类（安全方向失效），不会危险放行。
2. **远程 LSP/子代理 spawn 是否实际经接缝**：架构 §1 列其为接缝消费方，但未运行时
   确认具体调用形状；shell 形状规则使设计对该事实不敏感（非壳形状一律不拦）。
3. **web UI answerer 对无 `callId` 请求的呈现**：类型上可选（"when available"），
   预期可正常弹卡并显示 reason 预览；未实测（lab UAT 验证项，附录 A-3）。
4. **后台任务「先拿 jobId、拒绝在 job_output 可见」的体验**：按 jobs 同步 `run()`
   语义推导；未实测（附录 A-6）。

## 附录 A：docs/uat 验收脚本大纲（实施轮落盘）

前置：lab（`DSH_HOME=.dsh-lab`，端口 50599）+ 一台测试机器；用户已按 ADR-0015 应可
选应用 `remote-full` 预设（A-8 才可验）。

| # | 场景 | 预期 |
|---|---|---|
| A-1 | 机器 `remoteApproval: 'off'`，远程会话跑 `bash`/`sw_exec` | 与现状一致，无问询（回归） |
| A-2 | 改 `'human'`：让模型跑一条良性命令 | UI 弹审批卡（含 reason 命令预览）；Allow once → 命令执行；会话日志出现 `approval/asked`+`approval/decided` 对 |
| A-3 | 同上，点拒绝 | 工具结果为可区分英文错误（rejected 文案）；模型不再重试同命令（提示段 `remoteGateActive` 生效） |
| A-4 | 改 `'ai'`：白名单命令（如 `uname -a` 之外的名单项 `pwd`） | 不弹卡直接执行（审计对仍落日志） |
| A-5 | `'ai'`：非白名单命令（如 `touch x`） | 弹卡到人，与 `'human'` 一致 |
| A-6 | `'human'` + `run_in_background` 命令 | jobId 先返回；批准 → job completed；拒绝 → job failed(detail=拒绝文案) |
| A-7 | 会话切 `never`（`/permission danger-full-access` 或等价）+ `'human'` 机器跑命令 | 无弹卡、确定性 rejected 文案（fail-closed） |
| A-8 | 应用 ADR-0015 预设片段 | composer chip 显示 `Remote Full`（UX-1 验收，与门独立） |
| A-9 | 模型开终端（`spawnTerminal`） | 同样过门；拒绝 → 终端工具报同款错误 |
| A-10 | 本地会话跑命令 | 零问询（门只拦远程分支，本地沙箱行为不变） |
