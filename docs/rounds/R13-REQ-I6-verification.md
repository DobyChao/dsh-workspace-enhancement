# REQ-I6 独立验证报告 — 系统提示词英文化 + 按工作区状态按需注入

- **需求**：`REQ-I6`（`docs/backlog.md` §2；状态 `doing`）
- **被验对象**：t2（engineer-host）的**未提交工作树改动**（HEAD 仍为 `e0334ac`；本报告对**校准后**的工作树最终状态负责）
- **验证者**：verifier（t5，attempt `4303c7b6`）
- **日期**：2026-09-09（本地 UTC+8）
- **性质**：验证报告（**不是轮次收口报告**；REQ-I6 的评审与提交由 reviewer / captain 收口）

> **证据纪律**：本报告只认「命令 + 退出码 + 断言位置/输出片段」。
> 实现者 t2 的自述**未被采信为证据**，凡引用均标注为「t2 自述」并给出独立复现路径。

## 0. 校准记录（验证期间实现发生一次修正）

captain 于 t5 期间通知「验证对象漂移」，t11 据此**以最终工作树为唯一验证对象**复验。两次取证的差异如下：

| 项 | t5 首次取证（早于收尾修正） | t11 复验（最终工作树） |
|---|---|---|
| 取证时刻 | 01:17 前（`src/locale/dsw.ts` 仍为中间态） | 01:20 之后（`dsw.ts`/`dsw.en.ts` 最后写入 01:17:53） |
| `check:static` 键数 | `zh=329 en=329` | **`zh=328 en=328 onlyZh=[] onlyEn=[]`** |
| 差异来源 | 收尾修正**删除孤立键 `tool.env.heading`**（该键在实现中已无引用；`grep 'tool.env.heading' src/` → 0 命中） | 已确认：HEAD 340 − 12 键 = 328 |
| `typecheck` / `test:agent` | 0 错误 / 215 tests·209 pass·6 sandbox-limited fail | **完全一致** |
| 独立探针 | 33/33 | **33/33（复跑）** |
| ADR-0014 日期 | 2026-09-10 | **2026-09-09（t10 已校正）** |

| 事实 | 数值 / 证据 |
|---|---|
| 本轮删除的词典键 | **12 个** = 11 个 `prompt.*` + `tool.env.heading`（`git diff -- src/locale/dsw.ts` 逐键列出；zh/en 各删 19 行） |
| HEAD（`e0334ac`）键数 | **340**（`git show HEAD:src/locale/dsw.ts` 计数） |
| **最终工作树键数** | **328/328**，`zh/en onlyZh=[] onlyEn=[]`（`npm run check:static` 复跑，exit 0） |
| 验证期间的收尾修正 | 实现方在 t2 终态后删除**孤立键 `tool.env.heading`**（`src/locale/dsw.ts`/`dsw.en.ts` 写入 01:17:53），词典 340 → **328**；`docs/architecture.md` §5.8 与 ADR-0014 的日期由 t10 同步校正 |
| 受影响断言 | 仅「键数」数字与 V1 日期；**全部行为断言已在最终工作树复跑通过**（§3、§5） |
| 本报告口径 | 一律以 **328/328（最终工作树）** 为准；329/329 作为「中间态」记录在此，不作为结论 |

`docs/architecture.md` §5.8 的旧数字（340 → 329）由 captain 在 t10 校正为 328，**不属本报告 inScope**，本报告不改该文件。

另据 captain 裁定：t2 的 inScope 外连带文件（新增 `src/model-prompts.ts`、`src/session-remote-context.ts`、`test/prompt-injection.test.ts`、`test/workspace-prompt-mount.test.ts`；修改 `test/remote-write.test.ts`、`docs/architecture.md`、`docs/backlog.md`）按「必然连带，接受」处理，**不记为越界**；`AGENTS.md` 与 `docs/architecture.md` §8.1 的「Inspect 磁盘等价物」小节属另一条轨道（t9），与 REQ-I6 无关。

## 1. 目标与验收口径

REQ-I6 两条：

1. **英文化**：model-facing 文案统一英文、不随 UI 语言切换（`sw-remote`、`tool:sw-exec`、`tool:bash`、`sw_status` 远端工具箱提示）。
2. **按需注入**：无远程事实、无副工作区时 `tool:sw-exec` / `tool:bash` 两段**零注入**。

backlog 原句验收：本地会话系统提示不出现本插件文案；远程会话文案全英文且仅在远程事实成立时出现。

## 2. 验证环境与通道限制

| 项 | 事实 |
|---|---|
| 平台 | Windows（本机 pwsh 通道），DSH 文件沙箱 `workspace-write` |
| 可用通道 | `npm run check:static`、`npm run typecheck`、`npm run test:agent`（单进程，无 esbuild） |
| **不可用通道** | `npm test`（逐文件 spawn → `EPERM`）、`npm run check`（含 `npm test`）、`npm run e2e`（Playwright，需本地 shell） |
| 留待 CI | 全量 `npm test`（含 4 个 `.tsx` 依赖 esbuild 的用例文件）、真进程用例、`npm run check`、lab E2E 双语切换 |

## 3. 三条 verify 命令（真实执行记录）

| 命令 | 退出码 | 观察到的结果 |
|---|---|---|
| `npm run check:static` | **0** | 16/16 `[check.mjs] PASS` + `[check.mjs] ALL PASS`；其中 `dictionary key sets equal — zh=328 en=328 onlyZh=[] onlyEn=[]`（**校准后复跑**）、`no CJK string literal outside src/locale/**`、`docs/backlog.md rows carry a status — 41 row(s), 0 malformed` |
| `npm run typecheck` | **0** | `tsc --noEmit` 无输出（0 错误） |
| `npm run test:agent` | **0** | `23 test files: 19 runnable, 4 need esbuild (JSX)`；`tests 215 / pass 209 / fail 6`；`[test-agent] SANDBOX-LIMITED PASS — 6 failure(s), all blocked by the file sandbox` |

> **t11 最终复跑声明**：上表三条命令在**最终工作树**（`src/locale/*.ts` 最终写入 01:17:53 之后）**重新执行**，
> 退出码均为 0；`check:static` 的键数为 **`zh=328 en=328`**（与 t10 一致），`typecheck` / `test:agent` 统计与首次取证相同；
> §5 独立探针同样在最终工作树复跑 **33/33**。本节数字即最终态，报告内不再保留 329 作为结论。

`test:agent` 的 6 个失败**逐条核对**（均为沙箱受限，与 REQ-I6 无关）：

| 失败用例 | 位置 | 受限原因 |
|---|---|---|
| `MixedSubprocessRuntime: a local cwd executes on the local branch (process-level)` | `test/mixed-routing.test.ts:155` | 真进程 spawn |
| `MixedFileSystem: local cwd reads/writes/lists through the real local backend (process-level)` | `test/mixed-routing.test.ts:307` | 真进程 spawn |
| `AUDIT-TC04` / `AUDIT-TC05` / `AUDIT-TC06` / `AUDIT-TC12` | `test/side-workspace-attacks.test.ts:255/266/272/281` | `spawn EPERM`（`dsh-subprocess-local` → `MixedSubprocessRuntime.spawn`） |

> **权威判定**：以上 6 项必须由 CI 的 `npm test` 判定；本报告不把它们计为通过，也不计为代码失败。

## 4. 验收项逐条取证

### 4.1 ① 英文化解耦 —— 通过（结构 + 行为双证据）

| 断言 | 证据 | 结果 |
|---|---|---|
| 12 个键**已从 zh/en 词典删除**（11 个 `prompt.*` + `tool.env.heading`） | `git diff -- src/locale/dsw.ts` / `-- src/locale/dsw.en.ts` 逐键列出（各删 19 行）：`prompt.remote.emphasis`、`prompt.side.fs.r/rw`、`prompt.side.exec.on/off`、`prompt.side.item/heading/note`、`prompt.env.missing`、`prompt.section.swExec`、`prompt.section.win32Bash`、`tool.env.heading` | PASS |
| zh/en 键集仍严格相等 | `check:static`（校准后复跑）→ `zh=328 en=328 onlyZh=[] onlyEn=[]`（HEAD 340 − 12 = 328，与 §0 校准记录一致） | PASS |
| 全仓 `src/` 已无任何 `prompt.*` 键引用 | `grep -E "prompt\.(remote|side|env|section)\.|tool\.env\.heading" src/` → **无匹配** | PASS |
| 渲染函数**不再接受翻译器参数**（没有开关能把 UI 语言接回来） | 独立探针 `renderRemotePrompt.length === 1`、`sideWorkspacePromptFact.length === 1`、`renderSideWorkspaces.length === 1`、`renderRemoteEnvProbe.length === 1`（`src/tools.ts:98/119/135/201`） | PASS |
| 文案唯一来源是英文常量 | `src/model-prompts.ts:27` `MODEL_PROMPTS = { … } as const`（11 个键，全英文） | PASS |
| **行为**：即使宿主 locale 报 `zh`，注入文本仍无汉字 | 独立探针（见 §5）在 `ctx.get('settings') → { locale: 'zh' }` 的替身下逐段求值：`tool:sw-exec` / `tool:bash` / `sw-remote` 文本 `!/[\p{Script=Han}]/u` 全部成立 | PASS |
| `sw_status` 远端工具箱提示（原 zh/en 混装）现为纯英文 | 独立探针 D5：`Remote environment:` + `Hint: the remote is missing pwsh, rg … ripgrep`，无汉字 | PASS |

> **说明**：`tool.*`（工具描述/参数/错误/输出）仍双语属 ADR-0014 明示边界，未纳入本条断言。

### 4.2 ② 按需注入 —— 通过（含「判定只来自本会话事实」）

| 断言 | 证据（独立探针，非实现者测试） | 结果 |
|---|---|---|
| 判定函数：本地 cwd / 无 cwd / 空 scope → `false` | `hasRemoteWorkspaceContext` A1–A3 = `false`（`src/session-remote-context.ts:74`） | PASS |
| `ssh://<id>/…` 与占位树 → `true` | A4–A5 = `true`（`remoteRouteFromCwd`） | PASS |
| 仅副工作区（cwd 本地）→ `true`；未 attach 的会话 → `false` | A6 = `true`；同一挂载下 `s2` 仍 `''`（B10、C9） | PASS |
| `tool:sw-exec` 本地零注入 / 远程注入英文 | B3 `''`、B4 `''`、B5 `'sw_exec executes a command on the specified server…'`；注册点 `src/exec-tools.ts:857` `text: context => hasRemoteWorkspaceContext(context, opts.sides) ? modelPrompt('sectionSwExec') : ''` | PASS |
| `tool:bash` 同样按需 | B6 `''`、B7 `'The bash tool targets remote Linux workspaces…'`；`src/exec-tools.ts:1017` | PASS |
| 整条插件行挂载后，本地会话**所有 section 合计零文本** | C3 `[]`、C4 `[]`（`registerWorkspaceTools` 真实挂载，`src/tools.ts:427-438`） | PASS |
| 远程会话三段齐备且全英文 | C5 = 3 段（win32 宿主）、C6 无汉字、C7 含 `remote SSH workspace` 与 `sw_exec …` | PASS |
| 判定与会话事实**同源** | `src/session-remote-context.ts:51-81` 是 `sw-remote` 与两段 tool section 共用的唯一实现；`src/tools.ts:445-446` 把 `sides` 透传给 `registerSwExec` / `registerWin32Bash` | PASS |

### 4.3 用户可见文案口径变化（有意，非缺陷）

`sw_status` 的远端工具箱提示从「标题中文 + 缺件提示中文/英文混装」改为**纯英文**：
中文 UI 用户会看到英文的工具输出行。这与 ADR-0014「注入进模型上下文的文案英文、工具错误/描述保留双语」一致，但属用户可感知变化，**建议 reviewer / UAT 明确认可**。

## 5. 独立复现步骤（不复用实现者测试）

```pwsh
# 1) 三条 verify 命令（本报告的真实执行记录）
npm run check:static ; npm run typecheck ; npm run test:agent

# 2) 独立探针（验证者自写，挂真实注册函数 + 中文 locale 替身，33 项断言）
node --experimental-transform-types .tmp/t5-verify-injection.mjs
#    → === t5 independent probe: 33/33 checks passed ===   (exit 0)
```

探针覆盖：A 判定纯函数 7 项、B 两段 tool section 10 项、C 整行挂载 9 项、D 渲染函数英文与签名 7 项。
关键断言形态（可直接抄进后续回归）：

```js
const local  = sections.map(s => textOf(s, asm('C:\\Users\\me\\proj', 's1'))).filter(t => t !== '')
assert.deepEqual(local, [])                                  // 本地会话零注入
const remote = sections.map(s => textOf(s, asm('ssh://c1/srv/work', 's1'))).filter(t => t !== '')
assert.ok(remote.every(t => !/[\p{Script=Han}]/u.test(t)))    // 远程会话全英文
```

> 探针脚本是**未入库**的临时验证资产（`.tmp/`，已 gitignore）；本报告记录了它的断言与结论，脚本本身不入库。
> **校准后复跑**（`src/locale/*.ts` 最终写入 01:17:53 之后）：`node --experimental-transform-types .tmp/t5-verify-injection.mjs`
> → `=== t5 independent probe: 33/33 checks passed ===`，exit 0 —— 即 §0 的键数修正**不影响任何行为断言**。

## 6. 未覆盖 / 留待 CI（未伪装成通过）

1. **`npm test` 全量**（`node --import tsx --test "test/**/*.test.ts"`）——沙箱内逐文件 spawn `EPERM`，**留待 CI**。
2. **4 个 `.tsx` 用例文件**（`machine-form` / `row-badges` / `settings-banner` / `status-center`）在 `test:agent` 中 **SKIP**（需 esbuild），**留待 CI**。
3. **6 个真进程 / DACL 用例**（§3 表）——沙箱受限，**留待 CI**。
4. **`npm run check`**（含 build + pack 冒烟）与 **`npm run e2e`**（lab 50599 黑盒）——本通道不可执行，**留待 CI / 本地 shell**。t2 自述「build OK、lib import 冒烟 OK」**未被本报告采信**。
5. **框架真实 assembly 的黑盒验证**：本轮以「真实注册函数 + 替身 assembly context」覆盖；框架真实会话中「切 Language 后系统提示不变」的用户可见结论需 lab E2E 复核。

## 7. 观察项（不影响本轮结论，供 reviewer / 后续轮处理）

| 编号 | 观察 | 级别 |
|---|---|---|
| V1 | `docs/decisions/ADR-0014` 日期**曾写 2026-09-10**（实际日为 2026-09-09）。**已由 t10 校正为 `2026-09-09`**：复核 `Select-String -Path docs/decisions/ADR-0014-*.md -Pattern '日期'` → `- 日期: 2026-09-09（REQ-I6 落地）`（文件写入 01:19:03，晚于本报告首次取证） | 已闭合 |
| V2 | 本报告验证的是**未提交工作树**；t2 的改动集（`src/tools.ts`、`src/exec-tools.ts`、`src/model-prompts.ts`、`src/session-remote-context.ts`、`src/locale/*`、3 个测试文件、ADR-0014）尚待 captain 收口提交 | 提示 |
| V3 | `sw_status` 远端工具箱提示改英文对中文 UI 用户可见（§4.3） | 需认可 |
| V4 | **已闭合**：`docs/architecture.md` §5.8 曾写「340 → 329」，captain 已在 t10 校正为 328（不在本报告 inScope） | 已处理 |

## 8. 结论

REQ-I6 的两条验收（**英文化解耦** / **按需注入零泄漏**）在**可执行通道内全部取得独立证据**，并已对**最终工作树（t11 复验）**重新取证：
三条 verify 命令退出码 0（`check:static` 键集 **`zh=328 en=328`**）；独立探针 **33/33**；结构断言（无 `prompt.*` 引用、渲染函数无翻译器参数）全部成立。
三条行为结论在最终树上依旧成立：**本地会话零注入**、**远程会话全英文**、**仅副工作区（本地 cwd）也触发注入**。
**未发现实现缺陷或验收不符**。剩余风险集中在沙箱无法覆盖的全量单测 / 真进程 / E2E，已按 §6 显式标注**留待 CI**。

来源：本报告 §0/§3–§5 的实测输出（`npm run check:static` / `npm run typecheck` / `npm run test:agent` / `.tmp/t5-verify-injection.mjs`，t11 在最终工作树复跑）；`git show HEAD:src/locale/dsw.ts` 与工作树键计数；`src/tools.ts`、`src/exec-tools.ts`、`src/model-prompts.ts`、`src/session-remote-context.ts`、`src/locale/dsw.ts` 的最终工作树状态；`docs/decisions/ADR-0014-model-facing-prompts-are-english.md`（日期已由 t10 校正为 2026-09-09）；`docs/backlog.md` REQ-I6 行；captain 的 t5 校准通知与 t11 复验任务单
