# R14 契约审计：本插件门面 vs 上游服务声明面（BUG-2 同类缺口横向排查）

- 轮次：R14（BUG-2 A 路 / B 路）
- 任务：t3（只读侦察，不改产品代码）
- 权威源（AGENTS.md §5 红线 7，磁盘核验，未用 cordis_inspect_*）：
  - 宿主单例树：`C:\Users\Admin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\**`（下文记 `HOST`）
  - 本仓库：`D:\ZCodeProject\dsh-workspace-enhancement`（含其 `node_modules/@deepseek-ai/*`）
  - 两处 `dsh-fs` 声明面已交叉核对一致（`processPathFromHostPath` 均在 types/index.d.ts:106）
- 本插件接管的门面（src/plugin.ts，`ctx.set` 全量枚举，无遗漏）：
  - `fs` → `MixedFileSystem`（src/plugin.ts:100，src/mixed.ts:228）
  - `subprocess` → `MixedSubprocessRuntime`（src/plugin.ts:96，src/mixed.ts:161）
  - 自有服务 `sideWorkspaces` → `SessionSideWorkspaceStore`（src/session-workspaces.ts:340）
  - 自有服务 `ssh` / `sshRegistry`（由本插件的 SshRuntime/registry 提供，src/filesystem.ts:379、src/transport.ts:152 消费）

## 1. ctx.fs 门面成员矩阵（上游 `FileSystem` 全集，HOST dsh-fs/lib/types/index.d.ts:61–211）

上游成员共 15 个（1 个 getter + 14 个方法，其中 `processPathFromHostPath` 是**非抽象具现方法**，dsh-fs/lib/index.js:83 默认空实现返回 undefined）。

| 成员 | 上游声明 | 门面实现 | 宿主调用点（file:line） | 判定 |
|---|---|---|---|---|
| `sandboxMode` (get) | ✔ :75 | ✔ mixed.ts:236 | dsh-tool-fs/lib/index.js:1156；dsh-tool-str-replace-editor/lib/index.js:55–56 | 对齐 |
| `resolve` | ✔ :85 | ✔ mixed.ts:241 | dsh-tool-fs:273/655/804；dsh-agent-instructions:427/450/709；dsh-tool-str-replace-editor:70 | 对齐 |
| `processPath` | ✔ :97 | ✔ mixed.ts:260 | 宿主直接调用点未找到（仅 fs-local 内部 :716/:720/:723 与 dsh-tool-cordis 签名目录 :1247 附近） | 对齐（无外部调用点） |
| `processPathFromHostPath` | ✔ :106（具现） | ✘ **缺** | **dsh-llm-deepseek/lib/index.js:2029、dsh-llm-pi-ai/lib/index.js:2496**（`ctx.get("fs")?.processPathFromHostPath(hostPath)`） | **缺口 G1（=BUG-2 本体）** |
| `fileUrl` | ✔ :114 | ✔ mixed.ts:267 | 未找到调用点（仅 dsh-tool-cordis:1259 签名目录、fs-local:719 自身） | 对齐（预防性转发，正确） |
| `contains` | ✔ :122 | ✔ mixed.ts:274 | 未找到宿主调用点（宿主树 `.contains(` 命中全为 DOM/client UI） | 对齐（预防性转发，正确） |
| `stat` | ✔ :129 | ✔ mixed.ts:282 | dsh-tool-fs:274；dsh-agent-instructions:429/451/710；dsh-tool-str-replace-editor:73/143 | 对齐 |
| `lstat` | ✔ :144 | ✔ mixed.ts:289 | 宿主直接调用点未找到（tool 层未见 `.lstat(`） | 对齐（预防性转发） |
| `readText` | ✔ :153 | ✔ mixed.ts:303 | dsh-tool-fs:418；dsh-tool-str-replace-editor:132/166/197 | 对齐 |
| `streamText` | ✔ :163 | ✔ mixed.ts:310 | dsh-tool-fs:418；dsh-agent-instructions:599 | 对齐 |
| `readBytes` | ✔ :174 | ✔ mixed.ts:317 | dsh-tool-fs:1081 | 对齐 |
| `listDir` | ✔ :182 | ✔ mixed.ts:324 | dsh-skill-filesystem:630；dsh-tool-str-replace-editor:108 | 对齐 |
| `writeText` | ✔ :195 | ✔ mixed.ts:331 | dsh-tool-fs:659；dsh-tool-str-replace-editor:147/173/213 | 对齐 |
| `editText` | ✔ :209 | ✔ mixed.ts:348 | dsh-tool-fs:808 | 对齐 |

### 缺口 G1：`processPathFromHostPath`（严重级：会抛错 / BUG-2 本体）

- 证据：门面 `FileSystemBranch` 类型（src/mixed.ts:190–217）与 `MixedFileSystem` 类（src/mixed.ts:228–359）均无该方法；上游 dsh-fs/lib/index.js:83 给了默认具现「返回 undefined」，dsh-fs-local/lib/index.js:716 有真实实现（宿主路径→进程路径映射）。
- 调用点：`HOST dsh-llm-deepseek/lib/index.js:2029`、`HOST dsh-llm-pi-ai/lib/index.js:2496`，均为 `resolveImageAccess` 的附件图片授权回调。门面缺方法 → 回调抛 TypeError → 带图请求整单失败成 TRANSPORT（即 BUG-2 现象，详见 backlog BUG-2 行根因链）。
- 最小复现：任意会话发起一条带本地图片附件的请求（deepseek 或 pi-ai 路由），观察请求降级 TRANSPORT。
- 建议修法：一行转发——本地分支 `this.local.processPathFromHostPath(hostPath)`；远程 `ssh://` 前缀或 `dsw-routes` 占位路径返回其本地宿主映射（无映射即 `undefined`，与上游语义一致）。已由 t2/t4/t5 在 A 路处理，本报告只归档。

### 观察项（非缺口，不修）

- 门面经 `ctx.set('fs', new MixedFileSystem(...))` 替换的是**纯对象**而非 `FileSystem` Service 子类（src/plugin.ts:100）。宿主树未发现任何调用 Service 基类生命周期成员（dispose 等）于 `ctx.fs` 的代码，当前无影响；若未来上游在 FileSystem 基类新增具现方法（如本次 G1 的模式），门面仍会缺——**根因是「门面=子集类型」而非「Service 继承」**，建议后续把 `MixedFileSystem` 改为 `extends FileSystem`（或至少保持成员矩阵评审习惯，见 §4 建议）。

## 2. ctx.subprocess 门面成员矩阵（上游 `SubprocessRuntime` 全集，HOST dsh-subprocess/lib/types/index.d.ts:71–99）

上游抽象成员共 3 个；基类无其他公开成员（grep `^\s{4}...` 仅命中 :84/:91/:99 三处抽象签名）。

| 成员 | 上游声明 | 门面实现 | 宿主调用点（file:line） | 判定 |
|---|---|---|---|---|
| `resolveExecutable` | ✔ :84 | ✔ mixed.ts:169（**恒走本地**） | 宿主代码调用点未找到（仅 dsh-subprocess README:44 示例） | 对齐；见观察 O1 |
| `spawn` | ✔ :91 | ✔ mixed.ts:174 | dsh-bash-local:237/274；dsh-pwsh-local:327/352；dsh-tool-fs-search:169 | 对齐 |
| `spawnTerminal` | ✔ :99 | ✔ mixed.ts:183 | dsh-terminal-bash:968/981 | 对齐 |

### 观察项（非缺口，语义边界，不修）

- **O1 `resolveExecutable` 世界归属**：mixed.ts:156–159/169 注释声明其「world-less、恒本地」。当前宿主调用点不存在（未找到调用点），无实际影响；若未来有消费方在远程会话里 `resolveExecutable('bash')` 后把绝对路径交给 spawn，本地路径会经 `remoteArgvOf`（mixed.ts:134）被削成裸名，尚能自愈。判定：**无影响（当前）/ 文档边界（未来）**，建议在 ADR 记一条即可。
- 同 §1：门面是纯对象替换（plugin.ts:96），未继承 `SubprocessRuntime`。Service 契约要求「service dispose 时终止全部受管进程」（dsh-tool-cordis:3741 服务目录转述）；Mixed 纯对象没有 dispose 生命周期，终止语义实际落在两个内层 Service（LocalSubprocessRuntime / SshSubprocessEngine）上。宿主未调用 `ctx.subprocess` 的任何生命周期成员，**未找到调用点，无影响**；与 §1 观察项同根因。

## 3. sideWorkspaces 门面矩阵（本插件自有服务，上游不存在同名 seam）

- 上游核验：宿主全树 grep `sideWorkspaces` 零命中（README/md 也无）——该服务完全由本插件定义与消费，**不存在上游调用方，结构上不可能有「调用方存在、门面缺方法」缺口**。
- 公开面（src/session-workspaces.ts:339–463）：`statePath` / `list` / `listFor` / `get` / `match` / `attach` / `detach` / `update` / `persist`。
- 消费点全部在本仓库且已对齐：`match`（mixed.ts:62，经 `SideWorkspaceFace` 窄面）、`listFor`（tools.ts:432、web.ts:460）、`attach/update/get/detach`（web.ts:488/500/506/513）。门面 vs 消费逐一对齐，无缺口。

## 4. 反向检查：本插件「假设上游存在」的成员清单

| 我方调用 | 权威源证据 | 核对结果 |
|---|---|---|
| `setSandboxMode(session, mode)`（plugin.ts:64） | HOST dsh-sandbox-policy/lib/index.js:159 导出；types/session-mode.d.ts:49 声明 | 存在 ✔ |
| `ctx.on('session/created', …)`（plugin.ts:62） | HOST dsh-session/lib/types/index.d.ts:42 事件声明；多方消费同款 | 存在 ✔ |
| `ctx.get('sandboxPolicy')`（plugin.ts:87/109） | HOST dsh-sandbox-policy（SandboxPolicyService 默认导出） | 存在 ✔ |
| `ctx.get('jobs')` + `jobs.start(spec)`（exec-tools.ts:725/803/923） | HOST dsh-jobs/lib/index.js:61 注册服务名 `'jobs'`；types/index.d.ts:56 `start(spec: JobStart): JobId` | 存在 ✔（我方只消费 `start`，窄面安全） |
| `ctx.get('ssh')`（filesystem.ts:379、subprocess.ts:66）、`ctx.get('sshRegistry')`（transport.ts:152/169、web.ts:227） | 宿主树无提供方——**由本插件 SshRuntime 自产自销** | 自有 seam ✔ |
| `ctx.get('settings')`（locale/host.ts:61，可选判空） | 可选消费、判空守卫 | 安全 ✔ |
| client：`ctx.get('connection'/'workspaces'/'sessions')`（client/index.ts:168/214/216） | HOST dsh-api-workspace-controller/lib/types/client/index.d.ts:19 声明 `workspaces`；均为可选判空窄面 | 安全 ✔ |
| `session.ownEvents()` 之类 rc 变更面 | 本仓库 src/ 全量 grep 未发现使用 | 未使用，无风险 |

## 5. 结论汇总

| # | 项 | 严重级 | 状态 |
|---|---|---|---|
| G1 | `MixedFileSystem` 缺 `processPathFromHostPath`（dsh-llm-deepseek:2029 / dsh-llm-pi-ai:2496 调用） | **会抛错**（带图请求全变 TRANSPORT） | = BUG-2，A 路 t2 修复中，本报告仅归档 |
| O1 | `resolveExecutable` 恒本地的世界边界 | 无影响（未找到宿主调用点） | 建议文档化（ADR 一句话） |
| O2 | fs/subprocess 门面为纯对象替换而非 Service 子类，上游未来新增具现方法会再现 G1 模式 | 无影响（当前） | 建议后续把门面改为 `extends` 上游基类，或维持本报告式的成员矩阵评审 |
| — | subprocess 3 成员、sideWorkspaces 9 成员、其余 fs 13 成员 | — | 全部对齐 |

**除 G1 外未发现新的「调用方存在、门面缺方法」缺口。**

## 6. 建议 backlog 行草稿（供 t6 采纳，不入库由 t6 决定）

```markdown
| AUDIT-2 | todo | P3 | 契约审计 R14：把 MixedFileSystem/MixedSubprocessRuntime 门面改为 extends 上游 Service 基类（dsh-fs FileSystem / dsh-subprocess SubprocessRuntime），使上游新增具现方法（BUG-2 的 processPathFromHostPath 模式）自动继承而非缺方法抛错；顺带在 ADR 记录 resolveExecutable「恒本地」的世界边界。验收：typecheck 通过；Mixed 门面 instanceof 对应基类；check 全绿。Refs: docs/rounds/R14-BUG-2-contract-audit.md |
```
