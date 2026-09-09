# ADR-0015: 远程会话 composer 权限预设显示 `Custom` —— 部署预制表补一组 `remote-full`

- 状态: proposed
- 日期: 2026-09-09（用户复现记录；本轮 scout-ux 磁盘权威源侦察 + 会话日志实锤）
- 关联: `docs/backlog.md` UX-1、`docs/architecture.md` §7-5、`drafts/CONTEXT.md` §7（原始记录）
- 范围: **只写结论与片段，不改产品代码、不改 `$DSH_HOME/profiles/**`**（`AGENTS.md` §5 红线 2/3）

## 背景

用户 2026-09-09 复现：新建**远程工作区**会话后，composer 的权限 chip 显示 `Custom`
（提示语 "Current sandbox and approval settings do not match a preset."），而本地会话显示
`Workspace write`。本轮把「谁产出这个标签、缺哪一项」追到磁盘权威源，并回答三个问题：
① 预设从哪来 / 为什么是 `Custom`；② **插件内**能否补一组预设；③ 插件内不行时用户可粘贴什么。

## 根因

### 1. 预设表是**组合层配置**，不是插件运行时可改的

- 部署里的那一行在 `@deepseek-ai/dsh-base/cordis.patch.yml:235-247`（安装树
  `C:\Users\Admin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-base\`）：

  ```yaml
  - id: permission
    name: '@deepseek-ai/dsh-permission-presets'
    config:
      presets:
        read-only:         { sandbox: read-only,          approval: ask }
        workspace-write:   { sandbox: workspace-write,    approval: ask }
        danger-full-access:{ sandbox: danger-full-access, approval: never }
  ```

- 服务实现 `@deepseek-ai/dsh-permission-presets`（同树 `lib/index.js`）：
  - 表来自构造参数：`constructor(ctx, config) { this.presets = config.presets }`（`lib/index.js:105-108`），
    即 `presets` 是**进程级、构造时固定**的配置；README「Known Limitations」原文：
    *"The preset table is process-level — configuration is fixed for the plugin lifetime; changing
    available presets requires reloading the plugin."*
  - 匹配数学在 `derive(state)`（`lib/index.js:213-223`）：
    `sandbox = state.sandbox ?? ctx.shell.sandboxMode`、`approval = state.approval ?? ctx.approval.config.policy ?? 'ask'`，
    先看「上次选中且仍匹配」，否则**取表中第一个整组相等**的条目，都不匹配 → `CUSTOM_PRESET`（`lib/index.js:22`）。
  - `custom` 的显示名/提示写死在 `optionOf()`（`lib/index.js:255-260`）：`name: "Custom"`。

- 该行的旋钮默认值也在 dsh-base：`sandbox-policy` 的 `mode = process.env.DSH_PERMISSION_MODE ?? 'workspace-write'`
  （`cordis.patch.yml:214-218`）；`approval` 的 `policy = ... === 'danger-full-access' ? 'never' : 'ask'`
  （`cordis.patch.yml:230-233`）。本机未设 `DSH_PERMISSION_MODE`、`$DSH_HOME/settings.yaml` 无 `permission:` 段
  → 部署默认审批旋钮 = **`ask`**，`defaultPreset` 由组合推断 = `workspace-write`。

### 2. 本插件把远程会话的**沙箱旋钮**钉成 `danger-full-access`，审批旋钮仍是 `ask`

`src/plugin.ts:61-66` 的 `forceRemoteSandboxMode()`：`session/created` 时若 `remoteRouteFromCwd(session.header.cwd)`
命中（`src/transport.ts:132`，占位路径 `<DSH_HOME>/dsw-routes/<id>/…` 或旧 `dsh-ssh-routes/<id>/…`），
就 `setSandboxMode(session, 'danger-full-access')`。理由（`src/plugin.ts:48-58`、`docs/architecture.md` §5）：
非 full 模式下沙箱化 shell 执行器会把命令包进**本机** runner，远端不存在（exit 127）。
它**只写沙箱旋钮**，不写审批旋钮 —— 这是刻意的（审批层留给用户/部署）。

### 3. 于是旋钮组合 `{danger-full-access, ask}` 不匹配任何一组 → 派生 `custom`

`derive` 要求**整组相等**，表中 `danger-full-access` 那组绑的是 `approval: never`，因此：

- 远程会话的有效旋钮 = `{sandbox: danger-full-access, approval: ask}`；
- 表里没有这一组 → 返回 `custom` → `selectFor` 把 `custom` 追加为当前值 → composer chip 渲染 `Custom`。

### 4. 会话日志实锤（磁盘证据）

解压 `$DSH_HOME/sessions/--C-Users-Admin-.dsh-dsw-routes-c2-home-marisa-test--/session-*/session.jsonl.zstd`
（zstd 多帧，需逐帧解压）得到远程会话的持久事件：

| 会话 | header.cwd | 权限事件序列 |
|---|---|---|
| `094680ba`（2026-09-09 新建） | `C:\Users\Admin\.dsh\dsw-routes\c2\home\marisa\test` | `sandbox/mode=danger-full-access`, `approval/policy=ask`, `session/end-seed`, `sandbox/mode=danger-full-access` |
| `5019037c` / `716662a9` | 同上 | 同上（无 `permission/preset`） |
| `2e8eb1cb` / `b9973130` 等更早会话 | 同上 | `permission/preset=workspace-write` → `sandbox/mode=workspace-write` → `approval/policy=ask` → … 用户点选 `danger-full-access` → `approval/policy=never` |

两条结论：
① 有效旋钮就是 `{danger-full-access, ask}`，与 §3 推导一致；
② 新建远程会话**没有** `permission/preset` 事件 —— 因为固定初始权限时
`pinInitialPermission`（`lib/index.js:293-311`）在「沙箱旋钮已被本插件改写」的状态下走到 else 分支，
`derive` 得 `custom`，于是不追加 preset 事件（`if (selected === null && effective !== "custom")`）。
**注意：有没有这个事件都不影响显示** —— `derive` 不看事件本身，只看旋钮折叠值。

### 5. 客户端不做二次推导

composer chip 直接消费宿主下发的 `permissions` 会话投影：`dsh-client-ui-conversation/lib/client.js:15362`
（`useProjection("permissions")`）、`15180-15191`（`currentValue` 查 `options` 取 `name`）。
`permissionLabel`（`15161-15166`）只对 `read-only`/`workspace-write`/`danger-full-access` 三个内置名做词典翻译，
其余走 `displayName(name)`（kebab → Title Case）。所以 `Custom` 这个字是**宿主**给的，客户端没有本地兜底逻辑。

## 决定

**推荐方案 A（待用户拍板）**：在**部署层**（`$DSH_HOME/profiles/web/cordis.patch.yml`，用户执行）
给 `permission` 行补一组 `remote-full = {sandbox: danger-full-access, approval: ask}`。
它不改变任何旋钮语义（远程会话本来就是这组值），只是给**既有现实**一个名字：
chip 显示 `Remote Full`、提示消失、`/permission` 与设置页默认预设下拉都能选到它。

## 候选方案对比

| 方案 | 做法 | 效果 | 代价 / 风险 | 结论 |
|---|---|---|---|---|
| **A. 部署表补 `remote-full={full, ask}`** | 用户改 `cordis.patch.yml` 的 `permission` 行 `config.presets` | chip 显示 `Remote Full`；审批仍 `ask`（安全不降级）；本地/远程都多一个可选档 | patch 是**整键替换**，必须把原三组一并写出（见下）；需重启 profile 生效 | **推荐** |
| **B. 复用内置 `danger-full-access` 组** | 让远程会话的审批旋钮也变 `never`（插件写 `approval/policy`，或让部署把审批默认改成 never） | chip 显示内置「Full access」；复用客户端已有的风险确认门 | **等于去掉远程审批层**（审批不再 `ask`，`docs/architecture.md` 的诚实语义变差）；行为变更，非纯标签修复 | 不推荐（用户与草案均已排除） |
| **C. 插件运行时补表（monkey-patch `ctx.permissionPresets`）** | 在 `apply()` 里 `ctx.get('permissionPresets')` 后往 `presets` 塞条目、替换 `derive`/`optionOf` | 无需改部署配置 | 依赖 **TS `private` 仅编译期**（运行时是普通字段/原型方法）、依赖未公开内部形状，上游改一行即碎；违反「只走公开 API」；本轮**明确不做** | 否决 |
| **D. 仅记录、不动** | 现状 | 「诚实表达」：组合确实不匹配任何预设 | 用户每次新建远程会话都看到 `Custom` + 一句看不懂的提示；用户已提出要修 | 不采纳（保留为回退项） |

## 推荐方案的精确内容

### 1. 用户可粘贴片段（`$DSH_HOME/profiles/web/cordis.patch.yml`）

把当前顶层数组 `[]` 换成（或合并进）下面这一条；**`presets` 是整键替换**，所以原三组必须一起写出：

```yaml
# UX-1: 给远程会话被钉住的旋钮组合 {danger-full-access, ask} 一个预设名，
# 让 composer 权限 chip 显示真实预设而不是 Custom。仅补表，不改任何旋钮行为。
- id: permission
  name: '@deepseek-ai/dsh-permission-presets'
  config:
    presets:
      read-only:
        sandbox: read-only
        approval: ask
      workspace-write:
        sandbox: workspace-write
        approval: ask
      danger-full-access:
        sandbox: danger-full-access
        approval: never
      remote-full:
        sandbox: danger-full-access
        approval: ask
        description: Remote workspace session — full access on the remote host, approval still asks.
```

可选：加 `name: Remote Full` 覆盖自动 Title Case；不加则显示 `Remote Full`（kebab 键的默认呈现）。

### 2. 为什么是「整键替换」而不是合并（patch 语义，读代码得出）

- `dsh-app-boot/lib/index.js:59-108` 的 `applyEntryPatches()`：非 `insert` 补丁逐键
  `target[key] = value` —— `config` 整对象被覆盖，**没有深合并**。
- 覆盖后的 `config` 直接作为插件配置：`cordis-plugin-loader/src/config/entry.ts:142-246` 的
  `Entry.update()` → `_start()` 里 `registry.plugin(plugin, this.options.config)`；config 变更走
  `_patchContext(diff)` → `fiber.update(this.options.config, true)`（同文件 `114-122`）。
- 因此补丁里只写 `remote-full` 会让内置三组消失（且若 `settings.yaml` 里存着
  `permission.defaultPreset` 指向被删掉的组，设置注册会直接失败 —— 该包 README 的已知限制）。
  本机 `settings.yaml` 当前**没有** `permission:` 段，不受影响。

### 3. 插件内**做不到**（回答「②」）

公开接口面（`lib/types/index.d.ts:102-168`、上游源码 `packages/interaction/permission-presets/src/index.ts:159-431`）：

- `get names` / `get defaultPreset` / `current(events)` / `selectFor(state)` / `resolve(name)` /
  `optionOf(name)` / `set(session, name)` —— **没有** `add` / `register` / `setPresets` 之类的方法；
- `private readonly presets`（上游 `src/index.ts:182`）只在构造时由 config 赋值；
- 服务名 `permissionPresets` 由该类 `provide`，**不能**再挂第二个实例来「叠加」表；
- 结论：**任何受支持的插件路径都无法增删预设条目**。唯一受支持的表变更入口就是组合层
  `permission` 行的 `config.presets`（即方案 A），且需要重载插件/重启 profile。

### 4. 边界：代理能改什么、必须用户改什么

| 项 | 谁做 | 说明 |
|---|---|---|
| 本 ADR（`docs/decisions/ADR-0015-*.md`） | 代理 | 本轮产出 |
| `docs/backlog.md` 状态回填 | 另一任务（t1） | 本轮**不改** |
| `docs/architecture.md` §7-5 备注（可选） | 代理（待拍板后） | 把「已拍板仅记录」更新为指向本 ADR |
| `$DSH_HOME/profiles/web/cordis.patch.yml` | **用户** | 红线 2/3：产品 profile 由插件管理器/用户管理，代理不代改 |
| 3080 重启 | **用户** | `scripts/restart-3080.ps1`，会话外执行 |

## 验证步骤

1. **改前基线**：新建远程工作区会话 → composer 权限 chip = `Custom`。
2. **粘贴片段**：按上面 §1 写入 `cordis.patch.yml`（保留原三组）。
3. **组合层离线核对**（用户 shell，只读、不起服务）：

   ```powershell
   dsh --profile web --dump-config | Select-String -Pattern 'id: permission' -Context 0,14
   ```

   期望：`permission` 行的 `config.presets` 出现 4 个键，`remote-full` 与内置三组并存。
   若只看到 `remote-full`，说明原三组被覆盖掉了（漏写）。
4. **重启 profile**（`scripts/restart-3080.ps1`，用户执行）。预设表是进程级，改配置必须重载；
   热补丁虽可能重挂该行，但 `permissions` 投影的 wire view 只在**旋钮事件变化**时重算
   （`dsh-session-projection/lib/index.js:401-428`），不保证立刻推送新选项 —— 重启最稳。
5. **验收（新会话）**：新建远程工作区会话 → chip 显示 `Remote Full`；下拉里出现该档；
   `/permission` 列出 `read-only, workspace-write, danger-full-access, remote-full`；
   设置页「默认权限预设」下拉包含它。
6. **验收（既有远程会话）**：直接打开之前那个远程会话（旋钮已是 `{full, ask}`）→ chip 同样显示
   `Remote Full`，不需要重新建会话（`derive` 每次读投影时重算）。
7. **回归**：本地会话仍显示 `Workspace write`；远程会话的 `bash`/`pwsh` 命令仍原样到达远端
   （沙箱档位未变）；`sandbox/mode` 事件仍为 `danger-full-access`。

## 后果

- 正向：chip 与 `/permission`、设置页默认预设三处一致；提示语消失；不改变任何执行/审批语义
  （远程审批仍是 `ask`）。
- 代价：`remote-full` 对**本地**会话也可见可选；选中它得到 `{full, ask}`，与手动把沙箱拨到 full
  等价（无新增权限面）。
- **新发现的风险（建议单列一条待办）**：客户端只对 `danger-full-access` 这一个值做「Full access」
  风险确认门（`dsh-client-ui-conversation/lib/client.js:15201-15217`），`remote-full` 走普通路径、
  **没有确认弹窗**，但它等价于 full 沙箱。若在意，可给 `remote-full` 起一个更中性的名字，或后续在
  客户端把「沙箱为 full 的档位」统一纳入确认门（属上游/客户端改动，不在本 ADR 范围）。
- 另一处不修的行为：用户点选 `workspace-write` 后，`session/created` 的钉定仍把远程会话拨回
  `danger-full-access`（窄档 + 远程 = 本地 runner 不可用）。这是刻意的执行适配，本 ADR 不改。

## 未验证假设

1. **3080 上实际运行的宿主构建**：本机安装树是 `dsh 0.1.2-rc.1`，但历史会话日志里出现过
   `permission/preset` 带 `origin: "default" | "selection" | "inferred"` 的载荷，而 0.1.2-rc.1 的
   `lib/index.js:282/302/308` 与本地上游源码都**不含** `origin` 字段 —— 说明 3080 跑的是另一个（更新的）
   构建。该差异**不影响本结论**（两种构建的 `derive` 都是「整组相等否则 custom」，`optionOf` 的
   `custom` 标签文案一致），但第 5 步验收请以用户机器上的实际构建为准。
2. **`pinInitialPermission` 与 `forceRemoteSandboxMode` 的监听器顺序**：会话日志显示新建远程会话**没有**
   `permission/preset` 事件、且只有一次 `sandbox/mode`，据此推断本插件的监听器先于预设服务的固定逻辑执行；
   具体顺序取决于 Cordis 事件派发（`collectSessionCallbacks` → `ctx.events.dispatch`），本轮未做运行时插桩确认。
   两种顺序都导出同一个 `{full, ask}` 有效旋钮，故对结论无影响。
3. **热补丁重载后投影是否重推**：§验证第 4 步建议重启即基于「wire view 只在状态变化时重算」的代码阅读，
   未做实测。
4. **`--dump-config` 在本会话不可执行**：沙箱（workspace-write）拒绝 `dsh` 在
   `$DSH_HOME/profiles/web/` 下写 `cordis.yml`（`prepareProfile` 落盘），报 `EPERM`。
   第 3 步须由用户在自己 shell 里跑；本轮未拿到真实 dump 输出。
5. **`settings.yaml` 是否会在别处被写入 `permission.defaultPreset`**：本机当前没有该段；若用户曾设过
   默认预设，改表时必须保留对应组名（见 §推荐方案 2 的警告）。

## 被否方案

- **B（顺带把远程审批改 `never`）**：会让远程会话失去审批层，且属行为变更；用户与 `drafts/CONTEXT.md` §7 均已排除。
- **C（插件内 monkey-patch 预设服务）**：见候选方案表 —— 依赖私有内部形状，不满足「只走公开 API / 可逆」的项目约束。
- **改本插件 `cordis.patch.yml` 内置这一组**：会把某次部署的权限命名固化进通用插件包，语义错误（该表属于部署策略，不属于 SSH 接缝）。
