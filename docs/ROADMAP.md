# Roadmap — dsh-workspace-enhancement

> 公开进度叙事。**待办只在 [`backlog.md`](./backlog.md)**；版本与计数见
> [`status.md`](./status.md)（`npm run status` 生成）。怎么跑见
> [`architecture.md`](./architecture.md)；为什么见 [`decisions/`](./decisions/)。
> 某一轮的事实记录在 [`rounds/`](./rounds/)（档案，不是现状）。

## 现在在哪

已发布 **v0.2.0**；**v0.2.1** 在准备中（tag 归所有者）。本地/远程工作区收在一个插件里：混合 `ctx.subprocess` /
`ctx.fs`、多机注册表、`ssh://<id>/<path>` 路由、TOFU 与 OS 钥匙串、会话级机器连接、
副工作区薄声明清单、可选审批门、远端一个核心（围栏档走 RPC；无核心时读面降 SFTP、写/spawn
仍拒；`danger` 有核心仍走核心 `--sandbox off`）、模型工具只留 `sw_status` / `sw_connect` /
`sw_exec`、运行时 zh/en。宿主窗口是 `0.1.5` 家族。

## 接下来

只看 [`backlog.md`](./backlog.md) §2 / §3。本文件不另列 ID。

## 已完成轮次

索引在 [`rounds/README.md`](./rounds/README.md)。最近合入：R35（`REQ-I15` / `REQ-I16`，PR #28）、R36（`PUB-6` 0.2.1）。

## 已关闭 / 撤销

- 镜像/同步：**不做**（`ADR-0003`）。
- 审计日志：**不做**（`ADR-0004`）。
- 更新检查：**不做**（上游节奏过快，无收益）。
- 内嵌侧边栏：**不做**（只对接独立安装的 `dsh-better-sidebar`，`ADR-0006`）。
- 上游 PR：**撤销**（上游不接受公开 PR，`ADR-0011`）。
