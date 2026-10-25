# 专题附录

> **不是入口。** 现状怎么跑见 [`../architecture.md`](../architecture.md)；为什么见 [`../decisions/`](../decisions/)；待办见 [`../backlog.md`](../backlog.md)。
> 这里只放「太长不该进 architecture、又不是一轮档案」的专题事实。

| 附录 | 关于 |
|---|---|
| [host-silent-fs.md](./host-silent-fs.md) | 宿主静默 `ctx.fs` 项目根探测（`BUG-4` 已修；实机无 `.git` 尾巴仍待验） |
| [prompt-section-order.md](./prompt-section-order.md) | 系统提示段 order 对照（`REQ-I20`；90/105 落在身份行与官方工具段之间） |
| [BUG-21-22.md](./BUG-21-22.md) | 本机副根上的 sw_exec，以及远程子代理扫不到项目技能（`BUG-21` `BUG-22`） |
| [REQ-I31-switch-machine.md](./REQ-I31-switch-machine.md) | 实验性切机器工具的约束与连带行为（`REQ-I31`） |
| [BUG-23-fence-none-green.md](./BUG-23-fence-none-green.md) | 远程沙箱不可用仍显示成绿色成功，文案不要写「无法围栏」（`BUG-23`） |
| [BUG-24-subagent-custom.md](./BUG-24-subagent-custom.md) | 子代理权限显示成 Custom（`BUG-24`） |
