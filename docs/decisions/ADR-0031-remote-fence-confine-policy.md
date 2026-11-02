# ADR-0031: 远程围栏改走 `confine` 逐次策略——spike 结论与实施形状

- 状态: accepted（所有者 2026-10-11 点名实施（REQ-I27 并入 R51/PR #65）；§4 终端策略同日拍板）
- 日期: 2026-10-11（R51）
- 范围: REQ-I22 的两个待核问题（不调 `confine` 的上游调用方、交互终端）；
  A′（[ADR-0029](./ADR-0029-positioning-review.md) §4.3）落地设计；`BUG-12` 提权半的验收论证
- 关联: ADR-0029（定位与 A′ 形状）· ADR-0025（现行围栏）· ADR-0022 §2.4（围栏档拒 PTY）·
  ADR-0028（区域/副根矩阵）· `BUG-12` · [R51](../rounds/R51-three-p1-round.md)

## 0. 结论（先答 spike 的两问）

1. **不调 `confine` 的 spawn 调用方**（0.2.0-rc.2 磁盘全量枚举，§1）：浏览器终端
   （`dsh-api-terminal-controller`）、`dsh-workspace-changes` 的 git 探针（3 处）、
   `dsh-tool-fs-search` 的 ripgrep、`dsh-experimental-speech-to-text-sensevoice` 的推理
   worker；以及任何挂 `-local` 执行器的组合（执行器不围是**选择执行器**的属性）。
   fs 写不走 `ctx.sandbox.confine`（`dsh-fs-sandbox` 是进程内栅栏）——不属本次收窄。
2. **交互终端有两条路**：persistent shell 工具（`ctx.terminals` → `dsh-terminal-bash`
   `spawnArgv`）**经 confine**；浏览器/Web-UI 终端（`dsh-api-terminal-controller.spawn`）
   **裸 shell argv 直达 `spawnTerminal`，无 confine、无模式检查**。
   ⇒ 终端策略见 §4：**所有者 2026-10-11 已拍**——persistent shell（模型侧）拒；
   浏览器终端（人开的）对齐官方**放行不设防**。
3. **可行**：两家族（0.1.7-rc.2 / 0.2.0-rc.2）的 `dsh-sandbox` 契约**哈希级一致**
   （§1.4），confine 模型可同时启用；我方标记 argv 与官方 runner-argv **同构**（§3.1）。

## 1. 上游事实（引用一律「包@版本 文件 符号」；两份磁盘权威源）

源①：全局安装 `@deepseek-ai/dsh` 树 = 0.2.0-rc.2（消费者齐全）；源②：仓库
`node_modules` = 0.1.7-rc.2（仅 seam/策略包）。`dsh-sandbox-ssh` / `dsh-subprocess-ssh`
两源均未安装（registry 存在性由 ADR-0029 §6 的 `npm pack` 成功佐证）。

### 1.1 `confine` 调用方全量枚举（0.2.0-rc.2）

| 调用方 | 路径 | 形状 |
|---|---|---|
| `dsh-bash-sandbox` `SandboxBashExecutor.confine` | 官方 bash 前台/后台/超时晋升 job（`ctx.shell` seam） | `ctx.sandbox.confine(["bash","-c",command], policy, signal)` |
| `dsh-pwsh-sandbox` `SandboxPwshExecutor.confine` | 官方 pwsh 工具 | 同形（`this.argv(spec)`） |
| `dsh-terminal-bash` 模块级 `spawnArgv` | **persistent shell PTY**（`ctx.terminals` registry；消费者 `dsh-tool-bash/pwsh-persistent`） | `(await sandbox.confine(argv, {...policy, mode}, signal)).argv` → `spawnTerminal` |
| `dsh-ptc-runtime-node` `NodePtcRuntime.execute` | PTS/PTC 运行时 | danger → 跳过；否则 confine 后 spawn |
| `dsh-sandbox-local` `LocalSandboxProvider.confine` | 实现（非消费） | `[...runnerArgv, "--", ...callerArgv]` |

client 侧 runner 产物（`dsh-cordis-client-runner/lib/client.js` 等）不调 `confine`
（仅命中客户端插件 facade 的 `sandboxContext`，另一概念）。

### 1.2 danger 与提权的官方语义（三处同形证据）

`dsh-tool-bash` `execute` → `approveBashEscalation`（`dsh-sandbox` `approveEscalation`：
`WIDER_MODES` 严格变宽表 + `ctx.approval` 一次性批准）→ 批准档盖进本次 `sandboxPolicy`：

- 批准档 = `danger-full-access` ⇒ 消费者**跳过 confine、spawn 原 argv**（`dsh-bash-sandbox`
  `execute`、`dsh-ptc-runtime-node` `execute`、`dsh-terminal-bash` `spawnArgv` 三处同形）；
- 升到 `workspace-write` ⇒ 带更宽 policy **重新** confine（"an escalated retry is a new
  call with a wider policy"）。pwsh 同构。

### 1.3 `ConfinedArgv` 契约（`dsh-sandbox` `lib/types/index.d.ts`）

`{ argv: string[]; enforcement: 'full'|'partial'; denialSignatures: readonly string[];
runnerFailureRules: readonly RunnerFailureRule[] }`；`confine(argv, policy, signal?)` 的
argv 是**精确 argv**（"a shell-shaped consumer passes ['bash','-c', command]"）。
**没有魔法前缀协议**：policy 编进 runner 的 profile flag（bwrap 参数 /
windows-acl `--workspace/--temp/--mode`）；**spawn 侧不解标记**——`prepared.argv` 原样进
`ctx.subprocess.spawn`，argv[0] 仅用于 runner 失败诊断；**policy 对象不随
`SubprocessSpawnSpec` 传递**（无 policy 字段——正是我方 ALS 旁路存在的原因）。

### 1.4 家族一致性

源② 的 `dsh-sandbox`（5 文件）与 `dsh-subprocess` seam（3 文件）SHA256 与源①**全等**
⇒ confine 契约两家族同形，模型可同时启用。家族内差异只剩：shell 入口形状
（0.1.7 `run`/`start` vs 0.2.0 仅 `resolve`+`execute`，`dsh-shell` `lib/types/index.d.ts`
`ShellExecutor`）与消费者包集合（0.1.7 消费者**磁盘无据，未核实**——缓解：CI drift
通道每族装全家跑 boot 哨兵 + 单测，L1 实机矩阵兜底）。danger-跳过判定在消费者、
policy 在 spec 上，不受入口形状影响。

## 2. 我方现状与痛点（对照）

三块机制：`src/remote-confine.ts`（远程 cwd 上 `confine` 短路成恒等 argv + bwrap 拒绝
方言）、`src/remote-spawn-policy.ts`（`AsyncLocalStorage` 把 shell spec 的
`sandboxPolicy`+workdir 从 `run/start/resolve/execute` 四个入口旁路带进 spawn）、
`src/subprocess.ts` `SshSubprocessEngine.spawn`（按会话档 + 一次性提权施加围栏）。
痛点（ADR-0029 §1 已述）：**上游每多一个执行入口就要再接一次桥**——`BUG-12` 即
0.2.0 官方 pwsh 改走 `shell.execute` 时提权没跟到。

## 3. 实施形状（A′ 落地设计）

### 3.1 数据流

```text
工具（官方 bash/pwsh/PTC/persistent-PTY + 我方 sw_exec、win32 bash）
  ├─ danger（批准档）⇒ 跳过 confine，argv 原样 ────────────┐
  └─ 其余 ⇒ ctx.sandbox.confine(argv, policy)               │
              我方 wrapper（远程会话）：产出标记 argv          │
              `dsh-core run --sandbox <mode> --workspace <root> -- <argv>` 
              并把返回的 ConfinedArgv.argv 登记进进程内注册表  │
                                                            ▼
        ctx.subprocess.spawn(spec) / spawnTerminal(spec)
          有登记（对象身份命中）⇒ 解出 mode/root，按 cwd 重选根（ADR-0028 第一级），发对应 serve
          无登记 ⇒ --sandbox off（无标记不围栏，所有者已接受）
```

标记与官方 `[...runnerArgv, "--", ...callerArgv]`（policy 编进 flag）**同构**；远端协议
与 `CORE_ARTIFACT_VERSION` 不变。

### 3.2 防伪造：进程内注册表，不认字符串前缀

`WeakMap<argv 数组对象, {mode, root}>`；spawn 以 `spec.argv` 的**对象身份**查表。
模型自己拼同形前缀 ⇒ 查表 miss ⇒ `--sandbox off`——与它直接 spawn 无异，**无逃逸收益**；
注册表的真实作用是**路由正确性**（伪造标记若被前缀识别，会被送错 root 的 serve）。
已知限制：上游消费者若**复制** argv（而非按引用传递）会静默失去围栏。混合门面自己的改写会把已有标记搬到新数组（`BUG-25`）；模型另造的同内容数组仍然 miss。§1.1 的官方消费者按引用传递。

### 3.3 各入口的改造与退役

| 入口 | 改造 |
|---|---|
| 官方 bash/pwsh/PTC/persistent-PTY | 零改动自动覆盖（它们本来就调 confine / 跳过）——**BUG-12 整类消失** |
| `sw_exec` / win32 `bash`（我方工具） | 改成与官方 bash 同形：批准提权后 danger 跳过 confine，否则带本次 policy 调 confine |
| `remote-spawn-policy.ts` | policy 旁路存储（`storage`/`runWithRemoteSpawnPolicy`）**整体退役**；workdir 世界钉（`region-exec`，ADR-0028）**保留** |
| `spawnTerminal` | §4（已拍）：有标记（模型侧）即拒；无标记（人开的浏览器终端）放行不设防 |
| fs 面 | **不动**（`CoreRoutingFileSystem` 的 core 路由是路径语义，非 argv 语义） |

`BUG-12` 提权半验收论证：提权到 danger ⇒ 消费者跳过 confine ⇒ unmarked ⇒ `off`（正是
授予语义）；提权到 workspace-write ⇒ 重新 confine 更宽 policy ⇒ 标记 ⇒ 按宽档执行。
任何未来新入口只要走 confine 就自动带对策略——不再存在「漏接」。

## 4. 交互终端的决定（ADR-0029 §4.3 第 6 条的答案；所有者 2026-10-11 拍板）

- **persistent shell PTY（模型侧）**：官方经 confine ⇒ 我方 wrapper 会给出标记。
  「bwrap 下的 fenced PTY」仍是 ADR-0022 §2.4 的未验证面 ⇒ **标记进 terminal argv
  一律拒绝**（错误文案指明原因），不试图围栏 PTY。
- **浏览器终端（人开的）**：**对齐官方，放行不设防**。所有者原话：「如果是人开的
  终端，当然不设限」——围栏档会话里它是唯一不受围栏的入口，属**人的责任面**：模型
  没有打开它的工具入口，人开它即人接管。随 REQ-I27 写进 `SECURITY.md` 已知放行清单。
  实现上这是**简化**：`createRemoteSandboxTerminalGuard` 的「按会话档拒绝」对无标记
  终端退役（A′ 的「无标记不围栏」自然涵盖），只保留「有标记（模型侧）即拒」。

  > 拍板记录（2026-10-11 会话）：浏览器终端 = 官方面板（非 better-sidebar），远程
  > danger 档自 REQ-I2 起经接缝直接可用；远期「围栏里的终端」（fenced PTY）若要做，
  > 是独立能力项（ADR-0022 §2.4 口子），与本决定不冲突。

## 5. 收窄清单（相对现状；SECURITY.md 素材，所有者已接受 ADR-0029 §4.3-2）

| 路径 | 现状 | A′ 后 |
|---|---|---|
| 浏览器终端（远程会话，**人开**） | confined 拒 | **放行不设防**（对齐官方；§4 已拍；SECURITY.md 登记） |
| persistent shell（远程会话，**模型侧**） | confined 拒 | 仍拒（有标记即拒，§4） |
| `workspace-changes` git 探针 / `tool-fs-search` ripgrep / sensevoice worker（远程会话内） | 随会话档被引擎围 | unmarked ⇒ `off`（不围）——与官方本地语义一致 |
| `-local` 执行器组合 | 本就不围（本地） | 不变 |

## 6. 验证计划（随实施轮）

1. 契约测试：confine→标记→spawn 解码→按 cwd 选根→对应 serve；`ConfinedArgv` 引用
   传递断言（四消费者形状）；伪造前缀 = miss = off。
2. 退役断言：删 policy 旁路后 `npm test` 全绿（652 例为基线）。
3. `BUG-12` 复现（0.2.0 家族远程 pwsh + `sandbox_permissions`）：批准当次按授予档执行。
4. boot 哨兵 + 两家族 drift 通道；实机按 `docs/uat/matrix.md` L1 抽 M3/M6/N9。

## 7. 切分与未核实

- **实施 = `REQ-I27`**（所有者 2026-10-11 决定并入 R51 同一 PR）：§3 全部 + SECURITY.md +
  契约测试。WSL 侧测试按所有者指示 skip（CI ubuntu 承担 Linux 面）。
- 未核实：0.1.7 消费者集合（磁盘无包）；`dsh-sandbox-ssh`/`dsh-subprocess-ssh` 的
  registry 现状（两磁盘源未装，ADR-0029 §6 pack 成功为旧证）——实施轮装机核。
