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
| 预期耗时 | 40–60 分钟 |

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
| 其他前置 | Windows 宿主。一台 linux x86_64 远端，lab 机器 id `c1`，核心已部署。审批门 `remoteApproval` 为 off。会话权限 workspace-write。准备三个远端目录：登记根 `W`、与 `W` 平级且未挂为副根的 `S`、两者之外的未声明目录 `U` |

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

Windows 上计分步骤 1–12、14–19。没有第二台机器时步骤 13 标 N/A，不进分母。文末 Linux 附录在 Windows 上整段 N/A。

## 2. 步骤

### 情况 1：主工作区在本机

开一个本机目录会话。

| # | 操作 | 期望 | 观察点 | 结果 |
|---|---|---|---|---|
| 1 | 看本机会话的工具清单 | 有 `pwsh`、`sw_exec`；没有 `bash` | 工具名列表 | ☐ 通过 ☐ 不通过 |
| 2 | `pwsh` 省略 workdir，打印当前目录 | 成功，目录是本机会话目录（区域 1） | 工具 stdout 里的路径 | ☐ 通过 ☐ 不通过 |
| 3 | `pwsh` 在该目录写一个新文件 | 成功 | 文件内容 | ☐ 通过 ☐ 不通过 |
| 4 | `pwsh` 在该目录之外、且不是 `%TEMP%` 的路径写文件（区域 3） | 拒绝；文件不存在 | sandbox denied 文案；本机该路径不存在 | ☐ 通过 ☐ 不通过 |
| 5 | 本会话连上 `c1`。`sw_exec` `server` 为 `c1`，在登记根 `W` 里写文件 | 成功（区域 4） | 远端文件在 `W` 下 | ☐ 通过 ☐ 不通过 |
| 6 | 同一 `sw_exec`，往未声明的平级目录 `S` 写文件（区域 5） | 拒绝；`S` 里没有该文件 | 工具错误；远端 `ls` | ☐ 通过 ☐ 不通过 |
| 7 | `sw_exec` `server` 为 `c1`：`touch /tmp/r37-i19` | 成功，不弹提权卡 | 工具 stdout / 退出码；无提权卡 | ☐ 通过 ☐ 不通过 |
| 8 | 断开 `c1`，或 `server` 填一个不存在的 id，再 `echo hi` | 拒绝，命令没有在远端执行 | 工具错误（先连接 / 未知 id）；没有 `hi` 的远端 stdout | ☐ 通过 ☐ 不通过 |
| 9 | `sw_exec` `server` 为 `local`，或 workdir 填本机绝对路径 | 拒绝，且没有改去跑 `pwsh` | 错误含 `use the pwsh tool`；结果不是 pwsh 的 stdout | ☐ 通过 ☐ 不通过 |

### 情况 2：主工作区在 `c1`

新开 `c1` 的远程会话。权限仍是 workspace-write。

| # | 操作 | 期望 | 观察点 | 结果 |
|---|---|---|---|---|
| 10 | 看工具清单 | 有注入的 `bash`，也有 `pwsh` | 工具名 | ☐ 通过 ☐ 不通过 |
| 11 | `bash` 省略 workdir：`echo hi` | 成功，在远端登记根 | stdout `hi` | ☐ 通过 ☐ 不通过 |
| 12 | `sw_exec` 省略 `server`，或 `server` 填 `c1`：`echo hi` | 拒绝，不执行 | 错误含 `uses the bash tool` | ☐ 通过 ☐ 不通过 |
| 13 | 若另有已连接机器 `c2`：`sw_exec` `server` 为 `c2`，`echo hi` | 成功，在 `c2` 上 | stdout `hi`；无步骤 12 的拒绝 | ☐ 通过 ☐ 不通过 ☐ N/A |
| 14 | `bash` 的 workdir 写成另一台机器的 `ssh://…` | 拒绝 | 错误含 `Use sw_exec for that server` | ☐ 通过 ☐ 不通过 |
| 15 | `pwsh` 省略 workdir，打印 `$PWD` | 留在本机：恰好一个本机副根时是那个目录，否则是用户主目录。不是 Linux 路径，也不是 `dsw-routes` 占位目录 | `$PWD` 文本 | ☐ 通过 ☐ 不通过 |
| 16 | `pwsh` 的 workdir 显式写成 `ssh://c1/…` 或裸 POSIX `/…`，再打印 `$PWD` | 仍落在步骤 15 的本机目录，不报错 | `$PWD` 与步骤 15 相同；工具结果不是拒绝 | ☐ 通过 ☐ 不通过 |
| 17 | 标题栏「工作区」挂一个本机目录（区域 9）。workspace-write 下用官方 Write 或 `pwsh` 往那里写新文件 | 拒绝；文件不存在 | sandbox denied；该路径无新文件 | ☐ 通过 ☐ 不通过 |
| 18 | 再挂一个与 `W` 平级的远程副根 `S`。`bash` 的 workdir 指到 `S` 并在其中写文件；然后不改 workdir（停在 `W`）再写 `S` 里另一个文件 | 指到 `S` 时成功；停在 `W` 时拒绝，第二个文件不存在 | 远端两个路径的 `ls` | ☐ 通过 ☐ 不通过 |
| 19 | `bash` 的 workdir 指到未声明目录 `U`，在其中写文件；再 `touch /tmp/r37-i19-8` | 写 `U` 被拒且文件不存在；`/tmp` 那条成功且无提权卡 | 工具错误；远端 `ls`；无提权卡 | ☐ 通过 ☐ 不通过 |

步骤 7 和 19 的 `/tmp` 文件在 jail 的 tmpfs 里，serve 重启后会消失，不是远端宿主的 `/tmp`。验完不必到宿主上去找。

步骤 16 按当前实现判通过（显式远程路径也被改到本机，不拒绝）。若希望改成直接拒绝，记到 [FEEDBACK.md](./FEEDBACK.md)，不要因此把本步打成失败。

## 3. 判定

| 项 | 值 |
|---|---|
| 结论 | ☐ 通过 ☐ 不通过 |
| 通过项 / 总项 | |
| 证据链接 | `$LAB_HOME\e2e\` 下的工具结果摘录（不要带凭据） |
| 未通过项 | |
| 是否阻塞发布 | ☐ 是 ☐ 否 |
| 用户签字 | |

## 4. 环境指纹

| 项 | 值 |
|---|---|
| 实例 / 端口 | lab / 50599 |
| 插件版本 | `0.2.1` |
| commit | |
| 宿主 OS / 版本 | Windows |
| 远端 | linux x86_64 |
| 浏览器 / 视口 / 缩放 | |
| 主题 / 语言 | 浅色 / 中文 |
| 相关机器 id | `c1`（可选 `c2`） |

## 5. Linux 宿主附录（Windows 上不跑）

主工作区在远程时：`sw_exec` `server` 为 `local`、workdir 为本机绝对路径，命令在本机执行；对这台远程机器再调 `sw_exec` 应被拒绝，原文含 `uses the bash tool`。主工作区在本机时：`sw_exec` `server` 为 `local` 被拒绝，原文含 `use the bash tool`。

`sw_exec(server: "local")` 不支持 `run_in_background`，带上应直接拒绝。

## 6. 备注

- 机器 id `local` 不能登记。设置页不会让人填写 id，这一条由单测覆盖，本脚本不跑。
- 区域 2/9 不能靠本插件变成可写根。要写只能走已有的一次提权。
- 验收后删掉 `W`/`S`/`U` 里的探针文件，确认 50599 已停止。

来源：`docs/uat/README.md`；`docs/decisions/ADR-0028-region-permission-matrix.md`
