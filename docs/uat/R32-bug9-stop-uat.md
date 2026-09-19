# UAT：BUG-9 远端任务停止（前台中止 / 后台 cancel / 启动窗 / 正常完成）

> 验收 [`backlog.md`](../backlog.md) `BUG-9` 行。实现档案 [`rounds/R32`](../rounds/R32-bug9-remote-task-stop-fix.md)；
> 根因 [`rounds/R31`](../rounds/R31-bug9-remote-task-stop.md)。**一份脚本**覆盖核心腿与直连腿。
>
> **一份脚本，两条腿**：核心腿（围栏档，或 **有核心的 danger**）与直连腿（**核心不在**）都要走。
> danger **不是**直连开关：机器上已 `core.deploy` 再切 `/permission danger-full-access`，
> 停止链仍是管家（`--sandbox off`）。PTY/terminal 不在本轮范围。

## 0. 基本信息

| 项 | 值 |
|---|---|
| 轮次 / 主题 | R32 — BUG-9 远端任务停止 |
| 验收对象 | 核心腿组杀、pending-abort、直连腿 steward（stdin EOF → 组杀）+ signal + close、有界等待 |
| 需求 / 缺陷 ID | BUG-9 |
| 脚本作者 / 日期 | agent / 2026-09-18（2026-09-19 lab 实测回填） |
| 预期耗时 | 20–30 分钟 |

## 1. 前置条件

| 项 | 值 |
|---|---|
| 分支 / 产物 | `fix/bug9-remote-task-stop`；`npm run build && npm pack`，lab 以 tarball 安装（AGENTS §3） |
| lab 地址 | `http://127.0.0.1:50599/`（`DSH_HOME=C:\Users\Admin\.dsh-lab`） |
| 远端 | 一台 **linux x86_64**，已部署核心（核心腿用）；`c1` 已注册 |
| 杀残留检查 | 远端可另开一个 SSH 终端跑 `ps -eo pid,pgid,cmd | grep -E 'sleep|ping'` |
| 样例长任务 | `bash -c 'sleep 600; echo done'`（前台）；`ping -c 600 127.0.0.1`（后台可读输出） |

**禁止**：在 3080 上执行；改产品 profile。

## 2. 步骤

### A. 核心腿（会话 workspace-write / read-only，围栏档）

| # | 操作 | 期望 | 观察点 | 结果 |
|---|---|---|---|---|
| A1 | 会话发 `bash`：`sleep 600`，立即点**停止** | 工具调用秒级返回（中止）；远端 `ps` 无该 `sleep`（组杀） | 中止结果；远端 ps | ☑ 通过（`Error: tool call aborted`；`ps` 无残留） |
| A2 | `bash` 后台跑 `run_in_background: true`：`ping -c 600 127.0.0.1`，随后 cancel 该 job | job 状态变 killed；远端 `ps` 无该 `ping` | job 面板；远端 ps | ☑ 通过（偏差：围栏 jail 禁 ICMP，`ping` 退出 2；改后台 `sleep 600` + `job_kill`，远端无残留） |
| A3 | 正常完成不回退：`bash -c 'echo hi && sleep 1 && echo bye'` | 输出 `hi`/`bye` 完整、exit 0 | 工具输出 | ☑ 通过（工具输出 `hi` / `bye`，无 pid 首行） |
| A4 | 启动窗（冷核心）：**先杀掉仍活着的 `dsh-core serve`**，再把远端 `~/.dsh-core/current` 暂挪走 → 发长任务（触发 fail-closed / 部署）→ 有停止按钮再点 | 中止生效或 fail-closed；**不得**出现「远端已起进程但本地已返回」的窗口残留。只挪 symlink、不杀缓存 serve = 测的是热核心，不算本步 | 远端 ps；页面错误 | ☑ 通过（fail-closed：`no command text was sent` + core missing；无停止按钮；`ps` 无 sleep） |
| A5 | 核心在位，`/permission danger-full-access` 后再 `sleep 600` 并停止 | 与 A1 相同（仍走核心 `--sandbox off`，**不是**直连腿） | 中止结果；远端 ps | ☑ 通过（chip「完全权限」；`tool call aborted`；`ps` 无残留） |

### B. 直连腿（核心不在：挪走 `~/.dsh-core` 或换未部署机器，会话 danger）

| # | 操作 | 期望 | 观察点 | 结果 |
|---|---|---|---|---|
| B1 | danger 且无核心：`sleep 600`，立即停止 | 秒级返回；远端 `ps` 无 `sleep 600` | 远端 ps | ☑ 通过（完全权限 + 无 `current`；aborted；`ps` 无残留） |
| B2 | 后台 `ping -c 600 127.0.0.1` + cancel | killed；远端无 ping | job 面板；远端 ps | ☑ 通过（同 A2 偏差：后台 `sleep 600` + `job_kill`；远端无残留） |
| B3 | 正常完成：`bash -c 'echo ok'` | 输出恰为 `ok`（无 pid 首行、无 steward 杂讯） | 工具输出 | ☑ 通过（工具输出恰好一行 `ok`，无 `DSW_STDIN_` / `kill -TERM 0`） |

### C. 老 OpenSSH（< 7.9，如 CentOS 7 的 7.4）直连腿 —— 有旧机才做

| # | 操作 | 期望 | 观察点 | 结果 |
|---|---|---|---|---|
| C1 | 旧机、无核心、danger：`sleep 600`，停止 | **仍能停**（steward 不依赖 signal request）；最迟 grace+2s 后调用返回 | 远端 ps；返回时间 | N/A（本机 OpenSSH_9.6p1 ≥ 7.9） |
| C2 | 旧机后台 `ping` + cancel | 同上 | 远端 ps | N/A |

> 无老机器时 C 区标 N/A（不进分母）；单测已覆盖「stdin EOF 给 steward + signal 被吞仍 close」链路。

## 3. 判定

| 项 | 值 |
|---|---|
| 通过线 | A/B 全区 ☑（C 区 N/A 或 ☑），且全程远端 `ps` 无一处残留 |
| 失败样例 | 前台返回了但远端仍有进程 = **不通过**；工具输出被 steward 污染 = **不通过** |
| 代理实测 | 2026-09-19 lab 50599：A1–A5、B1–B3 ☑，C N/A；结束时远端无 `sleep 600` / `ping -c 600`。证据 `$LAB_HOME\e2e\r32\`（不入库） |
| 结果 | ☑ 通过（用户 2026-09-19 确认 A/B 已测完；C N/A） |
| 用户签字 | 用户确认通过（2026-09-19） |

## 4. 环境指纹（2026-09-19 代理跑）

| 项 | 值 |
|---|---|
| 实例 / 端口 | lab / 50599（`DSH_HOME` 隔离）；3080 未碰 |
| 插件 | `0.2.0` tarball（含直连腿 steward），分支 `fix/bug9-remote-task-stop` |
| 宿主 | Windows；浏览器 Playwright Chromium 1440×900 / 中文 |
| 远端 | linux x86_64，已注册 `c1`（文档占位）；OpenSSH_9.6p1 |
| 模型 | GLM-5.3-Flash（lab 会话） |

## 5. 已知边界


- 官方 systemd scope + 进程树跟踪（第二保险）未实现：任务若自己 `setsid` 逃出进程组，
  组杀不达 —— 维持 R31 决定，第一期不做，失败样例请记录远端进程树。
- `SshTerminalHandle`（PTY 交互终端）不在本轮：PTY 信号经 line discipline 必达。
- boot-smoke 成功后不自行退出是既有 `INFRA-12`，与本轮无关。
