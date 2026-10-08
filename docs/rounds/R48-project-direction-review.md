# R48 — 项目方向评审：命名 / 远程围栏 / 跨 agent 人工介入

> 一轮 = 一条指令（所有者问「这个项目何去何从」）= 一个 PR；**只落文档、不改代码**。
> 产出 [ADR-0029](../decisions/ADR-0029-positioning-review.md)（定位细化对比，proposed）+ backlog 新行。
> 日期：2026-10-08。基线 master `8be8b4a`。

## 0. 一句话

三个问题同根：`UPSTREAM-6`（官方 SSH 运行时出来后的定位）自 09-16 挂起未拍板，
于是名字定不下、远程围栏只能按上游入口逐个补丁。先拍定位，再命名、围栏收敛、人工介入减负。

## 1. 命名：「工作区增强」但多数在做远程

- **机制上名字没错**：`cordis.patch.yml` 禁用官方 `directory-picker` / `subprocess` / `fs-sandbox`，
  由混合门面（`mixed.ts`）接管全部工作区接缝，本地会话也经过我们。
- **价值上名字不对**：用户可见的价值几乎全在远程（注册表、SSH、核心、远程提权）；本地只剩
  目录选择器与已降为薄清单的副工作区（ADR-0019）。
- 处置：名字跟定位走，见 ADR-0029 §4.1（A/A′ 下改为远程工作区类名称 + 旧包 deprecate）。
- 附带待验：是否必须接管本地 `subprocess` / `fs`——若远程路由能只挂远程世界、本地交还官方，
  每代上游适配面会显著变小。受「Cordis 同名服务只能注册一次」约束（`architecture.md` §4），需 spike。

## 2. 远程围栏为什么一直理不清

- 权限线 8 份 ADR 往返：0008 / 0012 / 0015 / 0019 / 0020 / 0022 / 0025 / 0028。
- 同时生效的层：会话 `/permission`、单次提权 overlay、核心 `--sandbox`、遗留 bwrap 向量
  （`remote-sandbox.ts`）、遗留字段 `remoteSandbox`、审批门 `remoteApproval`、会话连接门
  （仅可见性，`architecture.md` §4 自承）、区域矩阵（ADR-0028，proposed）。没有一处能一眼看全。
- **结构性根因**：`SubprocessSpawnSpec` 无 policy 字段、danger 授予不经 `confine`（ADR-0025 §2.10），
  我们只好在每个官方入口旁路塞「本次权限」；上游新增 `shell.execute`（0.2.0-rc.2）即漏 → `BUG-12`。
- **官方的形状正相反**（`dsh-sandbox-ssh@0.2.0-rc.2`）：`confine(argv, policy)` 逐次发 policy 到远端，
  danger 由消费者跳过 `confine`；子进程 provider 不自行围栏。对齐它即可让提权自然流过所有入口
  → ADR-0029 §3 的 A′。
- 处置（backlog）：`AUDIT-7` 真值表 + 清理重叠机制；`REQ-I22` spike 改走 `confine`，`BUG-12` 作其验收。
- 待所有者一句话：远程围栏的威胁模型是「防模型手滑」还是「防对抗性模型」。前者允许把围栏
  做成可选项，只支持 linux x86_64 的核心也就不必承担「必须可用」。

## 3. 跨 agent 管理：人工介入为什么还多

09 月以来约 70 个提交里 24 个是纯文档；评审前已有 28 份 ADR、47 份轮次报告；backlog 有 14 处
「尾巴 / 待实机 / 待用户」，6 项以上等所有者拍板（UPSTREAM-6、AUDIT-5、UX-8、REQ-A6、
UPSTREAM-11、INFRA-8）；L1/L2 实机矩阵（INFRA-19）首轮从未执行。

| 介入类 | 是否该由人做 | 处置 |
|---|---|---|
| tag / publish / 3080 | 是（红线） | 不变 |
| 所有者拍板 | 是，但可批处理 | `INFRA-24`：统一拍板队列 + 推荐项 + 可逆决定默认期限 |
| 实机冒烟（L1 M3–M7） | **否**——卡人的根因是依赖真 LLM 驱动 agent 会话 | `INFRA-23`：脚本化假模型（固定工具调用）或直驱工具执行 + CI sshd 服务容器，进 `npm run e2e` |
| 视觉 / 交互判断（UX 类） | 部分 | 保留 browser-use，范围收窄到 UX case |
| 文档流程本身 | 否 | `INFRA-25`：round 报告只在里程碑 / 事故写；评估备注限长等纯格式闸门的性价比 |

原则：**规则少、自动化多**——一条能自动跑的测试，比一页执行协议更能减少人工介入。

## 4. 同会话讨论结论（所有者确认）

- **副根 = 工作区延伸，与主根同档**，取第一级粒度：一次写 / 一条命令只写一个根，跨根提权一次；
  本机与远程对称（`REQ-I24`）。第二级（一条命令跨根写）提给上游（`UPSTREAM-12`）。
- **A′ 实施形状**定稿于 ADR-0029 §4.3：`confine` 出标记 argv、spawn 解标记按 cwd 选根、
  **无标记不围栏**（收窄已接受）、只认进程内登记的产物防伪造。
- **`BUG-12` 拆两半**：提权没带到（`REQ-I22` 根治）与 pwsh 被送远端（钉 workdir 漏 `shell.execute`，另修）。
- **术语**：用户可见的「核心」改称「远程组件」（`UX-9`），代码标识符不动。
- 仍待所有者：ADR-0029 §3 正式选项（讨论按 A′ 推进）、远程围栏的威胁模型一句话。

## 5. 本轮验证

文档改动：`check:static` + `typecheck` + `test:agent` + `npm run status`。preflight：node/npm/git/gh/wsl
ok，50599 被占用（lab 在跑，本轮不用），browser-use 自报可用但本轮无 UI 改动、未使用。
官方包事实以 `npm view` + `npm pack` 解包（`.tmp/upstream6-0.2.0-rc.2/`，不入库）核实。

## 6. 遗 tail

- 所有者拍 ADR-0029 §3（A / A′ / B / B′ / C）→ 关 `UPSTREAM-6`、解挡 `REQ-A7`（改名）。
- 所有者回答威胁模型一句话（§2 末）→ 写进 ADR-0025 / `SECURITY.md`。
- 推荐下一轮顺序：`AUDIT-7` → `REQ-I22`（含 `BUG-12`）→ `INFRA-23` → 其余扩展项。
