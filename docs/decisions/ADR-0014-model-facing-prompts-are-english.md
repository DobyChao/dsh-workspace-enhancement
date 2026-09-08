# ADR-0014: model-facing 文案统一英文，不进 i18n；远程段按会话事实按需注入

- 状态: accepted
- 日期: 2026-09-09（REQ-I6 落地）

## 背景

R6 的运行时国际化（ADR-0010）把三面文案统一进 `src/locale/` 的 `dsw` 命名空间：
客户端 UI、宿主「远程认知」系统提示、`sw_*` 工具描述与错误。落地后发现两类混装：

1. **模型面文案跟着 UI 语言漂移**。系统提示里的 `sw-remote` 段（远程强调 + 副工作区清单）、
   `tool:sw-exec` / `tool:bash` 段、以及 `sw_status` 的远端工具箱提示，都按
   `settings.locale.preference` 取词。于是同一个会话里，把设置页 Language 从中文改成英文，
   **模型的指令语言也变了**；而 `prompt.env.missing` 与 `tool.env.heading` 更是
   一个中文一个英文，同一条工具输出内部就混着两种语言（用户 2026-09-09 报为「bug2」）。
2. **远程段无条件注入**。`tool:sw-exec` / `tool:bash` 两段是静态字符串，注册即注入：
   纯本地会话（cwd 非路由、无副工作区）也会看到「sw_exec 在指定服务器上执行命令」，
   属于零信息噪音，也让「本插件到底在不在管这个会话」变得不可判断。

## 决定

### ① model-facing 文案英文常量，且**不进 i18n 词典**

- 新增 `src/model-prompts.ts`：`MODEL_PROMPTS`（`as const` 英文文案）+ `modelPrompt(key, params)`
  （`{name}` 插值，缺参保留原文，与词典 `lookup()` 同规）。
- 以下文案迁出词典、只保留英文一份：
  `prompt.remote.emphasis`、`prompt.side.fs.r|rw`、`prompt.side.exec.on|off`、
  `prompt.side.item|heading|note`、`prompt.env.missing`、`prompt.section.swExec`、
  `prompt.section.win32Bash`（连同下方 `tool.env.heading` 共 **12 键**，zh/en 两边同时删除，
  键集 340 → **328**，仍严格相等）。
  `tool.env.heading` 也随之删除：它只为「中英混装」而生，现在标题与缺件提示同源英文。
- 渲染函数签名随之收敛：`renderRemotePrompt(fact)`、`renderSideWorkspaces(items)`、
  `sideWorkspacePromptFact(item)`、`composeWorkspacePrompt(cwd, machine, sides, dshBase?)`、
  `renderRemoteEnvProbe(probe)` 不再接受 `TranslateFn` 参数——**没有任何开关能改它们的语言**，
  这是刻意的：参数一旦存在，下一个人就会把 UI 语言接回去。

**边界**：`tool.*`（工具描述/参数/错误/输出）仍留在词典里双语——用户能读到工具错误，
它们属「人类面」。本 ADR 只收口**注入进系统提示的文案**与远端工具箱提示。

### ② 远程段按会话事实按需注入

- 判定函数 `hasRemoteWorkspaceContext(context, store)`（`src/session-remote-context.ts`）：
  `context.scope` 即该会话 agent → `session.header.cwd/id`（叶子字段）；
  **cwd 解析出远程路由**（`ssh://<id>/…` 或占位树）**或**该会话有至少一个副工作区 → `true`。
- `sw-remote`（order 90）沿用原判据（本来就是按会话组合）；`tool:sw-exec` / `tool:bash`
  （order 105）由静态字符串改为 `text: context => hasRemoteWorkspaceContext(...) ? 文案 : ''`。
- 会话事实读取抽到 `src/session-remote-context.ts`：`tools.ts` → `exec-tools.ts` 保持单向，
  `exec-tools.ts` 不再回头 import `tools.ts`（否则是值导入环）。
- `registerSwExec` / `registerWin32Bash` 的 opts 增加 `sides?: () => SessionSideWorkspaceStore | undefined`
  （可选：没有副工作区服务时退化为「只看 cwd 路由」）。`registerWorkspaceTools` 把 `web.ts`
  已持有的 store 访问器透传下去，因此判定与 `sw-remote` 用的是**同一份**会话事实。

## 后果

- 本地会话（无远程路由、无副工作区）三段 model-facing 文案**零注入**；
  远程会话文案全英文且只在远程事实成立时出现（`test/prompt-injection.test.ts` 锁定）。
- 切 UI 语言不再改变模型看到的系统提示；工具输出内部不再中英混装。
- 代价 ①：**i18n 覆盖面积缩小**（12 键，340 → 328）。代价是有意支付的：model-facing 文案本来就没有
  「用户语言」这个语义，把它塞进 UI 词典只会制造一个假开关。
- 代价 ②：`modelPrompt()` 的键集合不再受 `Record<DswKey, string>` 那样的编译期完整性保护。
  用 `as const` + `ModelPromptKey` 让拼错的键仍是编译错，但「某键是否被引用」没有闸门——
  与词典同级的静态闸门仍覆盖键集相等与 CJK 硬编码。
- 代价 ③：`tool:sw-exec` / `tool:bash` 段变成 per-assembly 求值（每次组装多一次
  `remoteRouteFromCwd` + 可能的 `listFor`），与 `sw-remote` 同量级；无缓存，避免会话状态漂移。
- 代价 ④（t6 评审 F2 补充，便于 UAT 认可）：**本地会话（含 Windows 本地会话）不再收到
  `sw_exec` / win32 bash 两段提示**——模型在纯本地会话里只能从工具清单发现 `sw_exec`，
  不再被提示「可指定服务器执行」。这是按需注入的直接后果，行为符合 REQ-I6 ②（有意的降噪）；
  工具本身仍注册、仍可显式调用，调用时的错误文案不变。
- `scripts/check.mjs` **不需要改**：CJK 闸门本就只禁 `src/locale/**` 之外的**中文字面量**，
  英文常量天然合规；词典闸门继续保证 zh/en 键集相等。

## 被否方案

- **保留词典 + 注入时固定 `lookup('en', …)`**：行为上等价，但键仍在词典里，任何人接上
  `locale.t` 就复发；删键才是把「model-facing 不入 i18n」变成结构约束。
- **给 `prompt.*` 加 `{locale: 'en'}` 之类的旁路参数**：同一个词典两套语义，闸门无法区分。
- **`tool:sw-exec` 段按「是否存在已保存机器」注入**：机器是全局注册表事实，与会话无关——
  本地会话只要存过一台机器就会重新看到噪音；判据必须是**本会话**事实。
- **`tool:bash` 段常驻（因为它只在 win32 注册，本来就少见）**：本地 Windows 会话正是最常见的
  场景，常驻即等于对最多数会话注入零信息噪音。
- **给注入判定加缓存**（按 sessionId 记结果）：副工作区可在会话中途 attach/detach，
  缓存要么过期要么需要失效通知，收益不抵复杂度。
