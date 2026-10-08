# 安全策略

## 支持范围

只支持当前发布家族（见 `docs/compatibility.md` 的支持窗口）。旧版本不回补安全修复，请升级。

## 什么算安全问题

- 凭据泄漏：密码 / passphrase / 私钥内容出现在日志、错误信息、UI 透传视图或仓库里
- 主机指纹校验被绕过（TOFU 记录被静默接受或覆盖）
- 远程命令注入（拼进 shell 的参数未做 POSIX 单引号转义）
- 插件读取/上传了工作区之外的数据

## 已知边界（不是漏洞，但请知悉）

### 红线 1 复述：凭据永不作为模型工具参数（SEC-5 教训，2026-09-13）

**密码 / passphrase / 私钥内容永远不得出现在模型工具的参数面里。** `tool/call` 事件的 `arguments`
字段会**原文持久化进会话日志**，所以「模型代填密码」等于「明文凭据落盘」——这是 `SEC-5` 发现①
的真实事故形态（旧 `sw_connect` 的 `password` 参数）。

- `sw_connect` 现在**只接受注册表机器 id**（`machines: string[]`），不再有
  `host/username/port/password/privateKeyPath/save` 参数：凭据只能来自注册表 / OS 钥匙串 /
  `~/.ssh/config`（`resolvePassword` 解析序不变），注册动作只发生在用户驱动的设置页/添加工作区流。
- 机器注册也移出模型面：模型可以向**用户已注册**的机器发起连接，但不能新增机器到用户域。
- 新增/修改带凭据字段的工具参数（例如给某个工具加 `password`）属于**红线 1 违规**，评审直接拒绝。

### 其余已知边界

下列行为已在 `docs/decisions/` 与 `docs/compatibility.md` 记录，属于**已知边界**：

- **副工作区 = 工作区的延伸**（`ADR-0019` / `ADR-0028` §5 / `REQ-I24`）：不设逐根 fs/exec 档位
  （旧门的已知绕过见 `ADR-0012`，已作废）。workspace-write 下，一次写（按目标路径）或一条命令（按 cwd）
  落在本会话挂的哪个根，就以哪个根为可写根，本机与远程同规则；**挂副根即放宽写范围**，所以挂载只开放给
  面板上的人，模型工具不能挂。在主根里跑的命令写并列副根要提权。完整真值表见 `docs/architecture.md` §4.1。
- **远端权限跟会话 `/permission`（`ADR-0025`）**：远程命令与文件工具走与本地同一套沙箱档和官方提权卡。无 Linux 远程组件（代码与协议中仍称 core）时，围栏档的**写与 spawn** fail-closed、不退 SFTP；**读**可见降级到 SFTP（`REQ-I15`，否则宿主项目根探测会挡住纯聊天）。`danger-full-access` 保持今天的 SFTP + SSH。可选的**逐机器审批门**（`remoteApproval: 'off' | 'human' | 'ai'`，默认 `'off'`）在
  shell 形状的远程命令与远程终端执行前经平台审批服务决定。该门**明确不覆盖**（诚实边界，`ADR-0020` D1）：
  1. **审批门不覆盖 fs 写**——围栏档的写由远程组件 jail 覆盖；danger 且无远程组件时仍是 SFTP；
  2. **插件自有固定探针**不设门（注册表 `probe`/`reconnect`、`sw_status` 环境自检、`sw_exec` 的
     OS 探针、连接测试）——走 `connection.exec` 直连通道，命令文本是插件常量、非模型输入；
  3. ~~`sw_connect save:false` 临时连接不设门~~——**该路径已退役**（`ADR-0021` §1/§5：临时连接整体
     退场，机器宇宙 = 用户注册表），此项失去对象；门现在只认注册表机器标志，且 `sw_exec` 另有
     会话级连接门（`ADR-0021` §2.5）；
  4. 非壳形状的远程 spawn（LSP、宿主自组 argv 的进程）不拦——威胁面是**模型撰写的命令文本**，
     shell `-c` 形状正是它的唯一常规载体。
  审批门与 sandbox 提权同时开启会弹两张卡。设置页「远程命令审批」下拉已移除（`UX-7`）；门本身仍是
  `ADR-0020`，默认 `off`，只能由 machines.json 中已有的 `remoteApproval` 值开启。
- **会话级「已连接机器」门是可见性门，不是强制门**（`ADR-0021` §2.7，2026-09-13 实测取证）：
  `sw_connect` 的连接集合决定**本会话看到什么**（`sw_exec` 是否可用、提示词里有没有机器清单），
  但它**拦不住**会拼路径的模型，两条已验证的绕行：
  1. **fs 面**：官方 `read`/`write`/`edit`/`glob`/`grep` 传 `ssh://<id>/…` 即直达该机器——路由是
     **注册表级**（任何已注册机器都可解析），不查会话；
  2. **exec 面**：官方 `bash`/`pwsh` 工具把模型给的 `workdir` **原样**当 `spec.cwd`
     （`dsh-tool-bash`：`...args.workdir !== void 0 ? { cwd: args.workdir } : {}`，`resolveWorkdir`
     只把**相对**路径接到会话 cwd），混合门面按 `worldOfCwd(spec.cwd)` 路由 ⇒ 零连接的本地会话
     传 `workdir: "ssh://c1/…"`（`c1` = 注册表机器 id）就能在已注册机器上执行命令。
  这是**结构性**的：`SubprocessSpawnSpec` 不携带会话身份，门面在 spawn 时无从判别会话，所以门只能
  做在工具层（用户 2026-09-12 拍板「门控只做在工具层与提示层」）。命令级仍有审批门兜底（该路径
  argv 仍是 shell 形状）；**强制层**只有远端 OS 权限（低权用户/容器）与远程组件 jail
  （会话 `/permission` 为 `read-only` / `workspace-write` 时命令**与文件工具**同进 jail；
  `danger-full-access` 走 SFTP + 裸 exec）。
- SSH 固有：远端 pid / 前台进程组不可见。
- 围栏档不再要求用户预装 `bwrap` / `ripgrep`：两者打进远程组件 tarball，由设置页 `core.deploy`
  上传。远程组件缺失或架构不符时 fs 与 spawn **一起** `SANDBOX_UNAVAILABLE`（UAT I9-9 **反转**：
  `read-only` 下官方 `write` 工作区外失败且文件不存在），读仍走 SFTP；只有 `danger-full-access`
  是 SFTP + 裸 exec。宿主组合里没有 `sandboxPolicy` 服务时按 `read-only` 处理（fail-safe）。交互终端在围栏档仍拒绝。供应链（二进制来源、签名、校验和）是新信任根。
- **宿主静默项目根探测会铸出比会话更宽的 workspace-write jail**（`BUG-4`，2026-09-15 R27）：
  `dsh-agent-instructions` 等在组上下文时沿目录 `resolve(…/.git)`，轨迹不可见。插件把探测路径当
  `cwd` 后会对 `/home`、`$HOME` 做 `--bind`。官方 Write 打进会话 jail 时工作区外拒绝仍可能成立；
  多出来的宽 serve 是另一份可写面。事实 [`docs/notes/host-silent-fs.md`](./docs/notes/host-silent-fs.md)；
  修完本条从这里删掉。

如果你发现**上面之外的**绕过路径，请按下面的方式报告。

## 怎么报告

用 GitHub Security Advisories（仓库 → Security → Report a vulnerability）私密提交。
不要在公开 issue 里贴真实主机、用户名、指纹或凭据。

请附：影响版本、复现步骤（脱敏）、期望与实际、影响面评估。

## 我们怎么处理

- 确认为安全问题后，在 `docs/backlog.md` 建 `SEC-` 条目并给出修复计划；
- 修复提交在 CHANGELOG 里以 `### 安全` 小节说明（不披露利用细节，直到用户可升级）；
- 无法修复但必须接受的，写进上面的「已知边界」并给出缓解建议。
