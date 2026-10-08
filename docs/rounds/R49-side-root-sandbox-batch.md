# R49 — 副根同权、远程单一执行路径、术语与 spike 一批

> 用户点名的一组：`REQ-I24` `UX-9` `AUDIT-7` `REQ-I23` `BUG-12`，顺带 `UX-7`（AUDIT-7 备注里绑定）。
> 一个 PR，叠在 R48（PR #60）分支上。日期：2026-10-08。`UPSTREAM-12` 按所有者指示删除（上游不收 issue）。

## 1. 做了什么

- **BUG-12**：0.2.0 官方 bash/pwsh 走 `shell.resolve` + `shell.execute`，旧桥只包了 0.1.7 的
  `run` / `start`。补包后单次提权与 workdir 钉住都能带到 spawn。
- **REQ-I24**：本机并列副根在 workspace-write 下与主根同权（第一级：一次写 / 一条命令一个根）。
  - 文件：`SideRootSandboxedFileSystem` 按写入目标把 `policy.workspaceRoot` 换成目标所在副根；
  - 命令：shell 入口把 workdir 放进 `AsyncLocalStorage`，`ctx.sandbox.confine` 的包装按它换根。
    backlog 原写「spawn 时重调 confine」——不可行：spawn 同步、confine 异步，所以改在 shell 入口；
  - 只认本会话的副根（`listFor(sessionId)`），嵌套在主根里的副根保持主根；只换 workspace-write。
- **AUDIT-7**：`architecture.md` §4.1 加权限真值表（A 谁执行 / B 可写区域 / C 单次提权入口 /
  D 拦不住的）。清理时发现并补上三个洞：
  1. 子路径行与降级路径仍按机器字段走宿主侧 bwrap 包装；
  2. 子路径 `SshFileSystem` 写不看会话档（围栏档下裸 SFTP 写）；
  3. 聚合传输（无注册表连接 id）的写在围栏档下落 SFTP。
  现在远程只剩远程组件一条执行路径；机器字段 `remoteSandbox`、宿主侧 bwrap 包装 / 探针 / 缓存全删，
  旧 machines.json 的键读入忽略、保存即丢。
- **UX-7**：设置页审批下拉、围栏说明、🛡 / 🧱 徽标删掉；执行门保留。
- **UX-9**：用户可见文案、README、现行文档「核心」→「远程组件」；标识符、线协议、工件名、
  面向模型的 `core` 不改。
- **REQ-I23**：spike 结论写成 [ADR-0030](../decisions/ADR-0030-local-seams-stay-routed.md)：
  本地接缝不能交还官方（官方消费者只认部署根作用域里的那一个提供者），推荐「未知方法默认转发」，
  实现另立 `REQ-I25`。

## 2. 行为变化（需要知道的）

- 宿主组合里没有 `sandboxPolicy` 服务时，远程 spawn / 终端 / 写一律按 `read-only` 拒（fail-safe）。
  之前只有 spawn 这样，终端与写各走各的。
- 子路径行没挂 `coreHub` 时，围栏档会话的远程命令与写被拒；danger 档照旧裸 SSH / SFTP。
- `core.status` 不再带 `sandbox` 字段（它报的是机器字段，已无意义）。

## 3. 分工

- 主代理：BUG-12、REQ-I24、AUDIT-7 执行路径重写与测试、文档。
- 便宜子代理（composer）：`remoteSandbox` 字段在注册表 / web / 客户端 / 词典的删除与 UX-7 界面；
  主代理审后补删一个只剩空实现的 `sandbox-badge.ts`、修一处断句注释。
- 只读 spike 子代理：REQ-I23 调查报告（结论经主代理对照 `@deepseek-ai/cordis@4.0.4` 源码复核）。

## 4. 未完成（真机）

lab 实机脚本 [`uat/R49-side-root-sandbox-batch.md`](../uat/R49-side-root-sandbox-batch.md)：
Windows ACL 首次授权耗时与卸载不收回、远程拒绝文案、BUG-12 pwsh 提权、设置页目测。
