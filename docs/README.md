# 文档地图

本目录放事实与设计。规则与命令在仓库根 [`AGENTS.md`](../AGENTS.md)。
**不要另建第二份待办，也不要把现状抄进多份入口。**

| 想知道 | 看 | 不要写在 |
|---|---|---|
| 文档从哪进 | **本文件** | README / CONTRIBUTING / AGENTS 里再抄一张完整表 |
| 现在能做什么 / 待办 | [`backlog.md`](./backlog.md)（**唯一待办真相源**；备注只写剩余动作 + 指针） | README、ROADMAP、AGENTS 快照；把调查/ADR 摘要堆进备注 |
| 版本、HEAD、待办计数 | [`status.md`](./status.md)（`npm run status` 生成，禁止手改） | 任何手写副本 |
| 现状怎么跑 | [`architecture.md`](./architecture.md) | rounds、README 设计要点、把 ADR 全文贴进来 |
| 为什么这么做 | [`decisions/`](./decisions/)（[索引](./decisions/README.md)） | 在 architecture 里复述 ADR |
| 某一轮做了什么、怎么验的 | [`rounds/`](./rounds/)（**历史档案，不是现状**） | 当作当前架构或待办表 |
| 测试怎么跑、沙箱限制 | [`testing.md`](./testing.md) | AGENTS 里除命令表以外再写一遍 |
| 宿主支持窗口与上游漂移 | [`compatibility.md`](./compatibility.md) | README 里展开漂移日志 |
| 专题附录（非入口） | [`notes/`](./notes/) | 当作 architecture / 待办 / 文档根入口 |
| 用户验收脚本 | [`uat/`](./uat/) | |
| 安全模型与已知边界 | [`../SECURITY.md`](../SECURITY.md) | 在 README 里展开实现细节 |
| 公开进度叙事 | [`ROADMAP.md`](./ROADMAP.md) | 再列一份待办或轮次表 |
| 代理规则与命令 | [`../AGENTS.md`](../AGENTS.md) | 把当前 sprint 写进规则文件 |
| 人类贡献 / 发布清单 | [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | |
| AgentTeams 可粘贴 profile | [`agents.md`](./agents.md) | |
| 用户安装与功能 | [`../README.md`](../README.md) / [`../README.zh.md`](../README.zh.md) | 实现机制、ADR 编号、待办 ID |

`drafts/`、`.agent-teams/`、`.workbuddy/`、`.tmp/` 是**本地素材**（不入库、可能含机器专属数据）。
结论一旦拍板，必须搬进上表——否则下一个 clone 的人看不到。
