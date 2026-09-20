# 轮次档案（Round Reports）

> **本目录是历史档案，不是现状。** 当前系统怎么跑见 [architecture.md](../architecture.md)；
> 待办见 [backlog.md](../backlog.md)；公开叙事见 [ROADMAP.md](../ROADMAP.md)。
> 这里只回答「那一轮做了什么、怎么验的、当时还剩什么」。

## 1. 档案总表

| 轮次 | 主题 | 报告 |
|---|---|---|
| R0.5 | dsh-ssh 精简版独立落地 | [R0.5.md](./R0.5.md) |
| R0.6 | dsh-remote 最小合并 | [R0.6.md](./R0.6.md) |
| R1 | 更名抛光（`/dsw`、`dsw:` 前缀、新路由根） | [R1.md](./R1.md) |
| R2 | UI 统一（共享机器表单 + 会话栏三态） | [R2.md](./R2.md) |
| R3 | 表单交互守卫与同名误标 | [R3.md](./R3.md) |
| R4 | 远程认知提示 + 混合 provider | [R4.md](./R4.md) |
| R5 | 会话关联副工作区 | [R5.md](./R5.md) |
| R5 打磨 | UI 主题化 / flow 浏览 / README | [R5-polish.md](./R5-polish.md) |
| A3 | 发布 npm `v0.1.0` | [R-A3-release.md](./R-A3-release.md) |
| S1+S2 | `sw_exec` + win32 `bash`（`v0.1.1`） | [R-S1-S2.md](./R-S1-S2.md) |
| R6 | 运行时国际化 | [R6-i18n.md](./R6-i18n.md) |
| INFRA-1 | 真相源入库与质量门 | [INFRA-1.md](./INFRA-1.md) |
| R13 | REQ-I6 系统提示英文化 / 按需注入 | [R13-req-i6-and-recon.md](./R13-req-i6-and-recon.md) · [验证](./R13-REQ-I6-verification.md) |
| R14 | BUG-2 `processPathFromHostPath` | [R14-BUG-2-fix.md](./R14-BUG-2-fix.md) · [契约审计](./R14-BUG-2-contract-audit.md) |
| R15 | BUG-3 本机目录 + `lib/` 漂移 | [R15-BUG-3-local-directory.md](./R15-BUG-3-local-directory.md) · [INFRA-11](./R15-infra-11-dev-build-drift.md) |
| R16 | `readByteRange` 与家族窗口 | [R16-upstream-1-byte-range.md](./R16-upstream-1-byte-range.md) |
| R17 | rc.2 槽位侦察 + 行徽标验证 | [R17-rc2-slot-recon.md](./R17-rc2-slot-recon.md) · [徽标](./R17-rc2-badge-verification.md) |
| R18 | F2：`/dsw` 在 0.1.5 上 405 | [R18-F2-dsw-405.md](./R18-F2-dsw-405.md) |
| R19 | 通道改走官方 `/api` + 0.1.2 退场 | [R19-f2-shared-api-channel.md](./R19-f2-shared-api-channel.md) |
| R20 | 副工作区权限档位退役（REQ-I7） | [R20-req-i7-permission-retirement.md](./R20-req-i7-permission-retirement.md) |
| R21 | AUDIT-6 设计定稿（ADR-0020） | [R21-audit6-remote-approval-gate-design.md](./R21-audit6-remote-approval-gate-design.md) |
| R22 | AUDIT-6 审批门落地 | [R22-audit6-remote-approval-gate.md](./R22-audit6-remote-approval-gate.md) |
| R23 | 侧边栏远程浏览接入面侦察 | [R23-sidebar-remote-browse-recon.md](./R23-sidebar-remote-browse-recon.md) |
| R24 | 会话连接（REQ-I11）+ 远端围栏（REQ-I9） | [R24-session-connections-and-remote-fence.md](./R24-session-connections-and-remote-fence.md) |
| R25 | 发布 npm `v0.1.4` | [R25-v0.1.4-release.md](./R25-v0.1.4-release.md) |
| R26 | REQ-I5 远端一个核心 | [R26-req-i5-remote-core.md](./R26-req-i5-remote-core.md) |
| R27 | REQ-I13 远端会话沙箱 UAT | [../uat/R27-req-i13-remote-session-sandbox.md](../uat/R27-req-i13-remote-session-sandbox.md) |
| R28 | INFRA-15 核心工件分发 | [R28-infra15-core-artifact-distribution.md](./R28-infra15-core-artifact-distribution.md) |
| R29 | BUG-5 ssh2 死链打挂宿主 | [R29-bug5-ssh-error-listener.md](./R29-bug5-ssh-error-listener.md) |
| R30 | 发布 npm `v0.2.0` | [R30-v0.2.0-release.md](./R30-v0.2.0-release.md) |
| R31 | BUG-9 调查：远端任务停止不了 | [R31-bug9-remote-task-stop.md](./R31-bug9-remote-task-stop.md) |
| R32 | BUG-9 修复：核心腿组杀 + 直连腿停止链 | [R32-bug9-remote-task-stop-fix.md](./R32-bug9-remote-task-stop-fix.md) |
| R34 | REQ-I10 日落 pick + BUG-7 version + BUG-8 tar | [R34-req-i10-bug7-bug8.md](./R34-req-i10-bug7-bug8.md) |
| R35 | REQ-I15 读面降级 + REQ-I16 bash 按工作区注入 | [R35-req-i15-i16.md](./R35-req-i15-i16.md) |
| R36 | 发布 npm `v0.2.1` | [R36-v0.2.1-release.md](./R36-v0.2.1-release.md) |

尚未做的工作以 [`backlog.md`](../backlog.md) 为准，不在本表开「尚未开工」栏。

## 2. 每份报告的固定五段

新报告仍用这五段，便于横向对比：

| 段 | 内容 |
|---|---|
| **目标** | 这一轮要解决什么（一句话 + 需求 ID） |
| **拆解** | 任务 DAG：主题 + 依赖 + 角色 |
| **验证** | 单测 / typecheck / E2E 或真机 / 评审结论 |
| **结果** | 交付了什么、是否上线 / 发布 |
| **遗留** | 已知边界、未决项、后续引用 |

末行固定为 `来源：<文件>`。

## 3. 脱敏约定（公开仓库）

| 占位符 | 含义 |
|---|---|
| `user@host` / `user@192.0.2.10:22` | 测试用 SSH 连接 |
| `127.0.0.1:50599` | 本机回环 lab 地址（非敏感） |
| `<fingerprint>` | 主机指纹 |
| `%DSH_HOME%` | 真实 DSH 数据根 |
| `$LAB_HOME` | lab 隔离根 |
| `<repo>` | 本仓库绝对路径 |
| `<host>` | 远程主机名 |

自检（命中数必须为 0）：

```bash
grep -nE 'uu''z@|BEGIN[ ].*PRIVATE' docs/rounds/*.md docs/uat/*.md
```

## 4. 来源

报告提炼自当时的权威来源。`drafts/`、`.agent-teams/` 是**本地工作素材，不入库**；clone 后只能看到报告本身。
这是有意的——草稿可能含机器专属数据。
