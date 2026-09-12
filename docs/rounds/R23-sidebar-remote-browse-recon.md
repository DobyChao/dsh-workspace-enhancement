# R23 — 侦察：远程工作区会话下「侧边栏浏览远程文件」的接入面

日期：2026-09-12 · 只读侦察，未改产品代码、未跑构建/测试、未做 git 操作。

**磁盘权威源说明（重要）**：任务指定的 `C:/Users/Admin/.dsh-lab/rc2-cli/node_modules/@deepseek-ai/dsh-cordis-client-runner/lib/client.js`
在本机已损坏（SHA256 `DA37574B…`，正文为乱码/加密残片，`Select-String` 全文匹配失败）。
本报告全部行号锚定到等价的、可读的 **0.1.5-rc.2** 快照：

```
C:/Users/Admin/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/
  dsh-cordis-client-runner/lib/client.js   (SHA256 E78C94D6…, 262,524 bytes)
```

生成产物文件头 `do not edit by hand`；以下 `(line N)` 只对本 bundle 有效，跨快照不可互换。
（红线遵守：全程未调用 cordis_inspect_list / cordis_inspect_query。）

---

## §1 0.1.5-rc.2 侧边栏槽位地图

| 槽位 | kind / scope | occupants（rc.2 实测） | replaceRisk | 来源 bundle |
|---|---|---|---|---|
| `sidebar` | single / root | client-ui-sidebar（声明方） | — | 同上 client.js (line 3993) |
| `sidebar.workspaces` | single / root | `client-ui-workspace WorkspaceBrowser` | shadows-shipped-ui | (line 4411) |
| `sidebar.workspaces.directoryFlow` | single / root | `client-ui-directory-picker-browse BrowseDirectoryFlow`、`client-ui-directory-picker-native NativeDirectoryFlow` | shadows-shipped-ui | (line 4437) |
| `sidebar.panellist` | **list** / root | （空，`replaceRisk: none`） | **none** | (line 4116) |
| `sidebar.panellist` 语义 | — | 「每个 list id 对应一个 main 面板；侧边栏拥有按钮并从 list 元数据取 label」 | — | doc (line 4116) |
| `main` | keyed / root | `client-ui-conversation ConversationPanel key 'conversation'`；**其余 key 全开放** | 撞 `conversation` 才 shadows | (line 3372) |
| `rightbar` | single / root | `client-ui-sidebar-right RightbarRoot` | shadows-shipped-ui | (line 3435) |
| `rightbar.session` | single / session | client-ui-sidebar-right（声明方） | — | (line 3461) |
| `sidebar.right.pane.tab` | keyed / session | `client-ui-sidebar-documentpreview TextPreview`、**`client-ui-sidebar-files FilesBody`**、`client-ui-sidebar-right GuideBody`；key 域 open（无编译期集合） | none | (line 4161) |
| `sidebar.right.pane.tab.title` | keyed / session | 同上体系的 chip 标题座 | none | (line 4204) |
| `sidebar.right.tab.document` | keyed / session | documentpreview 的 Code/Html/Image/Markdown/Pdf/TextBody ×6 | none | (line 4247) |
| `sidebar.right.tab.guide` | chain / session | client-ui-sidebar-right GuideBody | — | (line 4293) |
| `sidebar.right.tab.menu.item` | list / session | （追加到某个 tab 的动作菜单尾） | none | (line 4332) |
| `conversation.session.header.actions` | list / session | agent-preset、job-list、schedule-catalog、agent-team（id 均已占；新 id 追加） | none | (line 3102) |
| `conversation.hero.workspace.directoryFlow` | single / root | 与本插件现有接管相关的目录流洞（声明于 WorkspacePicker） | shadows-shipped-ui | (line 2646) |

要点：
- **`sidebar.panellist` 是 rc.2 官方留好的第三方全局面板入口**：fresh id 追加新按钮 + 一个 `main` 面板（key 同 id），owner 明文写着「reusing a shipped id puts you in THAT cell and replaces it」——用新 id 则 replaceRisk = none。
- **rc.2 右侧面板 Tab 体系（`sidebar.right.pane.tab`）已经是成熟的第三方内容挂载面**：`replaceRisk: none`，key 域 open，官方 occupant 自己（sidebar-files）就是第三方形态的样板。
- 本插件已接管的两个 directoryFlow 槽位在 rc.2 依旧存在且契约未变（`sidebar.workspaces.directoryFlow` (line 4437)、`conversation.hero.workspace.directoryFlow` (line 2646)），OwnerProps（open/busy/onPicked/onCancel/onError）与本插件 flow 的 pickOnly/suppressSessionRoute 兼容。

## §2 数据面分工

- **`workspaces` 服务**（Client face，client.js line 1538）：5 个方法——create/rename/delete/archiveSession/insertSessionBefore。**纯注册表管理，没有任何目录列举能力**。list feed（WorkspaceSnapshot）只供 `useWorkspaces` 快照钩子渲染工作区/会话树。
- **`uiWorkspace` 服务**（client.js line 1447）：9 个方法，含 `listDirectory(path?, signal?)`、`createDirectory`、`pickDirectory`。**目录列举挂在 uiWorkspace，不在 workspaces**——再次印证 BUG-3 教训。
- **新发现（rc.2 增量）**：`dsh-client-ui-sidebar-files`（0.1.5-rc.2 新包）是右侧面板的官方文件树 tab：
  - 根 = **当前 Session 的 cwd**（`useSessions().byId[sessionId].cwd`），数据走 **`remote.workspaceFiles.list(sessionId, absolutePath)`**（`@deepseek-ai/dsh-api-workspace-files` 通道，非 uiWorkspace、非 `/api/dsw/*`）。
  - Remote binding 已内建 → **远程工作区下官方 Files tab 本身就能工作**；但 Host 拒绝 workspace root 之外的路径，且单根、无搜索/无新建/无重命名。
  - 它不占 `sidebar.right.tab.document`，文件点击走 `dsh-resource://file/session/...` 地址由 documentpreview 系 viewer 认领。
- 结论：本插件的远程浏览内核（`listRemoteLevel` maxEntries 1000 + `/api/dsw/browse.list|browse.home|browse.mkdir`）与官方两条数据面（uiWorkspace.listDirectory、workspaceFiles.list）**互不重叠、可并存**；官方面是「workspace root 内」，本插件面是「整台机器 + mkdir」。

## §3 dsh-better-sidecar 摸底

- **本地副本**：`C:/Users/Admin/.dsh-lab/profiles/web/node_modules/`、`C:/Users/Admin/AppData/Roaming/npm/node_modules/`、本仓库 node_modules 均**未安装**（`@bitkyc08/` 下只有 opencodex，无关）。
- **npm registry**：`dsh-better-sidecar` 拼写 **404 不存在**；正确拼写为 **`dsh-better-sidebar`**（registry.npmjs.org/dsh-better-sidebar，200）。
  - latest **0.19.1**（alpha `0.19.0-alpha.1`、beta `0.12.0-beta.1`），MIT，维护者 menghuan1918/huanlin，repo `omdsh-dev/DSH-better-sidebar`。
  - 自述：**「VSCode-like right sidebar (explorer / editor / terminal / git / browser), isolated per conversation session. Exposes a service for other plugins to register sidebar tabs and file viewers.」** → 确有第三方内容 provider 扩展点（注册 sidebar tabs 与 file viewers 的服务）。
  - 消费面（manifest `dsh.client.inject`）：client-runtime、client-locale、**client-ui-slots**、client-ui-conversation（0.15+ 另加 client-modules）→ 它自己就是经 Slot 体系挂 UI 的宿主半+客户端半插件，并带 `dsh.bundle.patch: cordis.patch.yml`（**bundle 补丁**，升级敏感）。
  - 版本兼容：0.10.x peer `^0.1.0-rc.6`；0.15+ peer `^0.1.0-rc.8`（devDep 锁 0.1.1-rc.1）。按 semver 0.1.5-rc.2 落在 `^0.1.0-rc.8` 区间内，**但无任何对 0.1.5 家族的实测背书**，且它重度依赖 conversation/slots 内部形态——0.1.5 的 Tab 体系/panellist 演进可能直接打破它。
  - 结论：作为「喂内容给它」的选项技术上存在（provider 服务），但引入一个 25MB 级、带 bundle patch、兼容性未验证的第三方重型插件，只为换一个文件树入口，收益/风险不成比例。

## §4 接入选项对比与推荐

| # | 方案 | 挂载点 | replaceRisk | 被上游演进破坏的风险 | 备注 |
|---|---|---|---|---|---|
| a | 会话 header/工作区行挂「浏览」入口，弹层复用现有 directory flow（pickOnly） | `conversation.session.header.actions`（list，新 id 追加）或 sidebar.workspaces 行内 | **none**（list 槽、新 id） | 低：list 槽契约稳定；但 header.actions 是 session 域，仅在会话内可见——恰好匹配「会话已在远程工作区时」的缺口语义 | 纯增量、零竞态；与 0.1.2→0.1.5 已验证的 flow 接管共用代码 |
| b | 独立侧边栏面板：`sidebar.panellist` 新 id + `main` 新 key 渲染远程文件树，数据走 `/api/dsw/browse.list` | `sidebar.panellist`（list）+ `main`（keyed，新 key） | **none**（fresh id/key） | 中低：panellist↔main 的「id=面板 key」联动是文档化契约（client.js line 4116 doc），但属 rc.2 较新体系，跨家族漂移风险高于 list 槽 | 全局常驻入口（root 域，不依赖会话）；自带整台机器浏览 + mkdir 能力，正好是官方 Files tab 的盲区 |
| c | 作为 provider 喂给 dsh-better-sidebar | 其 tabs/viewers provider 服务 | 无槽位竞争 | **高**：第三方包自身兼容性未验证 + bundle patch + 25MB 依赖 | 不推荐作主路径 |

**推荐：b（为主）+ a（为辅，可后补）。**
理由：b 用的是 rc.2 官方为第三方留的、`replaceRisk: none` 的全局面板入口，给的是真正的「常驻『浏览这台机器文件』」入口（任务缺口的本义），且数据面直接复用已实证的 `/api/dsw/browse.list`，不与官方 workspaceFiles 的 root 限制冲突；a 成本极低可作为快速补丁，但只覆盖「已开会话」场景，不是常驻面。c 不建议。

## §5 开放问题

1. `main` 新面板与左侧 `sidebar.panellist` 图标的选中态如何联动（owner 自动按 active id 高亮，仍需真机确认 label/order 表现）。
2. 远程工作区未连接时，`/api/dsw/browse.home` 的行为（报错形态）需要定义 UI 呈现。
3. `sidebar.right.pane.tab` 是否可注册**非 session 域**的自定义 tab kind（key 域 open 但槽是 session scope，无会话时不可用）——若可以，是 b 之外的另一常驻形态，留待下一轮 `--key` 级核验。
4. `dsh-better-sidebar` 0.19.1 对 0.1.5-rc.2 的真实可运行性（如确要评估 c，需在隔离 lab 实测，本仓库不装产品 profile）。
5. `.dsh-lab/rc2-cli` 的 client.js 为何损坏（同长度不同内容/乱码）——建议下次从 registry 重装该 lab，勿以它为契约源。
