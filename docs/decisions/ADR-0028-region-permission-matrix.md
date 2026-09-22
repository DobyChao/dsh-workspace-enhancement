# ADR-0028: 主/副工作区区域权限（工具绑世界）

- 状态: proposed（**REQ-I19**；`REQ-I18` 已于 2026-09-22 简验。本文仍是预期，不是现状）
- 日期: 2026-09-22
- 范围: 会话主根 / 副根 × 本机 Win·Linux / 远程 Linux × `bash` / `pwsh` / `sw_exec` / 官方 Read·Write，在 `/permission` 三档下的路由与 workspace-write 可写集
- 关联: 承接 **ADR-0019**（本机副根无权限档）、**ADR-0024** §6.2（WW 每根一条 serve）、**ADR-0025** / **REQ-I18**（spawn 一次提权）、**ADR-0027**（无 `sw_pick_workspace`，主根 = 会话 cwd）

## 0. 为什么先记、先不做

区域预期和今天的实现不一致（Win 远程会话的 pwsh 会跟会话 cwd 送到 Linux；Linux 远程主会话没有本机 exec；未声明 spawn cwd 会新开一条 WW serve）。spawn 一次提权在 `REQ-I18`，用户已于 2026-09-22 简验。

区域矩阵里「WW 拒写之后如何 allowed-once」依赖 I18 的 overlay 与拒绝标记。**REQ-I19 可以开工。**

不改核心协议，不升 `CORE_ARTIFACT_VERSION`。WW 多根已经是多进程，不是一个 `serve` 里重复 `--workspace`。

## 1. 图中区域

会话只有一个主根 = `header.cwd`。副根是薄声明（ADR-0019），没有独立 `fs`/`exec` 档。`/permission` 仍是整会话一档。

- 情况 1（主在本机）：1 本机主根、2 本机副根、3 本机其余、4 远程副根、5 远程其余。
- 情况 2（主在远程 Linux）：6 远程主根、7 远程副根、8 远程其余、9 本机副根、10 本机其余。

`sw_pick_workspace` 已删。`workdir` / `file_path` 不换主根。跨世界靠另一个工具或 `sw_exec` 的 `server`，不靠改 `workdir`。

## 2. 工具绑世界

| 宿主 | 主根 | 远程命令 | 本机命令 |
|---|---|---|---|
| Win | 本机 | `sw_exec` | 官方 `pwsh` |
| Win | 远程 | 注入 `bash`（钉远程） | 官方 `pwsh`（钉本机；省略 workdir 也不得送到 Linux） |
| Linux | 本机 | `sw_exec` | 官方 `bash` |
| Linux | 远程 | 官方 `bash`（钉远程） | `sw_exec(server: "local")` → 本机 `bash -c` |

拒绝：工具世界与路径拼写冲突则报错，不改路由。

- 钉远程的 bash：本机盘符、UNC、非占位宿主路径 → 拒。`workdir=ssh://<其他机>` → 拒，改 `sw_exec`。
- Win 上 `pwsh`：`ssh://`、POSIX 绝对、占位树 → 不送到远端；省略 workdir 时 cwd 改成本机默认根（见 §4），不 throw。
- `sw_exec` 的远程目标：
  - 情况 1（主在本机）：`server` 省略或注册表 id → 该远程（4 可写，5 只读可提权，见 §5）。无本会话连接、未知 id、workdir 非法 → 拒绝并提示（先 `sw_connect`、列出已知 id、或路径形状），不执行。
  - 情况 2（主已在该远程）：目标落在 6/7/8（省略 `server`、该机 id、该机路径）→ 拒绝，提示改用已注入的 `bash`。另一台已连接机器仍用 `sw_exec`。Linux 同样：该机远程用官方 `bash`，`sw_exec` 不重复执行 6/7/8。
- `server: "local"` 仅 Linux 且主根在远程时合法，用来跑 9/10（本机 `bash -c`，仍受宿主沙箱）。Win 上 `local`、以及任何打到 9/10 的 `sw_exec`：拒绝并提示用 `pwsh`，不把参数改写成一次 pwsh 调用。
- `local` 是保留 id，不得登记为机器。已有同名机器则 add/load 失败。

## 3. 官方 Read / Write（不改 schema）

只有 `file_path`。混合 `resolve` 按拼写选世界。远程命中后 `displayPath` 已是 `ssh://<id>/<posix>`。

- 相对路径 → 主根世界（1 或 6）。
- `ssh://<id>/…` 或占位树 → 该注册表机器（不查会话连接门，ADR-0021）。跨机只用这种前缀。
- 宿主绝对路径 → 本机。已挂本机副根在远程 cwd 下仍走本机（现有 side 匹配）。
- Win 上裸 POSIX `/…` → 远程拼写。Linux 宿主没有这条：情况 1 的裸 POSIX 是本机。

## 4. 本机默认 cwd（主根在远程时）

`pwsh` / `sw_exec(local)` 不用会话远程 cwd。恰好一个本机副根 → 用它当 cwd；否则 `os.homedir()`。多个本机副根不猜。显式 `workdir` 必须是本机绝对路径。

这只决定进程 cwd。**不**把 9 写进本机 `writableRoots`。

## 5. workspace-write 可写集

本机副根 **维持现状**（ADR-0019）：**2、9 不是可写集**。cwd 可以到那里，写应 sandbox denied（2 是 1 的子孙时除外）。本机另加官方 `/tmp` 与 `os.tmpdir()`（Windows 上真正能写的是 `%TEMP%`）。情况 1 的本机可写根是 **1**。3 与 10 同样要提权。

本机 9（以及非子孙的 2）没有不提权的做法。上游 `writableRoots`（`@deepseek-ai/dsh-sandbox`）只含 `policy.workspaceRoot`（来自 `session.header.cwd`）、`/tmp`、`os.tmpdir()`。远程主会话的 cwd 是 `dsw-routes/<id>/…` 占位目录，9 在其外。插件不拥有这份允许列表；把会话 cwd 改成 9 会换掉主根。WW 下写 9 被拒，I18 一次提权（或 sticky danger）是出路。Linux 本机副根相同。

远程副根 **4、7 视为 WW**，机制是 ADR-0024 §6.2 已有的 **每根一条 serve**（`coreSessionKey` 含根；`sideRootsOf` 已把该机远程副根放进 declared）。一次 `serve` 仍只有一个 `--workspace`。

- 路径或 spawn cwd 落在 4/7 → 最长包含前缀 → 多开或复用那条 serve，该根内可写。
- 7 嵌套在 6 下 → 共用 6 的 serve，cwd 在 6 也能写 7。
- 7 与 6 是兄弟 → 两条 serve。cwd 在 6 的 bash **写不了 7**；`workdir` 或 Write 路径指到 7 才开 7 的 serve。
- 情况 1：登记根一条；4 是兄弟则另一条。`sw_exec` 默认 cwd 是登记根，不自动可写兄弟 4。
- **5、8 禁止再铸 WW serve。** 今天未声明 cwd 会 `gitWorkingTreeOf` 新开可写 jail；I19 改为只改 cwd，写由当前 jail 拒绝。
- 远程 WW 的 shell 写 `/tmp` **已经放行**，不用再加挂载。`core/profile.json` 的 `workspaceWriteExtra` 是 `--tmpfs /tmp`，`jail.go` 在 `--bind <根>` 之前拼上。这是 jail 内一块空 tmpfs，不是宿主 `/tmp`，serve 重启即丢。官方 Read/Write 仍按 `canWrite` 拒绝工作区外路径（R27）。`/var/tmp` 没有额外挂载，不放行。read-only 档没有这块 tmpfs。所以 5 与 8：shell 写 `/tmp` 不用提权；其它路径走 I18。

read-only：能跑、各格都不能写（本机 `/tmp` 的官方例外另计）。danger-full-access：该世界内不围栏（远端 `--sandbox off`；无核心则裸 SSH）。无核心 + 围栏档：4/5/6/7/8 的 spawn 与写 fail-closed。

sticky WW 下 5/8（以及非子孙的 2/9）要写，走 danger，或用 I18 的 spawn allowed-once。Write 的 fs overlay 已在 I13。

## 6. 不做

- 不把本机副根 2/9 加进 `writableRoots`。
- 不把多个根绑进同一个 bwrap，不升核心版本。
- 不恢复 `sw_pick_workspace`。
- 不在 Win 上做 `sw_exec(local)`，也不把这类调用静默映射成 `pwsh`。
- 不改官方 Read/Write/bash/pwsh 的 schema。
- 不做本机/远端两套 `/permission`。
- 路由与「未声明 cwd 不新铸 jail」在 REQ-I19 的实现里，不在本文。
