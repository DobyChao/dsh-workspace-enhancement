# UAT 脚本 — R17 官方槽位入口（header 工具区「远程状态」）

> 本文件是 [TEMPLATE.md](./TEMPLATE.md) 的真实填写；流程与 lab 用法见 [README.md](./README.md)。
> **本轮为多轨道交付**：t4 = 官方槽 `conversation.session.header.utilities` 上的远程状态 cell（本文主体），
> t2/t3 = 侧边栏行徽标在 rc.2 上的存活验证（本文第 6 组做回归复核），
> t6 = 文档轨道（`docs/backlog.md` / `docs/compatibility.md`，不改变用户可见行为）。
> 槽位契约与决策依据见 [../decisions/ADR-0017-rc2-client-slot-recon.md](../decisions/ADR-0017-rc2-client-slot-recon.md)。

## 0. 基本信息

| 项 | 值 |
|---|---|
| 轮次 / 主题 | R17 — rc.2 官方槽位落地：会话 header 工具区的「远程状态」入口 + 行徽标/目录回归 |
| 验收对象 | 远程会话的 header 是否出现官方槽内的「远程状态」cell（本地会话零噪音），语言切换即时跟随，且行徽标与「本机目录」无回归 |
| 需求 / 缺陷 ID | REQ-I1 前置侦察（ADR-0017）派生的最小官方槽入口；回归涉及 BUG-3（本机目录）与 R6（i18n） |
| 脚本作者 / 日期 | researcher（scout-slots）/ 2026-09-10 |
| 预期耗时 | 20–30 分钟（含一次语言来回切换；lab 已有远程会话，无需新建机器） |

## 1. 前置条件

| 项 | 值 |
|---|---|
| 版本 | `0.1.3`（`package.json`） |
| 分支 | `master`（本轮改动**尚未提交**，落在工作树；打分支/提交由收口完成） |
| commit | `96c7ae9` **+ 未提交的 R17 改动**（`src/client/{index.ts,row-badges.ts,remote-status.ts,remote-status-entry.tsx,route-id.ts}`、`src/locale/dsw{,.en}.ts`、`test/remote-status.test.ts`、`AGENTS.md`、`package.json`；验收时以 `git status --short` 现场值为准） |
| 构建产物 | `lib/` **已重建**：`lib/client.js` 写于 2026-09-11 00:54:03，晚于最新 `src/` 改动（`src/client/index.ts` 00:53:23）⇒ 不是 `INFRA-11` 那种过期 build |
| lab 地址 | `http://127.0.0.1:50599/`（`scripts/dev-lab.ps1`） |
| 启动命令 | `pwsh -File scripts/dev-lab.ps1`（`lib/` 已新，可加 `-SkipBuild`） |
| 浏览器与视口 | **推荐** Chromium / 1440×900；验收时按实际使用的填写（本项目 R6 轮的记录方式：视口未记录则现场补） |
| 主题 | **推荐** 浅色；同一个 cell 在深色下也应可读（本轮样式只用主题 token） |
| 语言 | 起始 `中文`，第 5 组切到 `English` 再切回 |
| 缩放 | **推荐** 100%；若用其它值请在第 4 节记录 |
| 其他前置 | lab（`DSH_HOME=C:\Users\Admin\.dsh-lab`）**已满足**：① `remote-workspaces/machines.json` 存在，注册表里有机器 id **`c1`**；② 路由占位树 `dsw-routes\c1\home\uuz\…`（8 项，另有旧命名 `dsh-ssh-routes\c1\…`）⇒ **已有远程会话可直接打开**；③ 本地工作区 `e2e\r4-local-ws` 可用于第 4 组的本地会话对照。**无需新建机器、无需真实凭据** |

**禁止**：在 3080（真实实例）上执行本脚本；修改产品 profile；使用真实凭据。
第 5 组切语言会写 lab 自己的 `settings.yaml`（隔离目录内），**不涉及产品 profile**。

## 2. 步骤

### 第 1 组 — 启动与环境自检

| # | 操作 | 期望 | 观察点 | 结果 |
|---|---|---|---|---|
| 1 | `pwsh -File scripts/dev-lab.ps1`，打开 `http://127.0.0.1:50599/` | 实例就绪、插件已注入 | HTTP 200；页面引用本插件的 `client.js`；`POST /api/dsw/conn.status` 返回 `ok:true` | ☐ 通过 ☐ 不通过 |

### 第 2 组 — 正向：官方槽 cell 在远程会话出现

| # | 操作 | 期望 | 观察点 | 结果 |
|---|---|---|---|---|
| 2 | 在左侧栏打开一个**远程**会话（工作区路径形如 `…\.dsh-lab\dsw-routes\c1\home\uuz\…`；路线归属机器 `c1`） | 会话打开；header 工具区出现「远程状态」cell | cell 文本三选一：`未检测` / `已连接` / `离线`（`status.unknown` / `status.active` / `status.offline`）；其左侧有 🌐 与一枚 8×8 圆点 | ☐ 通过 ☐ 不通过 |
| 3 | 取该 cell 的 DOM 证据（DevTools Console） | 槽位与连接 id 都正确 | `document.querySelectorAll('[data-dsw-remote-status]').length === 1`；该元素的 `getAttribute('data-dsw-remote-status')` === **`c1`**；`disabled` 属性在非检测态为 `false` | ☐ 通过 ☐ 不通过 |
| 4 | 鼠标悬停该 cell | tooltip 用**当前语言**给出机器与动作 | 中文标题含 `当前会话的远程连接：` 与机器名，并以 `（点击重新检测）` 结尾（`header.remote.title`，参数 `{machine}`） | ☐ 通过 ☐ 不通过 |
| 5 | 点击该 cell | 触发一次重检；期间不可重复点 | 点击后文本短暂变为 `检测中…`（`status.checking`）且 `disabled=true`；结束后恢复为三态之一；RPC 观察 `POST /api/dsw/conn.status` 有请求 | ☐ 通过 ☐ 不通过 |

### 第 3 组 — 状态与颜色对应（三态自洽）

| # | 操作 | 期望 | 观察点 | 结果 |
|---|---|---|---|---|
| 6 | 在**不可达**机器上验证 `离线` 态（lab 的 `c1` 是占位主机，通常不可达；若 `c1` 恰好可达则用「停掉其可达性 / 换成另一台已知不可达的占位机器」造出该态） | 离线时点色与文案一致 | 文案 `离线`；圆点 `background-color` = `rgb(224, 108, 117)`（`#e06c75`）；cell **可点**（用于重连） | ☐ 通过 ☐ 不通过 |
| 7 | 若可造出 `已连接` 态 | 已连接时点色与文案一致 | 文案 `已连接`；圆点 `background-color` = `rgb(152, 195, 121)`（`#98c379`） | ☐ 通过 ☐ 不通过 |
| 8 | 刷新会话后再看 | 未检测态可复现 | 文案 `未检测` 时圆点 = `rgb(138, 143, 152)`（`#8a8f98`） | ☐ 通过 ☐ 不通过 |

> 第 3 组允许「当前 lab 环境下无法造出某态」——**如实勾不通过并在第 5 节写明原因**，不要凭猜测打勾。

### 第 4 组 — **负向**：本地会话零噪音

| # | 操作 | 期望 | 观察点 | 结果 |
|---|---|---|---|---|
| 9 | 打开一个**本地**会话（工作区路径为宿主路径，例 `…\.dsh-lab\e2e\r4-local-ws`） | header 工具区**不出现**我们的 cell | `document.querySelectorAll('[data-dsw-remote-status]').length === 0`；header 右对齐区只剩上游自身的条目（例官方 `在应用中打开`） | ☐ 通过 ☐ 不通过 |
| 10 | 在本地会话与远程会话之间来回切换会话 | 出现/消失**即时**且不报错 | 切到远程 → count 变 1；切回本地 → count 变 0；Console 无 React 报错、无 `Cannot read properties` | ☐ 通过 ☐ 不通过 |

> 第 4 组是本轮**最重要的负向验证**：该入口的存在性由会话 cwd 决定（`remoteConnectionIdOf(cwd)`），本地会话必须**一点噪音都不加**。

### 第 5 组 — 语言切换（zh ⇄ en）

| # | 操作 | 期望 | 观察点 | 结果 |
|---|---|---|---|---|
| 11 | 设置页 → **General** → `语言` 行（官方 locale 行，`settings.locale` 命名空间的 `language.title`）→ 切到 **English** | header cell 文案**即时**跟随，无需刷新、无需重开面板 | cell 文本由 `离线` 变 `offline`（或 `未检测`→`not detected` / `已连接`→`connected`）；`aria-label` 变 `Remote status` | ☐ 通过 ☐ 不通过 |
| 12 | 仍在 English 下悬停 cell | tooltip 也跟随 | 英文标题形如 `Remote connection of this session: c1 (click to re-check)`（机器名取 `conn.status` 的 `label`；lab 里为注册表 id `c1`，故与 `{machine}` 同值） | ☐ 通过 ☐ 不通过 |
| 13 | 切回 `中文` | 文案回到中文 | cell 文本回到 `离线` / `未检测` / `已连接` 之一；`aria-label` 回 `远程状态` | ☐ 通过 ☐ 不通过 |
| 14 | 切语言前后对比 cell 节点 | 语言切换**就地更新**，不重建节点 | 切换前在 Console 执行 `window.__uatCell = document.querySelector('[data-dsw-remote-status]')`，切语言后再比较 `window.__uatCell === document.querySelector('[data-dsw-remote-status]')` → **`true`** | ☐ 通过 ☐ 不通过 |

### 第 6 组 — 回归：侧边栏行徽标（`routeIdOf` 已纯搬迁）

| # | 操作 | 期望 | 观察点 | 结果 |
|---|---|---|---|---|
| 15 | 看左侧栏的工作区/会话行 | 行徽标仍注入 | `document.querySelectorAll('[data-dsw-badge]').length` **> 0**；可见文本为 `已连接`/`离线`/`未检测` 之一 | ☐ 通过 ☐ 不通过 |
| 16 | 展开/收起远程工作区分组、再展开 | 徽标不重复、不叠加 | 每个远程行**恰好一枚**徽标（数一下可见行数与徽标数一致）；重复展开后数量不增长 | ☐ 通过 ☐ 不通过 |
| 17 | 在徽标存在时切换一次语言（zh→en→zh） | 徽标文本就地重绘 | 徽标文本随语言变化；第 14 组的「节点同一性」检查对徽标同样成立（切语言不重建 DOM） | ☐ 通过 ☐ 不通过 |

> 本组是 `routeIdOf` 从 `src/client/row-badges.ts` 纯搬迁到 `src/client/route-id.ts` 的运行时回归面：单元测试已覆盖，此处只确认 lab 里仍可见。

### 第 7 组 — 回归：目录选择器「本机目录」（BUG-3）

| # | 操作 | 期望 | 观察点 | 结果 |
|---|---|---|---|---|
| 18 | 打开「添加工作区」流程 | 流程正常打开 | 标题 `选择工作区目录`；左侧有 `本机目录` 条目（`flow.sidebar.local.title`） | ☐ 通过 ☐ 不通过 |
| 19 | 选 `本机目录` → 浏览到任一存在目录（例 lab 根目录） | 能列出本机目录（BUG-3 修复后应可用） | 列出真实目录项；**不出现** `无法读取目录`，也**不出现** `目录服务不可用（uiWorkspace 未挂载）`（`flow.error.directoryUnavailable`） | ☐ 通过 ☐ 不通过 |
| 20 | 会话 header 的「⊕ 工作区」动作（`conversation.session.header.actions`） | 入口仍在且可用 | 该按钮存在、可点开侧工作区面板 | ☐ 通过 ☐ 不通过 |

## 3. 判定

| 项 | 值 |
|---|---|
| 结论 | ☐ 通过 ☐ 不通过 |
| 通过项 / 总项 | `___/20`（第 3 组第 7 项允许「当前环境无法造出该态」并如实标注） |
| 证据链接 | `$LAB_HOME\e2e\`：`r17-01-remote-cell-zh.png`、`r17-02-remote-cell-dom.txt`、`r17-03-local-session-zero-noise.png`、`r17-04-cell-en.png`、`r17-05-badges.png`、`r17-06-local-directory.png`、`r17-e2e.log`（命名规则见 [README.md](./README.md) §3；**只写相对/占位路径**） |
| 未通过项 | 指向 [FEEDBACK.md](./FEEDBACK.md) 条目（本轮暂无） |
| 是否阻塞发布 | ☐ 是 ☐ 否 |
| 用户签字 | ______________ / ______________ |

## 4. 环境指纹

| 项 | 值 |
|---|---|
| 实例 / 端口 | lab / **50599**（隔离 `DSH_HOME`；**不是** 3080） |
| 插件版本 | `0.1.3` |
| commit | `96c7ae9` + 未提交 R17 改动（现场取 `git rev-parse --short HEAD`） |
| 宿主 OS / 版本 | Windows（本机；具体版本按现场 `winver` 记录） |
| 远端（如涉及） | 占位主机，机器 id **`c1`**（文档与证据中一律用占位主机名/回环地址，不写真实主机与用户名） |
| 浏览器 / 视口 / 缩放 | 现场记录（推荐 Chromium / 1440×900 / 100%） |
| 主题 / 语言 | 现场记录（推荐 浅色；中文 ⇄ English 各测一轮） |
| 相关机器 id | `c1`（lab 注册表内；旧命名路由树 `dsh-ssh-routes\c1\…` 亦存在） |

## 5. 备注

- **已知限制（如实说明）**：lab 里**已有**远程会话（`dsw-routes\c1\…`），所以本轮不需要新建机器；若某些 UI 需要「在线」的远端才能造的态（第 3 组第 7 项 `已连接`），在本机没有真实远端时**可能无法复现** —— 这时按上一节的规则勾「不通过」并在此写明原因与复现命令，**不要**把未复现写成通过。
- **本轮实测边界**：本文是**人工验收脚本**；lab 的**浏览器自动化**实测属同轮 t3 任务，其结论写在 `docs/rounds/R17-rc2-badge-verification.md` 第二部分。两者证据来源不同，不要互相替代。
- ✅ **本轮验收目标家族 = `0.1.5` 线**（2026-09-11 起；0.1.2 家族已按所有者决定退场，见 `UPSTREAM-4`）。
  **F1/F2 均已修**（通道改挂官方 `/api` 的精确 Fetch 路由，`ADR-0018`），真机实证 `POST /api/dsw/connections.list → 200, result.ok=true`：
  本脚本第 2/3/5 组能看到真实状态（不再是停在 `未检测`），第 7 组「已保存连接」段可正常读取。
  若第 2/3/5 组仍停在 `未检测`，先按下面第 4 节的取证命令确认通道本身是 200，再当作**新缺陷**记录（而不是环境噪声）。详见 `docs/backlog.md` 的 `UPSTREAM-3` 与 [R19-f2-shared-api-channel.md](../rounds/R19-f2-shared-api-channel.md)。
- **证据来源分层（引用本脚本结论时必须带上）**：t4 特性的可见性 = **目录契约级**（`conversation.session.header.utilities` 在两家族都有、契约逐字节相同）+ **`0.1.2-rc.1` 运行时**；**不得**写成「另一个家族上也已验证可见」（我们只支持 0.1.5 一条线）。
- **静态前置已证**：`ADR-0017` 已逐字节证明该槽在两家族都存在且契约相同（`kind: list` / `scope: session` / `replaceRisk: none`），rc.2 仅多一个 occupant（`open-in-app`）⇒ 本入口在**线上 0.1.2-rc.1 家族**同样可见。可任取一份 runner bundle 复核（两个快照的实际路径见 [ADR-0017 §1.2](../decisions/ADR-0017-rc2-client-slot-recon.md)）：

  ```powershell
  # bundle 与你手上的那份保持一致；不同快照的行号不可互换（ADR-0017 §1.1）
  npm run slots -- --key conversation.session.header.utilities "$env:APPDATA\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-cordis-client-runner\lib\client.js"
  ```
- **技术债（不阻塞本轮）**：`showsRemoteStatus`（`src/client/remote-status.ts`）在生产中无调用者，实际渲染判定在 `remote-status-entry.tsx` 的 `if (connId === undefined) return null`，该分支沙箱内跑不到 —— 已登记为 `AUDIT-4`（见 `docs/backlog.md`）。
- 验收后请清理 lab 状态（注册表 / 路由占位树 / 临时文件），并确认 50599 已停止。

来源：`docs/uat/README.md`、[TEMPLATE.md](./TEMPLATE.md)；`scripts/dev-lab.ps1`；`ADR-0017`；`docs/rounds/R17-rc2-badge-verification.md`；`src/client/remote-status.ts`、`remote-status-entry.tsx`、`status.tsx`、`src/locale/dsw{,.en}.ts` 的键值；lab 只读实测（`C:\Users\Admin\.dsh-lab` 的目录/文件名清单，未读取任何凭据内容）
