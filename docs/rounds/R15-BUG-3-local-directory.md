# R15 — BUG-3：目录选择器「本机目录」接错服务

> 触发：用户 2026-09-09 截图报错「无法读取目录 `ctx.workspaces.listDirectory is not a function`」。
> 与同轮 `INFRA-11`（`lib/` 产物过期）**无关**，是独立缺陷；同 PR #8 交付。

## 1. 根因（磁盘权威取证）

客户端服务名漂移（与 `FIX-1` 同类）：

| 能力 | 真正所在的服务 | 证据 |
|---|---|---|
| `listDirectory(path, signal)` / `createDirectory(path, name)` | **`uiWorkspace`** | `dsh-client-ui-workspace/lib/client.js:37` `super(ctx, "uiWorkspace")`；`:85` `listDirectory`；`:90` `createDirectory` |
| 官方浏览 UI 的实际调用式 | `uiWorkspace` | `dsh-client-ui-directory-picker-browse/lib/client.js:1023` → `ctx.uiWorkspace.listDirectory(path, signal)` |
| `workspaces` 服务只有控制器面 | create / rename / delete / archiveSession / list | Service Catalog `key: "workspaces"`，`dsh-cordis-client-runner/lib/client.js:1488` |

本插件自首次导入（`4d15846`）起把两个 seat 接在 `ctx.workspaces.*` 上 ⇒ 「本机目录」浏览与「新建文件夹」必现 `TypeError`；远程浏览走 `/dsw` RPC，不受影响。
**为何一直没被发现**：该路径零覆盖（`test/**` 无 `listLocalDirectory`，`e2e/specs` 无「本机目录」场景），日常又都连远程机器。

## 2. 改动

| 文件 | 改动 |
|---|---|
| `src/client/local-directory.ts`（新） | `createLocalDirectorySeats(resolve, unavailable)`：**懒解析** + **方法存在性守卫**；文档写清 `uiWorkspace` vs `workspaces` 的区别与上游行号 |
| `src/client/index.ts` | 两个 seat 改由该工厂提供：`ctx.get('uiWorkspace')`（**可选**，不进 `inject`——服务缺失只降级成一行文案，不让设置页/副工作区一起挂不上）；`ClientWorkspaces` 类型删掉不属于它的目录方法；顶部模块注释更正 |
| `src/locale/dsw{,.en}.ts` | 新键 `flow.error.directoryUnavailable`（zh/en 329/329 仍严格相等） |
| `test/client-local-directory.test.ts`（新） | 8 用例：参数转发、path 缺省为 `undefined`、缺服务降级、**服务在但方法没了**也只报文案、**服务后挂载仍可用**（懒解析）、源码守卫（`src/client/**` 不得再出现 `workspaces.listDirectory/createDirectory`）、入口必须用 `ctx.get('uiWorkspace')` |
| `docs/uat/R15-local-directory-pane.md`（新） | 6 步 UAT（含负向对照与「产物过期」排错指引） |

**设计取舍**：`uiWorkspace` 不列为硬依赖（`inject`）。硬依赖会让「上游改名」升级成**整个插件不挂载**；按 `AGENTS.md` §6「可选服务 `ctx.get` 判空」，这里选择局部降级。

## 3. 验证

- `npm run typecheck` 0 错误；`npm run check:static` 16 项 ALL PASS（词典 329/329；WARN 在重建后消失）
- `npm run test:agent` **232 pass / 0 fail**（21 文件；新增 8 例）
- 单测直跑：`node --experimental-transform-types --test --experimental-test-isolation=none test/client-local-directory.test.ts` → 8/8
- 产物体检：`npm run build` 后 `lib/client.js` 含 `ctx.get("uiWorkspace")`，且全文只剩**文档注释**提及旧写法，无任何真实 `workspaces.listDirectory/createDirectory` 调用
- 未覆盖：浏览器内「槽位注入的是这两个 seat」只有 UAT/浏览器能证（CI e2e 作业默认手动跳过）

## 4. 遗留

- 同类风险：客户端服务名漂移没有通用防线。本轮只加了本缺陷的定点守卫；是否要扩成「插件消费的每个客户端服务都有一条契约守卫」记入 `AUDIT-1` 的邻域，暂不立新项。
- 用户验收：见 `docs/uat/R15-local-directory-pane.md`。
