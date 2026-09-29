# R44 — INFRA-21：跨 agent 协作协议 + 三份调查折入

> 一轮 = 一条指令（完成 INFRA-21）= 一个 PR（#51，squash `4b10e3e`）；同会话折入 REQ-A6 /
> UPSTREAM-11 / UX-8（原 REQ-I21）三份子代理调查与 PUB-8 发版窗口拍板。日期：2026-09-29。

## 1. 交付（PR #51）

- **AGENTS.md §7 协议四条**（198/200 行）：点名派发 = 恰好一个 PR；开工先 preflight + 自报
  browser-use 等探测不了的能力；缺能力 ⇒ `agent-missing:<cap>` 进 §3 不静默跳；接续三件套
  （WIP 提交 + backlog 备注现状/下一步 + PR 评论交接）——项目状态不依赖任何 agent 会话记忆。
- **`npm run preflight`**（scripts/preflight.mjs）：环境能力报告（node/npm/git/gh/wsl/lab 端口/
  home/tarball），容错探针、`--json`；是报告不是闸门。
- **`scripts/lib/doc-edit.mjs`**（+5 用例）：`replaceOrThrow`/`mustInclude`。**首战实绩**：本轮
  内三次拦下自己的失配编辑（CRLF 混合行尾 ×2、正则空匹配、`\r` 行尾导致恒等替换）——R41–R43
  教训的工具化即刻回本；顺带修复 R42 遗留（INFRA-19/20 行卡 §1 doing）。
- 同轮折入：三份子代理调查归档（better-sidebar / 桌面版 / 侧栏插槽）+ REQ-I21→UX-8 改名
  （用户纠正：呈现类走 UX 前缀）+ PUB-8（I14+I17 完成后发 0.2.3）。

## 2. 三份调查一句话结论

- **REQ-A6**（better-sidebar）：零槽位冲突可并存；适配 = optional peer + `ctx.betterSidebar.registerTab`
  （A 起步→C2 远程树），待拍方向。
- **UPSTREAM-11**（桌面版）：官方桌面 = Electron 壳包完整 web 应用，desktop profile 用 web 模板
  bundles ⇒ **架构零改动可用**；适配 = 文档 + 桌面真机 UAT（ssh2/dsh-app:// 转发/machines.json
  并发）+ 每周探 monorepo `project-manager.ts`。
- **UX-8**（侧栏行）：分组行三代皆无官方槽（截图控件即我方 DOM 增辉）；Session 行 0.1.7 起 4 槽；
  机会 A=data-row-key 锚、B=迁官方槽，待拍。

## 3. 验证

check:static + typecheck + test:agent（51 文件）+ build + WSL verify 全绿；preflight 双模式实跑；
PR #51 CI 全绿（含折入 bookkeeping 的三次追加推送）。合并后 master 收尾：INFRA-21 → §4、
I14/I17 行加「下一轮」点名注（跨会话状态入库）、本档案、status 再生。

## 4. 教训

- 行尾混合（CRLF/LF）是 Windows 仓库脚本化编辑的头号暗坑：本轮 doc-edit 的三次拦截全与它有关。
  后续可考虑给 doc-edit 加 `readText/eolOf` 伴生助手（未做，够用时再说）。
- 子代理调查模式（后台 general-purpose + 只读约束 + 磁盘权威源指引）本轮跑通三次，产出质量高、
  零事故——作为「用户提需求→先调查→拍板→实现」流程的固定一环沉淀。

## 5. 遗 tail

- I14+I17（下一轮，用户已点名，一轮一 PR→PUB-8 发版）；三个调查待拍板；tag-watch 明晨将报
  next→0.2.0-rc.2（预期）。
