# UAT：REQ-I19 主/副工作区区域权限

> 矩阵认 [ADR-0028](../decisions/ADR-0028-region-permission-matrix.md)。本脚本只验收人能在对话里看到的事：哪个工具执行、拒绝原文、文件在不在。
> 单测已经覆盖路由函数；这里不重复测注册表内部。

## 0. 基本信息

| 项 | 值 |
|---|---|
| 轮次 / 主题 | R37 — 工具绑世界 |
| 验收对象 | 命令落在该落的世界上；打错世界被英文拒绝；未声明的远程路径不新开可写 jail |
| 需求 / 缺陷 ID | REQ-I19 / ADR-0028 |
| 脚本作者 / 日期 | agent / 2026-09-23 |
| 预期耗时 | Windows 已走完。Linux 宿主另计 40–60 分钟 |

## 1. 前置条件

| 项 | 值 |
|---|---|
| 版本 | `0.2.1`（本分支未 bump） |
| 分支 | `feat/req-i19-region-permissions` |
| commit | 本分支 HEAD（含本脚本） |
| 构建产物 | `npm run build` 后打 tarball 装进 lab，见下方 |
| lab 地址 | `http://127.0.0.1:50599/` |
| 启动命令 | 见下方；不要让 `dev-lab.ps1` 的 `plugin add <repo>` 盖掉 tarball |
| 浏览器与视口 | 任意现行浏览器 / 1440×900 |
| 主题 | 浅色 |
| 语言 | 中文（工具拒绝仍是英文） |
| 缩放 | 100% |
| 其他前置 | §2 是 Windows 宿主走查，已勾完。§5 换一台 Linux 宿主重跑，分开计分。两边都要一台 linux x86_64 远端（机器 id `c1`，核心已部署），审批门 `remoteApproval` 为 off，会话权限 workspace-write。准备三个远端目录：登记根 `W`、与 `W` 平级且未挂为副根的 `S`、两者之外的未声明目录 `U`。`c1` 的登记根不要设成本机会话目录 |

**禁止**：在 3080 上执行；改产品 profile；把真实凭据写进仓库或本脚本。

装包（`dev-lab.ps1` 每次都会 `dsh plugin add <repo>`，会把 tarball 换回仓库路径，所以验收不用它来启动）：

```powershell
npm run build
npm pack --pack-destination .tmp
pwsh -File scripts/dev-lab.ps1 -NoBoot
# 使用上一步打印的 DSH_HOME，不要改到产品 home
dsh plugin --profile web remove dsh-workspace-enhancement
dsh plugin --profile web add .tmp\dsh-workspace-enhancement-0.2.1.tgz
dsh web --port 50599 --no-open
```

看工具结果的原文，不要只看模型的转述。要求它调用指定工具；它若换了工具，这一步记不通过。

Windows 上计分步骤 1–12、14–19。没有第二台机器时步骤 13 标 N/A，不进分母。§5 只在 Linux 宿主上计分，Windows 上整段 N/A。

## 2. 步骤

> 2026-09-23 agent 按 `feat/req-i19-region-permissions`@fd96c66（0.2.1 tarball 装 lab）执行完毕，
> 结果勾选如下；证据见 `$LAB_HOME\e2e\R37\uat-evidence.md`（截图为本地素材 `.tmp/r37-uat/`）。

### 情况 1：主工作区在本机

开一个本机目录会话。

| # | 操作 | 期望 | 观察点 | 结果 |
|---|---|---|---|---|
| 1 | 看本机会话的工具清单 | 有 `pwsh`、`sw_exec`；没有 `bash` | 工具名列表 | ☑ 通过 |
| 2 | `pwsh` 省略 workdir，打印当前目录 | 成功，目录是本机会话目录（区域 1） | 工具 stdout 里的路径 | ☑ 通过 |
| 3 | `pwsh` 在该目录写一个新文件 | 成功 | 文件内容 | ☑ 通过 |
| 4 | `pwsh` 在该目录之外、且不是 `%TEMP%` 的路径写文件（区域 3） | 拒绝；文件不存在 | sandbox denied 文案；本机该路径不存在 | ☑ 通过 |
| 5 | 本会话连上 `c1`。`sw_exec` `server` 为 `c1`，在登记根 `W` 里写文件 | 成功（区域 4） | 远端文件在 `W` 下 | ☑ 通过 |
| 6 | 同一 `sw_exec`，往未声明的平级目录 `S` 写文件（区域 5） | 拒绝；`S` 里没有该文件 | 工具错误；远端 `ls` | ☑ 通过 |
| 7 | `sw_exec` `server` 为 `c1`：`touch /tmp/r37-i19` | 成功，不弹提权卡 | 工具 stdout / 退出码；无提权卡 | ☑ 通过 |
| 8 | 断开 `c1`，或 `server` 填一个不存在的 id，再 `echo hi` | 拒绝，命令没有在远端执行 | 工具错误（先连接 / 未知 id）；没有 `hi` 的远端 stdout | ☑ 通过 |
| 9 | `sw_exec` `server` 为 `local`，或 workdir 填本机绝对路径 | 拒绝，且没有改去跑 `pwsh` | 错误含 `use the pwsh tool`；结果不是 pwsh 的 stdout | ☑ 通过 |

### 情况 2：主工作区在 `c1`

新开 `c1` 的远程会话。权限仍是 workspace-write。

| # | 操作 | 期望 | 观察点 | 结果 |
|---|---|---|---|---|
| 10 | 看工具清单 | 有注入的 `bash`，也有 `pwsh` | 工具名 | ☑ 通过 |
| 11 | `bash` 省略 workdir：`echo hi` | 成功，在远端登记根 | stdout `hi` | ☑ 通过 |
| 12 | `sw_exec` 省略 `server`，或 `server` 填 `c1`：`echo hi` | 拒绝，不执行 | 错误含 `uses the bash tool` | ☑ 通过 |
| 13 | 若另有已连接机器 `c2`：`sw_exec` `server` 为 `c2`，`echo hi` | 成功，在 `c2` 上 | stdout `hi`；无步骤 12 的拒绝 | ☑ N/A |
| 14 | `bash` 的 workdir 写成另一台机器的 `ssh://…` | 拒绝 | 错误含 `Use sw_exec for that server` | ☑ 通过 |
| 15 | `pwsh` 省略 workdir，打印 `$PWD` | 留在本机：恰好一个本机副根时是那个目录，否则是用户主目录。不是 Linux 路径，也不是 `dsw-routes` 占位目录 | `$PWD` 文本 | ☑ 通过 |
| 16 | `pwsh` 的 workdir 显式写成 `ssh://c1/…` 或裸 POSIX `/…`，再打印 `$PWD` | 仍落在步骤 15 的本机目录，不报错 | `$PWD` 与步骤 15 相同；工具结果不是拒绝 | ☑ 通过 |
| 17 | 标题栏「工作区」挂一个本机目录（区域 9）。workspace-write 下用官方 Write 或 `pwsh` 往那里写新文件 | 拒绝；文件不存在 | sandbox denied；该路径无新文件 | ☑ 通过 |
| 18 | 再挂一个与 `W` 平级的远程副根 `S`。`bash` 的 workdir 指到 `S` 并在其中写文件；然后不改 workdir（停在 `W`）再写 `S` 里另一个文件 | 指到 `S` 时成功；停在 `W` 时拒绝，第二个文件不存在 | 远端两个路径的 `ls` | ☑ 通过 |
| 19 | `bash` 的 workdir 指到未声明目录 `U`，在其中写文件；再 `touch /tmp/r37-i19-8` | 写 `U` 被拒且文件不存在；`/tmp` 那条成功且无提权卡 | 工具错误；远端 `ls`；无提权卡 | ☑ 通过 |

步骤 7 和 19 的 `/tmp` 文件在 jail 的 tmpfs 里，serve 重启后会消失，不是远端宿主的 `/tmp`。验完不必到宿主上去找。

步骤 16 按当前实现判通过（显式远程路径也被改到本机，不拒绝）。若希望改成直接拒绝，记到 [FEEDBACK.md](./FEEDBACK.md)，不要因此把本步打成失败。

> 步骤 13 备注：lab 里第二台登记机器 `c3`（marisa@127.0.0.1）可 `sw_connect` 连上，但没有登记工作区根，
> `sw_exec(server:"c3")` 被 fail-closed 拒绝（`…requires an absolute remote workspace root to bind, and none was
> resolved; refusing to run the command unconfined`，命令未发送）。无等效 `c2`，按规则记 N/A。

## 3. 判定

| 项 | 值 |
|---|---|
| 结论 | ☑ 通过 |
| 通过项 / 总项 | Windows 18 / 18（步骤 13 N/A，不进分母）。Linux §5 未跑，不并入这个分数 |
| 证据链接 | `C:\Users\Admin\.dsh-lab\e2e\R37\uat-evidence.md`；截图（本地素材，不入库）`.tmp/r37-uat/` |
| 未通过项 | 无 |
| 是否阻塞发布 | ☐ 是 ☑ 否 |
| 用户签字 | 待用户确认 |

## 4. 环境指纹

| 项 | 值 |
|---|---|
| 实例 / 端口 | lab / 50599 |
| 插件版本 | `0.2.1`（tarball 安装） |
| commit | `fd96c66`（feat/req-i19-region-permissions） |
| 宿主 OS / 版本 | Windows 10.0.26200 x64 |
| 远端 | linux x86_64（`c1`，127.0.0.1 上的 WSL lab 用户） |
| 浏览器 / 视口 / 缩放 | ZCode 内嵌浏览器（Chromium）/ 1440×900 / 100% |
| 主题 / 语言 | 浅色 / 中文 |
| 相关机器 id | `c1`（`c3` 见步骤 13 备注） |

## 5. Linux 宿主（Windows 上整段 N/A）

Linux 上本机命令是官方 `bash`，没有 Windows 那套 `pwsh`。主工作区已经在远程时，本机命令改走 `sw_exec(server: "local")`，前台用宿主 shell 的 `run`，后台用 `start` 登记成 job。裸 POSIX `/…` 在 Linux 上是本机路径，不是远程。

装包后手动起 lab（不要用会把安装换回仓库路径的 `plugin add <repo>`）：

```bash
npm run build
npm pack --pack-destination .tmp
export DSH_HOME=<lab home>   # 不要指到产品 home
dsh plugin --profile web remove dsh-workspace-enhancement
dsh plugin --profile web add .tmp/dsh-workspace-enhancement-0.2.1.tgz
dsh web --port 50599 --no-open
```

计分 L1–L11、L13–L16。没有第二台机器时 L12 标 N/A，不进分母。结果列留空，跑完再勾。

### 情况 1：主工作区在本机

开一个本机目录会话。

| # | 操作 | 期望 | 观察点 | 结果 |
|---|---|---|---|---|
| L1 | 看工具清单 | 有官方 `bash`、`sw_exec` | 工具名 | ☐ 通过 ☐ 不通过 |
| L2 | `bash` 省略 workdir，打印当前目录 | 成功，目录是本机会话目录（区域 1） | stdout 里的路径 | ☐ 通过 ☐ 不通过 |
| L3 | `bash` 在该目录写一个新文件 | 成功 | 文件内容 | ☐ 通过 ☐ 不通过 |
| L4 | `bash` 在该目录之外、且不是 `/tmp` 的路径写文件（区域 3） | 拒绝；文件不存在 | sandbox denied；该路径无新文件 | ☐ 通过 ☐ 不通过 |
| L5 | 本会话连上 `c1`。`sw_exec` `server` 为 `c1`，在登记根 `W` 里写文件；再往未声明的平级目录 `S` 写另一个文件 | `W` 成功（区域 4）；`S` 拒绝且文件不存在（区域 5，不新开可写 jail） | 远端两个路径的 `ls` | ☐ 通过 ☐ 不通过 |
| L6 | `sw_exec` `server` 为 `c1`：`touch /tmp/r37-i19-linux` | 成功，不弹提权卡。这是远端 jail 里的 tmpfs，不是这台 Linux 宿主的 `/tmp` | 工具 stdout / 退出码；无提权卡 | ☐ 通过 ☐ 不通过 |
| L7 | 断开 `c1`，或 `server` 填一个不存在的 id，再 `echo hi` | 拒绝，命令没有在远端执行 | 工具错误（先连接 / 未知 id）；没有 `hi` 的远端 stdout | ☐ 通过 ☐ 不通过 |
| L8 | `sw_exec` `server` 为 `local`，或 workdir 填本机绝对路径 | 拒绝，且没有改去跑 `bash` | 错误含 `use the bash tool`；结果不是 bash 的 stdout | ☐ 通过 ☐ 不通过 |
| L9 | `bash` 的 workdir 写成 `ssh://c1/…` | 拒绝 | 错误含 `this session is local. Remote commands use sw_exec` | ☐ 通过 ☐ 不通过 |

### 情况 2：主工作区在 `c1`

新开 `c1` 的远程会话。权限仍是 workspace-write。

| # | 操作 | 期望 | 观察点 | 结果 |
|---|---|---|---|---|
| L10 | `bash` 省略 workdir：`echo hi` | 成功，在远端登记根（区域 6） | stdout `hi` | ☐ 通过 ☐ 不通过 |
| L11 | `sw_exec` 省略 `server`，或 `server` 填 `c1`：`echo hi` | 拒绝，不执行 | 错误含 `uses the bash tool` | ☐ 通过 ☐ 不通过 |
| L12 | 若另有已连接机器 `c2`：`sw_exec` `server` 为 `c2`，`echo hi` | 成功，在 `c2` 上 | stdout `hi`；无 L11 的拒绝 | ☐ 通过 ☐ 不通过 ☐ N/A |
| L13 | `bash` 的 workdir 写成另一台机器的 `ssh://…`；再把 workdir 写成本机绝对路径 | 两次都拒绝 | 前者含 `Use sw_exec for that server`；后者含 `local paths use sw_exec with server "local"` | ☐ 通过 ☐ 不通过 |
| L14 | `sw_exec` `server` 为 `local`，workdir 为本机绝对路径，打印当前目录。再省略 workdir 打一次。再把 workdir 写成相对路径打一次 | 显式绝对路径：成功，目录就是那个路径，不是远端、也不是 `dsw-routes` 占位。省略 workdir：恰好一个本机副根时是那个目录，否则是用户主目录。相对路径：拒绝 | 两次 stdout 的路径；相对路径的错误含 `a local workdir must be an absolute path` | ☐ 通过 ☐ 不通过 |
| L15 | 标题栏「工作区」挂一个本机目录（区域 9）。workspace-write 下用官方 Write，或 `sw_exec` `server` 为 `local`、workdir 指到该目录，写一个新文件。另外用 `sw_exec(server: "local")` 写宿主 `/tmp` 下一个新文件 | 区域 9 拒绝，文件不存在。宿主 `/tmp` 那条成功（官方可写例外，不是远端 tmpfs） | sandbox denied；区域 9 无新文件；宿主 `/tmp` 上该文件存在 | ☐ 通过 ☐ 不通过 |
| L16 | `sw_exec` `server` 为 `local`，workdir 为本机绝对路径，`run_in_background: true`，命令里先输出一行再 `sleep`。接着 `job_output`，再 `job_kill`。另起一条后台，往本机工作区外且不是 `/tmp` 的路径写文件 | 调用立刻返回，不等 sleep 结束。job id 的 `server` 和 `endpoint` 都是 `local`。`job_output` 读到那一行，`job_kill` 能停掉。工作区外的写在 `job_output` 里被拒，文件不存在 | 返回时刻；job 字段；`job_output` 原文；目标路径不存在 | ☐ 通过 ☐ 不通过 |

区域 7/8 的 jail 规则与 Windows 步骤 18、19 相同，Linux 上执行工具是官方 `bash` 而不是注入的 bash：workdir 指到已挂的平级副根 `S` 时可写，停在 `W` 时写 `S` 被拒；workdir 指到未声明目录 `U` 时写被拒，`touch /tmp/r37-i19-linux-8` 成功且无提权卡。Windows 已按注入 bash 通过，这里不单列、不进分母。有余力可以再走一遍。

## 6. 备注

- 机器 id `local` 不能登记。设置页不会让人填写 id，这一条由单测覆盖，本脚本不跑。
- 区域 2/9 不能靠本插件变成可写根。要写只能走已有的一次提权。
- §5 由 Linux 宿主的验收人填写。勾完后把通过项写进 §3，不要改 §2 里已经勾过的 Windows 结果。
- 验收后删掉 `W`/`S`/`U`、本机探针和宿主 `/tmp` 里的探针文件，确认 50599 已停止。

来源：`docs/uat/README.md`；`docs/decisions/ADR-0028-region-permission-matrix.md`
