# UAT：BUG-9 远端任务停止（前台中止 / 后台 cancel / 启动窗 / 正常完成）

> 验收 [`backlog.md`](../backlog.md) `BUG-9` 行的四处标准。实现档案见
> [`rounds/R32`](../rounds/R32-bug9-remote-task-stop-fix.md)；根因调查见
> [`rounds/R31`](../rounds/R31-bug9-remote-task-stop.md)。
>
> **一份脚本，两条腿**：核心腿（围栏档）与直连腿（danger 档回退）都要走；
> 「老 OpenSSH」仅在直连腿有意义（signal request 单点）。PTY/terminal 不在本轮范围。

## 0. 基本信息

| 项 | 值 |
|---|---|
| 轮次 / 主题 | R32 — BUG-9 远端任务停止 |
| 验收对象 | 停止链三跳（signal → 独立 channel kill → close 兜底）、核心腿组杀、pending-abort、有界等待 |
| 需求 / 缺陷 ID | BUG-9 |
| 脚本作者 / 日期 | agent / 2026-09-18 |
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
| A1 | 会话发 `bash`：`sleep 600`，立即点**停止** | 工具调用秒级返回（中止）；远端 `ps` 无该 `sleep`（组杀） | 中止结果；远端 ps | ☐ |
| A2 | `bash` 后台跑 `run_in_background: true`：`ping -c 600 127.0.0.1`，随后 cancel 该 job | job 状态变 killed；远端 `ps` 无该 `ping` | job 面板；远端 ps | ☐ |
| A3 | 正常完成不回退：`bash -c 'echo hi && sleep 1 && echo bye'` | 输出 `hi`/`bye` 完整、exit 0；**没有**多余的首行数字（pid 行已剥离） | 工具输出首行 | ☐ |
| A4 | 启动窗（冷核心）：把远端 `~/.dsh-core/current` 暂挪走 → 发长任务（触发 core.deploy 预热/审批期间）→ 立即停止 | 中止生效；**不得**出现「远端已起进程但本地已返回」的窗口残留 | 远端 ps；core 日志 | ☐ |

### B. 直连腿（`/permission danger-full-access`，核心不参与）

| # | 操作 | 期望 | 观察点 | 结果 |
|---|---|---|---|---|
| B1 | danger 会话发 `bash`：`sleep 600`，立即停止 | 秒级返回；远端 `ps` 无 `sleep 600` | 远端 ps | ☐ |
| B2 | 后台 `ping -c 600 127.0.0.1` + cancel | killed；远端无 ping | job 面板；远端 ps | ☐ |
| B3 | 正常完成：`bash -c 'echo ok'` | 输出恰为 `ok`（无 pid 首行） | 工具输出 | ☐ |

### C. 老 OpenSSH（< 7.9，如 CentOS 7 的 7.4）直连腿 —— 有旧机才做

| # | 操作 | 期望 | 观察点 | 结果 |
|---|---|---|---|---|
| C1 | 旧机 danger 会话：`sleep 600`，停止 | **仍能停**（kill channel 不依赖 signal request）；最迟 grace+2s 后调用返回 | 远端 ps；返回时间 | ☐ |
| C2 | 旧机后台 `ping` + cancel | 同上 | 远端 ps | ☐ |

> 无老机器时 C 区标 N/A（不进分母）；单测已覆盖「signal 被吞 → kill channel → close 兜底」链路。

## 3. 判定

| 项 | 值 |
|---|---|
| 通过线 | A/B 全区 ☑（C 区 N/A 或 ☑），且全程远端 `ps` 无一处残留 |
| 失败样例 | 前台返回了但远端仍有进程 = **不通过**；输出首行出现纯数字 = 剥离回退，**不通过** |
| 结果 | ☐ 通过 / ☐ 不通过（复现步骤与截图回填本表） |

## 4. 已知边界

- 官方 systemd scope + 进程树跟踪（第二保险）未实现：任务若自己 `setsid` 逃出进程组，
  组杀不达 —— 维持 R31 决定，第一期不做，失败样例请记录远端进程树。
- `SshTerminalHandle`（PTY 交互终端）不在本轮：PTY 信号经 line discipline 必达。
- boot-smoke 成功后不自行退出是既有 `INFRA-12`，与本轮无关。
