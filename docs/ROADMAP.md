# Roadmap — dsh-workspace-enhancement

> 公开进度叙事。**待办只在 [`backlog.md`](./backlog.md)**；版本与计数见
> [`status.md`](./status.md)（`npm run status` 生成）。怎么跑见
> [`architecture.md`](./architecture.md)；为什么见 [`decisions/`](./decisions/)。
> 某一轮的事实记录在 [`rounds/`](./rounds/)（档案，不是现状）。

## 现在在哪

已发布 **v0.1.4**。本地/远程工作区收在一个插件里：混合 `ctx.subprocess` / `ctx.fs`、
多机注册表、`ssh://<id>/<path>` 路由、TOFU 与 OS 钥匙串、会话级机器连接、副工作区薄声明清单、
可选审批门、远端 spawn 围栏（fail-closed；SFTP 写面仍不在围栏内）、运行时 zh/en。宿主只支持 `0.1.5` 家族。

远端前置仍是分项安装（`pwsh` / `ripgrep` / `bwrap`）。**方向是部署一个核心**（`ADR-0023`，载体 `REQ-I5`）：
围栏执行和远端读写进同一个产物；落地前不得宣称「已围栏」。

## 接下来

按 [`backlog.md`](./backlog.md) §2 的优先级。主线是 `REQ-I5`（一个核心，含远端读写）。
`REQ-I1` 已往后排。R24 真机 UAT 仍待仓库所有者跑。

## 已完成轮次

索引在 [`rounds/README.md`](./rounds/README.md)。最近一轮是 R24（会话连接 + 远端围栏，真机待验）。

## 已关闭 / 撤销

- 镜像/同步：**不做**（`ADR-0003`）。
- 审计日志：**不做**（`ADR-0004`）。
- 更新检查：**不做**（上游节奏过快，无收益）。
- 内嵌侧边栏：**不做**（只对接独立安装的 `dsh-better-sidebar`，`ADR-0006`）。
- 上游 PR：**撤销**（上游不接受公开 PR，`ADR-0011`）。
