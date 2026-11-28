# Roadmap — dsh-workspace-enhancement

> 公开进度叙事。**待办只在 [`backlog.md`](./backlog.md)**；版本与计数见
> [`status.md`](./status.md)（`npm run status` 生成）。怎么跑见
> [`architecture.md`](./architecture.md)；为什么见 [`decisions/`](./decisions/)。
> 某一轮的事实记录在 [`rounds/`](./rounds/)（档案，不是现状）。

## 现在在哪

本地/远程工作区收在一个插件里：混合 `ctx.subprocess` /
`ctx.fs`、多机注册表、`ssh://<id>/<path>` 路由、TOFU（默认 accept-new；密码默认明文，可按机器转存 OS 钥匙串）、会话级机器连接、
副工作区薄声明清单、遗留审批门（默认关）、远端一个组件（围栏档走 RPC；无组件时读面降 SFTP、写/spawn
仍拒；`danger` 有组件仍走组件 `--sandbox off`）、模型工具 `sw_status` / `sw_connect` /
`sw_exec`（实验性 `sw_use_machine` 默认关，0.2.1+ 才注册；调用要完全权限且机器已连接）、运行时 zh/en（词典工具错误跟随语言；沙箱拒绝、审批门错误和改用 bash/pwsh 的提示保持英文，工具描述与会话提示也是英文）。当前版本与待办计数见 [`status.md`](./status.md)，宿主支持窗口见 [`compatibility.md`](./compatibility.md)。

## 接下来

只看 [`backlog.md`](./backlog.md) §2 / §3。本文件不另列 ID。

## 已完成轮次

索引在 [`rounds/README.md`](./rounds/README.md)。

## 已关闭 / 撤销

- 镜像/同步：**不做**（`ADR-0003`）。
- 审计日志：**不做**（`ADR-0004`）。
- 更新检查：**不做**（上游节奏过快，无收益）。
- 内嵌侧边栏：**不做**（只对接独立安装的 `dsh-better-sidebar`，`ADR-0006`）。
- 上游 PR：**撤销**（上游不接受公开 PR，`ADR-0011`）。
