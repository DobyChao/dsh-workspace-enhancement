# REQ-A6 调查：dsh-better-sidebar 适配面（2026-09-29，子代理调查归档）

> 调查途径：npm registry、GitHub（omdsh-dev/DSH-better-sidebar）、磁盘权威源（产品 profile 已装
> 0.19.0 含完整 TS 源码）、本仓库占用面盘点。未调用被禁的 inspect 工具。行号引用属已装 0.19.0 副本。

## 1. 包身份

- 包名 `dsh-better-sidebar`（无作用域；`@deepseek-ai/…` 变体 404）。最新 **0.24.1**（2026-09-28）；
  产品 profile 已装 **0.19.0**（2026-09-10）。MIT。3.9k stars / 376 forks，vitest 1293 用例 + e2e + CI。
  首发 2026-08-13，6.5 周 29 版——迭代极快，无稳定承诺。
- 依赖形态与我方 ADR-0009 一致：`dependencies` 无 `@deepseek-ai/*`，全走 peer；30 个 dependencies
  （CodeMirror 全家、mermaid、node-pty、ws 等），15.5 MB unpacked。
- 版本线与宿主家族一一绑定（README 兼容表）：0.19.x=`^0.1.5-rc.1`（现装）、0.21/0.22=`^0.1.7-rc.1`、
  **0.24.1=`^0.2.0-rc.1`**。cordis `^4.0.2~4.0.4`；optional peer `@huanlin/dsh-plugin-better-locale`。

## 2. 它是什么

VSCode 风格右侧栏+底部面板工作台（文件树 / CodeMirror / 真实终端 node-pty / git / 后台任务 /
侧边对话 / 内嵌浏览器），按会话隔离；8 种 tab 注册进 DSH **原生右侧栏**（接管内置「文件」页），
并把 `ctx.betterSidebar` 服务开放给第三方注册 tab 与文件预览器（官方生态 28+，接入指南
`docs/external-plugin-guide.md`）。服务只在 client half。

占用面（0.19.0 源码证据）：槽位 5 个——`settings.section`（设置卡）、`conversation.chat.turnTail`、
`conversation.session.header.utilities`（底部工作台开合钮）、`sidebar.right.pane.tab`(+`.title`)
（keyed，priority `extension` 接管内置 `files` kind）；宿主侧 inject `webServer/sessions/webRuntime/tools`，
路由自家前缀 `/sidebar/*`，工具 `terminal_*` 8 个 + `sidebar_open`；`cordis.patch.yml` 自挂 bundle。

**关键事实**：文件访问**不走 `ctx.fs` 接缝**——`fs-tree/operations/search`、git、pty 全部本地
`node:fs`/`node:child_process` 直连，以 session cwd 为根（ADR-0006 早有记录）。远程会话下它的
文件树展示的是宿主本地盘，模型经 `ctx.fs` 看到的远程文件不在其树里。

## 3. 重叠分析（对 docs/architecture.md §2.2 我方面）

- **直接冲突：零**。无 single 槽同占；我方不用 `sidebar.right.*`/`turnTail`，它不用我方两个
  `directoryFlow`/`header.actions`；路由（`/api/dsw` vs `/sidebar/*`）与工具前缀互不相碰。
  **两插件可无改动并存。**
- 同槽相邻（list 型，安全）：`settings.section` 双卡；`session.header.utilities` 我方远程状态单元
  与它的开合钮同排（注意视觉宽度）。
- 交叉不在槽位在数据面语义：见上「关键事实」。

## 4. 适配方向（对齐既有决策：ADR-0006 只对接不捆绑；ADR-0016 §4.3 列为可选增强）

- **A（推荐起步，1–2 天）**：client half `ctx.get('betterSidebar')` 判空 + `registerTab({ id:
  'dsw:workspaces', … })`，面板复用我方 browse/状态面（数据走 `/api/dsw`），badge 显示远程状态。
  硬规则：`dsh-better-sidebar` 必须 **optional peer + `optional: true`**；**禁止 value-import**
  （模块级 Symbol 身份，跨插件只走服务方法调用）；类型用 `import type {} from 'dsh-better-sidebar'`。
- **B**：`registerFileViewer` 注册远程路径预览器——仅作 C 的附属（远程文件不在其树里，单独无触发机会）。
- **C2（真集成，3–5 天）**：在我方自己的 tab 里自建远程文件树（browse 后端已有），不碰其内置 Files 页。
  （C1 改造它走 `ctx.fs` 接缝——ADR-0006 明确否决，勿做。）
- 不该做：抢 keyed 槽的 `files` kind（第三方互斗）。

## 5. 风险

1. **家族兼容**：产品宿主 0.1.5 家族 ↔ 它 0.19.x；宿主升 0.1.7/0.2.0 时它须跟 0.22.1/0.24.x。
   **0.2.0 宿主 boot 强制 peer**（compatibility.md 2026-09-29）——届时两插件 pin 都要同步过闸。
   适配代码必须 `features`/`version` 能力探测 + 降级，禁版本假设。
2. 服务契约漂移快：0.19→0.24 已有 `floatWindows` 删除、`registerTurnTailInterception` 移除、
   0.1.6 起 turnTail 改追加式 list；TabDescriptor 在演进。
3. lab 未装它：适配开发先在 lab 装（pnpm 11 拦 node-pty 构建需 `pnpm approve-builds`，README 有三步法）
   再共存 UAT；产品 profile 重装归用户（红线 2/3）。
