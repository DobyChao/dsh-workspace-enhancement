# 实机测试矩阵（INFRA-19）

> **这是实机 case 的唯一清单**（声明式：步骤 + 判定标准写死，任何有 browser-use 的
> agent 照单执行）。它与两套既有资产互补、不重复：`e2e/`（Playwright，CI 内确定性
> 断言，无 agent 能力要求）与 `docs/uat/R*.md`（历史轮次的验收脚本，本矩阵的素材
> 来源）。UPSTREAM-8 的教训：typecheck / 单测 / boot 哨兵三层全绿也没拦住运行时
> 断点——**工具执行路径只有实机跑 agent 会话才走到**。

## 1. 两个 lab

| lab | 宿主 | 启动 | 浏览器入口 |
|---|---|---|---|
| win32 lab | Windows 宿主（dsh CLI 装在 Windows） | `pwsh -File scripts/dev-lab.ps1` | `http://127.0.0.1:50599/` |
| Linux lab | **WSL 内** Linux 宿主（dsh CLI 装在 WSL） | `pwsh -File scripts/dev-lab-wsl.ps1`（内部 `wsl -e bash scripts/dev-lab-wsl.sh`） | `http://127.0.0.1:50600/`（WSL localhost 转发） |

共同规则：lab 家族**跟 peer pin 走**（当前 `^0.1.7-rc.2`）；插件一律装 `npm pack`
tarball（与真实发包一致）；绝不碰 3080 / 产品 `~/.dsh`。改动要进 lab 的固定动作见
`AGENTS.md` §3。

**远程目标前置**：远程类 case 需要一台可 ssh 的目标。推荐就在 lab 机器上解决——
WSL 内跑 `sudo apt install openssh-server`（win32 lab 以 WSL 的 sshd 为目标，
Linux lab 以宿主 Windows 侧回环或另一 WSL 实例为目标），账号密码即可（指纹 TOFU
本身也是 case 的一部分）。

## 2. 分层与执行时机

| 层 | 内容 | 何时跑 | 驱动 |
|---|---|---|---|
| L0 | boot 哨兵（boot + `/api/dsw/connections.list` 强断言） | 每 PR（CI drift 通道对新家族也跑） | `node scripts/boot-smoke.mjs`，无需浏览器 |
| **L1** | **每 PR 实机冒烟**（§3，7 条，约 30–45 分钟） | PR 报「可合并」**之前**，改动涉及工具/服务/接缝时必跑 | agent + browser-use |
| **L2** | **发版前全量**（§4，L1×双 lab + 12 条，约 2–3 小时） | 用户说「发版」之后、release PR 之前 | agent + browser-use |

case 数量纪律：**每条 case 必须有真实事故背书**（锚点列）。没有锚点的新 case
不进清单——这条规则把数量钉在「够用」上，防 case 腐化与敷衍跑。

## 3. L1 — 每 PR 实机冒烟

前置：目标 lab 已 boot；浏览器打开入口 URL（token 会话）；一台可 ssh 目标（§1）。

| # | case | 步骤要点 | 判定（全过才算 pass） | 锚点 |
|---|---|---|---|---|
| M1 | boot + 插件注入 | 打开 lab URL → 设置 → 找到本插件设置页 | 页面渲染无 JS 错误；机器表单/语言行可见；控制台无来自 `client.js` 的未捕获异常 | F1/F2（boot 崩 / 405） |
| M2 | 添加机器 + 连接 | 表单填 ssh 目标 → 测试连接 → 保存 → 设为当前 | 测试连接有明确结果；行内出现端点 `user@host:port`；首次连接的指纹确认出现且可接受 | BUG-5（ssh 错误链） |
| M3 | 远程前台执行 | 开远程会话 → 让 agent 跑 `echo hi` 与 `exit 3` 两条命令 | 输出含 `hi`；空输出有 `(no output)` 类标记；exit code 标记渲染（0.1.7 家族为 EN，与官方一致）；**render 不抛错** | **UPSTREAM-8 ①** |
| M4 | 远程后台执行 | 让 agent 后台跑 `sleep 30 && echo done` → 读 job 输出 | 立即返回 job id；`job_output` 能读到增量；结束后 exit 标记在 | **UPSTREAM-8 ②** |
| M5 | 远程 fs 读写 | 让 agent 在远程工作区写一个文件再读回 | 写入成功；读回内容一致；无 CAS/版本误报 | BUG-7 |
| M6 | 停止远程任务 | 让 agent 跑 `sleep 300` → 停止 | 停止请求在收敛窗口内完成，会话不挂死 | BUG-9 |
| M7 | 语言切换 + 标记跟随 | 设置切语言（zh↔en）→ 再跑一条失败命令 | 设置页语言即时变；新会话/新渲染的错误文案跟随语言（0.1.7 家族工具标记恒 EN 属预期） | REQ-R6 + UPSTREAM-8 ① |

## 4. L2 — 发版前全量（L1×双 lab 之外加跑）

| # | case | 步骤要点 | 判定 | 锚点 |
|---|---|---|---|---|
| N1 | 目录流：已保存连接 | 「添加工作区」→ 已保存连接 region → 选机器选目录 | 目录树可浏览；选中后新会话 cwd 为远程 | BUG-3 / REQ-R6 |
| N2 | 副工作区 | 会话内挂一个本地 + 一个远程副工作区 | 面板两行齐全；挂载后相应世界工具可用 | REQ-I3 |
| N3 | 区域权限抽样 | 本地 `sw_exec(server:"local")` 越界写 → 拒 | 越界被拒且提示可读；界内放行 | REQ-I19 / BUG-11 |
| N4 | 远程 skill 发现 | 远程项目目录放一个带 SKILL.md 的目录包 | agent 能发现该 skill | BUG-10 |
| N5 | 机器 CRUD | 编辑 / 删除 / 设为当前 / 忘记指纹 | 四个动作全部生效；删除后无幽灵行 | UX-5 邻域 |
| N6 | 断连恢复 | 停目标 sshd → 观察状态 → 恢复 → 重连 | 状态徽标准确变红/恢复；重连成功；宿主不崩 | BUG-5 |
| N7 | 多机会话门 | 会话连第二台机器 → `sw_exec` 指名未连接的第三台 | 被拒并列出已连接清单（gate 不被 workdir 绕过） | REQ-I11 / ADR-0021 |
| N8 | 核心部署 + 版本门 | 删远端核心 → 部署 → 再删后执行写操作 | 部署后版本一致；无核心时围栏内写被拒并提示部署 | REQ-I5 / REQ-I17 |
| N9 | 远程提权一次 | 带 `sandbox_permissions`+`justification` 的远程命令 | 审批 UI 出现；批准后该次放行、下一次回落会话档 | REQ-I18 |
| N10 | 语言持久 | 切语言 → 重启 lab → 再看 | 语言设置跨重启保持 | REQ-R6 |
| N11 | 会话恢复 | 会话中途刷新浏览器页 | 会话状态恢复；工具/徽标不丢 | INFRA-5 |
| N12 | 双 lab 对拍 | 在另一个 lab 重跑 L1 全部 | 同样全过（win32↔Linux 行为一致） | FIX-4（平台假设） |

## 5. 执行协议（跨 agent）

1. **能力预检**：执行前跑 `npm run preflight`（环境面：node/npm/git/gh/wsl/端口/lab/打包产物）+ agent 自报能力（browser-use 等探测不了的）。本矩阵要求：`browser-use`（视觉判定 + 交互）、
   `shell`（起 lab）、`wsl`（Linux lab）。**缺任一 → 不静默跳过**：把对应 backlog 行
   标 `blocked`，备注 `agent-missing:<cap>`，在 PR/汇报里写明「待人工实机」或换有
   能力的 agent 执行。环境类能力（wsl/端口/ssh 目标）预检失败同样 blocked。
2. **结果记录**：PR 描述或 round 报告贴结果表（模板：case × lab × pass/fail/blocked
   × 一句话证据，截图/文本摘录各留关键一条）。
3. **判定从严**：任何一条 fail → PR 不得标记可合并；blocked ≠ pass。
4. **清单即契约**：agent 不得自行增删 case；发现新断点 → 修完后**先把它固化成
   新 case（带锚点）再关 PR**——这就是矩阵长出 L1/L2 的唯一方式。

## 6. 结果表模板

```markdown
| case | lab | 结果 | 证据（一句话 / 截图指针） |
|---|---|---|---|
| M1 | win32 | pass | 设置页渲染，控制台无插件异常 |
| M3 | win32 | fail | exit 3 的标记未渲染，工具结果空 — <日志/截图> |
```
