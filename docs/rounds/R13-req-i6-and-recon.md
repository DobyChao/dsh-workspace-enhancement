# R13（REQ-I6 + 并行侦察）— 系统提示词英文化/按需注入 + UX-1、REQ-I1 侦察 + 发布事实校正

## 目标

一轮内把「能并行的都推进」：**唯一的代码轨道**是把 model-facing 系统提示改为英文、并按会话工作区状态按需注入（**REQ-I6**，用户 2026-09-09 提出的「bug2」）；同时并行做三条只读/文档轨道——`UX-1`（远程会话权限显示 `Custom`）根因侦察、`REQ-I1`（对话/轨迹区可扩展面板 Tab）前置槽位侦察、以及发布状态回填。

## 拆解

AgentTeams 轮次 `dsw-r13-prompt-and-recon`（角色：captain / engineer-host / scout-ux / scout-slots / verifier / reviewer），共 12 个任务，成员共用一个工作树、**不做 git 写操作**（提交由 captain 收口）。

| 任务 | 类型 | 角色 | 依赖 | 内容 |
|---|---|---|---|---|
| t1 | work | verifier | — | 状态回填：`PUB-1`→shipped、`PUB-2` 备注改 link 装法、`REQ-I6`/`UX-1`→doing，刷新看板 |
| t2 | implementation | engineer-host | — | **REQ-I6 实现**：英文常量 + 按会话事实按需注入 |
| t3 | work | scout-ux | — | `UX-1` 侦察：预设表为何显示 `Custom`、插件内能否补 → `ADR-0015` |
| t4 | work | scout-slots | — | `REQ-I1` 侦察：客户端槽位契约 → `ADR-0016` |
| t5 | verification | verifier | t2 | 独立验证（自写探针，不采信实现者自述） |
| t6 | review | reviewer | t5 | 评审（**pass** + 2 条 low findings） |
| t7 | work | verifier | — | 发现并登记 `PUB-3`：npm 0.1.2 产物早于依赖对齐提交 |
| t8 | work | scout-ux | — | 核实并登记 `SEC-3`：`remote-full` 等价 full 沙箱却无风险确认门 |
| t9 | work | scout-slots | — | 把「Inspect 的磁盘等价物」沉淀进 `AGENTS.md` §5 与 `architecture.md` §8.1 |
| t10 | work | captain | — | 校正 `architecture.md` 键数 329→328、`ADR-0014` 日期 09-10→09-09 |
| t11 | verification | verifier | t2 | **最终态复验** + 修正 t5 报告的漂移数字 |
| t12 | work | captain | — | 收口：闭合 F1/F2、写本报告、按归属拆提交到短分支 |

关键设计（`ADR-0014`）：model-facing 文案（系统提示段 + 远端工具箱提示）**不进 i18n**，改由 `src/model-prompts.ts` 承载英文常量；注入判定只读**会话事实**（`context.scope` 即该会话 agent 的 `session.header.cwd/id` + `store.listFor(sessionId)`），无远程路由且无副工作区时两段 section 返回 `''`。

## 验证

- **静态闸门** `npm run check:static`：ALL PASS（含 `dictionary key sets equal — zh=328 en=328 onlyZh=[] onlyEn=[]`、CJK 硬编码闸门、backlog 行格式）。
- **类型**：`npm run typecheck` 0 错误。**单测**：`npm run test:agent` exit 0（215 tests / 209 pass / 6 fail，6 项全为 `spawn EPERM` 沙箱受限：2×`(process-level)` + `AUDIT-TC04/05/06/12`）。**构建**：`npm run build` 通过 + `lib/` import 冒烟。
- **独立探针**（验证者自写，非实现者测试）：`33/33 passed` —— 本地会话所有 section 合计文本 `[]`；远程会话 3 段且无汉字；仅副工作区（本地 cwd）也触发、未 attach 的会话仍为空；四个渲染函数 `.length === 1`（无 `TranslateFn` 形参，结构上无法接回 UI 语言）。评审侧另有生命周期探针 5/5（8 个注册全 `ctx.effect` 拥有、dispose 后零残留、re-mount 不抛 already registered）。
- **评审结论**：`t6` = **pass**（4 项合同检查全通过；未复用实现者自述，上游磁盘契约独立核对）。2 条 low findings 已在本轮闭合：**F1** `backlog.md` 的「11 键 340→329」→「12 键 340→328」；**F2** `ADR-0014` 补记代价④「本地会话不再收到 `sw_exec`/win32 bash 两段提示」。
- **留待 CI（未伪装通过）**：`npm test` 全量、`npm run check`、`npm run e2e`、4 个 `.tsx` 用例、6 个真进程/DACL 用例、框架真实 assembly 黑盒。
- **验证漂移事件（本轮实证教训）**：实现方在 t2 终态后又删除了孤立词典键 `tool.env.heading`（词典 340 → **328**），导致 t5 的取证数字停留在中间态 `329/329`。captain 复核后开 **t11** 以最终工作树复验并修正报告（新增 §0「两次取证差异」）；`t5` 的历史 output 保留 329 作为不可变历史，**权威口径为 t11 与报告 §0/§3 的 328/328**。

## 结果

- **`REQ-I6` 代码完成**（`done`）：新增 `src/model-prompts.ts`（英文常量 + `{name}` 插值）与 `src/session-remote-context.ts`（会话事实判定）；`src/tools.ts` / `src/exec-tools.ts` 的渲染函数去掉 `TranslateFn`、两段 section 改按需注入；`src/locale/{dsw,dsw.en}.ts` 删 12 键（340 → 328，zh/en 仍严格相等）；新增 `test/prompt-injection.test.ts`、`test/workspace-prompt-mount.test.ts`，更新 `test/{remote-prompt,side-prompt,remote-write}.test.ts`；`ADR-0014`（accepted）。
- **侦察产出（proposed ADR）**：`ADR-0015`（`UX-1`：部署预设表缺 `{danger-full-access, ask}` 组；插件内无注册入口 → 只能由用户改 `$DSH_HOME/profiles/web/cordis.patch.yml` 补 `remote-full`，patch 整键替换、原三组须一并写出）、`ADR-0016`（`REQ-I1`：槽位 `conversation.view` 可行、`replaceRisk: none`、tab id 发布后不可改名）。
- **真相源更新**：`PUB-1`→shipped（含 registry 时间戳与 tag 交叉证据）；新增 `PUB-3`（发布 0.1.3：已发布 0.1.2 的 `gitHead=d30dc57` **早于** `24ec425`，其 `dependencies` 仍挂 13 个 `@deepseek-ai/*`，属 `ADR-0009` 禁止形态）；新增 `SEC-3`（`blocked`）；`UX-1`→`blocked`（等用户拍板+落地）；`REQ-I1` 备注指向 `ADR-0016`；`docs/status.md` 重生成。
- **方法学沉淀**：`AGENTS.md` §5 红线 7 增补「被禁的 Inspect 有磁盘等价物」+ `docs/architecture.md` §8.1（`dsh-cordis-client-runner/lib/client.js` 的 `CLIENT_SLOT_API` / Service / Event Catalog；生成产物、只读引用、上游升级需重核）。此后槽位/服务/事件契约侦察不必再碰会挂起的 `cordis_inspect_*`。

## 遗留

- **待用户拍板**：① `UX-1` 是否采纳方案 A（片段见 `ADR-0015`；贴入 `cordis.patch.yml` 后重启 3080 生效）；② 是否把「`dsh-better-sidebar` 右侧面板 Tab」单列为 `REQ-I7`（`ADR-0016` §4.3 建议）。
- **待用户执行**：3080 重启（`scripts/restart-3080.ps1`，会话外）——本次重启会一并带上 REQ-I6 与（若采纳）`remote-full` 预设；`PUB-3` 发布（2FA）；本轮的 push / PR / squash merge。
- **知情项**：`SEC-3` —— `remote-full` 选中时无风险确认弹窗（客户端三处门只比 preset id 字符串），但审批仍为 `ask`，比内置 `danger-full-access`（`never`）更严；修法需 `dsh-client-ui-*` 上游改动，`ADR-0011` 已否上游 PR 路线。
- **留待 CI**：见上「验证」段。
- **流程改进（已记入长期记忆）**：成员任务进入终态后不得再改工作区；需要修正应开新任务或报 captain。

来源：`.agent-teams/dsw-r13-prompt-and-recon/team.json`、各任务 output 与 mailbox 上报、`docs/backlog.md`、`docs/status.md`、`docs/decisions/ADR-0014..0016`、`docs/rounds/R13-REQ-I6-verification.md`、`AGENTS.md` §3–§5。
