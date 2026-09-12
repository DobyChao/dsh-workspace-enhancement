# UAT 脚本：AUDIT-6 远程命令审批门（R22）

> 按 `ADR-0020` 附录 A 大纲落盘；模板见 [TEMPLATE.md](./TEMPLATE.md)。

## 0. 基本信息

| 项 | 值 |
|---|---|
| 轮次 / 主题 | `R22—AUDIT-6 远程会话审批门 + AI answerer + 诚实化文案` |
| 验收对象 | 逐机器三态审批门（off/human/ai）、AI answerer 只读白名单自动放权、`sw-remote` 提示段诚实句与门生效句 |
| 需求 / 缺陷 ID | `AUDIT-6`（关联 `UX-1` 文档化、`SEC-3` 知情、`REQ-I9` 后续收口） |
| 脚本作者 / 日期 | `engineer-host` / `2026-09-12` |
| 预期耗时 | `25 分钟` |

## 1. 前置条件

| 项 | 值 |
|---|---|
| 版本 | `0.1.4（未发布，feat/audit-6-remote-approval-gate 分支构建）` |
| 分支 | `feat/audit-6-remote-approval-gate` |
| commit | `<实施轮合并后的短 sha>` |
| 构建产物 | `npm run build 后的 lib/（lab 以 link: 加载本仓库）` |
| lab 地址 | `http://127.0.0.1:50599/`（`scripts/dev-lab.ps1`） |
| 启动命令 | `pwsh -File scripts/dev-lab.ps1` |
| 浏览器与视口 | `<浏览器 + 版本>` / `1440×900` |
| 主题 / 语言 | `<任意>` / `<中文（表单文案以 zh 为源）>` |
| 其他前置 | ① lab 里已添加一台测试机器（下文称 `c1`，`<user>@<test-host>`，凭据已存）；② 会话可切权限策略（`/permission`）；③ A-8 需先按 `ADR-0015` 手工把 `remote-full` 预设片段并入 `$DSH_HOME/profiles/web/cordis.patch.yml`（整键替换）并重启 lab |

**禁止**：在 3080（真实实例）上执行本脚本；修改产品 profile；使用真实生产机器凭据。

## 2. 步骤

> A-1～A-10 对应 `ADR-0020` 附录 A。观察点里的「审计对」指会话日志中的 `approval/asked` + `approval/decided` 事件对（会话导出或 `$LAB_HOME` 下会话 JSONL）。

| # | 操作 | 期望 | 观察点 | 结果 |
|---|---|---|---|---|
| A-1 | 机器 `c1` 保持 `remoteApproval: off`（默认），开远程会话跑 `bash` 一条良性命令（如 `uname -a`）与一条 `sw_exec` | 与现状一致：无任何审批弹卡，命令直接执行 | 无 `approval/asked` 事件；设置页机器行无「🛡 审批」徽标 | ☐ 通过 ☐ 不通过 |
| A-2 | 设置页编辑 `c1` → 高级折叠区出现「远程命令审批」下拉 → 选 `human` 保存；远程会话让模型跑一条良性命令 | UI 弹审批卡，reason 含 `[dsw-remote-gate] machine=<id> target=<user>@<host> cmd=<命令预览>`；点 Allow once 后命令执行 | 弹卡文本可读出命令预览；会话日志出现 `approval/asked`+`approval/decided`（outcome=allowed-once）对 | ☐ 通过 ☐ 不通过 |
| A-3 | 同 A-2 配置，再跑一条命令，弹卡点拒绝 | 工具结果是可区分英文错误（`remote command rejected — the approval policy is … or the answerer denied it; check /permission or disable the machine approval gate`）；模型不原样重试同命令 | 工具结果文本含 `remote command rejected`；会话日志 decided=outcome rejected；系统提示含「do not retry a rejected command unchanged」（`remoteGateActive` 句） | ☐ 通过 ☐ 不通过 |
| A-4 | 改 `ai`；远程会话跑白名单命令（如 `pwd`、`git status`、`ls <dir>`） | 不弹卡直接执行；审计对仍落日志（decided=allowed-once，由 AI answerer 作答） | 无 UI 弹卡；会话日志仍有 asked/decided 对 | ☐ 通过 ☐ 不通过 |
| A-5 | `ai` 下跑非白名单命令（如 `touch x`） | 弹卡到人，与 `human` 一致 | 弹卡 + 人工决定后执行/拒绝 | ☐ 通过 ☐ 不通过 |
| A-6 | `human` + `run_in_background: true` 的远程命令 | jobId 先返回；批准 → job completed；拒绝 → job failed（detail=拒绝文案） | `job_output` 的 status/detail 文本 | ☐ 通过 ☐ 不通过 |
| A-7 | 会话切 `never` 策略（`/permission` 等价操作）+ 机器 `human`，跑命令 | 无弹卡，确定性拒绝文案（与 A-3 同款 rejected 文案） | 无弹卡；decided=rejected；工具结果含 `approval policy is \`never\`` | ☐ 通过 ☐ 不通过 |
| A-8 | （前置已应用 ADR-0015 预设片段）composer 权限下拉出现 `Remote Full` 且选中后 chip 显示之 | UX-1 验收（与门独立） | chip 文本 `Remote Full`；SEC-3 已知副作用（选中无二次确认弹窗）知悉即可 | ☐ 通过 ☐ 不通过 |
| A-9 | `human` 下让模型开远程终端（spawnTerminal） | 同样过门：弹卡；拒绝 → 终端工具报同款英文错误 | 弹卡 reason 预览是终端 argv（如 `bash`）；拒绝后工具结果含 `remote command rejected` | ☐ 通过 ☐ 不通过 |
| A-10 | 本地会话（本机工作区）跑命令 | 零问询（门只拦远程分支），本地沙箱行为不变 | 无弹卡、无 approval 事件 | ☐ 通过 ☐ 不通过 |
| A-11 | 提示段核对：`off` 机器的远程会话系统提示 | 含「Remote execution is not confined by the local sandbox…」诚实句；**不含**「additionally require an approval decision」门生效句 | 会话快照/导出的 system prompt 文本 | ☐ 通过 ☐ 不通过 |

## 3. 判定

| 项 | 值 |
|---|---|
| 结论 | ☐ 通过 ☐ 不通过 |
| 通过项 / 总项 | `<n>/11` |
| 证据链接 | `<$LAB_HOME\e2e\ 下的截图 / results.json / 会话日志>` |
| 未通过项 | `<指向 FEEDBACK 条目>` |
| 是否阻塞发布 | ☐ 是 ☐ 否 |
| 用户签字 | `<姓名 / 日期>` |

## 4. 环境指纹

| 项 | 值 |
|---|---|
| 实例 / 端口 | `lab / 50599` |
| 插件版本 | `<version>` |
| commit | `<短 sha>` |
| 宿主 OS / 版本 | `<例 Windows + 版本>` |
| 远端（如涉及） | `<测试机 OS；文档用占位主机名>` |
| 浏览器 / 视口 / 缩放 | `<浏览器版本> / <宽×高> / <缩放>` |
| 主题 / 语言 | `<浅色/深色> / <中文>` |
| 相关机器 id | `c1（<user>@<test-host>）` |

## 5. 备注

- **已知边界（如实，`ADR-0020` D1 / SECURITY）**：fs/SFTP 写路径不设门（「写脚本 + `bash script.sh`」组合可绕过形状门，REQ-I9 收口）；插件固定探针与 `sw_connect save:false` 临时连接不设门；非壳形状远程 spawn（LSP 等）不拦。
- **AI answerer 失效语义**：白名单分类器任何异常 → 委派人类（绝不自动放行、绝不饿死人类 answerer）；次序反转的最坏退化是「白名单命中也先问人」（安全方向失效）。
- 验收后请清理 lab 状态（把 `c1` 的 `remoteApproval` 改回 `off` 或删除测试机器；清理路由占位树），并确认 50599 已停止。
