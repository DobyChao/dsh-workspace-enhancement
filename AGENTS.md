# AGENTS.md — dsh-workspace-enhancement 项目工作约定

> 本文件是给在本仓库工作的 AI 代理（Agent）和人类协作者的**工作规则**。
> 项目的背景、研究结论与合并设计在 [CONTEXT.md](./CONTEXT.md)，先读它再动手。

## 1. 项目目标

统合社区中与 DeepSeek Harness（DSH）**工作区（workspace）** 相关的零散插件，
产出一个单一、精简、可维护的插件或插件组：一个包解决「工作区从哪里来、在哪里、
如何被操作」的问题 —— 本地工作区、远程（SSH）工作区、镜像/同步、目录选择体验、
机器/连接管理，统一到一个命名空间和一套配置下。

**当前第一步**：合并并精简以下两个插件 ——

- [UynajGI/dsh-ssh](https://github.com/UynajGI/dsh-ssh)（v0.3.0-pre，TypeScript）
- [flymysql/dsh-remote](https://github.com/flymysql/dsh-remote)（v0.8.7，纯 ESM JS）

详细分析见 `CONTEXT.md` §3/§4。

## 2. 技术栈约定

- **Node >= 22**，**ESM only**（`"type": "module"`）。
- **TypeScript** + `tsc`（类型检查）+ `tsdown`（打包），遵循 dsh-ssh 的工程形态：
  - 宿主（host）代码编译到 `lib/`，插件加载器导入的是 `lib/`；
  - 客户端（client，浏览器）代码在 `src/client/`，TSX 由 tsdown 打包为 `lib/client.js`；
  - 宿主插件对象**永远是纯 JavaScript**（不要写 TS 类型/装饰器/import 到运行时产物）。
- 运行时依赖能少则少：核心依赖 `ssh2`、`@deepseek-ai/cordis`、`@deepseek-ai/schemastery`；
  接缝包（`@deepseek-ai/dsh-subprocess`、`dsh-fs`、`dsh-host-directory-picker*`、
  `dsh-tools`、`dsh-host-webserver`、`dsh-system-prompt`）按需要声明。
- **不要**把 `dsh-better-sidebar` 作为硬依赖打进本插件（宿主环境已有独立安装，
  见 `CONTEXT.md` §2.4）；需要侧边栏能力时通过其自身 slot 对接，并做「已存在则退避」的守卫。
- 代码风格：Conventional Commits；提交前跑 typecheck；命名/注释用英文，文档用中文。

## 3. 仓库布局（目标形态，随步骤演进）

```
dsh-workspace-enhancement/
├── AGENTS.md            # 本文件：工作规则
├── CONTEXT.md           # 研究结论、架构对比、合并设计与路线图
├── package.json         # 插件包（名待定，见 CONTEXT.md §5.1）
├── cordis.patch.yml     # 插件 bundle patch（挂载行，见下面 §5）
├── src/
│   ├── index.ts         # 宿主入口 / apply
│   ├── runtime.ts       # SSH 连接服务（ctx.<name>）
│   ├── connection.ts    # 单连接封装（ssh2: 认证/跳板/SFTP/exec）
│   ├── subprocess.ts    # ctx.subprocess 远程 provider
│   ├── filesystem.ts    # ctx.fs 远程 provider
│   ├── registry.ts      # 多机注册表 + TOFU + ~/.ssh/config 解析
│   ├── web.ts           # /<plugin> RPC 通道（host 侧）
│   └── client/          # 客户端 UI（添加工作区流程 + 设置页）
├── test/                # node --test 单测
├── scripts/             # dev-run.sh / boot-smoke.sh / check.mjs（沙箱开发）
└── docs/                # 截图、设计文档
```

## 4. 开发流程（沙箱优先，严禁动产品 profile）

1. **一切改动先在沙箱里验证**：用仓库内脚本（参照 dsh-remote 的
   `scripts/dev-run.sh`）启动一个隔离 DSH 实例（独立 `$DSH_HOME`、独立端口，
   例如 `http://127.0.0.1:50599`），把构建产物放进沙箱 profile 再启动。
2. **永远不要手工编辑产品 profile**：`~/.dsh/profiles/web` 由插件管理器重管，
   手工部署会被 `dsh plugin add/remove` 还原。安装/卸载一律走
   `dsh plugin --profile web add|remove <本仓库路径或包名>`。
3. 宿主半改动 → 重启沙箱实例；客户端半改动 → 刷新页面即可。
4. 发布/装产品前先过 `check.mjs`（静态约束闸门）+ `boot-smoke.sh`（冒烟）。
5. 参照 DSH 官方惯例：`dsh.plugin`（bundle.patch / client.inject / client.platform）字段
   要写对；补丁层的 `name` 是校验字段，靠 `disabled: true` + 自定义 `id` 来关掉默认行。

## 5. 写插件代码 / 改 Cordis 组合之前的固定动作

- 先加载技能：`editing-cordis-compositions`（组合、挂载、host/agent 判定）、
  `cordis-plugin-development`（动态插件、Service/Event/Slot/Tool 写法）。
- **子代理（agent-teams 成员、subagent）一律禁止调用 `cordis_inspect_list` /
  `cordis_inspect_query`**：client 平台查询（Slots.listSubTree 等）依赖页面应答，
  页面不响应时**永久挂起**（本会话已两次卡死调试）。契约核验改用**磁盘权威源**：
  ① `C:\Users\Admin\.dsh\profiles\web\node_modules\@deepseek-ai\*`（部署包 types/源码）
  ② `C:\Users\Admin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\*`
  （全局安装包源码，ui-workspace/ui-sidebar 等）
  ③ 本仓库 `node_modules\@deepseek-ai\*`（接缝包类型）
  磁盘源找不到某契约 → 回来问 captain，不要用 inspect。主代理自身（会话内）可用
  host 平台查询；契约推断仍遵守「不要凭记忆写服务/槽位名」。
- 服务依赖：可选服务一律 `ctx.get(...)` 判空；硬依赖才用 `inject`。
- 生命周期：所有副作用（服务、事件、定时器、槽位、样式）必须挂在当前 context 的
  `ctx.effect()`/`ctx.on()` 上，保证卸载可逆。
- 数据：只读叶子字段，不序列化 Cordis 活对象；连接凭据绝不进日志、不进 git
  （见 `.gitignore` 的 secrets 段）。

## 6. 安全红线

- SSH 凭据（密码/passphrase/私钥内容）只允许存 `$DSH_HOME` 下的注册表文件或
  OS keychain（复用 dsh-remote 的 credential.js 思路），透传视图必须剔除敏感字段。
- 默认启用主机指纹校验（TOFU：首次记录、之后变化即拒），可配置降级但文档必须警告。
- 远程命令注入防护：所有拼接进 shell 的参数必须用 POSIX 单引号转义（`quoteShellArg`）。
- 生产配置示例里的凭据一律用占位符，禁止提交任何真实 host/user/路径数据。

## 7. 参考源

合并时以**上游最新代码**为准复核，不要只信本仓库的分析快照：

- dsh-ssh：<https://github.com/UynajGI/dsh-ssh>（历史快照：GitHub main，version 0.3.0-pre；
  注意其 main 曾被检出 typecheck 残骸，仅作档案，二开代码以本仓库为准）
- dsh-remote：<https://github.com/flymysql/dsh-remote>（历史快照：v0.8.7，仅作档案）
- 当前本机状态（见 CONTEXT.md §2 数据现状）：`~/.dsh/remote-workspaces/`（machines.json
  现役 c1 + known_hosts.json）、`dsh-ssh-connections.json.bak`（已归档）、
  `dsh-ssh-routes/`（legacy 占位树，兼容读取、保留待人工清理）。

## 8. 当前状态与下一步

- 已完成：R0.5（dsh-ssh 精简版）+ R0.6（dsh-remote 最小合并包）+ **R1 抛光轮 + R2 UI 统一轮**，
  **全部已上线真实 3080 实例**（c1 迁移完成、TOFU 保护中、共享 MachineForm、
  会话栏远程标识/三态/重连；单测 73/73）。
- 全量进度快照见 **CONTEXT.md §0**；设计事实见 §5 决策与 §6 里程碑；后续轮候选见
  §6.2（抛光轮[P2 四项+已知边界]→发布 npm→端口转发→愿景延伸）；
  会话栏行级正式注入点提案见 **docs/upstream-pr-b3.md**（待向上游提 PR）。
- 特性级拆解见 [docs/features-breakdown.md](./docs/features-breakdown.md)
  （每个功能的取舍在第 4 节映射表；第 5 节为 dsh-ssh 精简审计）。
- 开发基线：沙箱验收（`.dsh-lab` + `scripts/dev-lab.ps1` + browser-use）→
  部署（`scripts/restart-3080.ps1` 会话外重启）。
