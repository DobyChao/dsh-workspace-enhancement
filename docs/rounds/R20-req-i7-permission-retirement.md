# R20 — REQ-I7：副工作区权限档位退役 + 降级为薄声明清单

- 日期：2026-09-12
- 分支：`feat/req-i7-side-workspace-simplify`（从 `master` 拉）
- 决策：`ADR-0019`（supersede `ADR-0008`；收窄 `ADR-0007`；`ADR-0012` 作废）
- backlog：`REQ-I7` → done；`SEC-1`/`SEC-2` → dropped（§5 决策留痕）；`AUDIT-3` → done（随文件删除关闭）；`UX-2` 保留 blocked（浏览输入框与权限无关）

## 1. 背景与拍板

远程主工作区成熟后，ADR-0008 权限第一刀的前提（副根是进入某目录的唯一入口）失效：
`SshFileSystemEngine.resolve` 以 cwd 连接为 base 做 `posix.resolve`，远程会话内**同机任意绝对路径本就可达**；
副根对同机目录只剩「限权」作用，而两道门都是 advisory 且有已知绕过（ADR-0012 记录的
`fs:r+exec:on` 组合绕过、主 workdir 命令写删「只读」副根）。用户 2026-09-12 拍板：
**权限模型整体退役，副根降级为薄声明清单**；面板/store 保留（工作区生命周期线 REQ-I8 的 UI 载体）。

## 2. 实现方式

| # | 文件 | 改动 |
|---|---|---|
| 1 | `src/session-workspaces.ts` | `SideWorkspaceItem` 收缩为 `id/kind/rootKey/label`（删 `SideFsMode`/`SideExecMode` 与 `fs`/`exec` 字段）；`normalizeSideWorkspaceRecord` 加载时**忽略**旧 `fs`/`exec` 字段（不报错、不迁移，下次持久化自然丢弃）；`attach`/`detach`/`update(label)`/`list`/`listFor`/`match` 与 `normalizeSideRootKey`、最长前缀匹配原样保留 |
| 2 | `src/mixed.ts` | 删 `assertSideWriteAllowed`（fs 写门）与 `assertSideExecAllowed`（exec 门）及全部调用点；`MixedSubprocessRuntime` 构造器去掉 `sides` 参数（spawn 面不再消费副根）；`MixedFileSystem` 保留 `sides` 仅作路由（`resolve`/`lstat` 先看副根） |
| 3 | `src/model-prompts.ts` / `src/tools.ts` | 删 4 个权限词常量；`sideItem` 行只渲染 `{label}`+`{rootKey}`；`sideNote` 改无档位表述（副根=本会话可直接操作的附加目录；命令默认主工作区执行；跨机用 `sw_exec`）；`SideWorkspacePromptFact` 收缩为两字段 |
| 4 | `src/client/side-workspaces.tsx` | 删两个权限下拉（行内 + 表单）与 `draftFs`/`draftExec`/`updateSide`；`SideWorkspaceRow` 去权限字段；面板只剩挂/卸 + label |
| 5 | `src/web.ts` | `session.ws.add`/`session.ws.update` 的 payload 校验与 store 调用收窄（仍带 `fs`/`exec` 的请求以 `bad-request` 拒绝） |
| 6 | `src/plugin.ts` | `MixedSubprocessRuntime` 装配去掉 `sides`；注释更新 |
| 7 | `src/locale/dsw.ts` / `dsw.en.ts` | 同步删 6 键：`side.fs.label`、`side.exec.label`、`permission.rw`、`permission.r`、`permission.execOn`、`permission.execOff`；`side.empty` 文案去权限表述（331→325，zh/en 相等） |
| 8 | 测试 | `test/side-workspace-gates.test.ts` → **删**，接替者 `test/side-workspace-routing.test.ts`（resolve/lstat 副根路由、无匹配回退 cwd 世界、嵌套内根获胜、REQ-I7 写操作纯按 targetKey 路由无门；stub 补全 14 方法含 `processPathFromHostPath`/`readByteRange`）；`test/side-workspace-attacks.test.ts` **删除**（其对象就是门禁行为）；`test/side-prompt.test.ts` 改无权限标记断言（含负向断言 `!fs:`/`!exec:`/`!read-only`）；`test/session-workspaces.test.ts` 去权限字段断言 + 旧字段加载忽略回归（两个 fixture 故意带旧字段）；`test/exec-tools.test.ts` spawn 拒绝传播改通用错误；`test/{workspace-prompt-mount,prompt-injection}.test.ts` 的 `sideItem()` 去字段 |
| 9 | e2e | `E2E-05-side-workspaces-panel.spec.ts` 删两个 combobox 断言，加「默认本机模式无任何 `<select>`」负向断言；`e2e/fixtures/copy.ts` 同步删键改文案；`e2e/scenarios.md` E2E-05 行更新 |
| 10 | 文档 | 新增 `docs/decisions/ADR-0019-side-workspace-permission-retirement.md`（accepted）；`ADR-0008` → superseded、`ADR-0007` 状态行注明范围收窄、`ADR-0012` → 作废；`docs/architecture.md` §1/§4 模块表/§5.1/§5.5 重写/§5.7/§7（原 3、4 两条合并为新 3，后续重编号）；`README.md`/`README.zh.md` 特性行与设计要点重写；`SECURITY.md` 「什么算安全问题」删权限门项、「已知边界」改为薄声明说明；`CHANGELOG.md` 0.1.4 加破坏性条目；`docs/ROADMAP.md` SEC-1/SEC-2 行划掉 |

### 途中发现

- 初版 `side-workspace-routing.test.ts` 里我写了一条「占位树拼写的副根路径 resolve 应路由到远程分支」的用例，
  实跑红：**该行为从未存在**——占位树拼写只在 store 的 `match()`（门用）里归一，`MixedFileSystem.resolve`
  对占位拼写命中远程副根时 `parseSshRoute(placeholder)` 返回 null，落到 cwd 世界。REQ-I7 前即如此
  （旧 t2-fix 用例测的是门不是 resolve）。已删该用例；占位树匹配语义由 `test/session-workspaces.test.ts`
  的「LOCAL PLACEHOLDER spelling matches the remote root」继续锁定。

## 3. 验证方式与证据

| 验收项 | 命令/手段 | 结果 |
|---|---|---|
| 静态闸门 | `npm run check:static` | ALL PASS（词典 zh=325 en=325、无重复键、模板参数一致……） |
| 类型 | `npm run typecheck` | exit 0 |
| 单测（沙箱） | `npm run test:agent` | SANDBOX-LIMITED PASS（2 例失败均为既有沙箱受限类：process spawn EPERM + `SetFileSecurityW`，与本次改动无关） |
| 构建 | `npm run build` | `tsc` + `tsdown` 全绿（客户端半 2 文件） |
| 真 boot 哨兵 | `node scripts/boot-smoke.mjs --no-channel`（build 后） | **SMOKE PASS**（host 起活、`GET /` 200） |
| 权限残留（验收 b） | `grep` `src/` 与 `e2e/`：`permission\.`、`FS_PERMISSION_DENIED`（门）、`side.fs.label`、`side.exec.label`、`read-only`、`只读`、`exec: off`、`禁执行`、权限下拉相关 | src 仅剩 `filesystem.ts` 的 OS 级 `FS_PERMISSION_DENIED`（SFTP 权限错误透传，与门无关）与三处「read-only home」注释（DSH home 只读盘）；e2e 仅剩 spec 里的退役说明注释 |
| 词典键数（验收 b） | check:static 词典闸门 | zh=325 en=325 相等 |
| 提示词清单（验收 c） | `test/side-prompt.test.ts`（label+rootKey、无权限标记）+ `test/workspace-prompt-mount.test.ts`（本地无副根零注入） | 绿 |
| 文档同步（验收 d） | 本报告 §2 表第 10 行 | 全部落档 |

lab 真机挂/卸副根的手动 UAT 留给浏览器轮（本插件未装在 3080；lab 验证由主代理排期）。

## 4. 影响面

- **兼容性**：旧状态文件零迁移加载；旧客户端半（≤0.1.3）若向新宿主半发带 `fs`/`exec` 的
  `session.ws.add/update` 会得到 `bad-request`——本插件宿主半+客户端半同装同卸，无线上组合。
- **清账**：SEC-1/SEC-2 dropped；AUDIT-3 关闭；ADR-0012 作废。
- **保留**：面板、store、提示词清单、路由索引——REQ-I8（工作区生命周期 spike）的载体。
