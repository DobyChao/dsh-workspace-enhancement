# R21 — AUDIT-6 设计定稿：远程会话审批门（路线 D+A，ADR-0020）

- 日期：2026-09-12
- 分支：`feat/audit-6-remote-approval-gate`（基于 `feat/req-i7-side-workspace-simplify`——其
  3 个提交尚未合入 master，ADR-0019 只在该分支上；按任务指令基于它）
- 产出：`docs/decisions/ADR-0020-remote-approval-gate.md`（accepted）+ `docs/backlog.md`
  AUDIT-6 行备注追加设计要点；**docs-only，无 src 改动**
- backlog：AUDIT-6 保持 `doing`（设计轮完成，实施轮待排期；验收标准不变）

## 1. 本轮做了什么

七项决策逐条定稿并写进 ADR-0020（结论+理由+被否方案），要点：

| # | 决策 | 结论 |
|---|---|---|
| 1 | 问询位置与覆盖面 | 单一接缝门：`spawn` 远程分支（插在 `SshSubprocessHandle` 异步启动段之首，同步契约不动）+ `spawnTerminal`；覆盖判定=shell 形状（`bash/sh/zsh/dash/pwsh/powershell` + `-c`/`-Command`；终端恒拦）⇒ 官方 bash/pwsh、sw_exec（同门）、win32 bash、后台任务全覆盖；SFTP 写/固定探针/临时连接明确不覆盖（诚实边界，REQ-I9 收口） |
| 2 | 触发面配置 | machines.json 逐机器单字段 `remoteApproval: 'off'\|'human'\|'ai'`，默认 `'off'`（升级零行为变化）；否决「全局+例外」（双真相） |
| 3 | agent 解析 | `ctx.get('agents').currentInitiator()`（AsyncLocalStorage 发起者面；仅路由/归因非授权）；reason 嵌标记+机器+命令预览（ask 不带参数的唯一补偿通道）；降级阶梯全 fail-closed、错误可区分 |
| 4 | AI answerer | `ctx.on('approval/request', h, {prepend:true})` 挂 `ctx.effect`；只认标记+机器 `'ai'`；v1=纯规则白名单（否决 LLM）；**红线：全量 catch、异常一律 next()**（throw 会把 waterfall 容器化成 unavailable、饿死人类） |
| 5 | never 策略 | 不特判；服务在 waterfall 前确定性拒绝，与人类拒绝同路；四类非 grant 结局各自可区分英文错误 |
| 6 | 路线 D 文案 | model-prompts 两英文常量（`remoteNoSandbox` 恒注入 / `remoteGateActive` 开门时注入）+ README/SECURITY 边界句 + UX-1 片段正典留 ADR-0015 + docs/uat 十场景大纲（ADR 附录 A） |
| 7 | 与 REQ-I7 关系 | 轴/机制/配置面三不同，不复活目录级粒度；副工作区不回权限业务 |

## 2. 调查方式与证据（全部磁盘权威源，未碰 cordis_inspect_*）

| 事实 | 出处（0.1.5-rc.1 全局安装树） |
|---|---|
| approval 服务契约：request 签名/五结局/never 先于 waterfall/fail-closed/需 open turn/审计对 | `dsh-user-approval/lib/index.js:131-192`、`lib/types/index.d.ts`、README |
| answerer=waterfall 监听器、ACP answerer 范式（owned+无 callId 即 next()） | `dsh-acp/lib/index.js:1115-1138` |
| 人类 UI answerer 经 api-remotes 按连接转发 | `dsh-api-remotes/lib/index.js:17-24, 105-129` |
| `ctx.agents.currentInitiator()` 存在且 loop 包 `withInitiator(this, kick)`；工具执行 `requireInitiator()` | `dsh-agent/lib/index.js:334/:364`、`dsh-agent-loop/lib/index.js:851/:513` |
| 服务接缝用 currentInitiator 归因的先例 | `dsh-web-search-deepseek/lib/index.js:288` |
| 审批消费降级范式（缺服务/缺 agent/四结局各自文案） | `dsh-tools/lib/index.js:3314-3365`（serviceAsk） |
| Cordis `on` 支持 `{prepend:true}` | `cordis/lib/index.js:336, 368-372` |
| 后台任务 `jobs.start` 同步调 `run()` ⇒ spawn 在 open turn 内 | `dsh-jobs-local/lib/index.js:131-138` |
| spawn 同步契约 / 终端异步契约 | `dsh-subprocess/lib/types/index.d.ts:75-105` |
| 我们句柄本就「同步构造+异步启动」 | 本仓库 `src/process.ts:47-94, 151` |

## 3. 验证方式与证据

| 项 | 命令 | 结果 |
|---|---|---|
| 静态闸门 | `npm run check:static` | ALL PASS（docs-only 改动；status.md 版本号校验不受影响——AUDIT-6 状态未变，无需 `npm run status`） |
| 构建必要性 | — | 无 src 改动 ⇒ 无需 `npm run build`（AGENTS §3 规则只约束 src 变更）；无测试/跨平台代码改动 ⇒ 无需 WSL 复验 |

真机行为验证（问询弹卡、白名单直行、never 拒绝文案等）属实施轮（ADR-0020 附录 A 十场景，
lab 执行）。

## 4. 影响面与遗留

- 实施轮直接按 ADR-0020 §3 的 11 项实现轮廓开工（新模块/engine preflight/answerer/
  machines 字段/提示词/词典/文档/UAT/依赖/测试）。
- 未验证假设四条已列 ADR-0020 §6（prepend 实际次序、远程 LSP 形状、无 callId 的 UI
  呈现、后台拒绝体验）——全部进附录 A 的 UAT 场景覆盖或已有安全向缓解。
- SEC-3（remote-full 无二次确认）不阻塞本线，知情记录照旧（ADR-0015）。
