# 用户验收（UAT）流程

> 本目录是**入库的用户验收文档**：UAT 在交付流程中的位置、lab 实例怎么用、证据怎么留、反馈怎么回填。
> 轮次事实档案见 [docs/rounds/](../rounds/README.md)；面向用户的进度概览见 [docs/ROADMAP.md](../ROADMAP.md)。

## 1. UAT 在流程中的位置

本项目的开发基线是「**沙箱验收 → 部署**」：先在隔离 lab 实例上验证，再部署到真实实例
（`AGENTS.md` §8：沙箱验收 `.dsh-lab` + `scripts/dev-lab.ps1` + browser-use → 部署
`scripts/restart-3080.ps1` 会话外重启）。

UAT 是这条链上的**最后一道人工闸门**：

| 序 | 环节 | 由谁做 | 产出 |
|---|---|---|---|
| 1 | 单测 / typecheck / build | AgentTeams 工程师 | 门禁全绿 |
| 2 | 评审（AgentTeams reviewer） | 评审角色 | approve 或 needs-fix → 修复后通过 |
| 3 | lab 自动化 E2E | 验证角色 | 断言通过 + 证据落盘 |
| 4 | **UAT（用户验收）** | **用户** | **本目录的脚本 + 签字 / 反馈** |
| 5 | 部署 / 发布 | agent 换包，**用户**重启 / 2FA 发布 | 运行态验证 |

**判定规则：每一轮交付前必须有一份 UAT 脚本 + 用户签字或反馈，才算 Done。**
没有脚本的轮次不得进入部署；脚本执行后未回填反馈的，视为**未验收**。

约定：

- 每个轮次（或每批相关修复）在 `docs/uat/` 下新增一份 `R*.md` 脚本，模板见 [TEMPLATE.md](./TEMPLATE.md)。
- 已有真实示例：[R6-i18n.md](./R6-i18n.md)（R6 运行时国际化轮）。
- 反馈一律用 [FEEDBACK.md](./FEEDBACK.md) 的模板回填；结论回写到该轮 `docs/rounds/R*.md` 的
  **遗留**段与 `drafts/CONTEXT.md` §7（风险与开放问题）。
- 严重度 `blocker` 的反馈**阻塞发布**：修复 + 重跑脚本 + 重新签字后才继续。

## 2. lab 实例怎么用

**唯一入口**：`scripts/dev-lab.ps1`（隔离 `DSH_HOME`、默认端口 50599、**显式拒绝 3080**）。

```powershell
# 默认：构建 + 装 profile + 组合检查 + 前台启动 web（Ctrl+C 停止）
pwsh -File scripts/dev-lab.ps1

# 只做构建 + 装 profile + dump-config 组合检查，不启动
pwsh -File scripts/dev-lab.ps1 -NoBoot

# 全自动冒烟：后台启动 + HTTP / RPC 自检 + 自动停服并清理端口
pwsh -File scripts/dev-lab.ps1 -Smoke

# 跳过构建（复用已有 lib/）
pwsh -File scripts/dev-lab.ps1 -SkipBuild
```

安全边界（脚本内已强制，验收时也必须遵守）：

| 约束 | 说明 |
|---|---|
| **绝不碰 3080** | 3080 是真实运行实例；脚本对 `-Port 3080` 直接抛错。UAT 只在 50599 上做 |
| **隔离 `DSH_HOME`** | 脚本把 `DSH_HOME` 设为 lab 根 `$LAB_HOME`（形如 `<user-home>\.dsh-lab`），所有 profile / 状态写入都落在该目录 |
| **真实数据只读** | 真实 `%DSH_HOME%` 只作只读参考，脚本显式声明不写入、不复制 |
| **不用真凭据** | 示例连接使用占位值；lab 若需模型凭据，只读复制一份到 lab（见 `drafts/CONTEXT.md` §6.1） |
| **组合一致** | lab 的组合（`dsh --profile web --dump-config`）应与真实 profile 同构，验收结论才可外推 |

地址：`http://127.0.0.1:50599/`（**文档中回环地址统一写作占位地址**，端口 50599 为 lab 专用）。
启动后应确认三件事：HTTP 200、页面引用了插件 client bundle、`POST /dsw/<endpoint>` 返回 `ok:true`。

> 部署动作另有一套脚本 `scripts/restart-3080.ps1`（会话外执行 + 三项验证 + 回滚提示）。
> **重启 3080 一律由用户执行**，UAT 阶段不涉及。

## 3. 证据怎么留

| 项 | 位置 / 约定 |
|---|---|
| 根目录 | `$LAB_HOME\e2e\`（lab 隔离目录内，**不入库**；仓库根 `drafts/`、`.dsh-lab/` 均不提交） |
| 截图 | `<轮次前缀>-<序号>-<场景>.png`，例：`r5b-01-picker-remote.png`、`i18n-layout-en.png` |
| 断言结果 | `results.json` / `RESULTS.md` + 运行日志 `<轮次>-e2e.log` |
| 探针脚本 | 可复跑的 Python / Node 脚本与截图同目录（例：`i18n_layout_probe.py`） |
| 会话/轨迹证据 | 导出请求头与转写快照（注意：不要带凭据） |

入库文档中引用证据时，**只写相对路径或占位路径**，不写真实主机名、用户名、绝对用户路径。

## 4. 反馈怎么回填

1. 复制 [FEEDBACK.md](./FEEDBACK.md) 的模板，逐项填写（环境指纹 / 现象 / 复现步骤 / 期望 / 实际 /
   严重度 / 证据 / 是否阻塞发布）。
2. 在对应的 `docs/uat/R*.md` 判定表里标「不通过」并链接该反馈。
3. 结论回写：`docs/rounds/R*.md` 的 **遗留**段 + `drafts/CONTEXT.md` §7。
4. 严重度 `blocker` → 阻塞发布；修复后**重跑同一份脚本**并重新签字。
5. 若问题无法在 lab 复现（例如仅真实实例出现的布局/加载态问题），在反馈中如实注明
   「lab 未复现」，并给出真实实例上的复现条件。

## 5. 本目录文件

| 文件 | 用途 |
|---|---|
| [README.md](./README.md) | 本文件：UAT 流程说明 |
| [TEMPLATE.md](./TEMPLATE.md) | UAT 脚本骨架（可直接复制） |
| [R6-i18n.md](./R6-i18n.md) | 真实示例：R6 运行时国际化轮验收脚本 |
| [FEEDBACK.md](./FEEDBACK.md) | 用户反馈模板 |

来源：`AGENTS.md` §4/§8；`scripts/dev-lab.ps1`；`drafts/CONTEXT.md` §0/§6.1；`docs/ROADMAP.md`；`.agent-teams/archive/dsw-i18n-r6/inbox/captain.jsonl`（t11 E2E 证据约定）
