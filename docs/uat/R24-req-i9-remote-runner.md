# R24 — REQ-I9 远端沙箱围栏（bwrap over SSH）真机验收

> 设计与边界见 [`ADR-0022`](../decisions/ADR-0022-remote-sandbox-runner.md)；侦察证据见 `.tmp/recon/A3-remote-runner.md`。
> **本脚本会故意破坏/恢复远端状态**（移除 bwrap、越界写文件），只在 lab 的**一次性 Linux 测试机**上执行。

## 0. 基本信息

| 项 | 值 |
|---|---|
| 轮次 / 主题 | R24 — 远端沙箱围栏（`remoteSandbox` 逐机器档位） |
| 验收对象 | 远程 world 的 `spawn` 被 bwrap 围栏包住，且 fail-closed（runner 不可用即拒绝执行） |
| 需求 / 缺陷 ID | REQ-I9（关联 ADR-0022、ADR-0020、REQ-I5） |
| 脚本作者 / 日期 | 代理（编排轮 R24）/ 2026-09-13 |
| 预期耗时 | 40–60 分钟（含远端准备与恢复） |

## 1. 前置条件

| 项 | 值 |
|---|---|
| 版本 | `0.1.3`（`package.json`） |
| 分支 | `feat/REQ-I11-machine-connect`（REQ-I9 接线落在其后的分支/提交） |
| commit | 以 lab 启动时 `git rev-parse --short HEAD` 为准，填入此处：`______` |
| 构建产物 | **必须先 `npm run build`**——lab 以 `link:` 装本仓库、直接加载 `lib/`，不 build 跑的是旧产物 |
| lab 地址 | `http://127.0.0.1:50599/`（`scripts/dev-lab.ps1`） |
| 启动命令 | `pwsh -File scripts/dev-lab.ps1`（已 build 时可 `-SkipBuild`） |
| 浏览器与视口 | `<浏览器 + 版本>` / `1440×900` |
| 主题 | 浅色 |
| 语言 | 中文 |
| 缩放 | 100% |
| 其他前置 | 一台**真 Linux** 远端（本文用 `c1` 代称，禁用真实主机名/凭据）；远端需能 `sudo`（用于临时移除/恢复 bwrap）；`c1` 在注册表里已配好凭据与工作区；会话为远程会话（cwd 走 `ssh://c1/...`） |

**禁止**：在 3080（真实实例）上执行本脚本；修改产品 profile；使用真实生产机做破坏性步骤（I9-5/I9-6）。

**先过的三道可行性门（任一为「否」则本需求在该主机类上不成立）**：

| 门 | 命令（在远端以**登录用户**执行） | 期望 |
|---|---|---|
| G1 | `bwrap --version` | 有版本输出 |
| G2 | `bwrap --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent -- true; echo $?` | `0`（userns 可用；rootless/无 setuid 或禁 `CLONE_NEWUSER` 的容器会失败） |
| G3 | `bwrap --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent --bind <工作区> <工作区> -- true; echo $?` | `0`（工作区是 symlink / bind mount / NFS 时可能失败） |

## 2. 步骤

| # | 操作 | 期望 | 观察点 | 结果 |
|---|---|---|---|---|
| 1 | 机器 `c1` 设 `remoteSandbox: read-only`，新建远程会话，让模型执行 `echo hi > /tmp/i9-1` | 被拒绝 | `sw_exec` 结果含 `read-only file system`（或等价越界拒绝文案）；**远端 `ls /tmp/i9-1` 不存在**；退出码非 0 | ☐ 通过 ☐ 不通过 |
| 2 | 同机器同档位，执行 `cat /etc/hostname` 与 `uname -a` | 正常返回 | 退出码 0、输出即远端内容——围栏不得把正常读打死 | ☐ 通过 ☐ 不通过 |
| 3 | 改 `remoteSandbox: workspace-write`，在**远端工作区内** `echo hi > i9-3.txt`，再用**官方 fs 工具**读该文件 | 写成功且两条接缝一致 | `sw_exec` 退出 0；fs 工具按 `ssh://c1/<工作区>/i9-3.txt` 读出 `hi` | ☐ 通过 ☐ 不通过 |
| 4 | 同档位，写工作区外路径（如 `/root/i9-4` 或 `/tmp/i9-4`） | 被拒绝 | 非 0 退出 + 越界拒绝文案；远端确认文件不存在 | ☐ 通过 ☐ 不通过 |
| 5 | **fail-closed**：临时重命名远端 bwrap（或把机器指向不存在的 runner 路径），再执行 `touch /tmp/i9-5-ran` | 调用失败且**命令一个字节都没跑** | 错误码/文案为 `SANDBOX_UNAVAILABLE`（或被明确标注为 runner 不可用）；**远端 `/tmp/i9-5-ran` 不存在**（本套最强断言，证明未裸跑） | ☐ 通过 ☐ 不通过 |
| 6 | **present-but-unusable**：在禁 userns 的容器里（`command -v bwrap` 成功、G2 失败）执行任意命令 | 同样拒绝 | 仍为不可用错误；无任何命令执行痕迹 | ☐ 通过 ☐ 不通过 |
| 7 | 恢复 bwrap，改 `remoteSandbox: off`（含所有既有机器），执行 `sw_exec` 与官方 `bash` 工具 | 与今天逐字节相同 | 无额外包装、无探针导致的新失败、会话提示词无新增段落；`sw_exec` 命令文本即用户所写 | ☐ 通过 ☐ 不通过 |
| 8 | `remoteApproval: human` + `remoteSandbox: read-only` 同时开，执行一条会越界写的命令 | 审批卡出现，放行后仍被围栏拒绝 | 审批卡 `cmd=` 预览是**原始命令**（不是 bwrap argv）；允许后仍拒绝越界写 | ☐ 通过 ☐ 不通过 |
| 9 | **诚实边界**：围栏开着时，用**官方 fs 工具**在工作区外写文件 | **成功**（SFTP 不经远端进程，围栏围不住） | 文件确实被写入；本项是**预期行为**，需在 FEEDBACK 里确认文档已如实写明，不得当作缺陷修复 | ☐ 通过 ☐ 不通过 |
| 10 | 远程会话在**本地**默认 `workspace-write` 下跑一条命令 | 无双重包装 | 远端命令行里只有一个 runner；不出现本地 bwrap/landlock 的 argv | ☐ 通过 ☐ 不通过 |
| 11 | 本地（非远程）会话跑本地命令 + `npm run check` + `node scripts/boot-smoke.mjs --no-channel` | 本地沙箱行为不变、闸门与哨兵全绿 | 本地命令按原档位运行；`check` 全绿；`SMOKE PASS` | ☐ 通过 ☐ 不通过 |

## 3. 判定

| 项 | 值 |
|---|---|
| 结论 | ☐ 通过 ☐ 不通过 |
| 通过项 / 总项 | `__/11` |
| 证据链接 | `<$LAB_HOME\...>`：每个越界/拒绝场景的 `sw_exec` 文本 + 远端 `ls` 证明；I9-5 的「文件不存在」截图/输出 |
| 未通过项 | 指向 `docs/uat/FEEDBACK.md` 条目 |
| 是否阻塞发布 | ☐ 是 ☐ 否（I9-5/I9-6 失败**必须**判定为阻塞：fail-closed 是该需求的存在理由） |
| 用户签字 | `<姓名 / 日期>` |

## 4. 环境指纹

| 项 | 值 |
|---|---|
| 实例 / 端口 | lab / 50599 |
| 插件版本 | `0.1.3` |
| commit | `______` |
| 宿主 OS / 版本 | `<例 Windows 11 24H2>` |
| 远端（如涉及） | `<发行版 / 版本；bwrap 版本与是否 setuid>` |
| 浏览器 / 视口 / 缩放 | `<浏览器版本> / 1440×900 / 100%` |
| 主题 / 语言 | 浅色 / 中文 |
| 相关机器 id | `c1` |

## 5. 备注

- **未测即未知**：信号传递（`channel.signal` 在非 PTY exec 上历史上是 no-op）、sshd 孤儿进程（bug 396）、`--die-with-parent` 的实际行为、bwrap 的 exit-signal 传递——本轮不要求，但若观察到 `Ctrl-C`/超时杀不掉远端命令，请记入 FEEDBACK（属于 ADR-0022 §3 已声明的风险）。
- **围栏只覆盖经 spawn 的命令**；fs 写面（SFTP）不在围栏内（步骤 9）。强围栏要么靠远端 OS 权限，要么等
  `REQ-I5` / `ADR-0023`：读写纳入核心、与 runner **同轮**落地（不再后置完全体）。
- **本脚本的前置（在远端手工装 `bwrap`）是过渡路径**：`ADR-0023` 已拍板部署**一个核心**
  （围栏执行 + 远端读写 RPC + 打包 `rg`）。核心落地后 G1/G2 由核心自身的 runner 满足，I9-9 必须反过来
  （围栏开着时官方 write 工作区外失败）；**在此之前不得把「已围栏」当成产品承诺**。
- 验收后请清理：恢复远端 bwrap、删除 `/tmp/i9-*` 与工作区测试文件、把机器的 `remoteSandbox` 复位为 `off`，并确认 50599 已停止。

来源：`docs/uat/README.md`；`docs/decisions/ADR-0022-remote-sandbox-runner.md`；`.tmp/recon/A3-remote-runner.md`
