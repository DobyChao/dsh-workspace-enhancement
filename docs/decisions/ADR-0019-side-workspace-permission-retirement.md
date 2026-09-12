# ADR-0019: 副工作区权限档位退役——降级为薄声明清单

- 状态: accepted
- 日期: 2026-09-12
- 范围: `src/session-workspaces.ts`（实体收缩 + 旧字段忽略）、`src/mixed.ts`（删两道门）、
  `src/model-prompts.ts` / `src/tools.ts`（提示词无档位化）、`src/client/side-workspaces.tsx`（面板收窄）、
  `src/web.ts`（RPC 参数收窄）、`src/locale/`（删权限键）、`test/` 与 `e2e/`（断言收缩）
- 关联: supersede `ADR-0008`（权限第一刀）；收窄 `ADR-0007`（副工作区 = 声明清单 + 远程根路由，无档位）；
  关闭 `SEC-1` / `SEC-2`（失去对象）；`ADR-0012`（fs:r+exec:on 绕过）随之作废；
  面板/store 保留为「工作区生命周期」线（`REQ-I8` 及其后继）的 UI 载体

## 0. 结论

**副工作区的权限模型（`fs: r|rw` × `exec: on|off`）整体退役。** 副根降级为**薄声明清单**：
`SideWorkspaceItem` 收缩为 `id / kind / rootKey / label`，只表达「本会话把这个目录声明为可直接操作的附加根」，
不再携带任何权限语义。面板与 store 保留（挂/卸 + 改名），作为未来工作区生命周期特性的载体。

## 1. 背景：前提已经消失

ADR-0008 的权限第一刀建立在「副根是进入某目录的**唯一**入口」这一前提上。远程主工作区成熟后该前提失效：

- **同机任意绝对路径本就可达**：`SshFileSystemEngine.resolve` 以 cwd 所在连接为 base 做 `posix.resolve`，
  远程会话里模型写 `/any/absolute/path` 都会落到同一台机器上——副根对同机目录不再是「入口」，
  只剩「限权」作用；
- **权限门是 advisory 且有已知绕过**：fs 写门只拦 `writeText`/`editText` 的 targetKey，exec 门只看
  `spec.cwd` 与 `spec.argv[0]`；命令文本不扫描（有意设计），因此主工作区命令可以用绝对路径读写删
  「只读」副根（`ADR-0012`、`SEC-1`/`SEC-2` 的全部内容）。门挡得住工具面、挡不住 shell；
- **维护成本真实存在**：两道门、六个词典键、两个下拉、一批绕过审计用例，换来的是一层
  既不完整又会误导用户（「只读」其实不只读）的保证。

用户 2026-09-12 拍板「按建议来」：权限模型整体退役，副根降级为薄声明清单。

## 2. 决定

1. **删两道门**（`src/mixed.ts`）：fs 写门（`assertSideWriteAllowed` 及 `writeText`/`editText` 的调用）
   与 exec 门（`assertSideExecAllowed` 及 `spawn`/`spawnTerminal` 的调用）删除。
   `MixedSubprocessRuntime` 不再持有 side-workspace 引用；`MixedFileSystem` 保留 `sides` 仅用于
   **路由**（`resolve`/`lstat` 先看副根——绝对路径落在远程副根上时即使会话 cwd 是本地也走该机器）。
   `normalizeSideRootKey` 与最长前缀匹配**原样保留**（路由仍依赖）。
2. **实体收缩**（`src/session-workspaces.ts`）：`SideWorkspaceItem` 删 `fs`/`exec` 字段；
   加载既有 `dsw-session-workspaces.json` 时**忽略**记录上的旧 `fs`/`exec` 字段（不报错、不迁移，
   下次持久化自然丢弃）；`attach`/`detach`/`update(label)`/`list`/`listFor`/`match` 保留。
3. **提示词无档位化**（`src/model-prompts.ts` / `src/tools.ts`）：sideItem 行只渲染 label + rootKey；
   sideNote 改写为无档位表述——副根 = 本会话可直接操作的附加目录；命令默认在主工作区执行；
   跨机用 `sw_exec`。
4. **UI 收窄**（`src/client/side-workspaces.tsx`）：删两个权限下拉（行内 + 表单），面板只剩
   挂/卸 + label 编辑；`session.ws.add` / `session.ws.update` 的 RPC 参数同步收窄（`src/web.ts`）。
5. **词典清键**：删 `side.fs.label`、`side.exec.label`、`permission.rw`、`permission.r`、
   `permission.execOn`、`permission.execOff`（zh/en 同步，键数保持相等）。
6. **测试收缩**：`test/side-workspace-gates.test.ts` → `test/side-workspace-routing.test.ts`
   （只留路由/前缀匹配类用例，stub 补全 13+1 方法）；`test/side-workspace-attacks.test.ts` 删除
   （其对象就是门禁行为）；提示词/状态层用例改无权限断言。

## 3. 后果

- **诚实性上升**：不再存在「标着只读但 shell 一写就穿」的 UI 承诺。真正的隔离手段回归两层：
  每会话 `sandbox/mode`（本地沙箱）与操作者对模型的信任边界；远程命令围栏见 `AUDIT-6`/`REQ-I9` 线。
- **清账**：`SEC-1`（fs:只读+exec:开 被绕）、`SEC-2`（主 workdir 命令无围栏）→ dropped（失去对象）；
  `ADR-0012`（该绕过的决策记录）随之作废；`UX-2`（浏览输入框去留）与权限无关，保留 blocked。
- **兼容性**：旧状态文件零迁移加载（旧字段忽略）；`session.ws.add/update` 的 payload 校验是
  **宽松白名单**——只校验已知必需字段的类型、不拒绝未知键，旧客户端仍发 `fs`/`exec` 时请求
  **照常受理**，未知字段被静默忽略（attach/update 只消费 `id`/`kind`/`path`/`label`）。
  RPC 面的破坏性依据因此落在**权限行为变更**而非请求被拒：旧客户端半（≤0.1.3）面板上的档位
  选择发到新宿主半后不再产生任何限权效果——与本插件「宿主半 + 客户端半同装同卸」的交付形态一致。
- **保留物**：面板、store、提示词清单、路由索引全部保留——它们是「工作区生命周期」线
  （`REQ-I8` spike 及其后继）的既有载体。

## 4. 被否方案

- **修门而不是拆门**（扫描命令文本 / 逐根围栏）：命令文本扫描不可靠且承诺无法兑现（ADR-0008 已否）；
  真围栏需要远端 runner（`REQ-I9`），那是会话级能力，不是逐副根档位。
- **保留档位但 UI 隐藏**：留一双份语义（wire 上有、界面无），违反「没有第二份真相」。
- **连 store/面板一起删**：面板是工作区生命周期线的 UI 载体（`REQ-I8`），删了要重造。
