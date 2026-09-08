# AGENTS.md — dsh-workspace-enhancement

> 给在本仓库工作的 AI 代理（DSH / Cursor / ZCode / 其他）与人类协作者的**工作规则**。
> 本文只放「规则与命令」；事实与设计在 `docs/`，待办在 `docs/backlog.md`。
> 本文档**入库**：clone 下来就能读到。请保持 ≤200 行。

## 1. 这个项目是什么

把 DSH 生态里散落的「工作区」能力（远程 SSH 工作、目录选择、机器/连接管理）收进**一个**插件包：
`ctx.subprocess` / `ctx.fs` 的远程 provider 让框架里所有消费这两条接缝的工具零改动地跑在远端。
架构见 `docs/architecture.md`，关键取舍见 `docs/decisions/ADR-*.md`。

技术栈：Node ≥ 22.8、ESM only、TypeScript + `tsc`（类型）+ `tsdown`（打包）。
宿主半编译到 `lib/`，客户端半（`src/client/` TSX）打包为单文件 `lib/client.js`。

## 2. 真相源（**不要另建第二份**）

| 想知道 | 看 |
|---|---|
| 待办 / 需求 / 状态 | `docs/backlog.md`（唯一待办真相源；改状态改这里） |
| 当前版本、提交、待办分布 | `docs/status.md`（`npm run status` 生成，**禁止手改**） |
| 架构、模块、机制 | `docs/architecture.md` |
| 为什么这么做 | `docs/decisions/ADR-*.md`（一决策一文件） |
| 每轮做了什么、怎么验的 | `docs/rounds/` |
| 测试怎么跑、沙箱限制 | `docs/testing.md` |
| 上游兼容与支持窗口 | `docs/compatibility.md` |
| 用户验收 | `docs/uat/` |
| 公开进度 | `docs/ROADMAP.md` |

`drafts/`、`.agent-teams/`、`.workbuddy/`、`.tmp/` 是**本地素材**（不入库、可能含机器专属数据）。
任何结论一旦拍板，必须搬进上面这些文件——否则下一个 clone 的人看不到。

## 3. 命令（直接跑，不要猜）

| 命令 | 用途 | 谁能跑 |
|---|---|---|
| `npm run check` | **唯一质量门**：静态闸门 + typecheck + 单测 + build + pack 冒烟 | CI / 本地 shell |
| `npm run check:static` | 静态闸门（词典/密钥/peer 家族/版本/提交信息等 12 项） | 代理 / CI |
| `npm run typecheck` | `tsc --noEmit` | 代理 / CI |
| `npm test` | 全量单测（`node --test`，21 文件） | CI / 本地 shell |
| `npm run test:agent` | 沙箱内单测（单进程、无 esbuild；自动分类沙箱受限失败） | **代理** |
| `npm run build` | `tsc` + `tsdown` | 代理 / CI |
| `npm run e2e` | Playwright 黑盒（lab 50599） | 本地 shell / CI |
| `npm run status` | 重新生成 `docs/status.md` | 任何人 |
| `pwsh -File scripts/dev-lab.ps1` | 起隔离 lab 实例 | 本地 shell |

改完代码后**至少**跑 `npm run check:static && npm run typecheck && npm run test:agent`；
能跑 shell 时跑完整 `npm run check`。

## 4. 沙箱现实（代理必读）

DSH 文件沙箱（workspace-write）**不能开管道**：

- `npm test` / `node --test` / `tsx` → `spawn EPERM`（逐文件 spawn / esbuild worker）。
  **代理用 `npm run test:agent`**：单进程 + Node 内置 TS transform，退出 0 = 没写坏。
- `tsc --noEmit` 正常（不 spawn）。
- 真进程用例（`(process-level)`、`AUDIT-TC*`）与 `SetFileSecurityW` 失败属**沙箱受限**，
  `test:agent` 会归类并仍返回 0；权威判定是 CI 的 `npm test`。
- 子进程捕获输出要用**文件描述符重定向**（见 `scripts/lib/run.mjs`），不要用 `execFileSync` 默认管道。

## 5. 红线（违反即回滚）

1. **凭据零泄漏**：密码/passphrase/私钥内容只进 `$DSH_HOME` 注册表或 OS 钥匙串；
   不写日志、不写仓库、不进 git（`.gitignore` 已覆盖 `machines.json` / `known_hosts.json`）。
2. **不碰产品 profile**：`$DSH_HOME/profiles/web` 由插件管理器重管；装/卸一律
   `dsh plugin --profile web add|remove <pkg>`，禁止手工编辑。
3. **不碰 3080**：一切开发验证在隔离 lab（`DSH_HOME=.dsh-lab`、端口 50599）；
   3080 的重启**只由用户执行**（`scripts/restart-3080.ps1`，会话外）。
4. **不 push、不打 tag、不 publish**：代理只做本地 commit；push / tag / npm publish 由用户执行。
5. **主机指纹默认校验**（TOFU：首次记录、变化即拒），降级必须文档警告。
6. **远程命令注入防护**：拼进 shell 的参数一律 POSIX 单引号转义。
7. **子代理禁止调用 `cordis_inspect_list` / `cordis_inspect_query`**：client 查询依赖页面应答，
   页面不响应会**永久挂起**（本仓库已两次卡死）。契约核验走磁盘权威源：
   ① 部署包 `$DSH_HOME/profiles/web/node_modules/@deepseek-ai/*`；
   ② 全局安装包 `<npm root -g>/@deepseek-ai/dsh/node_modules/@deepseek-ai/*`；
   ③ 本仓库 `node_modules/@deepseek-ai/*`。找不到就回来问，不要猜服务/槽位名。

## 6. 写插件代码 / 改 Cordis 组合前的固定动作

- 先加载技能：`editing-cordis-compositions`（组合/挂载/host-agent 判定）、
  `cordis-plugin-development`（动态插件、Service/Event/Slot/Tool）。
- **依赖**：宿主已提供的 `@deepseek-ai/dsh-*` 一律 `peerDependencies`（范围必须带 `-rc.`）
  + `devDependencies`（取类型）；`dependencies` 只留 `ssh2`。理由：Cordis 服务身份是**模块级
  Symbol**，自装副本会遮蔽宿主单例，导致 service/工具注册分裂。静态闸门会拦。
- **服务**：可选服务 `ctx.get(...)` 判空；硬依赖才 `inject`。
- **生命周期**：所有副作用（服务/事件/定时器/槽位/样式）挂 `ctx.effect()` / `ctx.on()`，
  保证卸载可逆；重装后再挂一次不得抛 "already registered"。
- **数据**：只读叶子字段，不序列化 Cordis 活对象。
- **i18n**：所有面向用户/模型的文案进 `src/locale/`（命名空间 `dsw`），禁止硬编码（闸门会拦）。
- **测试**：逻辑放 `.ts`，`.tsx` 只做视图（否则沙箱内覆盖不到）；见 `docs/testing.md`。

## 7. 一轮的工作流

1. 在 `docs/backlog.md` 加行（ID + `todo`），写清目标与验收标准。
2. 状态改 `doing`，拉短分支 `feat/<id>-slug` / `fix/<id>-slug`。
3. 小步提交，Conventional Commits，尾行 `Refs: <ID>`。
4. 验证：`npm run check`（或沙箱内 `check:static` + `typecheck` + `test:agent`）。
5. 开 PR（模板即验收清单）；涉及 UI 附 `docs/uat/` 脚本。
6. 合并后：状态改 `done`/`shipped`，`npm run status`，在 `docs/rounds/` 写一份报告。

## 8. 接手三分钟

1. `npm run status` —— 看版本、HEAD、待办分布、被挡住的项。
2. `docs/backlog.md` §1/§3 —— 当前在做什么、什么被挡住。
3. `docs/status.md` 的「质量门」表 —— 你能跑哪些命令。
4. `docs/compatibility.md` —— 别在错误的上游家族上开工。

**当前唯一即刻事项**：`PUB-1` 发布 0.1.2（用户 2FA）→ `PUB-2` 3080 换装并重启。
