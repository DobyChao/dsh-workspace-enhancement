# ADR-0030: 本地接缝能否交还官方——结论：路由层必须留，改为默认转发

- 状态: proposed（**事实已核实**；§3 的方向待所有者拍板，实现另开待办）
- 日期: 2026-10-08
- 范围: `REQ-I23` spike——混合门面能否只挂远程世界，本地 `subprocess` / `fs` / picker 交还官方行
- 关联: **ADR-0029** A′（缩小每代上游适配面）、**ADR-0028** / `REQ-I24`（本机副根写放宽）、
  **ADR-0019**（subprocess 不再查副根）、`UPSTREAM-1` / `UPSTREAM-5`（门面补方法的历史）

## 0. 结论

**有条件可行，但不是「我方只管远程」**。只要一个会话里本地与远程并存，`ctx.fs` /
`ctx.subprocess` 上就必须有一层路由，而这层路由只能是**那一个**已注册的服务实例。能缩小的是
「本地方法逐个手写转发」的成本，不是路由本身。推荐 §3 的 B：继续做唯一提供者，未知方法默认转发
给本地委托。

## 1. 事实（2026-10-08 核）

| 事实 | 证据 |
|---|---|
| `ctx.provide(name)` 在**同一隔离作用域**内第二次注册即抛 `service "…" has been registered at <fiber>`；`ctx.set` 只允许提供它的 fiber 改写（`cannot set property "…" in multiple fibers`） | `@deepseek-ai/cordis@4.0.4` `src/reflect.ts` |
| `ctx.isolate(name, label?)` 能开一个子作用域另行提供同名服务——所以「只能注册一次」的准确说法是「每个隔离作用域一次」 | 同包 `src/context.ts` `isolate()` |
| 官方工具与 shell 在部署根上下文注入 `fs` / `subprocess`；已安装的 `@deepseek-ai/*` 里**没有**任何 `isolate('fs' \| 'subprocess')` 调用；`dsh-session` 的 fork 是事件日志血缘，不是 Cordis 隔离 | 全量 grep |
| 官方 seam 的定义是「一个执行世界」：`dsh-fs`「Filesystem Service Definition for one execution world」；`SubprocessTerminalSpawnSpec.cwd`「in this subprocess provider's execution world」 | `dsh-fs` / `dsh-subprocess` `0.1.7-rc.2` |
| 官方 SSH 四包（`0.2.0-rc.2`）是**整体替换**本地 `fs` / `subprocess` / `sandbox` 的组合，不是并挂；宿主仍拒 Windows | ADR-0029 §1 |

⇒ 让官方行提供本地、我方另外提供远程，在官方消费者看来不存在第二个提供者；子作用域方案需要宿主
把工具挂到会话级隔离下，宿主没有这种机制。

## 2. 门面今天对本地世界多做了什么

纯本地会话、普通路径时，本地行为就是官方 `LocalSubprocessRuntime` + `SandboxedFileSystem`。
门面**额外**负责、且交还后无人接手的：

1. 世界判定：`ssh://<id>/…`、占位树 `dsw-routes/<id>/…`（及旧名）、win32 裸 POSIX 路径都算远程；
2. 本地 cwd 下的注册表级远程路径（`REQ-I11`）与远程副根分流（`resolve` / `lstat`）；
3. 远程会话的占位 cwd——在宿主磁盘上看是本地目录，必须拦住；
4. `REQ-I24` 的本机副根写放宽：`SideRootSandboxedFileSystem` 是我方构造的子类，交还官方实例后只能
   原地包它的 `writeText` / `editText`；
5. picker 是另一个同名约束的接缝，Windows 本机 + 远程双根浏览是产品价值，独立决策。

## 3. 选项

| 选项 | 做法 | 省掉什么 | 风险 | 量级 |
|---|---|---|---|---|
| A 现状 | 显式列方法转发 | — | 每次上游加方法都要补门面（`mixed-fs-contract.test.ts` 锁死面） | 0 |
| **B 默认转发（推荐）** | 仍禁用官方行、仍是唯一提供者；只拦带路径/cwd 的方法，其余方法默认转发本地委托 | 纯本地新增方法的逐个补丁 | 转发不能破坏 `Service` 身份与 Cordis 追踪；getter（`sandboxMode`）要单独处理；契约测试要重写 | S |
| C 交还注册 | 去掉 `disabled`，官方 fiber 提供；我方 `inject` 后原地包官方实例的路径方法 | 本地后端重复构造、`LOCAL_FS_CONFIG` 与官方默认值漂移 | 包装顺序受 profile patch / 其他插件影响；必须幂等；包漏一个方法就静默落到宿主磁盘 | M |
| D 会话级隔离 / 官方 SSH 并挂 | — | — | 宿主无支持；官方 SSH 拒 Windows | 上游需求 |

## 4. 决策（待拍板）

- 采纳 B 作为下一步；C 只在「必须与官方行同版对齐注册」成为硬需求时再评估。
- 对外表述改为：「`fs` / `subprocess` 的部署级双提供不被官方消费者支持」，不再写「Cordis 只允许
  注册一次」（有 `isolate` 例外）。
- B 的验收：纯本地会话与官方行为逐字节一致；三条矩阵行（本地 cwd + `ssh://` 路径、远程 cwd + 本机
  副根、占位 cwd spawn）保持；`npm run check` + boot-smoke。
