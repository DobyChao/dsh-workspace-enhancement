# UAT：REQ-I5 + REQ-I13 远端核心与会话权限合验

> **一份脚本，两条 backlog。** 运输认 `ADR-0023` / `ADR-0024`（REQ-I5）；权限认 `ADR-0025`
> （REQ-I13）。机器 `remoteSandbox` **不是**本轮开关。
>
> 取代 [`R26-req-i5-remote-core.md`](./R26-req-i5-remote-core.md)（该脚本假设机器档位，已作废）。
> 对偶 [R24-req-i9-remote-runner.md](./R24-req-i9-remote-runner.md) 的 I9-1/2/3，并把 I9-9
> **反过来**：会话围栏打开时官方 `write` 工作区外必须失败，且目标文件不存在。

## 0. 基本信息

| 项 | 值 |
|---|---|
| 轮次 / 主题 | R27 — 远端一个核心 + 会话 `/permission` |
| 验收对象 | 有核心时 fs/spawn/browse 走 RPC；权限跟会话 sandbox；无核心+围栏档 fail-closed；danger 才允许 SFTP |
| 需求 / 缺陷 ID | REQ-I5 / REQ-I13 / ADR-0023 / ADR-0024 / ADR-0025 |
| 脚本作者 / 日期 | agent / 2026-09-14 |
| 预期耗时 | 35–50 分钟 |

## 1. 前置条件

| 项 | 值 |
|---|---|
| 版本 | `0.1.4` 源码线上的 0.2.0 能力（当时未 bump；该能力随 **0.2.0** 发布） |
| 分支 | `feat/REQ-I5-remote-core` |
| commit | `feat/REQ-I5-remote-core`（含 R27 当场修的 realpath 缺叶与禁止 `/` jail） |
| 构建产物 | `npm run build`；真机部署再 `npm run build:core` |
| lab 地址 | `http://127.0.0.1:50599/`（`scripts/dev-lab.ps1`） |
| 启动命令 | `pwsh -File scripts/dev-lab.ps1` |
| 浏览器与视口 | 任意现行浏览器 / 1440×900 |
| 主题 | 浅色 |
| 语言 | 中文 |
| 缩放 | 100% |
| 其他前置 | 一台 **linux x86_64** 远端；lab 已注册机器 `c1`；审批门 `remoteApproval` 保持 **off**；会话默认 workspace-write |

**禁止**：在 3080 上执行；改产品 profile；使用真实凭据。

## 2. 步骤

| # | 操作 | 期望 | 观察点 | 结果 |
|---|---|---|---|---|
| 1 | 设置页机器表单：确认**没有**围栏档位下拉；对 `c1` 点「核心状态」再「部署核心」 | 提示说跟 `/permission` 走；部署成功后状态含版本 `0.2.0` 与 arch | 高级区文案；RPC `core.status` / `core.deploy` | ☑ |
| 2 | 打开远程会话，看 composer 权限 chip | 不是 Custom；应是 Workspace write（或部署默认） | chip 文案 | ☑ |
| 3 | 会话 workspace-write：官方 `write` **工作区内**一路径 | **成功** | 文件内容 | ☑ |
| 4 | 同一会话：官方 `write` **工作区外**一路径 | **失败**；错误含 `[sandbox: file access denied under workspace-write mode]`；目标文件**不存在**（反转 I9-9） | 工具错误；远端 `ls` | ☑ |
| 5 | 模型带 `sandbox_permissions` 重试（或点提权卡允许一次） | 弹官方提权卡；允许后 **write 成功** | 审批/提权 UI；文件内容 | ☑ |
| 6 | `/permission read-only`：官方 `write` 工作区外；再 `read` 工作区外一既存文件 | write **失败**且文件不存在；read **成功**（只读，对偶 I9-2） | 工具错误 / 读出内容 | ☑ |
| 7 | `/permission workspace-write`：`bash -c 'echo hi'` | **成功**；审批门若开仍看到**未包装** argv（无 `bwrap` 当 argv[0]） | 工具输出；如有审批预览 | ☑ |
| 8 | 围栏档 `glob`/`grep`（spawn `rg`） | 不因缺系统 `rg` 而 127（核心 `PATH` 前置捆绑 rg） | 搜索命中或明确核心缺失 | ☑ |
| 9 | 围栏档打开交互终端 | 拒绝，不打开未围栏 PTY | 错误文案含 terminal / sandbox | 跳过（用户：Flash 无 PTY 工具；头栏 Git Bash 未见 terminal/sandbox 拒绝） |
| 10 | `/permission danger-full-access` 后再 write 同一工作区外路径 | **成功且不再弹提权卡** | 工具成功；无新卡 | ☑ |
| 11 | 临时把远端 `~/.dsh-core/current` 挪走，会话回到 workspace-write，再 write + `bash -c 'echo hi'` | **两者都拒绝**，write 不得悄悄走 SFTP 把文件写出来 | `SANDBOX_UNAVAILABLE`（或等价）；`ls` 无新文件 | ☑ |
| 12 | 仍无核心，`/permission danger-full-access` 后再 write | **成功**（SFTP 旁路仅 danger） | 文件存在 | ☑ |
| 13 | （可选）Windows 远端或 `uname -m` 非 x86_64：部署按钮；会话保持围栏档再 write | 部署失败；健康面「无围栏核心」；write/bash **fail-closed**，直到 `/permission danger-full-access` | `core.deploy` detail；工具错误 | N/A |

> 步骤 13 无对应主机时标 **N/A**，不计入通过项分母。danger 档是否放开未围栏 PTY **本轮不验收**（ADR-0025：不把放开 PTY 当目标）。

## 3. 判定

| 项 | 值 |
|---|---|
| 结论 | ☑ 通过 ☐ 进行中 ☐ 不通过 |
| 通过项 / 总项 | `11/12`（步骤 13 为 N/A；步骤 9 用户跳过） |
| 证据链接 | lab 50599；会话 `ssh-test-lab`；截图 `r27-step1-settings.png` / `r27-step2-chip.png` / `r27-step3-write-inside.png` / `r27-step4-denied-step5-card.png` |
| 未通过项 | 步骤 9 跳过（Flash 无 PTY 工具，非失败）。11–12 用户 2026-09-15 口头通过；**2026-09-17 lab 复核了步骤 11**（手工删核心 ⇒ 围栏档 fail-closed；同轮暴露 `BUG-6` 与拒绝文案误诊，均已修） |
| 是否阻塞发布 | 步骤 9 不挡合入。`BUG-4`（祖先 jail）当时记录未修，**已于 2026-09-17 修复**（`docs/notes/host-silent-fs.md`，随 0.2.0）。 |
| 用户签字 | |

## 4. 环境指纹

| 项 | 值 |
|---|---|
| 实例 / 端口 | lab / 50599 |
| 插件版本 | `0.1.4`（0.2.0 能力，当时未 bump；现已随 **0.2.0** 发布） |
| commit | `feat/REQ-I5-remote-core` 工作区（含 R27 当场修） |
| 宿主 OS / 版本 | Windows 10 26200 |
| 远端 | linux x86_64 / Ubuntu 24.04（WSL `user@127.0.0.1:22`；机器 id `c1`） |
| 浏览器 / 视口 / 缩放 | Cursor IDE browser / 约 1440×900 / 100% |
| 主题 / 语言 | 浅色 / 中文 |
| 相关机器 id | `c1` |

## 5. 备注

- Windows 远端的常态是「无核心 + 会话默认 workspace-write」→ 远程命令/写会失败，直到 `/permission danger-full-access`。这是对齐本地的诚实代价，**在范围内**（步骤 11–13），不是另开一条「零迁移 off」故事。
- 捆绑 `bin/bwrap` / `bin/rg` 若未打进 tarball，步骤 1 后核心能 `version` 但 jail 会失败——记入 FEEDBACK，不要标「已围栏」。
- `remoteApproval: human` 与提权卡同时开会弹两张卡；本脚本默认审批门 off。
- 审批门仍不覆盖 fs 写（ADR-0020 D1）；围栏档的 fs 由**核心**覆盖。
- 2026-09-14 lab 50599 跑到步骤 5 卡面：
  - 步骤 1：设置「远程工作区」无围栏 `<select>`；高级区「远端权限」文案跟 `/permission`；`c1` 核心状态 `0.2.0 x86_64`。
  - 步骤 2：chip「工作区内修改」，不是 Custom。
  - 步骤 3：官方 Write 新建 `/home/uuz/ssh-test-lab/r27-in-20260914.txt` 内容 `R27-in`。第一次失败是核心 `fs.realpath` 对缺叶 `EvalSymlinks`（已在宿主侧补祖先 walk）。
  - 步骤 4：官方 Write `/tmp/dsw-r27-out-20260914.txt` 拒绝，文案含 `[sandbox: file access denied under workspace-write mode]`；远端 `ls` 无该文件。第一次泄漏是把 `/` 当成 workspace-write jail（`--bind / /` 盖掉 tmpfs）；已禁止 `/` 根并让 fs 写跟会话 cwd。
  - 步骤 5：用户点「允许一次」后官方 Write 成功（`写入 /tmp/dsw-r27-out-20260914.txt +1 -0`）。WSL `cat` 内容 `R27-out`。chip 仍是「工作区内修改」（一次授权，不是 sticky danger）。随后官方 Read 报 `not found`：允许一次写到宿主 `/tmp`，Read 仍走围栏核心的 `/tmp` tmpfs，看不到宿主文件。不否决步骤 5（判定是 write 成功 + 宿主文件存在）。
  - 步骤 6：新会话 chip「仅可查看」。官方 Write `/tmp/dsw-r27-ro-20260914.txt` 拒绝：`file access denied under read-only mode [sandbox: file access denied under read-only mode]`；WSL `ls` **ABSENT**。官方 Read `/tmp/dsw-r27-exist.txt` 成功，内容 `r27-exist`。未用 `sw_exec`。
  - 步骤 7：chip「工作区内修改」。官方 Bash `echo hi` 第二次 stdout `hi`（第一次空输出，瞬时异常非策略拒绝）。轨迹里 command 是 `echo hi`，页内无 `bwrap` 当 argv[0]。审批门 off，无 argv 预览卡。
  - 步骤 8：工作区范围 Grep 30s 超时（不是 exit 127）。随后单文件 Grep `R27-in` @ `r27-in-20260914.txt` 命中 `Line 1: R27-in`；Glob `**/*r27-in-20260914*` 命中同文件。rg 在远端存在（另一次误用 Windows 路径时 rg 报 exit 2 / No such file，不是 127）。
  - 步骤 9：Flash 工具集无交互终端/PTY 工具。头栏「在 Git Bash 中打开工作目录」未弹出含 terminal/sandbox 的页内错误。**用户跳过。**
  - 步骤 10：chip「完全权限」（产品确认框「我已了解风险」）。官方 Write 同一 `/tmp/dsw-r27-out-20260914.txt`：**无新提权卡**。第一次被 read-before-overwrite 拦住（非 sandbox）；读后 Write `+1 -1` 成功，读回 `R27-d10`。
  - 步骤 11–12：用户 2026-09-15 口头通过。挪走 `current` 不会杀已 exec 的 serve（要 pkill / 重连 / 重启 50599）。无核心时围栏档 fail-closed；danger 走 SFTP。
  - 同日：进会话会静默 `ctx.fs.resolve` 往上找 `.git`，铸出 `/home`、`$HOME` 等祖先 jail（`BUG-4`，本轮只记录不修）。每个 jail 的 3 个 PID 是 `--unshare-pid` 常驻树，不是每次 RPC 新起三份。见 `docs/notes/host-silent-fs.md`。
- 验收后恢复核心目录、删测试文件、确认 50599 已停。不要把机器档位拨回去——已经没有这个下拉。

来源：`docs/uat/README.md`；`docs/decisions/ADR-0023-one-remote-core.md`；`docs/decisions/ADR-0024-remote-core-protocol.md`；`docs/decisions/ADR-0025-remote-session-sandbox.md`
