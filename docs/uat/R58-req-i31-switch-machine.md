# UAT：R58 实验性切机器工具（REQ-I31）

> 流程与 lab 用法见 [README.md](./README.md)。本脚本只覆盖单测摸不到的部分：真宿主上
> `workingDirectory.set` 的全链路（投影、prompt、连带行为）、设置页开关、提权卡与真机拒绝形状。

## 0. 基本信息

| 项 | 值 |
|---|---|
| 轮次 / 主题 | R58 — 实验性切机器工具 |
| 验收对象 | 设置页实验开关（默认关）驱动 `sw_use_machine` 注册/注销；danger 门与单次提权；切换后本会话 `ctx.fs` / `sw_exec` 默认机 / 提示词 / 终端跟随新机器 |
| 需求 / 缺陷 ID | `REQ-I31` |
| 脚本作者 / 日期 | 代理 / 2026-10-26 |
| 预期耗时 | 40 分钟 |

## 1. 前置条件

| 项 | 值 |
|---|---|
| 版本 | 0.2.6（分支 `feat/REQ-I31-switch-machine`） |
| 构建产物 | `npm run build` → `npm pack` → lab remove/add tarball（AGENTS.md §3） |
| lab 地址 | `http://127.0.0.1:50599/`（`scripts/dev-lab.ps1`），宿主家族 **0.2.1-rc.2**（带 `workingDirectory` 服务的家族） |
| 机器 | `c1`：已注册、**workspace 字段已登记**（如 `/home/u/alpha`）、已部署远程组件；`c3`：已注册但 **workspace/cwd 均为空** |
| 其他前置 | 一个本机主工作区会话；`$DSH_HOME/dsw-experimental.json` 不存在（或 `switchMachine=false`） |

**禁止**：在 3080 上执行；修改产品 profile；使用真实凭据。

## 2. 步骤

| # | 操作 | 期望 | 观察点 | 结果 |
|---|---|---|---|---|
| 1 | 设置页滚到底部「实验特性」区 | 只有一个「切换机器（sw_use_machine 工具）」开关，**默认关**，说明文案含 danger 档与 0.2.1+ 提示 | 截图 | ☐ 通过 ☐ 不通过 |
| 2 | 开启开关 → 开一个会话（任意档）问模型「你现在有哪些 sw_ 工具」 | `sw_use_machine` 在列 | 工具清单回答 | ☐ 通过 ☐ 不通过 |
| 3 | **不重启宿主**，回设置页关掉开关 → 同一会话再问 | `sw_use_machine` **消失**（sw_status/sw_connect/sw_exec 仍在） | 工具清单回答 | ☐ 通过 ☐ 不通过 |
| 4 | 重启 lab → 再开开关 → `$DSH_HOME/dsw-experimental.json` 内容 | `"switchMachine": true`（持久化跨重启） | 文件内容 | ☐ 通过 ☐ 不通过 |
| 5 | workspace-write 档会话，`sw_connect` 连 `c1`，让模型调 `sw_use_machine(machine:"c1")` | **拒绝**：文案含 danger-full-access 要求与当前档名；工作目录**不变**（问模型当前目录仍为本机项目） | 拒绝文案；`working_directory` 读数 | ☐ 通过 ☐ 不通过 |
| 6 | 同会话切 `/permission` 为 danger-full-access，重复步骤 5 | **成功**：输出「session switched to c1 … committed as …」；紧接一条宿主注入的工作目录变更通知（"The working directory changed from … to …"） | 工具输出 + 通知消息 | ☐ 通过 ☐ 不通过 |
| 7 | 步骤 6 后让模型**用相对路径**读/写工作区文件（如 `notes.md`） | 操作落在 `c1` 的 `/home/u/alpha`（远程文件面板/`ssh://c1/…` 路径可见），不再走本机 | 文件路径证据 | ☐ 通过 ☐ 不通过 |
| 8 | 让模型调 `sw_exec`（省略 `server`）跑 `pwd` | 默认机已是 `c1`：要么输出 `server: c1`，要么因「主工作区已在该机」提示改用 bash（两者都对，记录哪种） | 输出首行 | ☐ 通过 ☐ 不通过 |
| 9 | 让模型调 `sw_use_machine(machine:"c1")`（已在 c1 上） | 诚实 no-op：文案「already on c1 … nothing changed」，无变更通知 | 工具输出 | ☐ 通过 ☐ 不通过 |
| 10 | `sw_use_machine(machine:"c3")`（c3 无登记根） | 拒绝：no registered workspace directory，提示传显式 path | 拒绝文案 | ☐ 通过 ☐ 不通过 |
| 11 | `sw_use_machine(machine:"c3", path:"/home/u")` | 成功切到 c3 的 `/home/u`；相对路径操作落在 c3 | 工具输出 + 一次文件操作 | ☐ 通过 ☐ 不通过 |
| 12 | `sw_use_machine(machine:"c2")`（已注册但**未连接**本会话） | 拒绝：not connected，文案含已连接清单与 sw_connect 提示 | 拒绝文案 | ☐ 通过 ☐ 不通过 |
| 13 | `sw_use_machine(machine:"local")` | 拒绝：reserved 文案（本工具只在远程机之间移动） | 拒绝文案 | ☐ 通过 ☐ 不通过 |
| 14 | （可选，时间允许）`c1` 的 `/home/u/alpha/.dsh/skills/` 下放一个技能目录，切回 `c1` 后问模型该技能是否可见 / 开子代理 | 技能扫描跟随新 cwd（BUG-22 的占位路径回认） | 模型回答 | ☐ 通过 ☐ 不通过 |
| 15 | 设置页把开关关掉 → 再问模型调 `sw_use_machine` | 工具已不在清单（模型答无法调用），不是调用后被拒 | 工具清单回答 | ☐ 通过 ☐ 不通过 |

## 3. 判定

| 项 | 值 |
|---|---|
| 结论 | ☐ 通过 ☐ 不通过 |
| 通过项 / 总项 | `/15` |
| 证据链接 | `$LAB_HOME\e2e\R58\` |
| 是否阻塞发布 | ☐ 是 ☐ 否 |
| 用户签字 | |

## 5. 备注

- **2026-10-26 代理预验（lab 50599，0.2.6 分支 tarball，宿主 0.2.1-rc.2）**：步骤 1（设置页「实验特性」区渲染、默认关）、
  步骤 2（开启后同一新建会话模型清单含 `sw_use_machine`）、步骤 3（**不重启**关开关，同一会话下一轮模型明确
  「sw_use_machine 不存在」并更正前答）、步骤 4（`dsw-experimental.json` true/false 双向落盘）已实测通过。
- **2026-10-27 BUG-20 修复后重验**：步骤 11 双向在 lab 通过——`local→c3(path)` 提交 `dsw-routes\c3\home\marisa`、
  `c3→c1(默认落点)` 提交 `dsw-routes\c1\home\uuz`，两次 `working_directory` 读回与提交一致；错机提交现在会回滚并报
  `commitMismatch`。owner 环境的 a/b 复测仍以本脚本为准。
- **UAT 排障提示**：验证工具存在性用**全新会话**——模型可能被「该工具不存在」的旧对话带偏（幻觉）；权威证据是
  会话日志 `request/header` 的 tools 数组与 `tool-addition` developer 消息。换装 tarball 后必须重启 lab 宿主，
  否则旧进程报 "Failed to load plugins"。`experimental.get` 现带 `gate` 遥测字段可直接看门禁三态。
- 步骤 5–6 覆盖「拒绝且不改目录」的门禁语义；步骤 8 记录 sw_exec 默认机的**实际形态**
  （直连 c1 或「用 bash」提示），两种都是投影生效的证据。
- 步骤 11 的 `/home/u` 只是落点示例；落点在 WW 下是否可写取决于声明根（ADR-0028 §5），
  danger 档不围栏，本脚本不做 WW 可写性断言。
- 切回本机（`local`）按拍板 v1 不做；远程机之间的往返（如 c1→c3→c1）等价于重复步骤 6/11。
- 已知边界（侦察结论）：宿主自带的 `working_directory` 工具不受本开关管控（裸通道），
  v1 接受并在笔记声明；如需封堵另立 backlog。
