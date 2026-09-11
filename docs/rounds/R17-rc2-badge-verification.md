# R17 — rc.2 行徽标存活验证（t2 静态判定 + t3 浏览器实测）

- **轮次目标**：验证现有侧边栏 DOM 行徽标层（`src/client/row-badges.ts`）在 DSH `0.1.5-rc.2` 上的存活
- **验证者**：verifier（t2 attempt `87a3726a-88e0-406c-b651-7192429edb4c`；t3 见第二部分）
- **日期**：2026-09-11（本地 UTC+8）
- **性质**：验证报告（**不是轮次收口报告**）
- **缺陷编号**：**§8.1 缺陷登记表**（`T3-F1` … `T3-F5`）——**稳定编号，供 t6 / t8 / 后续轮引用**；
  t8 的裁决点在 **§10.5.1「预测 vs 观察」**
- **基线**：全局安装树 `C:\Users\Admin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\`
  的 **0.1.2-rc.1**（= 3080 现网家族，`docs/compatibility.md` §3.1 `legacy`）。**未接触** 3080 进程、未改产品 profile。

> **证据纪律**：
> ① 只认「命令 + 退出码 + 产物哈希 + 字节偏移」。结论若来自代码推导（而非实跑），一律标注为**静态推导**并给出被推翻的方式。
> ② **引用以符号为单位，不以行号为单位**（`AGENTS.md` §5.7：行号不是契约）。本报告引用被验代码时一律用
> 「**符号 / 行为**」——`rowTitleOf`、`markRow`、`markRowStatus`、`withdrawStale`、`scan`、`ROW_STATUS_KEY`、
> `BADGE_MARK_KEY`、`document.querySelectorAll('[role="tree"]')`、`tree.querySelectorAll('[role="treeitem"][aria-expanded]')`、
> `row.parentElement.children`、`row.appendChild(badge)` 等；**行号只在附录 C 作为一次性快照登记**，随文件演进作废。
> ③ 上游 bundle 的行号/字符偏移**只在其所属 bundle+版本内有效**，跨快照不可互换。
> ④ 第一/第二部分的证据来源严格分离（静态 vs 实跑）。

## 0. 被验修订与「符号锚点」

| 项 | 值 |
|---|---|
| 被验代码修订 | `src/client/row-badges.ts` @ git blob **`75fb30f90a7e476c3c1555b5ab15aa02838e7708`** = HEAD `96c7ae9` 版本（703 行） |
| 取证时刻 | t2 开始时工作树 == `75fb30f`（`git diff` 无该文件改动） |
| 引用口径 | **符号/行为**（见上证据纪律 ②）；行号快照见附录 C，**不被当作契约** |

**验证对象漂移（t2 取证结束后，施工预报内）**：t4（engineer-client）把 `routeIdOf` 从
`src/client/row-badges.ts` 抽到新模块 `src/client/route-id.ts` 并原样再导出
（`git diff` 显示**纯搬移**：新增 import + `export { routeIdOf }`，删除原函数体）。影响：

- **A5 相关符号（`scan` / `withdrawStale` / 行容器假设）逐字未变** —— 该 diff 不触碰这些函数；
  对外导出名与语义不变 ⇒ 本报告的判定**不受影响**；
- 该文件行数 703 → 698，被搬移符号之后的**行号整体位移**——这正是本报告改用符号引用的原因；
- 该搬移属 t4 的合理连带（`row-badges.ts` 值导入 `./status.tsx`，会把 `.tsx` 拖进 `test:agent`
  的类型剥离路径），**不记为越界**。

---

# 第一部分：静态判定（t2）

## 0. 结论速览

| 问题 | 判定 |
|---|---|
| rc.2 是否改动了**行 markup**（行容器 / 标题节点 / 图标节点 / wrapper / 虚拟列表）？ | **没有**。`dsh-client-ui-workspace@0.1.5-rc.2` 的 `lib/client.js` 与 `0.1.5-rc.1` **逐字节相同**（§3.1） |
| rc.2 是否新增了会被行徽标层扫到的 `[role="tree"]` 面？ | **没有**。全 41 个客户端包 census 与基线**完全一致**（§3.2） |
| row-badges 的 DOM 假设在 rc.2 上**仍成立 / 已破坏 / 无法静态判定**？ | **主体仍成立；其中一条（分组视图的「会话子行」）已破坏——但在 0.1.2-rc.1 上同样已破坏**，不是 rc.2 引入的回归（§4） |
| 是否需要改产品代码？ | **需要**（修的是两代共有的缺陷，不是 rc.2 适配）。精确修法见 §6，**本轮未实施**（`src/**` 不在 t2 inScope） |

**一句话**：rc.2 对我们的行徽标层是**零 markup 风险**；但静态分析顺带证伪了一条**两代都错**的假设——
「分组视图里会话子行会继承所在工作区的徽标」在真实 DOM 上做不到，因为官方 `HoverCard` 会在行与分组容器之间插一层
`<span class="…root">` 包裹元素，使会话行**不是**工作区行的 DOM 兄弟。

## 1. 被验对象

| 对象 | 位置 | 说明 |
|---|---|---|
| 被验代码 | `src/client/row-badges.ts` @ blob `75fb30f`（703 行；见 §0 漂移说明） | 唯一实现手段；rc.2 仍无行级官方槽 |
| rc.2 行渲染方 | `@deepseek-ai/dsh-client-ui-workspace@0.1.5-rc.2` `lib/client.js` | `role="tree"` / `role="treeitem"` 只在这里与 `ui-subagent` 出现 |
| 基线行渲染方 | 同包 `0.1.2-rc.1`（全局安装树） | 3080 现网 |
| 包裹元素来源 | `@deepseek-ai/dsh-client-ui-primitives`（`HoverCard`）→ 运行时内联于 `dsh-web-frontend` 的静态模块 | 见 §3.4 |

## 2. 方法（可复现）

证据产物落在**仓库外**的本地暂存目录 `$env:TEMP\dsw-r17`（属 `AGENTS.md` §2 的本地素材，不入库、不污染工作区）。
下列命令即全部取证步骤，任何人可原样复跑：

```powershell
$d="$env:TEMP\dsw-r17"; New-Item -ItemType Directory -Force $d | Out-Null; cd $d
$g='C:\Users\Admin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai'

# (1) 取 rc.1 / rc.2 家族全量客户端包并解包
$pkgs = Get-ChildItem -Directory $g | Where-Object { $_.Name -like 'dsh-client-*' } | Select-Object -ExpandProperty Name
foreach($v in '0.1.5-rc.1','0.1.5-rc.2'){
  New-Item -ItemType Directory -Force "$d\pkgs-$v","$d\x-$v" | Out-Null
  foreach($p in $pkgs){ npm pack "@deepseek-ai/$p@$v" --silent --pack-destination "$d\pkgs-$v" | Out-Null }
  Get-ChildItem "$d\pkgs-$v" -Filter *.tgz | ForEach-Object {
    $n = $_.BaseName -replace '^deepseek-ai-','' -replace "-$([regex]::Escape($v))$",''
    New-Item -ItemType Directory -Force "$d\x-$v\$n" | Out-Null
    tar -xzf $_.FullName -C "$d\x-$v\$n"
  }
}

# (2) 客户端半逐字节比较（§3.1）
Get-ChildItem -Directory "$d\x-0.1.5-rc.1" | ForEach-Object {
  $p=$_.Name
  (Get-FileHash "$d\x-0.1.5-rc.1\$p\package\lib\client.js").Hash -eq
  (Get-FileHash "$d\x-0.1.5-rc.2\$p\package\lib\client.js").Hash
}

# (3) 行 markup 逐元素签名（§3.3，脚本见附录 A）
node extract-signatures.mjs "$g\dsh-client-ui-workspace\lib\client.js"           # 基线
node extract-signatures.mjs "$d\x-0.1.5-rc.2\dsh-client-ui-workspace\package\lib\client.js"
```

工具链：`npm@10` / `node v24.18.0` / `pwsh 7`。所有 `npm pack` 退出码 0（41/41，两版本均成功）。

## 3. 证据

> **溯源口径（硬规则）**：本节所有 `@<n>` 都是**字符偏移**，引用上游契约时
> **包名 + 版本 + 文件 + 偏移必须同时出现**，且**只对它当处注明的那个包+版本**有效
> （如 `@deepseek-ai/dsh-client-ui-workspace@0.1.5-rc.2` 的 `lib/client.js`）。跨版本/跨快照
> **不可互换**——引用时请连同包名+版本一起引。
> **本节未使用** `D:\ZCodeProject\deepseek-harness`（0.1.0-rc.5）作为任何对照（见 §9.1 ①）。

### 3.1 rc.2 的行渲染包与 rc.1 **逐字节相同**

| 包 | 0.1.5-rc.1 sha256 | 0.1.5-rc.2 sha256 | 差异字节 |
|---|---|---|---|
| `dsh-client-ui-workspace`（行 markup 所在） | `383B9EF779366C13D818500B6488896328B189F156ADDBAA480C835E902EDD5F` | **同左** | **0** / 130113 B |
| `dsh-client-ui-session` | `A794B82A58F6E774…` | 同左 | 0 |
| `dsh-client-ui-layout` | `930C10A9BED1094E…` | 同左 | 0 |
| `dsh-client-ui-sidebar` | `88F7E04D046EADB4…`（22516 B） | `171E3F0014E09C0F…`（22516 B） | **8** |

sidebar 的 8 个差异字节**只是构建版本字面量**（对 22516 B 逐字节定位，偏移 10763–10771）：

```
0.1.5-rc.1 : return `0.1.5-rc.1-18a8c50` + ({}.DSH_CLIENT_GIT_DIRTY === "true" ? "-dirty" : "");   // lib/client.js @10763
0.1.5-rc.2 : return `0.1.5-rc.2-449af19` + ({}.DSH_CLIENT_GIT_DIRTY === "true" ? "-dirty" : "");   // lib/client.js @10763
```

**全客户端半 delta**：41 个客户端包里 **37 个逐字节相同**，4 个有变化：
`ui-chat`(+15 B)、`ui-deliverables`(+178 B)、`ui-message-feedback`(−313 B)、`ui-sidebar`(8 B = 版本字面量)。
**其中 `ui-workspace` 与 `ui-subagent`（唯二带 tree 角色的包）都不在变化名单里。**

### 3.2 全客户端半 census：rc.2 **没有**新增会被扫到的树面

行徽标层用 `document.querySelectorAll('[role="tree"]')` 扫**整篇文档**（符号：`scan()` 里的 `trees` 循环），
所以「rc.2 新增了哪些 `[role=tree]` 面」直接决定误标风险。结果：

| 包 | `role:"tree"` | `role:"treeitem"` | rc.1→rc.2 |
|---|---|---|---|
| `dsh-client-ui-workspace` | 3 | 3 | 逐字节相同 |
| `dsh-client-ui-subagent` | 1 | 3 | 逐字节相同（`B1C5D6F2…`，42382 B，三个版本全同） |
| **其余 39 个包** | **0** | **0** | — |

新增包 `@deepseek-ai/dsh-client-ui-dockkit`（0.1.5 家族才有，rc.2 新增为前端静态模块
`"@deepseek-ai/dsh-client-ui-dockkit":Ey`）—— `lib/index.js`（106167 B）里 **`role` 属性出现 0 次**，
即新的右侧面板 / dock 体系不产出任何 `[role]` 节点，**与行徽标层零交集**。

### 3.3 行 / 容器 markup 逐元素签名：基线 ↔ rc.2 只差一个 React `ref`

用 `extract-signatures.mjs` 把每个带 `role` 的 JSX 元素解析成「标签 + 顶层属性表」签名，
脚本只做括号配平与空白归一，不做语义猜测。**基线 10 个元素、rc.2 10 个元素**。把 `bundleOffset=<n>` 归一化后
逐行 `Compare-Object`，输出**只有一行**（`<=` = 仅基线有）：

```
<=    ref=rowRef
```

即：**10 个元素的标签、role、其余全部属性行完全相同**，唯一差异是 rc.2 的会话行多了一个 `ref`。

`ref` 是 React 引用（`rowRef` → `scrollIntoView`），**不落 DOM 属性**。以下签名两边**完全一致**；
下表偏移全部属于 **`@deepseek-ai/dsh-client-ui-workspace@0.1.5-rc.2` 的 `lib/client.js`**
（同版本 `sha256 383B9EF779366C13D818500B6488896328B189F156ADDBAA480C835E902EDD5F`，130113 B）：

| # | 元素 | 关键属性（两版本相同） | 偏移（`ui-workspace@0.1.5-rc.2` `lib/client.js`） |
|---|---|---|---|
| 1 | 工作区分组行 | `<div class="projectRow" role="treeitem" aria-expanded=row.expanded>` | 35073 |
| 2 | 搜索结果行 | `<button class="searchResultRow" role="treeitem" aria-selected>` | 42828 |
| 3 | 会话行 | `<div class="sessionRow" role="treeitem" aria-selected>`（+`ref`） | 46385 |
| 5 | 分组视图容器 | `<div class="list" role="tree" aria-label=t("section.sessions")>` | 83271 |
| 7 | 平铺视图容器 | `<div class="list flatList" role="tree" aria-label=t("section.sessions")>` | 92841 |
| 10 | 搜索视图容器 | `<div class="searchTree" role="tree" aria-label=t("search.results.aria")>` | 95912 |

标题节点两版本相同：分组行是 `span.projectText > span.title`，会话行是 `span.title`；
图标都在 `span.slot > svg` 里（`rowTitleOf` 的 `span.querySelector('svg') !== null` 跳过条件命中）；
`span.rowActions` 只装 SVG 按钮（`textContent === ''`）。**行内最长无 svg 的 span 文本 = 行标题**，
`rowTitleOf`（「行内最长且不含 `svg`、且不在 `[data-dsw-badge]` 子树内的 `span` 文本」）的取法在 rc.2 上成立。

`[role="treeitem"]` 与 `aria-expanded` 的**共现**在 rc.2 里只有 **1 处**（`div.projectRow`）。
另两处 `aria-expanded` 是 `<button>`（`sessionOverflowButton`、`searchButton`），**没有** `role=treeitem`。
所以 `scan()` 的「分组视图判别」（符号：`tree.querySelectorAll('[role="treeitem"][aria-expanded]')`
→ `groupRows.length > 0`）与 `withdrawStale()` 的同一判别（同一条后代查询）在 rc.2 上依然精确：
分组视图 → 只有工作区行被当作 group row；平铺 / 搜索视图 → `groupRows.length === 0` → 走按标题匹配的
分支（符号：`remoteSessionTitles.size > 0` 分支下的 `querySelectorAll('[role="treeitem"]')` 循环）。
**无虚拟列表**：rc.2 workspace bundle 里
`virtual` / `overscan` / `useVirtual` / `scrollTop` / `IntersectionObserver` / `content-visibility` **命中数全为 0**。

### 3.4 关键发现：官方 `HoverCard` 在行与分组容器之间插了一层包裹元素（**两代都有**）

`ui-workspace` 的行**不是**直接挂在分组容器下：

- 分组容器（`@deepseek-ai/dsh-client-ui-workspace@0.1.5-rc.2` `lib/client.js` 字符偏移 `@82922` 起的
  `groupSection`）的 children = `[ProjectRowItem, ...SessionNodeItem, 可选 overflow button]`
  （同包同版本 `@88062` 起：`return jsx(SessionNodeItem, {...})`，与 `ProjectRowItem` 同一个 children 数组）
- `SessionNodeItem` 全函数**只有一个 return**，且是 `jsx(HoverCard, { anchor: <div role="treeitem" …> })`
  （同包同版本 `@45142`）
- `HoverCard` 的根元素是 **`<span>`**：

```js
// @deepseek-ai/dsh-client-ui-primitives@0.1.5-rc.2  lib/index.js @145850（函数末 return）
return jsxs("span", { ref: rootRef, className: css$8.root, onPointerEnter, onPointerLeave, onPointerDownCapture,
                     children: [ anchor, /* span.status */, createPortal(card, document.body) ] })
// @deepseek-ai/dsh-client-ui-primitives@0.1.2-rc.1  lib/index.js @141931：
// 结构完全相同，只有 CSS module 变量名不同（css$6 → css$8）
```

**在真实运行时（前端打包产物）里也确认同样结构**，不是包源码特有的：

| 版本 | 前端产物（包名 + 版本 + 文件） | HoverCard 根元素 |
|---|---|---|
| `@deepseek-ai/dsh-web-frontend@0.1.2-rc.1`（3080 现网） | `dist/assets/index-Df-65__b.js`（静态模块 `Fp` → `HoverCard: Rd`） | `return d.jsxs("span",{ref:m,className:p1.root, … children:[n /*anchor*/, …]})` |
| `@deepseek-ai/dsh-web-frontend@0.1.5-rc.2` | `dist/assets/index-BKQ_L1z6.js`（静态模块 `Zg` → `HoverCard: oC`） | `return d.jsxs("span",{ref:p,className:Mn.root, … children:[t /*anchor*/, …]})` |

上游自己也在 CSS module 里写明了这件事（`@deepseek-ai/dsh-client-ui-primitives` 的
`lib/HoverCard.module.css`，`0.1.2-rc.1` 与 `0.1.5-rc.2` 两版本注释逐字相同）：

```css
/* Block, not inline-flex: consumers wrap full-width list rows and an
 * inline wrapper would shrink them; the card still measures this rect. */
.root { position: relative; display: block; }
```

推导出的真实 DOM 链（**静态推导**，rc.2；rc.1 同构）：

```
div.list[role="tree"][aria-label="Sessions"]                       ← scan() 遍历的 trees（`[role="tree"]` 查询）
└── div.groupSection                                               ← 分组容器
    ├── span.<HoverCard root>                                      ← 包裹元素（无 role 属性）
    │   └── div.projectRow[role="treeitem"][aria-expanded]         ← 工作区行
    │       ├── span.slot.folder   > svg
    │       ├── span.slot.chevron  > svg
    │       ├── span.projectText   > span.title        ← 行标题
    │       ├── span.rowActions    > button>svg ×2
    │       └── span[data-dsw-badge]                   ← 我方注入点（markRow 的 row.appendChild(badge)）
    ├── span.<HoverCard root>                                      ← SessionNodeItem 无条件包裹
    │   └── div.sessionRow[role="treeitem"][aria-selected]         ← 会话子行
    └── button.sessionOverflowButton[aria-expanded]（仅 collapsed.hiddenCount>0）
```

平铺视图：`div.list.flatList[role="tree"] > span.<root> > div.sessionRow[role="treeitem"]`。
搜索视图：`div.searchTree[role="tree"] > button.searchResultRow[role="treeitem"]`。

### 3.5 挂载点未变：`sidebar.workspaces` 仍直接渲染在侧边栏

rc.2 的 `dsh-client-ui-sidebar` 把 `sidebar.panellist`（list）加进了 `sidebar` 槽的子槽表
（`@deepseek-ai/dsh-client-ui-sidebar@0.1.5-rc.2` `lib/client.js` `@22033`：
`children: { "sidebar.brand.mark": single, "sidebar.brand.name": single,
"sidebar.panellist": **list**, "sidebar.workspaces": single, "sidebar.settings": single,
"sidebar.footer.action": list }`），并渲染 `PanelRow` 列表（同包同版本 `@11671`）。但：

- `SidebarRoot` 里 `renderSlot("sidebar.workspaces", { wide, expandSidebar })` 仍位于
  `div.regionArea`（`dsh-client-ui-sidebar@0.1.5-rc.2` `lib/client.js` `@18685`），
  **与基线 `dsh-client-ui-sidebar@0.1.2-rc.1` `lib/client.js` `@15619` 的位置与调用形式一致**
  ——工作区树仍随侧边栏渲染；
- `ui-workspace` 仍把 `WorkspaceBrowser` 注册进 `sidebar.workspaces`
  （`@deepseek-ai/dsh-client-ui-workspace@0.1.5-rc.2` `lib/client.js` `@128660`：
  `ctx.slots.inject("sidebar.workspaces", () => ctx.slots.register({ name: "sidebar.workspaces", … }, WorkspaceBrowser))`）；
- `PanelRow` 是 `<button aria-label aria-current>`，**不带 `role`**；`dsh-client-ui-sidebar@0.1.5-rc.2`
  的 `lib/client.js` 全文件 `role: "…"` 命中数为 **0** → 新的面板 Tab 体系不会进入
  `[role="tree"]` / `[role="treeitem"]` 选择器。

## 4. 逐条 DOM 假设判定表

行徽标层的 DOM 依赖逐条拆出来（**引用单位 = 符号**，不写行号），对 rc.2 判定：

| # | 假设 | 承载符号（`src/client/row-badges.ts`） | rc.2 判定 | 依据 |
|---|---|---|---|---|
| A1 | 存在 `[role="tree"]` 容器 | `scan()` 的 `document.querySelectorAll('[role="tree"]')` | ✅ 仍成立 | §3.3 元素 5/7/10 |
| A2 | 分组视图 = 树内有 `[role="treeitem"][aria-expanded]` | `scan()` / `withdrawStale()` 的 `tree.querySelectorAll('[role="treeitem"][aria-expanded]')` 判别 | ✅ 仍成立（且唯一：全树只有 1 处共现） | §3.3 |
| A3 | 工作区行标题 = 行内最长无 `svg` 的 `span` 文本 | `rowTitleOf` | ✅ 仍成立 | §3.3 标题节点 |
| A4 | 分组行的徽标注入（追加到行末） | `markRow` → `row.appendChild(badge)` + `markRowStatus` | ✅ 仍成立 | §3.4 行末为我方节点 |
| A5 | **会话子行是工作区行的 DOM 兄弟** | `scan()` 分组分支的 `const section = row.parentElement` + `Array.from(section.children)`；`withdrawStale()` 分组子行分支的同类兄弟查找 | ❌ **已破坏**（**0.1.2-rc.1 上同样已破坏**） | §3.4：父元素是 `span.<HoverCard root>`，`section.children` 里没有 `[role=treeitem]` |
| A6 | 平铺视图按会话标题匹配 | `scan()` 的 `remoteSessionTitles.size > 0` 分支 → `querySelectorAll('[role="treeitem"]')` | ✅ 仍成立 | §3.4 平铺链（`querySelectorAll` 是后代查询，能穿过包裹元素） |
| A7 | 无虚拟列表把行挪出原容器 | `scan()` 开头的 `row.isConnected` 剪枝 | ✅ 仍成立（0 命中） | §3.3 |
| A8 | 分组视图判别不会被新 UI 元素污染 | 同 A2 | ✅ 仍成立 | §3.3 + §3.5（`dockkit`/`panellist` 无 role） |
| A9 | 注入后能收敛（无自维持循环） | `withdrawStale` → `markedRowStillQualifies` ← `rowTitleOf` 排除 `[data-dsw-badge]` 子树 | ✅ 静态自洽（运行时见 §10.4） | 工作区行 `aria-expanded !== null` → 走 `markedRowStillQualifies` → 标题稳定 → 保持不变 |

**总判定**：rc.2 上「工作区文件夹旁的远程/连接状态徽标」（本层的**唯一目标**）**静态成立**；
只有 A5 这条**附带的**「会话子行继承分组徽标（compact 变体）」是坏假设，
且它在 0.1.2-rc.1 上**同样**是坏的 —— **不是 rc.2 回归，是既有缺陷被静态证伪**。

补充：`test/row-badges.test.ts` 用的是**手写结构化 fake**（构造只带 `querySelectorAll` / `closest` 等
单个方法的对象字面量，而非真实 DOM），**不建模行的容器层级**，所以单测原理上抓不到 A5；
`e2e/specs/E2E-07-local-session-no-badge.spec.ts` 只断言「本地会话行**没有**徽标」（`[data-dsw-badge]` 计数为 0），
历史上**没有任何正向断言**要求会话子行**有**徽标 —— 这是 A5 能长期潜伏的原因。

## 5. 对 rc.2 的最终静态结论

> **rc.2 未引入任何行 markup 变化**（行包逐字节相同、树面 census 相同、行签名相同、无虚拟列表、
> 新面板/dock 体系无 `role`），因此**不会因 rc.2 而破坏行徽标层**。
> 静态分析顺带发现并证伪了一条两代共有的错误假设（A5）：**分组视图下的会话子行**从来拿不到徽标，
> 因为 `HoverCard` 的 `<span class="…root">` 包裹元素把「行 ↔ 分组容器」的父子关系隔开。

风险提示（不属 rc.2 回归，记录备查）：`dsh-client-ui-subagent` 的 `[role="tree"]` 也在 `scan()` 的
文档级扫描范围内，其 `[role="treeitem"]` **不带 `aria-expanded`** → 会被当作**平铺**树按会话标题匹配。
三个版本该包逐字节相同，故与 rc.2 无关；仅当远程会话标题与子代理血缘标签重名时才可能误判。

## 6. 精确修法（本轮**未实施**，`src/**` 不在 t2 inScope）

修的是 A5（两代共有）。**最小改动** = 把「兄弟扫描」换成「分组容器内的后代扫描」，并抽一个
跨包裹元素的定位助手（`row-badges.ts`，**引用符号而非行号**）：

```ts
/** 从行上溯到「含 >=2 个 [role=treeitem] 的最近祖先」= 真正的分组容器（跳过 HoverCard 包裹 span）。 */
const groupSectionOf = (row: HTMLElement): HTMLElement | null => {
  let node: HTMLElement | null = row.parentElement
  while (node !== null) {
    if (node.getAttribute('role') === 'tree') return null   // 到树顶了，说明没有分组容器
    if (node.querySelectorAll('[role="treeitem"]').length > 1) return node
    node = node.parentElement
  }
  return null
}
```

- `scan()` 的**分组分支**：把 `const section = row.parentElement` 换成 `const section = groupSectionOf(row)`；
  内层循环由 `Array.from(section.children)` 改成 `section.querySelectorAll('[role="treeitem"]')`
  （**后代**查询即可穿过包裹 span），保留 `child === row` 跳过与 `rowStatusOf(child) === connId` 幂等守卫。
- `withdrawStale()` 的**分组子行分支**：同法把「在 `section.children` 里找 group 兄弟」改为
  在 `groupSectionOf(row)` 的**后代**里找 `[role="treeitem"][aria-expanded]` 且 `rowStatusOf === connId` 的节点。
- 附带收益：`groupSectionOf` 对 `searchResultRow`（其父是 `div.searchTree`，`role="tree"`）会立刻返回 `null`，
  不会误把搜索树当分组容器。
- **回归守卫建议**（`test/**`，同样不在 t2 inScope）：给 `test/row-badges.test.ts` 补一个**按真实 DOM 形状**
  的 fake —— 分组容器 → 包裹 `span` → 行，断言会话子行**拿到** compact 徽标。当前 fake 之所以没抓到这个 bug，
  正是因为 fake 里行是容器的直接子节点。
- 另需评估（**不要顺手改**）：A5 修好之后 compact 分支才第一次真正跑起来（按钮文案走 `status.retryAction.compact`、
  语言切换重绘走 `data-dsw-compact`），需要 t3 之外再加一次实测。

## 7. 静态分析**证明不了**的部分（→ 交给 t3 / 第二部分）

1. **真实 DOM 是否真如 §3.4 推导**。我用的是打包产物（前端 bundle 是压缩过的静态模块）与包源码；
   未在浏览器里 dump 过。**可证伪**：A5 正确 ⇒ 分组视图下 `div.sessionRow` **不会**带 `[data-dsw-badge]`，
   只有 `div.projectRow` 带 `[data-dsw-conn-id]`；反之若有会话行带徽标，则 §3.4 推导有误（需回头查包裹实现）。
   → **已在 t3 实测裁决：预测与观察一致，A5 被证实**，见 **§10.5.1「预测 vs 观察」**。
2. **`sidebar.workspaces` 是否在 rc.2 默认布局下真的渲染出树**（可能被折叠、或被新的 pane/tab 状态隐藏）。
   静态只能证明"调用点仍在同一位置"。
3. **React 协调是否容忍行末的异构尾节点**（`markRow` 的 `row.appendChild(badge)`）在 rc.2 的树里不打架。
4. **MutationObserver 的收敛性**（A9 只做了静态自洽，未做运行时零写断言）。
5. **`dsh-web-frontend` 内联 primitives 与 `dsh-client-ui-primitives` 包版本一一对应**（我按同版本号取，未做交叉校验）。
6. rc.2 家族在 lab 里能否装起来（`.dsh-lab` 家族闭包安装）——t3 的 acceptance 第 1 条。

---

# 第二部分：浏览器实测（t3）

- **验证者**：verifier（t3 attempt `6145ce66-148e-4f18-aa9a-abffa9031f23`）
- **环境**：隔离 lab，端口 **50599**；`.dsh-lab` 沙箱家族；**未碰 3080**，**未碰产品 profile**
  （`C:\Users\Admin\.dsh\profiles\web` 取证前后 mtime 均为 2026-09-09 14:07:45）
- **证据来源**：本部分的每个结论都来自**实跑**（命令 + 退出码 + DOM dump / HTTP 状态码 / 截图），
  与第一部分的静态判定分开标注

## 8. 结论速览（t3）

| 验收项 | 结果 |
|---|---|
| ① lab 以 `0.1.5-rc.2` 家族启动 | **❌ 未通过（阻断）** —— 仓库原样的 `lib/` 在 rc.2 **启动即崩**（`webServer` inject）；**同一崩溃在 `0.1.5-rc.1` 上也复现**（该家族是我们 peer 声明支持的） |
| ② rc.2 上侧边栏行徽标生效 | **⚠️ 部分通过** —— DOM 注入、标题匹配、本地行不误标**均实测通过**；但 `/dsw` 通道在 rc.2 上返回 **405**，状态文案停在 `未检测`（未知），**不能宣称"徽标在 rc.2 上完全可用"** |
| ③ 四个现有槽 UI 可用 | **✅ 通过**（在**打了一行启动补丁的副本**上实测；原样 `lib/` 因 ① 根本起不来） |
| ④ 未验证项如实标注 | **已做**（§12） |
| ⑤ 结论写入本文件并区分证据来源 | **已做**（第一部分=静态 / 本部分=实跑） |

**一句话**：rc.2 上我们**目前跑不起来**。启动崩溃的根因精确定位到 `webServer` 服务访问（两代家族差异），
已用一行补丁在**副本**上验证可解除；解除后 rc.2 的 UI 侧（四个槽 + 行徽标 DOM 注入）**全部正常**，
但 `/dsw` 通道仍不可用（**第二层、独立的** rc.2 不兼容，根因未定位）。

### 8.1 缺陷登记表（**稳定编号，供 t6 / t8 / 后续轮引用**）

| 编号 | 严重度 | 缺陷 | 证据位置 | 承接 |
|---|---|---|---|---|
| **T3-F1** | **blocker**（**t3 后已修**） | 插件在 `0.1.5` 家族（**rc.1 与 rc.2 都**）**启动即崩**：`web.ts` 的 `apply()` 在插件根上下文调用 `ctx.connection.rpc.handle('/dsw', …)`，而 `dsh-client-connection@0.1.5-*` 在**读取者上下文**上访问 `owner.webServer`。**状态更新**：`src/web.ts` 已按 §11 实验 B 形状修复，**并在 rc.2 上以仓库原样 `lib/` 实测启动成功**（见 §10.7）——本条对**历史 t3 取证**成立，对**当前工作树**已不成立 | §10.1、§10.2、§11、**§10.7** | 已落地（engineer）；剩余缺口见哨兵建议 T3-F3 |
| **T3-F2** | **blocker** | rc.2 上 `/dsw` 通道 `POST→405` / `GET→404`（静态兜底）；同一补丁副本在 `0.1.2-rc.1` 上 200 ⇒ **独立的第二层不兼容**，**根因未定位** | §10.3 | 下一轮专项定位 |
| **T3-F3** | high | `upstream.yml` 只跑 typecheck/单测/静态闸门、**从不 boot 宿主** ⇒「能编译」被当成「能运行」；peer 声明的 `\|\| ^0.1.5-rc.1` 在运行时**不成立** | §9.1 ③、§13-3 | 哨兵补 boot 冒烟 |
| **T3-F4** | medium | **会话子行从未拿到 compact 徽标**（两代共有缺陷，非 rc.2 回归）：`HoverCard` 在行与分组容器间插 `<span class="…root">`，`scan()` 分组分支的 `row.parentElement.children` 兄弟扫描扫不到会话行 | §3.4、§10.5 | **t8**（修法见第一部分 §6） |
| **T3-F5** | medium | rc.2 上徽标文案停在 `未检测` **不是**徽标层缺陷，而是 T3-F2 的 `/dsw` 405 使 `conn.status` 取值失败（catch 退回 `unknownView`）——只看「徽标出现了」会掩盖数据面已坏 | §10.4 | T3-F2 修复后复跑 `badge-state-probe` |

## 9. 环境与取证方式

**取证时刻的工作树形态（按 captain 规则 3 声明）**：

| 项 | 值 |
|---|---|
| HEAD | **`96c7ae9`**（`fix(fs): implement readByteRange for the 0.1.5 seam line (#10)`） |
| 工作树 | **非干净**——共享工作树，含 engineer-client 的 t4 中间态（`src/client/index.ts`、`row-badges.ts`、`src/locale/**`、新增 `remote-status*`/`route-id.ts`）与 scout 的资产化改动（`scripts/slot-catalog.mjs`、ADR-0017、`R17-rc2-slot-recon.md`、`docs/uat/*`） |
| 实际被 lab 加载的产物 | `lib/client.js` sha256 `B7CF152016AD65F04D4E88A2B747B77F2F26539D84731FCFC764A6B76B57371F`（275894 B，mtime 2026-09-11 00:54:03）＝**晚于**当时最新的 `src`（00:53:23）⇒ 产物与工作树同代 |
| 补丁副本的客户端半 | 与仓库 `lib/client.js` **同 sha256**（逐字节相同）⇒ §10.4/§10.6 的 DOM 结论对仓库客户端半成立 |
| 归属快照 | 见 §9.1 ③（含 `git status --short` + `git diff --stat`） |

> 因此：**§10 观察到的"产品行为"包含 t4 的中间态**。但 §10.1/§10.3 的两条阻断分别定位在
> `web.ts` 的挂载方式与 rc.2 的路由匹配上，**均与 t4 的改动无关**（t4 只动客户端半与词典）；
> 且 t4 的评审（t5）已 `pass`，其最终形态不改变这两条结论。

| 项 | 值 |
|---|---|
| lab 家族 | `C:\Users\Admin\.dsh-lab\rc2-cli`（`npm i @deepseek-ai/dsh@0.1.5-rc.2`，517 包，exit 0）→ 解析出 **240 个** `@deepseek-ai/*`，`dsh`/`dsh-base`/`dsh-web-app`/`dsh-client-connection`/`dsh-client-ui-workspace`/`dsh-client-ui-sidebar`/`dsh-web-frontend`/`dsh-host-webserver` 全部 `@0.1.5-rc.2`，`cordis@4.0.2` |
| 对照家族 | `C:\Users\Admin\.dsh-lab\rc1-cli`（`@0.1.5-rc.1`，exit 0）；全局安装树 `0.1.2-rc.1` |
| 启动命令 | `node <cli>/lib/bin.js web --port 50599 --no-open`（`DSH_HOME` 按 §10.1 各行指定） |
| 浏览器 | 仓库自带 Playwright + `%LOCALAPPDATA%\ms-playwright\chromium-1234\chrome-win64\chrome.exe`（headless，1440×900，locale zh-CN） |
| 认证 | `GET /?token=<token>` → 303 + `dsh-auth-*` cookie（lab 打印在 stdout） |
| 探针脚本 | `$env:TEMP\dsw-r17\probe\{dom-probe,badge-state-probe,slots-probe,rpc-probe}.mjs`（**仓库外**，不改工作区） |

**三份 DSH_HOME 的分工**（都在 `%TEMP%\dsw-r17` 或 `.dsh-lab` 内，互不干扰）：
`fixhome` = 干净空 home（首个 rc.2 启动实验）；`r17home` = 从 `.dsh-lab` 克隆的**状态副本**
（`storages/` + `remote-workspaces/machines.json` + `settings.yaml` 等，0.37 MB；`machines.json` 经检查
**只含 `privateKeyPath` 路径、无任何密码/passphrase 明文**，未复制任何私钥内容）；
`.dsh-lab` = 原有隔离 lab（对照组）。

> **工作区未改动**：本轮 t3 全程没有写入仓库任何文件；唯一交付物是本报告。
> 实验用的补丁副本在 `%TEMP%\dsw-r17\fixcopy`（见 §11）。

### 9.1 溯源口径与家族安装方式（硬规则，逐条对齐）

**① 上游契约引用 = 文件名 + 版本 + 行号，三者必须同时出现；行号只在同一文件同一版本内有效。**
本报告实际使用的**唯一**三类上游磁盘源：

| 用途 | 源 | 已确认版本 |
|---|---|---|
| rc.2 对照 | `npm pack @deepseek-ai/dsh-client-ui-workspace@0.1.5-rc.2` 解包读 `lib/client.js`（同法取 sidebar / session / layout / subagent / 全 41 客户端包 / primitives / web-frontend） | `0.1.5-rc.2` |
| rc.1 对照 | `npm pack …@0.1.5-rc.1` 解包 | `0.1.5-rc.1` |
| 现网基线 | 全局安装树 `C:\Users\Admin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\*` | `0.1.2-rc.1` |

> **⛔ 禁止源（本报告未使用，特此声明）**：`D:\ZCodeProject\deepseek-harness` 是 **0.1.0-rc.5**
> （HEAD `47f943859b`），其 slot-catalog 只有 **42** 槽、`panellist` / `pane.tab` **零命中**。
> 用它核验 rc.2 会得出「新槽位不存在」的**相反结论**。逐项核验：本报告全文对
> `deepseek-harness` / `slot-recon` / `47f9438` / `0.1.0-rc` 的命中数 = **0**。

**② lab 家族安装方式**：按 `next` dist-tag 的家族口径装。实测当前解析（`npm view <pkg> dist-tags`）：

| 包 | `next` | `latest` |
|---|---|---|
| `@deepseek-ai/dsh` | **0.1.5-rc.2** | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-client-ui-workspace` / `-sidebar` / `dsh-subprocess` | **0.1.5-rc.2** | `0.0.1-rc.1` |

我的装法 = `npm install @deepseek-ai/dsh@0.1.5-rc.2`（空 scratch 目录、**普通 npm install**），
得到 **517 包 / exit 0**，解析出 **240 个** `@deepseek-ai/*`。与 `upstream.yml` 的差别值得一提：

- 工作流用 `npm install --no-save --legacy-peer-deps`（为了装"peer 范围外的家族"），而
  `--legacy-peer-deps` **不自动装 peer** ⇒ 家族成员声明的 **peer** 新包（如 `dsh-subprocess` → `dsh-http-proxy`）
  会缺失，需要额外补装"家族闭包"，否则 `ERR_MODULE_NOT_FOUND` **假红**；
- 我这次没有用 `--legacy-peer-deps`，普通 npm install 会**自动装 peer**，因此闭包天然满足。
  **实测核对（peer 闭包探针）**：`dsh@0.1.5-rc.2`、`dsh-subprocess@0.1.5-rc.2`、
  **`dsh-http-proxy@0.1.5-rc.2`**、`dsh-client-ui-workspace@0.1.5-rc.2`、`dsh-client-ui-sidebar@0.1.5-rc.2`、
  `dsh-web-frontend@0.1.5-rc.2`、`dsh-host-webserver@0.1.5-rc.2`、`dsh-brand@0.1.5-rc.2`、
  `dsh-invariants@0.1.5-rc.2` **全部在树内**，全流程无 `ERR_MODULE_NOT_FOUND`。
- 结论：`.tmp/slot-recon/pkgs/` 的解包目录**未被**塞进任何 lab `node_modules`（它是只读参考，
  本报告的 rc.2 引用也全部取自我自己 `npm pack` 的同一版本，未依赖它）。

**③ 并发写入归属规则（已实际执行）**：若 `check:static` / `test:agent` 出现失败，先 `git status --short` +
`git diff --stat` 判断是否为他人中间态，再决定是否记为缺陷，并把「观察到的失败 + 归属判断 + 复跑结果」
一并记录。本轮**实际跑了这两个闸门**（只读性质，不改产品代码），结果如下。

**运行前归属快照**（证明这是**共享工作树**，含 engineer-client 的 t4 中间态与 scout 的资产化改动）：

```
 M AGENTS.md            M docs/uat/README.md   M package.json
 M src/client/index.ts  M src/client/row-badges.ts
 M src/locale/dsw.en.ts M src/locale/dsw.ts
?? docs/decisions/ADR-0017-rc2-client-slot-recon.md   ?? docs/rounds/R17-rc2-slot-recon.md
?? docs/uat/R17-rc2-official-slot-entry.md            ?? scripts/slot-catalog.mjs
?? src/client/remote-status-entry.tsx  ?? src/client/remote-status.ts
?? src/client/route-id.ts              ?? test/remote-status.test.ts
（git diff --stat: 7 files changed, 53 insertions(+), 18 deletions(-)）
```

| 命令 | 退出码 | 关键输出 |
|---|---|---|
| `npm run check:static` | **0** | `ALL PASS`——`dictionary key sets equal — zh=331 en=331 onlyZh=[] onlyEn=[]`；`@deepseek-ai/dsh-* peers declare one range — 0.1.2-rc.1 \|\| ^0.1.5-rc.1: 13 pkg`；`every declared peer family is probed in upstream.yml — 2 families` |
| `npm run test:agent` | **0** | `tests 248 / pass 247 / fail 0 / skipped 1`；`[test-agent] PASS — 23 file(s), 4 skipped (JSX)` |

**归属判断与复跑**：两个闸门**均一次通过、未观察到任何失败**，因此**没有**中间态需要归属，也**不需要**复跑
（captain 提到的瞬态 `dictionary key sets equal` FAIL 在这一刻已不存在——`zh=331 en=331` 两侧相等）。

> **边界（重要，避免混读）**：这两条闸门结果**不构成本报告 t3 判定的任何一部分**。t3 的
> FAILED 来自**运行时**（启动崩溃 + `/dsw` 405），而闸门证明的是「静态 + 单测**现在是绿的**」——
> 二者并不矛盾：**闸门从不 boot 宿主**，这正是 F1/F2 能躲过全部自动化的原因（§13 第 3 条）。
> 请注意上面 `peers declare one range — … || ^0.1.5-rc.1: 13 pkg` 那一行：闸门**明确认定**
> 我们声明支持 0.1.5 家族，而运行时该家族上插件连启动都做不到。

### 9.2 模块解析事实（回答「rc.2 实测到底测的是哪一份」——**先有这条，再谈 rc.2 实测**）

本插件以 `link:` 装进 profile，其 `lib/*.js` 的 `import '@deepseek-ai/…'` 由 Node **从导入方所在目录**
（= 本仓库 `lib/`）逐级向上解析，**不经过 profile 的 `node_modules`**。实测（`require.resolve`）：

| 解析起点 | 包 | 解析到 | 版本 |
|---|---|---|---|
| 仓库（插件目录） | `@deepseek-ai/dsh-fs` | `D:\ZCodeProject\dsh-workspace-enhancement\node_modules\@deepseek-ai\dsh-fs` | **0.1.2-rc.1** |
| 仓库（插件目录） | `@deepseek-ai/dsh-subprocess` | 同上（仓库树） | **0.1.2-rc.1** |
| 仓库（插件目录） | `@deepseek-ai/cordis` / `schemastery` | 仓库树 | 4.0.2 / 3.18.2 |
| lab **host** 树（`rc2-cli`） | `dsh-fs` / `dsh-subprocess` / `dsh-client-connection` | `C:\Users\Admin\.dsh-lab\rc2-cli\node_modules\@deepseek-ai\…` | **0.1.5-rc.2** |
| lab profile 自身 | — | `C:\Users\Admin\.dsh-lab\profiles\web\node_modules\@deepseek-ai\` **不存在** | 无该层 |

**插件实际用到的裸依赖闭包**（`lib/*.js` 全量扫描）：`@deepseek-ai/{cordis, dsh-fs, dsh-fs-local,
dsh-fs-sandbox, dsh-host-directory-picker, dsh-host-directory-picker-native, dsh-llm, dsh-sandbox-policy,
dsh-subprocess, dsh-subprocess-local, dsh-timeout, dsh-tools, schemastery}` + `ssh2`（+ `react` 仅出现在客户端半 `lib/client.js`）。
这 12 个 `@deepseek-ai` 包在 `rc2-cli` 宿主树里**全部存在于 `0.1.5-rc.2`**。

> **为什么这条重要**：宿主跑 rc.2、而插件从仓库树 import 0.1.2-rc.1 的同名包 ⇒
> **同一份包存在两个模块实例**（`AGENTS.md` §6 记的「Cordis 服务身份是模块级 Symbol，自装副本会遮蔽宿主单例」）。
> 因此"某次 rc.2 实测"必须说明**插件树**与**宿主树**各是哪一份，否则结论不可归因。

**本报告各次实测的树对齐情况（逐项标注）**：

| 观测 | 宿主树 | 插件树（Node 侧） | 对齐 |
|---|---|---|---|
| §10.1 启动矩阵 baseline 行 | `0.1.2-rc.1`（全局） | 仓库 = `0.1.2-rc.1` | ✅ 对齐 |
| §10.1 启动矩阵 rc.1/rc.2 行 | `0.1.5-rc.1` / `rc.2` | 仓库 = `0.1.2-rc.1` | ❌ **混合** |
| §10.4 / §10.6 / §10.7（DOM / 槽 / t4 cell） | `0.1.5-rc.2`（rc2-cli） | 仓库 = `0.1.2-rc.1` | ❌ **混合**（但见下） |
| §9.2 / §10.3 的**对齐复测** | `0.1.5-rc.2` | **`fixcopy2`：其 `node_modules/@deepseek-ai` 指向 rc2-cli 树 = `0.1.5-rc.2`** | ✅ **对齐** |

> **DOM 类观测为何仍可用（须显式说明，不得含糊）**：`lib/client.js` 是**客户端半**，由宿主作为静态资源
> 发给浏览器执行；它的 `import`（react 等）由**宿主的模块加载器**提供，**不经过插件目录的 Node 解析**。
> 因此 §10.4/§10.6/§10.7 的行 DOM / 槽位 / cell 观测**不受插件树版本影响**；
> 受影响的只有**宿主半接缝**（`/dsw` 注册、fs/subprocess provider 等）——那正是 §9.2/§10.3 重新对齐复测的部分。

### 9.3 家族版本清单（**实际解析到的**，不是"打算用"）

| 用途 | 家族 | 实测解析 |
|---|---|---|
| rc.2 宿主 | `dsh` / `dsh-base` / `dsh-web-app` / `dsh-client-connection` / `dsh-client-ui-workspace` / `dsh-client-ui-sidebar` / `dsh-web-frontend` / `dsh-host-webserver` | **全部 `0.1.5-rc.2`**（`rc2-cli` 树 240 个 `@deepseek-ai/*`），`cordis@4.0.2` |
| rc.1 宿主 | `@deepseek-ai/dsh` | **`0.1.5-rc.1`**（`rc1-cli` 树） |
| 现网基线宿主 | 全局安装树 | **`0.1.2-rc.1`** |
| 插件树（默认，`link:` 指向仓库） | 12 个 `@deepseek-ai` 裸依赖 | **`0.1.2-rc.1`**（devDependencies） |
| 插件树（§10.3 对齐复测） | 同上 | **`0.1.5-rc.2`**（`fixcopy2` 把 `node_modules/@deepseek-ai` junction 到 `rc2-cli` 树） |

## 10. 实测结果

### 10.0 观测溯源表（**读 §10 任何小节前先看这张表**）

§10 各小节的"宿主家族 / 插件构建 / DSH_HOME / 时刻"**各不相同**，混读会得出错误结论
（engineer-client 就曾把 §10.4 的"补丁副本"误推到 §10.7/§10.8.4 上）。逐项登记如下；
**"插件构建 = 仓库原样"的小节不依赖任何补丁**：

| 小节 | 观测内容 | 宿主家族 | 插件构建 | DSH_HOME | 时刻 | 归档（`.tmp/verifier/r17/`） |
|---|---|---|---|---|---|---|
| §10.1 | baseline 启动 **OK** | `0.1.2-rc.1`（全局树） | 仓库原样 | `.dsh-lab` | 01:01 | `lab-control2.stdout.log` |
| §10.1 | rc.1 **崩溃** exit 1 | `0.1.5-rc.1` | 仓库原样 | `.dsh-lab` | 01:04 | `lab-rc1.stderr.log` |
| §10.1 | rc.2 **崩溃** exit 1 | `0.1.5-rc.2` | 仓库原样 | `.dsh-lab` | 00:58 | `lab-rc2.stderr.log` |
| §10.3 | `/dsw` **200**（对照） | `0.1.2-rc.1` | `fixcopy`（挂载补丁） | `r17home` | 01:12 | `lab-base-patched.stdout.log` |
| §10.3 | `/dsw` **405** | `0.1.5-rc.2` | `fixcopy`（挂载补丁） | `r17home` | 01:09 | `lab-rc2b.stdout.log` |
| §10.3 | 对齐复测 **405** | `0.1.5-rc.2` | `fixcopy2`（**树也对齐**） | `fixhome2` | 01:29 | `lab-aligned.*` |
| **§10.4** | 行徽标 DOM：8 标记 / session 0 | `0.1.5-rc.2` | **`fixcopy`（挂载补丁）** | `r17home` | 01:16 | `probe-rc2b/` |
| §10.4 | 对照：8 标记 / 6 会话 0 | `0.1.2-rc.1` | `fixcopy` | `.dsh-lab` | 01:16 | `probe-out/` |
| **§10.6** | 四槽 7/7 + `data-slot` census 29 | `0.1.5-rc.2` | **`fixcopy`（挂载补丁）** | `r17home` | ~01:16 | `probe-rc2b/slots-probe.json` |
| **§10.7** | t4 cell：`c1` / `inUtilities` | `0.1.5-rc.2` | **仓库原样（F1 已修）** | `.dsh-lab` | 01:27 | `probe-rc2e/`、`probe-rc2j/` |
| **§10.8.4** | **闸门探针**：8 / **0** | `0.1.5-rc.2` | **仓库原样（最新构建）** | `.dsh-lab` | 01:34 | `probe-rc2k/` |
| §10.8.1 | 行类计数（跨轮汇总） | rc.2 + rc.1 | 见上（两代两种构建都有） | 见上 | 01:16–01:35 | `probe-rc2b`、`probe-rc2c`、`probe-out` |

**分界线 = F1 落地的构建时刻 `01:19:36`**（此后 `lib/` 已含挂载修复）：
- **01:19:36 之前**（§10.4 / §10.6）：仓库原样在 rc.2 上**根本起不来**，故只能用 `fixcopy`
  （只改宿主半挂载方式；**客户端半与仓库逐字节同 sha256**）——这是**必要的取证变通**；
- **01:19:36 之后**（§10.7 / §10.8.4）：**仓库原样构建即可在 rc.2 上启动**，故这两节
  **不含任何补丁**，**gate 结论（§10.8.4）因此不依赖补丁**。

**同一个结论在两个构建上都复现**（交叉印证，非单点）：
`markedOnSessionRow = 0` 在 **`fixcopy`（§10.4，01:16）** 与 **仓库原样最新构建（§10.8.4，01:34）** 上**各自独立成立**。

### 10.1 【阻断】启动矩阵：0.1.5 家族（rc.1 与 rc.2）上插件**无法启动**

> **⏱ 状态标注（读本节前必看）**：本节记录 **t3 取证时刻**的事实（当时未修）。
> **此后 `src/web.ts` 已修复该缺陷**，并已在 rc.2 上以仓库原样 `lib/` 复测启动成功 ——
> 复测见 **§10.7「前置」**。本节保留原始栈与判别矩阵，因为它仍是 T3-F1 的**根因证据**。

| 宿主家族 | 插件构建 | 结果 | 证据 |
|---|---|---|---|
| `0.1.2-rc.1`（现网 legacy） | 仓库原样 `lib/` | **✅ 启动 OK** | `lab-control2.stdout.log`: `dsh web: http://127.0.0.1:50599/?token=…`，端口 LISTENING |
| `0.1.5-rc.1`（`next`，**peer 已声明支持**） | 仓库原样 `lib/` | **❌ 启动崩溃 exit 1** | `lab-rc1.stderr.log` |
| `0.1.5-rc.2`（本轮目标） | 仓库原样 `lib/` | **❌ 启动崩溃 exit 1** | `lab-rc2.stderr.log` |
| `0.1.5-rc.2` | 一行补丁副本 | ✅ 启动 OK | `lab-fix3.stdout.log`（§11） |
| `0.1.2-rc.1` | 同一份补丁副本 | ✅ 启动 OK | `lab-base-patched.stdout.log`（判别实验，§10.3） |

rc.2 的原始失败输出（`lab-rc2.stderr.log`，与 rc.1 逐字相同、仅路径不同）：

```
Error: dsh: plugin tree failed to load: failed to apply loader entry ssh-web-channel
       (dsh-workspace-enhancement/web): cannot get property "webServer" without inject
    at Fiber.<anonymous> (…/rc2-cli/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js:618:35)
    at Proxy.register     (…/dsh-client-connection/lib/index.js:618:16)
    at Object.handle      (…/dsh-client-connection/lib/index.js:543:39)
    at new apply          (file:///D:/ZCodeProject/dsh-workspace-enhancement/lib/web.js:504:40)
    at boot (…/dsh-app-boot/lib/index.js:1545:9)
```

复现命令（可原样复跑）：

```powershell
$env:DSH_HOME='C:\Users\Admin\.dsh-lab'
node 'C:\Users\Admin\.dsh-lab\rc2-cli\node_modules\@deepseek-ai\dsh\lib\bin.js' web --port 50599 --no-open
# -> exit 1, stderr 首行 = "cannot get property \"webServer\" without inject"
```

### 10.2 根因定位

失败调用点 = 我们的 `web.ts` 里 **`apply()` 末尾的 `ctx.connection.rpc.handle('/dsw', dispatch, { authority: 'loopback' })`**
（取值时的编译产物快照：`lib/web.js` 第 504 行 —— 行号仅作快照，符号为准）：

```ts
const dispose = ctx.connection.rpc.handle('/dsw', dispatch, { authority: 'loopback' })
```

上游 `dsh-client-connection` 的实现（**三个版本都是这一行**；下方 `@618` 是该**行号快照**，
仅对 `dsh-client-connection@0.1.5-rc.2/lib/index.js` 有效，跨版本不可互换——符号为准）：

```js
get rpc() { const owner = this.ctx; return { handle: (channel, handler) => this.register(owner, channel, handler) } }
register(owner, channel, handler) {
  …
  return owner.effect(() => owner.webServer.register(route), `client-connection: ${channel} rpc channel`)   // ← @618
}
```

差异在**这个插件自己的 inject 契约**（下表每行都注明 `@deepseek-ai/dsh-client-connection@<版本>`
的 `lib/index.js`；三个版本分别取自全局安装树 / `conn-rc1` 解包 / `rc2-cli` 树）：

| 版本 | `dsh-client-connection@<版本>` `lib/index.js` 的 inject | 结果 |
|---|---|---|
| `0.1.2-rc.1` | `const inject = ["webServer", "credentials"]`（硬依赖） | `owner.webServer` 可解析 → 正常 |
| `0.1.5-rc.1` / `0.1.5-rc.2` | 改为 `ctx.inject(["webServer"], (webCtx) => { webCtx.effect(() => webCtx.webServer.register(route), '…/api route') })`（**可选**，只为挂 `/api`） | `owner.webServer` 在本插件 fiber 上解析失败 → Cordis 抛 `cannot get property "webServer" without inject` |

Cordis（三处同为 `4.0.2`）的 `ReflectService.handler.get` 在目标上下文没有该服务时抛这个错；
`owner` 是**读取者**上下文（Cordis `getTraceable` 的 receiver 绑定），所以**我们必须自己让
`webServer` 在自己的上下文里可见**。我们的 `web.ts` 顶部导出的 `inject` 目前是
`['connection', 'tools', 'systemPrompt']`（编译产物快照：`lib/web.js` 第 22 行），**没有 `webServer`**。

**这一条与 rc.2 无关**：rc.1 上同样崩，只是此前从未有人在 0.1.5 家族上**启动过**宿主
（`upstream.yml` 哨兵只跑 typecheck + 单测 + 静态闸门，**从不 boot**），所以
`docs/compatibility.md` §1 里「支持 `^0.1.5-rc.1`」在**运行时是假的**，而 CI 没有任何一层能发现。

### 10.3 【第二层、独立】rc.2 上 `/dsw` 通道返回 HTTP 405

解除启动崩溃后（§11 的补丁副本），rc.2 上的 `/dsw` **仍然不可用**：

| 宿主（同一份补丁副本） | `POST /dsw/connections.list` | `GET /dsw/connections.list` | `GET /dsw` |
|---|---|---|---|
| `0.1.2-rc.1` | **200** + 正确 JSON（`[{id:"c1",…}]`） | — | — |
| `0.1.5-rc.2` | **405** | 404 | 404 |

UI 侧同一现象（目录选择器对话框内的原文）：
`transport failure for /dsw/connections.list: HTTP 405　重试` / `transport failure for /dsw/config.hosts: HTTP 405　重试`
（`rc2-directory-flow.png`）。

**判别**：同一份补丁副本在 baseline 上 200、在 rc.2 上 405 ⇒ 这**不是补丁造成的**，是 rc.2 上的
**第二层不兼容**（`/dsw` 前缀路由在 rc.2 未被实际服务，请求落到静态兜底：POST→405 / GET→404）。

**判别二（排除"插件/宿主树版本不一致"这个混淆变量）**：上面那次 rc.2 测量里，**插件树 = 仓库 = 0.1.2-rc.1**
而宿主 = 0.1.5-rc.2（§9.2 实测），属于**混合树**，理论上足以让服务身份分裂。为此做了**对齐复测**：

| 项 | 做法 | 结果 |
|---|---|---|
| 构建 | `fixcopy2` = 仓库副本，其 `node_modules/@deepseek-ai` **junction 到 `rc2-cli` 宿主树**（`ssh2` 等仍取仓库） | 解析核对：`dsh-fs` / `dsh-subprocess` / `dsh-client-connection` = **0.1.5-rc.2**（与宿主**同家族**） |
| 注册 | `DSH_HOME=<fresh>` + rc.2 CLI `plugin --profile web add fixcopy2` | exit 0 |
| 启动 | rc.2 CLI `web --port 50599 --no-open` | **✅ 启动成功**（`lab-aligned.stdout.log` 打印 URL、RUNNING、stderr 为空） |
| 插件确实在册 | `--profile web --dump-config`：`ssh-remote` / `directory-picker-ssh` / `ssh-web-channel` 三行在册；`/` 返回 200 且 HTML **引用 `dsh-workspace-enhancement/client.js`** | ✅ 插件已加载并对外供包 |
| **`/dsw` 测量** | `POST /dsw/connections.list` / `POST /dsw/status` | **仍然 405** |

⇒ **F2 不是模块解析/树不一致造成的假象**：在"插件树与宿主树同为 0.1.5-rc.2、且插件已确认在册"的条件下
依然复现 405。**根因仍未定位**（下一步建议按 §13-2 ② 排查 `kind:"prefix"` 路由在
`dsh-host-webserver@0.1.5-rc.2` 的匹配语义）。

### 10.4 rc.2 原生 DOM 实测（补丁副本，客户端半与仓库 `lib/client.js` **逐字节相同**）

- 补丁副本 `lib/client.js` sha256 = `B7CF152016AD65F04D4E88A2B747B77F2F26539D84731FCFC764A6B76B57371F`
  = **仓库 `lib/client.js` 同值** ⇒ 下面所有 DOM 结论对仓库的**客户端半**成立；
  被改的只有宿主半 `lib/web.js`（挂载方式，见 §11），**与行徽标 DOM 无关**。

`dom-probe.mjs` 对 rc.2 lab 的真实 DOM（`probe-rc2b/dom-probe.json`）：

| 行 | class | `aria-expanded` | `[data-dsw-badge]` | `data-dsw-conn-id` | 父元素 |
|---|---|---|---|---|---|
| `ssh-test-lab` | `projectRow` | true | **1** | `c1` | `span._root_1b2ny_3` |
| `r4d` / `r4c` / `r4-verify` / `r4-pick` / `.ssh` / `uuz` ×2 | `projectRow` | false | **1**（各） | `c1` | `span._root_1b2ny_3` |
| `r4-local-ws`（**本地**工作区） | `projectRow` | false | **0** | — | `span._root_1b2ny_3` |
| `新会话`（`ssh-test-lab` 展开组下的**会话子行**） | `sessionRow` | — | **0** | — | `span._root_1b2ny_3` |

- **正向**：7 个远程工作区行带徽标，文本 `🌐未检测重新检测`（🌐 + 状态标签 + 重试按钮）。
- **负向**：本地工作区 `r4-local-ws` **无**徽标（与 `E2E-07` 的意图一致）。
- **父元素链**：`span._root_1b2ny_3` ← `div.bhn1Oq_groupSection` ← `div.bhn1Oq_list[role=tree]`，
  与第一部分 §3.4 的静态推导**逐项吻合**（HoverCard 包裹 span 的 class `_root_1b2ny_3`）。

0.1.2-rc.1 对照 lab（原样 `lib/`，`probe-out/dom-probe.json`）：**8 枚**徽标，`markedRows=16`
（8 行 + 8 徽标各带一次 `data-dsw-conn-id`），**6 个 sessionRow 中 0 个带徽标**；
状态文案在 2s 内收敛为 `已连接`（active）、重试按钮 `display:none`、点色 `rgb(152,195,121)`（`#98c379`），
与页内 `POST /dsw/conn.status → state:"active"` **一致**，并在 2/6/12/20/40 s 五个采样点**完全稳定**
（无抖动、无自维持循环）。

> rc.2 上徽标文案停在 `未检测` **不是**徽标层的问题，而是 §10.3 的 `/dsw` 405 让 `conn.status`
> 取不到值（`row-badges` 的 catch 路径退回 `unknownView`）——数据面坏，不是 DOM 面坏。

### 10.5 第一部分 A5 的**实测判定**

rc.2 原生 DOM 与 baseline 对照 DOM **都证实了 A5**：

- 每个行的 `parentElement` 都是 `span._root_1b2ny_3`（HoverCard 根，`role` 为 `null`），
  `parentElement.children` 里只有该行自己 ⇒ `scan()` 分组分支的**兄弟扫描**（`row.parentElement.children`
  取 `role=treeitem` 的兄弟）扫不到会话子行；
- 结果：**展开的远程组 `ssh-test-lab` 下的会话行 `新会话` 徽标 = 0**；baseline 上 6/6 会话行徽标 = 0。

⇒ 第一部分 §5 的静态结论（「会话子行从来拿不到徽标」）由**两代宿主的真实 DOM 独立证实**，不是纸面推理。

#### 10.5.1 **预测 vs 观察**（t8 的裁决点 —— 明确的通过/不通过判定）

第一部分 §7-1 给出的**可证伪预测**（原文）与其在浏览器里的**观察结果**逐字对照：

| 项 | 内容 |
|---|---|
| **预测**（第一部分 §7-1，取证前写下） | 「A5 正确 ⇒ 分组视图下 **`div.sessionRow` 不会带 `[data-dsw-badge]`**，只有 `div.projectRow` 带 `[data-dsw-conn-id]`；反之若有会话行带徽标，则 §3.4 推导有误。」 |
| **观察（rc.2 原生，`probe-rc2b/dom-probe.json`）** | 展开的远程组 `ssh-test-lab`（`projectRow`，`aria-expanded="true"`、`badge=1`、`conn-id=c1`）下唯一的会话行 `新会话`：**`[data-dsw-badge]` 计数 = 0**、**`data-dsw-conn-id` = 无** |
| **观察（baseline 对照，`probe-out/dom-probe.json`）** | 6 个 `sessionRow` 中 **0 个**带徽标；8 个 `projectRow` 全部带徽标（`badge=1`、`conn-id=c1`） |
| **观察（结构证据）** | 两代宿主上行（含 `sessionRow`）的 `parentElement` 均为 `span._root_1b2ny_3`，`parentRole = null`，`parentElement.children` 里只有该行自己 |

> **裁决：预测与观察一致 ⇒ A5 被证实、未被证伪。t8 第一条 acceptance 的停止条件
> （「若 t3 观察到 `div.sessionRow` 带 `[data-dsw-badge]`」）**不成立**，t8 可以按计划实施。**

三条并列（防止只读一半）：
1. **DOM 面**：工作区行（`div.projectRow`）的徽标注入**正常**（rc.2 与 baseline 都实测到），本层的**唯一目标**成立；
2. **数据面**：rc.2 上 `/dsw` 405 使 `conn.status` 失效 ⇒ 文案停在 `未检测`（T3-F5）——**与 A5 无关**；
3. **A5 本身**：会话子行**确实**拿不到徽标 ⇒ T3-F4 成立，**t8 要做**。

### 10.6 四个槽位 + rc.2 新布局面（补丁副本，rc.2 原生）

`slots-probe.mjs`：**7/7 检查通过**（`probe-rc2b/slots-probe.json`）。

| 槽 | 检查 | 结果 | 证据 |
|---|---|---|---|
| `settings.section` | 设置页可打开并进入「远程工作区」段 | ✅ | trigger 命中 1、section nav 命中 1、页标题「远程工作区（机器管理）」可见；`rc2-settings-section.png` |
| `conversation.session.header.actions` | 「⊕ 工作区」按钮存在且可见 | ✅ | `getByTitle('关联工作区（本会话的副目录）')` 命中 1、visible；`rc2-header-workspace-action.png` |
| `sidebar.workspaces.directoryFlow` | 目录选择器可打开 + **本机目录能列出**（BUG-3） | ✅（远端部分除外） | 对话框可见、`本机`/`已保存连接` 两段都在、42 个按钮、列表出现 `C:\Users\Admin\...`；**但 `/dsw` 405 使「已保存连接」段报错**（§10.3）；`rc2-directory-flow.png` |
| `conversation.hero.workspace.directoryFlow` | 首屏 hero 的目录流**槽位已渲染** | ✅ | 首屏 `[data-slot]` census 含 `conversation.hero.workspace` 与 `conversation.hero.workspace.directoryFlow`；hero 的「选择工作区」按钮命中 1 |
| （信息记录）rc.2 新布局面 | 右侧面板 / 活动栏 | 说明 | 首屏 `[data-slot]` census **29 项**，含 rc.2 新增的 `main` / `main.conversation` / `rightbar` / `rightbar.session`，以及 `conversation.session.header.{actions,corner,lineage,utilities}`；`sidebar.panellist` 的 `PanelRow`（`button[aria-current]`）与 dockkit 元素在本 profile 下**计数均为 0**（该槽无占用者，属正常空槽） |

首屏 `data-slot` 全清单（29）：
`conversation.composer`, `conversation.composer.bar`, `conversation.hero.agentPreset`,
`conversation.hero.brand.mark`, `conversation.hero.workspace`, `conversation.hero.workspace.directoryFlow`,
`conversation.input.attachments`, `conversation.input.dock`, `conversation.input.left`,
`conversation.input.model`, `conversation.input.overlay`, `conversation.input.plan`, `conversation.input.right`,
`conversation.session`, `conversation.session.header`, `main`, `main.conversation`, `rightbar`,
`rightbar.session`, `root`, `settings.trigger`, `shell.overlay`, `sidebar`, `sidebar.brand.mark`,
`sidebar.brand.name`, `sidebar.footer.action`, `sidebar.settings`, `sidebar.workspaces`,
`sidebar.workspaces.directoryFlow`

### 10.7 【附加观测 · 非 t3 原验收项】t4 特性：header 工具区的远程状态 cell（rc.2 原生）

> **定位**：这是 captain 在 t3 结论落定后追加的**现场观测项**，**不改变 §8 的既有验收**，
> 也不改变 t3 的 FAILED 判定。观测对象 = t4 的功能（`data-dsw-remote-status` cell）。
> **本轮前置变化**：`src/web.ts` 已按 §11 实验 B 的形状修好 T3-F1，`lib/` 于 01:19:36 重建
> ⇒ **这次用的是仓库原样的 `lib/`**（不是补丁副本），HEAD 仍 `96c7ae9`。

**先说前置：F1 已修好并被证实，F2 依旧**

| 项 | 结果 | 证据 |
|---|---|---|
| T3-F1（启动崩溃） | **✅ 已修复并实测通过**：仓库原样 `lib/` 在 rc.2 上**成功启动** | `lab-rc2-repofix.stdout.log`=`dsh web: http://127.0.0.1:50599/?token=…`，端口 LISTENING，**stderr 为空** |
| T3-F2（`/dsw` 405） | **❌ 未修，实修后复测仍 405** | `POST /dsw/connections.list` → **405**、`POST /dsw/conn.status` → **405** |

**观察 A — 远程会话（正例）：cell 出现，且落在官方 `.utilities` 槽内**

在远程工作区组（`projectRow` `data-dsw-conn-id="c1"`）下打开会话并渲染出对话后
（`probe-rc2e/decisive-remote-status.json`）：

```json
{
  "connId": "c1",
  "text": "🌐未检测",
  "title": "当前会话的远程连接：c1（点击重新检测）",
  "ariaLabel": "远程状态",
  "disabled": false,
  "inUtilities": true,     // ← 在 [data-slot="conversation.session.header.utilities"] 内
  "inActions": false       // ← 不在 .actions 内
}
```

- `cellCount = 1`（恰好一个）；`headerSlots` 同时含 `…header` / `.lineage` / `.actions` / `.utilities` / `.corner`；
- 文案 `🌐未检测`（🌐 + 状态标签；`●` 是 `<span>` 圆点，无文本）；`title`/`aria-label` 均为 i18n 键渲染结果；
- 状态为 `未检测`（unknown）**归因于 T3-F2 的 405**（`conn.status` 取不到值），不是 cell 本身的问题；
- 证据截图 `probe-rc2e/rc2-remote-status-decisive.png`。

**观察 B — 本地会话（零噪音对照）：`.utilities` 已挂载且对话已渲染，cell 计数仍为 0**

对照必须是**有效的**：若槽本身没挂载，"不显示"就证明不了零噪音。故本轮先点本地工作区
`r4-local-ws` 行的「在"r4-local-ws"中新建会话」按钮建一个**本地**会话，再发一条消息把
header 子槽顶出来（`probe-rc2j/local-control-v4.json`）：

```json
{
  "label": "L2: 本地发送后 +12s",
  "selectedGroupConnId": null,     // ← 本地组（无 conn-id）
  "utilitiesMounted": true,        // ← .utilities 确实挂载
  "chatNodes": 15,                 // ← 对话确实渲染
  "cellCount": 0,                  // ← ✅ 零噪音：不出现远程状态 cell
  "cells": []
}
```

证据截图 `probe-rc2j/rc2-remote-status-local-control-v4.png`。

**观察 C — 一个"陷阱"（对后续复验很重要，不计缺陷）**

`conversation.session.header.{lineage,actions,utilities,corner}` **只在会话渲染出对话之后才挂载**：
空白会话（如 app 自选的 `新会话`）里 `utilitiesHostCount = 0`，此时"没有 cell"既可能是零噪音、
也可能是槽未挂载。本轮前 3 次尝试（`probe-rc2c` / `-rc2d` / `-rc2g` / `-rc2h`：初始、展开分组、
点开远程会话 `uuz`）全部落在"槽未挂载"状态，`cellCount` 恒为 0 —— **当时的 0 不构成结论**。
必须先让目标会话出现 `chatNodes > 0` 再断言。**后续任何人复验此项都必须先满足该前置条件。**

**观察 D — 归属（按 captain 要求：cell 不出现时只留证据、不改 slot）**

本轮**未出现**"cell 该出现却没出现"的情形 ⇒ **无需归属、无需 fallback**；实测 `inUtilities: true`
即 t4 的实现确实注册在官方 `.utilities`（不是 `.actions`）。仅记录两处**非缺陷**的中间态：
① 空白会话槽未挂载（观察 C）；② 会话状态文案停在 `未检测`，根因是 T3-F2 的 `/dsw` 405。

| 项 | 判定 |
|---|---|
| cell 出现在 `conversation.session.header.utilities`（非 `.actions`） | ✅ 实测（`inUtilities: true` / `inActions: false`） |
| 远程会话显示、本地会话零噪音 | ✅ 实测双侧（观察 A + 观察 B，且对照满足"槽已挂载"前置） |
| 点按行为 = `conn.reconnect` | ⚠️ **未验证**（未点；且 T3-F2 的 405 会让该 RPC 失败，点按结果无法区分） |
| 状态文案与真实连接态一致 | ⚠️ **未验证**（同 T3-F5：405 使 `conn.status` 取不到值） |

复现命令（本轮原样）：

```powershell
$env:DSH_HOME='C:\Users\Admin\.dsh-lab'   # 隔离 lab；未碰产品 profile / 3080
node 'C:\Users\Admin\.dsh-lab\rc2-cli\node_modules\@deepseek-ai\dsh\lib\bin.js' web --port 50599 --no-open
# 正例：node probe/decisive-remote-status.mjs   http://127.0.0.1:50599 <token> <outDir>
# 对照：node probe/local-control-v4.mjs         http://127.0.0.1:50599 <token> <outDir>
```

### 10.8 【给 t8 的输入】lab 里到底有没有"会被标记的行"（t8 正向断言的可观察对象）

> engineer-client 在写 t8 的 e2e 正向断言前问了这个问题。答案来自本报告已取的实测，附**可复现选择器**与
> **一个必须避开的假绿陷阱**。

**答：有，且不是 idle。** 实测（§10.4，rc.2 原生 DOM）：

| 问题 | 答案 | 证据 |
|---|---|---|
| 有行被标记吗？ | **有**。rc.2 上 **8** 个 `div.projectRow` 带 `[data-dsw-badge]` + `data-dsw-conn-id="c1"`（9 个 projectRow 中唯一未标记的是本地工作区 `r4-local-ws`）；baseline 对照同为 **8** 个（10 个 projectRow） | §10.4 / `probe-rc2b`、`probe-out` |
| 有远程工作区行吗？ | **有 8 个**工作区条目的 path 含 `dsw-routes\c1\home\uuz\…`（另 1 个 `dsh-ssh-routes\c1\…`） | `$DSH_HOME/storages/workspace.json`（6159 B，`{unit,global,tables}`） |
| 有远程会话吗？ | **有 35 个** projcache 记录的 `identity.cwd` 是 `…\dsw-routes\c1\home\uuz\…`（另 3 个 `dsh-ssh-routes\c1\…`、1 个 `dsw-routes\c7\…`）；占位树在盘上真实存在 | `$DSH_HOME/storages/session_projcache/sessions/*.json`、`$DSH_HOME/dsw-routes/c1/home/` |
| 有可达远程主机吗？ | **有**：`c1` = `<lab-user>@127.0.0.1:22`（用户名按 `check.mjs` 的 `real lab host identity` 规则脱敏），key 认证（`machines.json` 只存 `privateKeyPath`，无明文口令）；rc.1 实测 `conn.status` → `state:"active", connected:true` | §10.4、`rpc-probe` 输出 |
| 整层 idle 吗？ | **不是**；且负向对照成立：本地工作区 `r4-local-ws` 徽标 = 0 | §10.4 |

**t8 正向断言的可观察对象**：**展开的远程工作区组下的会话子行**。lab 里 `uuz` 组默认
`aria-expanded="true"`，其 `projectRow` 带 `data-dsw-conn-id="c1"`，含 6 个 `sessionRow` 子行；
**当前（修复前）它们的徽标 = 0**（§10.5.1 实测），修复后应为 1 且 **compact 变体**。

#### 10.8.1 被标记的是哪类行 —— **行类判别（精确计数，t8 的开工闸门）**

从归档的 `dom-probe.json` 逐条统计（**这是"哪类行被标记"的硬答案**）：

| 证据文件（`.tmp/verifier/r17/`） | 家族 | `projectRow` | 其中带徽标 | `sessionRow` | 其中带徽标 | sessionRow 有 `aria-expanded` | sessionRow 有 `aria-selected` |
|---|---|---|---|---|---|---|---|
| `probe-rc2b/dom-probe.json` | **rc.2 原生** | 9 | **8** | 1 | **0** | **0/1** | 1/1 |
| `probe-rc2c/dom-probe.json` | rc.2（稍后同 lab） | 10 | **8** | 6 | **0** | **0/6** | 6/6 |
| `probe-out/dom-probe.json` | rc.1 baseline | 10 | **8** | 6 | **0** | **0/6** | 6/6 |
| `probe-out/badge-state.json`（5 个采样点 2/6/12/20/40 s） | rc.1 baseline | — | — | 6 | **0（全部采样）** | — | — |

**判别完美可分**：`projectRow` **100%** 带 `aria-expanded`；`sessionRow` **0%** 带 `aria-expanded`、
**100%**带 `aria-selected`。而**徽标只出现在 `projectRow` 上，`sessionRow` 上恒为 0**。

> **⇒ t8 的闸门结论：只有工作区行带徽标、会话子行不带** ⇒ **t2 §3.4 未被证伪**；
> 按 t2 推导修 DOM 层级遍历（§6 的 `groupSectionOf` + 后代查询）。**停止条件不成立。**

（旁证：`markedRows = 16 = 8 行 × 2`——行与徽标根**各自**带一份 `data-dsw-conn-id`，见行徽标层的
`ROW_STATUS_KEY` 单属性契约；统计"被标记的行"时别把这个 2 倍关系误读成 16 行。）

**使用的选择器（可原样复现）**：

| 用途 | 选择器 / 判定 |
|---|---|
| 被标记的行 | `[role="treeitem"][data-dsw-conn-id]` |
| **行类判别** | 带 `aria-expanded` ⇒ 工作区/分组行（`div.<hash>_projectRow`）；带 `aria-selected` 且**无** `aria-expanded` ⇒ 会话子行（`div.<hash>_sessionRow`） |
| 我方徽标根 | `span[data-dsw-badge]`（**无 class**） |
| **compact 变体** | `[data-dsw-badge][data-dsw-compact="1"]` |
| 状态标签 / 圆点 / 重试按钮 | `[data-dsw-label]` / `[data-dsw-dot]` / `[data-dsw-action="reconnect"]` |
| 遍历统计 | `document.querySelectorAll('[role="treeitem"]')` 逐条读 `className` / `aria-expanded` / `aria-selected` / `[data-dsw-badge]` 计数 |

**截图（`.tmp/verifier/r17/`）**：`probe-out/sidebar-dom.png`（rc.1 baseline，8 枚徽标在 projectRow 上）、
`probe-rc2b/sidebar-dom.png`（rc.2 原生）、`probe-rc2e/rc2-remote-status-decisive.png`（§10.7 的 t4 cell）、
`probe-rc2j/rc2-remote-status-local-control-v4.png`（§10.7 的本地对照）。

#### 10.8.2 证据可复现性声明（**这些行不是本轮构造的**）+ 命中路径形态 + 环境

**② 这些被标记的行是不是本轮由我构造的？——不是。** 它们是 `.dsh-lab` 的**历史累积状态**：
`scripts/dev-lab.ps1` 只设 `DSH_HOME` 并起 `dsh web`，**从不清理** lab HOME（我已核对脚本：无任何
`Remove-Item`/`rm` 针对 lab 状态）。本轮我**只读**这些状态，**没有**新建任何机器/工作区/会话去制造可观测对象，
**也没有**改产品代码或放宽任何断言。

> **可复现性限制（必须随结论一起引用）**：**一个全新的 lab HOME 里不会有任何被标记的行**——
> 行徽标层只在"工作区注册表的 path 含路由占位根"时才标记（见 §10.8 的 D3/索引说明），
> 全新 HOME 没有这类记录 ⇒ 整层 idle。因此
> **"某行带徽标"这一正向观测的可复现性受限于 lab 累积状态**，
> **本轮验收不得依赖它**；t8 若要做正向断言，须先按 §10.8 的三条出路之一**构造**状态。
> 反之，**A5 的结构性结论（会话子行不带徽标）不依赖具体工作区身份**——它只依赖
> `HoverCard` 包裹元素造成的 DOM 层级，对**任意**远程工作区都成立，因此在干净 lab 里构造出**一个**
> 远程工作区即可复现。

**③ 被标记行的数量与每条命中的路径形态**（只写**路径形态**；该文件不含凭据，未读取/未贴任何凭据内容）：

数量 = **8**（`div.projectRow`，全部 `data-dsw-conn-id="c1"`）；另有 **1** 个 `projectRow` **未**被标记（本地工作区 `r4-local-ws`）。
与 `<LAB>\storages\workspace.json` → `tables.workspaces` 的**9 条**记录**精确 1:1 对上**：

| # | workspace `title` | `path` 形态 | 是否被标记 |
|---|---|---|---|
| 1 | `uuz` | `<LAB>\dsh-ssh-routes\c1\home\uuz`（**旧拼写**） | ✅ |
| 2 | `uuz` | `<LAB>\dsw-routes\c1\home\uuz` | ✅ |
| 3 | `.ssh` | `<LAB>\dsw-routes\c1\home\uuz\.ssh` | ✅ |
| 4 | `r4-pick` | `<LAB>\dsw-routes\c1\home\uuz\r4-pick` | ✅ |
| 5 | `r4-verify` | `<LAB>\dsw-routes\c1\home\uuz\r4-verify` | ✅ |
| 6 | `r4c` | `<LAB>\dsw-routes\c1\home\uuz\r4c` | ✅ |
| 7 | `r4d` | `<LAB>\dsw-routes\c1\home\uuz\r4d` | ✅ |
| 8 | `ssh-test-lab` | `<LAB>\dsw-routes\c1\home\uuz\ssh-test-lab` | ✅ |
| 9 | `r4-local-ws` | （本地路径，无占位根） | ❌ **未标记** |

两条附带事实（都加强了结论）：
- 第 1 条的**旧拼写** `dsh-ssh-routes` 也被正确标记 ⇒ 行徽标层的 `routeIdOf` 正则
  `/(?:dsw-routes|dsh-ssh-routes)[\\/]([^\\/]+)/i` 对**两种拼写**都生效（与符号契约一致）；
- 这也解释了观测到的**两行同名 `uuz`**：它们分别来自两种拼写的两条记录，且两者的 connId 都是 `c1`
  （去重后唯一）⇒ 通过 C3 守卫、都进入索引 —— 即**同名不必然被丢弃**，丢弃只在"与本地同名"或
  "两个不同 connId 同名"时发生。

**环境（本轮全部 lab 观测）**：

| 项 | 值 |
|---|---|
| lab `DSH_HOME` | **`C:\Users\Admin\.dsh-lab`**（累积状态；另有 scratch 克隆 `%TEMP%\dsw-r17\r17home`、空 HOME `fixhome`/`fixhome2`） |
| 端口 | **50599**（固定；`dev-lab.ps1` 硬拒 3080） |
| 家族 | rc.2 宿主 = `@deepseek-ai/dsh@0.1.5-rc.2`（`rc2-cli` 树）；rc.1 = `0.1.5-rc.1`；baseline = 全局 `0.1.2-rc.1`（§9.3） |
| 插件树 | 默认 = 仓库 `node_modules`（`0.1.2-rc.1`，**混合**）；§10.3 对齐复测 = `0.1.5-rc.2`（§9.2） |
| 凭据 | **未读取/未记录任何凭据内容**；痕迹仅 `machines.json` 中 `privateKeyPath` 路径（无口令/passphrase，见 §9） |

#### 10.8.3 与 t9 UAT 的边界（**证据来源不同，不互相替代**）

| 面 | 来源 | 覆盖 | 不能替代什么 |
|---|---|---|---|
| **本报告 §10（t3）** | **自动化实测**：Playwright 驱动真实浏览器 + HTTP/DOM dump | rc.2 上的行徽标 DOM 注入、四槽可打开、t4 cell 的**存在与槽归属**（§10.7） | 不能替代人工验收路径的可用性判断 |
| `docs/uat/R17-rc2-official-slot-entry.md`（**t9**） | **人工验收脚本** | 人眼路径：本地会话零噪音、三态配色、zh⇄en 节点同一性、**徽标每行恰好一枚**、BUG-3 回归 | 不能替代自动化的 DOM/属性级取证（也没有 rc.2 宿主的自动断言） |

⇒ 两者**并列引用**，report 不合并、不互相背书。特别地：**"徽标每行恰好一枚"的 UAT 项**对应我这里的
`markedRows = 16 = 8 行 × 2`（行 + 徽标根各带一份 `data-dsw-conn-id`）——**人工计数时应按"行"数 8，不是 16**。

#### 10.8.4 【交叉引用证据】engineer-client 的闸门探针输出（**原样贴**）+ 一处**测量层级修正**

> **署名与责任（重要）**：**探针作者 = engineer-client**（利益相关方：结果决定它动手还是停手）；
> **执行与核验 = verifier**；**本小节的判定由 verifier 署名负责**，不是"贴一段脚本输出当独立判定"。
> 下表因此同时给出**我自己独立取的交叉证据**与**两者的偏差**。

engineer-client 给了只读闸门探针，请求把其 JSON 原样贴进本报告以作 t8 的交叉引用。下面是在
**rc.2 原生 + 当前工作树构建**上、`DSH_HOME=.dsh-lab`、端口 50599 跑出的**逐字输出**
（探针体未改，仅把 `console.log` 换成返回值；归档 `probe-rc2k/gate-probe.json`、
截图 `probe-rc2k/rc2-gate-probe.png`）：

```json
{
  "treeitems": 16,
  "markedTotal": 8,
  "markedOnGroupRow": 8,
  "markedOnSessionRow": 0,
  "groupCount": 10,
  "sessionRows": 6,
  "directChildSessionRows": 0,
  "descendantSessionRows": 0,
  "sessionParents": [
    "SPAN/no-role", "SPAN/no-role", "SPAN/no-role", "SPAN/no-role", "SPAN/no-role"
  ],
  "badgeSamples": [
    { "compact": "0", "buttonText": "重新检测", "connId": "c1" },
    { "compact": "0", "buttonText": "重新检测", "connId": "c1" },
    { "compact": "0", "buttonText": "重新检测", "connId": "c1" }
  ]
}
```

按探针自带判据读：`markedOnSessionRow === 0` 且 `markedOnGroupRow = 8` ⇒ **缺陷确认，按 §3.4 修**。

**⚠️ 测量层级修正（重要，否则会误读成"证据不足"）**：探针里的
`directChildSessionRows` 与 `descendantSessionRows` **在本 DOM 里都是 0**，**这不等于"没有证据"**——
它们测的是「**组行自己**的子/后代 treeitem」，而本 DOM 里会话行是组行的**兄弟**（不是子节点），
所以两者恒为 0 是结构决定的。徽标层实际读的层级是 **`row.parentElement.children`**，
因此正确的测量在**父元素层**。补充测量（归档 `probe-rc2k/wrapper-level.json`）：

| 指标（父元素层，即徽标层实际使用的层级） | 值 |
|---|---|
| `treeitems` | 16 |
| `markedGroup` / `markedSession` | **8** / **0** |
| **`maxTreeitemSiblingsInParent`**（任一行的 `parentElement.children` 里 `role=treeitem` 的兄弟数上限） | **0** |
| `rowsWithTreeitemSiblingInParent` | **0** |
| `groupRowsWhoseGrandparentHolds2PlusTreeitems` | **0** |

**逐行证据（每行都显示包裹层把关系切断）** —— 15/16 行的父元素是同一个签名：

```
group   badge=Y conn=c1  parent=span[no-role]._root_1b2ny_3  gp=div[no-role].bhn1Oq_groupSection   'ssh-test-lab'
group   badge=Y conn=c1  parent=span[no-role]._root_1b2ny_3  gp=div[no-role].bhn1Oq_groupSection   'r4d'
…（r4c / r4-verify / r4-local-ws(无徽标) 同签名）
session badge=n conn=-   parent=span[no-role]._root_1b2ny_3  gp=div[no-role].bhn1Oq_groupSection   '新会话'
session badge=n conn=-   parent=span[no-role]._root_1b2ny_3  gp=div[no-role].bhn1Oq_groupSection   'Generate session title'
session badge=n conn=-   parent=span[no-role]._root_1b2ny_3  gp=div[no-role].bhn1Oq_groupSection   'r4-local-ws15天'
session badge=n conn=-   parent=span[no-role]._root_1b2ny_3  gp=div[no-role].bhn1Oq_groupSection   'Hello15天'   （×3）
group   badge=Y conn=c1  parent=span[no-role]._root_1b2ny_3  gp=div[no-role].bhn1Oq_groupSection   'r4-pick' / '.ssh' / 'uuz' / 'uuz'
group   badge=n conn=-   parent=div[no-role].bhn1Oq_groupSection  gp=div[role=tree].bhn1Oq_list      '未分组'   ← 唯一未被包裹的行
```

三条结论（都对 t8 直接有用）：
1. **包裹层在每一行上都存在**：`row.parentElement` 恒为 `span[no-role]._root_1b2ny_3`（HoverCard 根），
   而**分组容器 `div.groupSection` 的直接子节点全是这种 span 包裹层**（无 `role`）
   ⇒ **不存在任何一个层级**让「组行 ↔ 会话子行」以 `role=treeitem` **兄弟**身份同屏
   ⇒ `row.parentElement.children` 的兄弟扫描**在任何路径上都匹配不到**（这正是 A5）。
2. **`未分组` 行是唯一未被包裹的**（`parent=div.groupSection`）——正是源码里
   `if (row.createdAt === void 0) return ownRow` 那条分支；即使对该行，`section.children` 里
   其余成员仍是 span 包裹层，故同样扫不到会话子行 ⇒ **两条分支都失效**。
3. `badgeSamples.compact` 全为 `"0"`（工作区行是 **non-compact** 变体）——这给了 t8 一个**可断言的
   before/after 对照**：修复后**会话子行**的徽标应为 `data-dsw-compact="1"`，而工作区行保持 `"0"`。

##### 10.8.4.1 交叉证据与**偏差**（按 captain 要求：不一致处以偏差为结论）

**我自己取的独立交叉证据**（不依赖该探针的代码路径）：
① 我自己的 `dom-probe.mjs`（逐条 dump `className`/`aria-*`/`parentTag`/`parentRole`/`chain`/`[data-dsw-badge]` 计数）；
② 我自己的 `wrapper-level-probe.mjs`（**父元素层**统计，即徽标层实际使用的层级）；
③ 截图 `probe-rc2k/rc2-gate-probe.png`；④ 原始 DOM 逐行表（下节代码块）。

| 指标 | engineer-client 探针 | 我的独立测量 | 一致？ |
|---|---|---|---|
| `treeitems` | 16 | 16（`wrapper-level.json`） | ✅ |
| 被标记的**组行**数 | 8 | 8 | ✅ |
| 被标记的**会话行**数 | **0** | **0** | ✅ |
| 会话行数 | 6 | 6 | ✅ |
| 父元素签名 | `sessionParents` 全 `SPAN/no-role` | 同（`parent=span[no-role]._root_1b2ny_3`） | ✅ |

**⚠️ 偏差一（测量层级）：探针的结构指标在本 DOM 里**无法**判定"包裹层隔断"**

| | 值 | 说明 |
|---|---|---|
| 探针 `directChildSessionRows` | **0** | 测「**组行自己**的子节点里 role=treeitem」 |
| 探针 `descendantSessionRows` | **0** | 测「组行的**后代**里 role=treeitem」 |
| 我的 `maxTreeitemSiblingsInParent` | **0** | 测「**`row.parentElement.children`** 里 role=treeitem 的兄弟」= **徽标层实际读的层级** |

**偏差的实质**：探针的读法要求 `direct === 0 且 descendant > 0` 才算"包裹层隔断的直接证据"；
但本 DOM 里会话行是组行的**兄弟而非子节点**，**两者恒为 0** ⇒ 按探针自己的读法会得出
**"结构证据缺失（0/0）"的错误印象**。真相是：`div.groupSection` 的直接子节点**全是
`span[no-role]` 包裹层**，所以**任何层级都不存在** `role=treeitem` 的兄弟关系。
**⇒ 以偏差为结论：结构判据必须落在 `row.parentElement` 层，不能落在组行的子/后代层；
t8 若照探针的 0/0 读，可能误判"缺陷不成立"。**（已把这条修正告知 engineer-client。）

**⚠️ 偏差二（分母不稳定）：lab 的会话行集合在多次运行间会变**

| 运行 | `sessionRow` 数 | 标题 |
|---|---|---|
| `probe-rc2b` | **1** | `新会话` |
| `probe-rc2c` | **6** | `新会话` / `uuz21分钟` / `NACE5 Version Check2天` / `Sna86t Setup2天` / `r2天` / `sn7tmb11天` |
| `probe-rc2k`（本轮探针） | **6** | 含 `新会话` / `Generate session title…` / `r4-local-ws15天` / `Hello15天`×3 |

**原因（如实归因）**：`probe-rc2s/rc2e` 等探针为了验证 `conversation.session.header.*` 会挂载，
**往 composer 发过消息**，因此**新建/重命名了会话** —— 即 **lab 的会话集合被本轮取证行为改写过**。
**⇒ 以偏差为结论**：`sessionRows` / `markedOnSessionRow` 的**分母不稳定**；
t8 的断言**不得假设固定会话数**，应按"**在某个远程组下新建并打开一个会话**"来构造断言对象。
（工作区行数（8）与组行数（10）在多次运行间稳定——它们来自 §10.8.2 的累积注册表，不随会话变化。）

**可复现选择器 / 属性**（行徽标层的 DOM 契约）：

| 目标 | 选择器 | 说明 |
|---|---|---|
| 被标记的行 | `[role="treeitem"][data-dsw-conn-id]` | 目前只有 `div.projectRow` 带（会话子行本应有、但 A5 缺陷使其没有） |
| 我方徽标根 | `span[data-dsw-badge]` | **无 class**（只设了内联样式），别按 class 找 |
| **compact 变体** | `[data-dsw-badge][data-dsw-compact="1"]` | ← **这条就是 t8 要的正向断言**（`COMPACT_KEY` → `data-dsw-compact`，compact 行写 `'1'`） |
| 状态标签 / 圆点 / 重试按钮 | `[data-dsw-label]` / `[data-dsw-dot]` / `[data-dsw-action="reconnect"]` | 语言切换重绘即改写这三处 |

**⚠️ 必须避开的假绿陷阱（对 e2e 设计是决定性的）**：上面全部"被标记的行"都来自 **`.dsh-lab` 的既有状态**
（多轮开发累积的 1 台机器 + 8 个 route 路径工作区 + 35 个远程会话）。而现有 e2e 夹具里
`machine` 只是**经真实设置表单加一台机器**、`session` 创建的是**本地会话** —— **两者都不构造远程工作区**。
⇒ 一条"断言某行有徽标"的 e2e 在**本机**会绿，在**干净的 lab HOME / CI** 上会**红**。

另：**只把一个路径含 `dsw-routes/<id>/` 的本地目录"播种"到盘上不够**——`remoteWorkspaceIndex`
是从**工作区注册表投影**（`workspaces()`）建 title→connId 的，被标记的前提是该 **workspace 条目**
的 path 含占位根、且其 **title** 与行标题相等（且不与本地同名标题冲突，见 C3 同名守卫）。
所以要么在夹具里**真的建**（设置表单加机器 → 经 `session.route` 建占位目录并落工作区），
要么**直接播种注册表**（落点见上表）。

> **是否依赖 D3（宽松字符串匹配）的判据 —— 按"路径是否落在 lab 路由根之下"判，不按路线判。**
> （此判据由 engineer-client **反向修正**，verifier 已回源码核验并采纳。）
> 两侧实现**不对称**：
> - **host 是根锚定**：`src/transport.ts` 的 `routeFromPlaceholder` 先做字符串预检，
>   再 `relative(root, resolve(value))`；只要得到 `''` / `..` 开头 / 绝对路径就 **`return null`**
>   （`transport.ts:100-108`）。根 = `resolve(DSH_HOME ?? ~/.dsh, 'dsw-routes')`
>   —— lab 里即 `<LAB>\dsw-routes`。
> - **client 是纯正则**：`row-badges.ts` 的 `routeIdOf` = `/(?:dsw-routes|dsh-ssh-routes)[\\/]([^\\/]+)/i`，
>   **不含根判断** ⇒ **只有客户端宽松**。
>
> 因此：**播种路径写在 `<labHome>/dsw-routes/<id>/…`（落在根下）⇒ host 与 client 都认
> ⇒ 语义忠实、不依赖 D3、无需标注**；只把路径写成"**字符串像**"（不在根下）⇒ 仅靠客户端的宽松匹配生效
> ⇒ **必须标注依赖 D3**。**路线 1 也不天然免疫**：`session.route` 产出的占位路径确实落在根下（不靠 D3），
> 但若夹具另造一条"只是字符串像"的路径，就又回到 D3。

**本条也反过来加固了我的证据**：§10.8.2 表里那 8 条命中路径**全部写在 `<LAB>\dsw-routes\…`
（或旧拼写 `<LAB>\dsh-ssh-routes\…`）之下** ⇒ 它们**同时满足 host 的根锚定语义**
⇒ **"8 行被标记"这一观测不依赖 D3 的宽松匹配**，是语义忠实的真实远程工作区。

**家族相关注意**：在 **rc.2** 上 `/dsw` 是 405（T3-F2），因此徽标的**状态文案**会停在 `未检测`。
所以正向断言只能断 **`[data-dsw-badge]` 的存在与 compact 属性**，**不要**断 `已连接` 之类的标签文本
（那会同时依赖 T3-F2 修好）。

## 11. 启动崩溃的**候选修法**（在仓库外的副本上验证，**未改产品代码**）

`%TEMP%\dsw-r17\fixcopy` = 仓库的副本（`lib/` + `package.json` + `cordis.patch.yml`；
`node_modules` 以 junction 指向仓库的，镜像真实 `link:` 安装形态）。做了两次实验：

| 实验 | 改动（`lib/web.js`） | rc.2 结果 |
|---|---|---|
| A | 顶部 `inject` 加 `'webServer'`（`lib/web.js` 第 22 行的快照） | **❌ 仍然崩**（同样 `without inject`）——**只加 inject 无效** |
| B | 把 `handle` 调用包进 `ctx.inject(['webServer'], webCtx => …)`（`lib/web.js` 第 504 行的快照） | **✅ 启动成功**（`lab-fix3.stdout.log`），且 baseline 上也不回归（§10.3 200） |

实验 B 的形式（≈ 与 `@deepseek-ai/dsh-client-connection@0.1.5-rc.2` 的 `lib/index.js` 里
它自己挂 `/api` 的写法对齐）：

```ts
// 在 webCtx（有 webServer 的上下文）里读 connection，使 owner.webServer 可解析
ctx.inject(['webServer'], (webCtx) => {
  const dispose = webCtx.connection.rpc.handle('/dsw', dispatch, { authority: 'loopback' })
  webCtx.effect(() => dispose, 'dsw: /dsw rpc channel')
})
```

**注意**：B 只解决 §10.1 的启动崩溃，**不解决 §10.3 的 405**。两处都需要真修，
且 A+B 是否可简化为单一改动（例如只保留 B）未做隔离验证。

## 12. 未验证 / 未通过清单（**不得读作通过**）

| # | 项 | 状态 | 原因 |
|---|---|---|---|
| 1 | **仓库原样构建在 rc.2 / rc.1 上启动** | ✅ **t3 后已修复并复测通过**（原为 ❌ 未通过） | t3 取证时为 §10.1 启动崩溃（**T3-F1**）；`src/web.ts` 修复后于 rc.2 上启动成功，见 **§10.7** |
| 1b | rc.1 上同样复测启动 | ⚠️ **未验证** | 修复后只在 **rc.2** 上复测过；rc.1 未复跑（同一修复形状，但**未取证**） |
| 2 | **rc.2 上 `/dsw` 通道可用** | ❌ **未通过 / 根因未定位** | §10.3 HTTP 405（**T3-F2**） |
| 3 | rc.2 上「已保存连接」远程目录浏览 | ❌ 未通过 | 同一 405（本机目录列出正常） |
| 4 | rc.2 上行徽标的**状态文案**与真实连接态一致 | ⚠️ **未验证** | 405 使 `conn.status` 取不到值（**T3-F5**）；baseline 上已验证一致（`已连接`） |
| 5 | rc.2 上「本机目录可列出」以外的 BUG-3 全路径 | ⚠️ 部分 | 本机列表已见（`C:\Users\Admin\…`），未走完选目录→建工作区的写路径 |
| 6 | 四个槽在 rc.2 上的**写操作**（保存机器、挂载副目录、选取目录后建工作区） | ⚠️ 未验证 | 依赖 §10.3 的 `/dsw`；本轮只验证「UI 可打开/存在」 |
| 7 | rc.2 上 `sidebar.panellist` / dockkit 的实际界面 | ⚠️ 未验证 | 本 profile 无占用者，元素计数为 0；未安装占用该槽的插件 |
| 8 | 行徽标在**分组视图会话子行**上的行为（A5 修复后） | ⚠️ 未验证 | A5 尚未修（**T3-F4** 交给 **t8**；修复前行为已由 §10.5.1 实测确认 = 无徽标） |
| 9 | 0.1.5 家族上「徽标→重连按钮」点击路径 | ⚠️ 未验证 | 依赖 `/dsw` |
| 10 | `dsh-web-frontend` 内联 primitives 与 `dsh-client-ui-primitives` 版本一一对应 | ⚠️ 未验证 | 第一部分 §7-5 已列；rc.2 侧只核到前端产物里的结构一致 |
| 11 | DOM/槽/cell 观测在**完全对齐的 rc.2 树**上复跑 | ⚠️ **未验证** | §10.4/§10.6/§10.7 是在**混合树**（宿主 rc.2 + 插件树 0.1.2-rc.1）上取的；按 §9.2 的论证客户端半不受影响，但**未做对齐复跑**（对齐复测只覆盖了 `/dsw`） |
| 12 | rc.2 上 `/dsw` 的 405 根因 | ⚠️ **未定位** | §10.3 已用「对齐树」排除"插件/宿主版本不一致"这一混淆变量，405 仍在；真正的路由匹配根因待查 |

## 13. 对下游（t4 / t5 / t6 / PR）的处置建议

> 引用统一用 §8.1 的**缺陷编号**：**T3-F1**（启动崩溃 blocker）、**T3-F2**（`/dsw` 405 blocker）、
> **T3-F3**（哨兵缺口 high）、**T3-F4**（会话子行徽标 medium → **t8**）、**T3-F5**（文案根因归属 medium）。

1. **本轮 PR 不应宣称"支持 0.1.5-rc.2"**（**T3-F1** + **T3-F2**）：现状是 rc.2 上**启动即崩**，rc.1 亦然；
   peer 里那条 `|| ^0.1.5-rc.1` 目前在运行时**不成立**（类型/单测层看不到）。
2. **两处必改**（都是宿主契约适配，不是新特性）：
   ① **T3-F1**：`/dsw` 通道挂载必须发生在有 `webServer` 的上下文（§11 实验 B 已验证可解除启动崩溃）；
   ② **T3-F2**：rc.2 上 `/dsw` 前缀路由 405 —— 需下一轮专门定位（先查 `dsh-host-webserver@0.1.5-rc.2`
   的路由匹配与 `dsh-client-connection@0.1.5-rc.2` 的注册是否真正生效）。
3. **T3-F3 —— 哨兵缺口要补**：`upstream.yml` 只跑 typecheck/单测/静态闸门，**不 boot 宿主**，
   所以"能编译"被当成了"能运行"。建议至少加一个 `dsh --profile web --dump-config` +
   **短时 boot 冒烟**（HTTP 200 + `/dsw/<某只读端点>` 200）到 next/legacy 两条通道。
4. **T3-F4**（会话子行徽标从未生效）与本轮 rc.2 适配是**两个独立问题**，交给 **t8**；
   修法见第一部分 §6；修复时请一并补按真实 DOM 形状（分组容器→HoverCard 包裹 span→行）的回归用例——
   当前单测的 fake 里行是容器的直接子节点，**结构上不可能**抓到它。
   注意 §10.5.1 的裁决：**A5 被实测证实，t8 的停止条件不成立，可以实施**。

---

## 附录 A：`extract-signatures.mjs`（§3.3 的取证脚本，原样可用）

放在任意目录，用 `node extract-signatures.mjs <path-to-lib-client.js>` 调用。它把打包产物里
`(0, react_jsx_runtime.jsx[s])("<tag>", { … })` 形式的 JSX 还原成「标签 + 顶层属性表」签名，
只做字符串感知的括号配平与空白归一，**不含任何语义猜测**；两版本输出逐行 diff 即得 §3.3 的结论。

> **复跑核验（本轮做过）**：把下面这段原样存成 `.mjs` 跑 rc.2 的 workspace bundle →
> **退出码 0、10 个元素**，`## element N … bundleOffset=…` 行与全部属性行**与 §3.3 所用的一模一样**；
> 唯一差异是脚本把 `children:` 打成原文前 90 字（§3.3 的版本打成 `starts with <tag>` 摘要）并省略文件头注释行，
> 属呈现差异，不影响结论。属性行 diff 结果：只差 §3.3 已记录的那一条 `ref=rowRef`。

```js
import { readFileSync } from 'node:fs'
const src = readFileSync(process.argv[2], 'utf8')
function balanced(s, open) {
  const close = { '(': ')', '{': '}', '[': ']' }[s[open]]
  let depth = 0, i = open, str = null, esc = false
  for (; i < s.length; i += 1) {
    const c = s[i]
    if (str !== null) { if (esc) { esc = false; continue } if (c === '\\') { esc = true; continue } if (c === str) str = null; continue }
    if (c === '"' || c === "'" || c === '`') { str = c; continue }
    if (c === '(' || c === '{' || c === '[') depth += 1
    else if (c === ')' || c === '}' || c === ']') { depth -= 1; if (depth === 0) return s.slice(open, i + 1) }
  }
  return s.slice(open)
}
function topLevelParts(body) {
  const parts = []; let depth = 0, str = null, esc = false, cur = ''
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i]; cur += c
    if (str !== null) { if (esc) { esc = false; continue } if (c === '\\') { esc = true; continue } if (c === str) str = null; continue }
    if (c === '"' || c === "'" || c === '`') { str = c; continue }
    if (c === '(' || c === '{' || c === '[') depth += 1
    else if (c === ')' || c === '}' || c === ']') depth -= 1
    else if (c === ',' && depth === 0) { parts.push(cur.slice(0, -1)); cur = '' }
  }
  if (cur.trim() !== '') parts.push(cur)
  return parts
}
const norm = v => v.replace(/\s+/g, ' ').replace(/[A-Za-z0-9_$]*_module_css_default\./g, '').trim()
const CALL = /\(0, react_jsx_runtime\.jsxs?\)\(/g
const calls = []; let m
while ((m = CALL.exec(src)) !== null) calls.push({ at: m.index, paren: CALL.lastIndex - 1 })
let n = 0
for (const call of calls) {
  const inner = balanced(src, call.paren).slice(1, -1).trim()
  const tagMatch = /^"([^"]+)"\s*,/.exec(inner)
  if (tagMatch === null) continue
  const afterTag = inner.slice(tagMatch[0].length).trim()
  if (!afterTag.startsWith('{')) continue
  const body = balanced(afterTag, 0).slice(1, -1)
  if (!/role:\s*"tree(?:item)?"/.test(body)) continue
  n += 1
  console.log(`\n## element ${n}  tag=<${tagMatch[1]}>  role="${/role:\s*"(tree|treeitem)"/.exec(body)[1]}"  bundleOffset=${call.at}`)
  for (const part of topLevelParts(body)) {
    const k = /^\s*([A-Za-z_$][\w$]*|"aria-[a-z-]+")\s*:/.exec(part)
    if (k === null) { console.log('   (spread)'); continue }
    console.log(`   ${k[1].replace(/"/g, '')}=${norm(part.slice(k[0].length)).slice(0, 90)}`)
  }
}
```

## 附录 B：本轮证据产物清单（**已归档到 `.tmp/verifier/r17/`**，不入库）

> 临时文件按 captain 指令归入 `.tmp/verifier/`（`.tmp/` 已被 `.gitignore` 覆盖）。
> 归档目录：`.tmp/verifier/r17/`；下表的“路径”均相对该目录。

### B.1 t2 静态判定

| 路径（`$env:TEMP\dsw-r17\` ；已归档到 `.tmp/verifier/r17/` 同名文件） | 内容 |
|---|---|
| `rc1-pkgs\`、`rc2-pkgs\` | `npm pack` 产物：41（rc.1）+ 42（rc.2，含 `dsh-client-ui-dockkit`）+ `dsh-web-frontend@0.1.5-rc.2` |
| `x-all-rc1\`、`x-all-rc2\` | 解包后的 41 + 41 个客户端包树（§3.1 / §3.2 的输入） |
| `x-0.1.5-rc.1\`、`x-0.1.5-rc.2\` | 4 + 5 个先期解包的包（§3.1 逐字节定位用） |
| `x-0.1.2-rc.1\dsh-client-ui-primitives\` | 基线 primitives 包源码（§3.4 左侧） |
| `x-frontend-rc2\`、`dockkit-rc2\` | rc.2 前端产物（`index-BKQ_L1z6.js`）与 dockkit 包（§3.2 / §3.4） |
| `sig-baseline.txt`、`sig-rc2.txt` | §3.3 的两个签名清单（10 + 10 元素） |
| `sig-baseline-appendix.txt`、`sig-rc2-appendix.txt`、`appendix-a.mjs` | 附录 A 脚本及其复跑输出 |
| `extract-signatures.mjs` | §3.3 实际使用的脚本（打印 `children` 摘要行） |
| `baseline-markup.txt`、`win-baseline.txt`、`win-rc2.txt` | 早期（废弃）取证——归一窗口法，因窗口边界错位不可靠，**不构成结论依据** |
| `conn-rc1\` | `dsh-client-connection@0.1.5-rc.1` 解包（§1/§3.2 的版本比对） |

### B.2 t3 浏览器实测

| 路径（`$env:TEMP\dsw-r17\` ；已归档到 `.tmp/verifier/r17/`） | 内容 |
|---|---|
| `lab-control2.stdout.log` | 0.1.2-rc.1 + 原样 `lib/` **启动成功**（URL + token） |
| `lab-rc1.stderr.log`、`lab-rc2.stderr.log` | **0.1.5-rc.1 / rc.2 启动崩溃**原始栈（§10.1） |
| `lab-fix3.stdout.log` / `stderr.log` | 补丁副本在 **rc.2** 上启动成功（§11 实验 B） |
| `lab-base-patched.stdout.log` | 补丁副本在 **baseline** 上启动成功（§10.3 判别实验的一半） |
| `fixcopy\` | 补丁副本（`lib/` + `package.json` + `cordis.patch.yml` + 指向仓库 `node_modules` 的 junction） |
| `fixhome\`、`r17home\` | 两份 scratch DSH_HOME（空 home / `.dsh-lab` 状态克隆） |
| `probe\dom-probe.mjs` | 侧边栏真实 DOM dump + 徽标 census（§10.4） |
| `probe\badge-state-probe.mjs` | 徽标状态 2/6/12/20/40 s 收敛采样 + 页内 RPC（§10.4） |
| `probe\slots-probe.mjs` | 四个槽 + `data-slot` census + rc.2 新布局面（§10.6） |
| `probe\rpc-probe.mjs` | `/dsw` 通道 HTTP 探针（§10.3 的 200/405 判别） |
| `probe-out\` | baseline lab 的 DOM dump + `badge-state.json`（8 枚徽标、`已连接` 收敛） |
| `probe-rc2b\` | **rc.2 lab** 的 DOM dump、`slots-probe.json`、4 张截图（`rc2-settings-section.png`、`rc2-header-workspace-action.png`、`rc2-directory-flow.png`、`rc2-hero.png`） |
| `dump-config-rc1.txt`、`dump-config-rc2.txt` | 两家族 `--dump-config`（各 564 行，`ssh-remote`/`directory-picker-ssh`/`ssh-web-channel` 三行在册） |

**工作区改动**：本报告 `docs/rounds/R17-rc2-badge-verification.md`（verifier 在本轮的**唯一**交付物）。
`src/**`、`test/**`、`package.json`、`.dsh-lab/**`、`C:\Users\Admin\.dsh\profiles\**` 均未触碰；
产品 profile 取证前后 mtime 均为 `2026-09-09 14:07:45`；实验期间误建的 `C:\Users\Admin\profiles`
（由 PowerShell 只读变量 `$home` 撞名导致，8.9 秒后即删除）已清理并记录。
临时产物按 captain 指令归档到 `.tmp/verifier/r17/`（`.tmp/` 已被 `.gitignore` 覆盖，不入库）。

## 附录 C：符号 ↔ 行号快照（**一次性，不是契约**）

`AGENTS.md` §5.7：行号不是契约。本报告正文一律按符号引用；下表只为**追溯**保留一份行号快照，锚定
`src/client/row-badges.ts` @ blob `75fb30f90a7e476c3c1555b5ab15aa02838e7708`（703 行）。
**该文件已发生 `routeIdOf` 搬移，行号会位移——请以符号为准；本表在文件再次演进后即作废。**

| 符号 / 行为 | 快照行号（blob `75fb30f`） |
|---|---|
| `rowTitleOf` 定义 | :313-322 |
| `markRow` → `row.appendChild(badge)` | :512 |
| `markRowStatus` / `rowStatusOf` / `ROW_STATUS_KEY` | :56、:68-85 |
| `BADGE_MARK_KEY` / `BADGE_MARK_SELECTOR` | :287-288 |
| `scan()` 的 `[role="tree"]` 查询 | :577 |
| `scan()` 的分组判别 + 兄弟扫描 | :579-580、:588-595 |
| `scan()` 的平铺分支 | :597-606 |
| `scan()` 的 `isConnected` 剪枝 | :569-574 |
| `withdrawStale()` 定义 / 分组判别 / 分组子行兄弟查找 | :526-563、:538、:546-553 |
| `markedRowStillQualifies` | :269-275 |
| `remoteWorkspaceIndex` / `remoteSessionIndex` | :199 / :233 |
| `installRowBadges` 的 dispose 路径 | :688-702 |

`src/web.ts` 侧的同类快照（F1/F2 相关，同样以符号为准）：
`apply()` 末尾的 `ctx.connection.rpc.handle('/dsw', …)` = `lib/web.js` :504；顶部导出的 `inject` = `lib/web.js` :22。
