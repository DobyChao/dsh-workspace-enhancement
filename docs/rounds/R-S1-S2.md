# S1+S2 — 跨服务器执行 `sw_exec` + win32 宿主 `bash` 接缝

## 目标

**S1**：新增模型工具 `sw_exec`——在指定 `server`（机器 id）上执行命令，规格对齐官方 `bash`/`pwsh`
（`command` / `description` / `timeoutMs` / `workdir` / `run_in_background`），按目标机 OS 选择
`bash -c` 或 `pwsh -Command`；**S2**：win32 宿主补注册 `bash` 工具，让 Windows 用户在远程 Linux
主工作区直接使用 bash（本地 Windows 会话下诚实报错，绝不静默降级）。
需求 ID：**S1 / S2**（`drafts/sw-exec-requirement.md`；起因见 CONTEXT §7「Windows 远程工作区只有 pwsh 工具」）。

## 拆解

AgentTeams 轮次 `sw-exec-team`（角色：engineer5 / reviewer5 / e2e5 / writer5）。

| 任务 | 角色 | 依赖 | 内容 |
|---|---|---|---|
| t1 | engineer5 | — | 实现 `sw_exec` + win32 `bash` 工具（含单测） |
| t2 | reviewer5 | t1 | 评审 `sw_exec` / win32 `bash` 实现 |
| t3 | e2e5 | t2 | 真跑验证（`sw_exec` c1 + background stub + `bash` 远程） |
| t4 | writer5 | t2 + t3 | 文档同步 + 提交推送（不 bump 版本） |

## 验证

- **单测**：202/202（175 + 27 新增）；typecheck 0 错误；build 成功；`lib/exec-tools.js` 冒烟 OK。
- **评审（t2）**：**needs-fix（minor：3 项必改 + 4 项建议）**，对照官方 `dsh-tool-bash` 逐项核验：
  ① 中止路径抛普通 `Error('…tool call aborted')` → 应抛 `HarnessError(message, TOOL_ABORTED)`
  且 `name='AbortError'`（官方同款）；② background 分支缺 `exec.signal.aborted` 预检（会生成孤儿
  job）；③ `timeoutMs` 未对齐官方语义（默认 120s / 上限 600s 钳制）→ 三项修复后复验 **approve**。
- **真跑（t3）**：**17/17 PASS**——`node --import tsx` 直调（无浏览器、未启动任何服务器），
  真实 `SshRegistry` + 真实混合 provider + 真实连接：`swExecCore('c1', 'echo sw-ok; uname -s')`
  → exit 0 / OS 判定正确；background 经 `ctx.jobs` 可收集；win32 `bash` 远端真跑；
  本地会话诚实报错。

## 结果

- 交付 `src/exec-tools.ts`：OS 探测（`uname` → `cmd /c ver` → unknown，按连接缓存）、
  `buildShellArgv`、`swExecCore`（server 解析 / workdir 归一 / deadline abort +
  `[timed out after Nms]` / 1 MiB tail + 8 MiB spill / 非 0 退出如实报告）、
  `registerSwExec`（`tool:sw-exec` section order 105）、`registerWin32Bash`（**仅 win32** 注册，
  避免与 POSIX 宿主官方 `bash` 冲突）。
- 修复项：Abort 归类 `HarnessError(TOOL_ABORTED)`、background 注册前 abort 预检、
  `timeoutMs` 默认 120s / 上限 600s 钳制并回报生效值。
- 文档：README（EN/ZH）功能表新增「跨服务器执行」行、`drafts/sw-exec-requirement.md` 状态更新。
- 提交：`9fb61b2`（feat: sw_exec cross-server execution tool + win32 bash seam，push `main`
  `0b0c9ce..9fb61b2`，**未 bump 版本 / 未打 tag**）。
- 发布：**`v0.1.1` 于 2026-08-29 发布**（用户 2FA；`tag v0.1.1` = `2f7503f`）；
  `CHANGELOG.md` 0.1.1 节记录该轮质量与修复。

## 遗留

- **3080 尚未换装 0.1.1**（换包命令 `dsh plugin --profile web add dsh-workspace-enhancement` 可由
  agent 执行，重启仍归用户）——最终并入 `0.1.2` 换装。
- `sw_exec` 不支持本地 `server`，因此不受「副工作区 `fs:r` + `exec:on` 被 `workdir` 绕写」影响
  （该问题只由官方 `pwsh`/`bash` 的 `workdir` 入口触发，CONTEXT §7）。
- 副工作区 `exec: off` 的权限门对 `sw_exec` 同样生效（命中即拒绝）。
- 后续轮引用：R6 I18N（`sw_*` 工具描述/参数/输出/错误键化）。

来源：`.agent-teams/archive/sw-exec-team/team.json` + `inbox/captain.jsonl`；`drafts/CONTEXT.md` §6.2、§7；`CHANGELOG.md` 0.1.1；`drafts/sw-exec-requirement.md`
