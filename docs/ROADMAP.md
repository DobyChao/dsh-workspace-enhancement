# Roadmap — dsh-workspace-enhancement

> 公开进度叙事。**待办只在 [`backlog.md`](./backlog.md)**；版本与计数见
> [`status.md`](./status.md)（`npm run status` 生成）。怎么跑见
> [`architecture.md`](./architecture.md)；为什么见 [`decisions/`](./decisions/)。
> 某一轮的事实记录在 [`rounds/`](./rounds/)（档案，不是现状）。

## 现在在哪

已发布 **v0.1.4**（npm 审批中）。本地/远程工作区收在一个插件里：混合 `ctx.subprocess` / `ctx.fs`、
多机注册表、`ssh://<id>/<path>` 路由、TOFU 与 OS 钥匙串、会话级机器连接、副工作区薄声明清单、
可选审批门、远端围栏（围栏档走核心 RPC；`off` 仍 SFTP）、运行时 zh/en。宿主只支持 `0.1.5` 家族。

**主线 `REQ-I5` 已在 `feat/REQ-I5-remote-core` 落地**：部署一个可校验核心（Go + 成帧 RPC），
围栏执行和远端读写进同一个产物。预定随 **0.2.0** 发布。宣称「已围栏」仍以 UAT 反转 I9-9 为准。

## 接下来

按 [`backlog.md`](./backlog.md) §2 的优先级。`REQ-I5` 实现在短分支上等 0.2.0。
`REQ-I1` 已往后排。R24 真机 UAT 仍待仓库所有者跑；R26 核心 UAT 反转 I9-9。

## 已完成轮次

索引在 [`rounds/README.md`](./rounds/README.md)。最近一轮是 R24（会话连接 + 远端围栏，真机待验）。

## 已关闭 / 撤销

- 镜像/同步：**不做**（`ADR-0003`）。
- 审计日志：**不做**（`ADR-0004`）。
- 更新检查：**不做**（上游节奏过快，无收益）。
- 内嵌侧边栏：**不做**（只对接独立安装的 `dsh-better-sidebar`，`ADR-0006`）。
- 上游 PR：**撤销**（上游不接受公开 PR，`ADR-0011`）。
