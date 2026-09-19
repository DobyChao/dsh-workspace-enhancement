# ADR-0027: 工具面 `sw_status` / `sw_connect` / `sw_exec`（日落 `sw_pick_workspace`）

- 状态: accepted
- 日期: 2026-09-19
- 范围: `src/tools.ts`、`src/locale/`、README 功能表
- 关联: **REQ-I10**；取代 **ADR-0001** 的工具清单（包名与 `sw_` 前缀并入本文，避免两份命名真相）
- 承接: **ADR-0021**（`sw_connect` 已是会话机器开关，不再选目录）

## 背景

ADR-0001 把 `sw_pick_workspace` 写进「最终工具集」。REQ-I11 之后，本会话工作根是 **header cwd**（添加工作区目录流）加上机器登记上的 `workspace` 字段；`sw_pick_workspace` 只改后者，模型却会把它当成「选本会话工作根」。`sw_status` / `sw_connect` 的文案还在教模型去调用这个工具。

## 决定

1. 包名仍是 **`dsh-workspace-enhancement`**，模型工具前缀仍是 **`sw_`**。
2. 模型工具只留 **`sw_status` / `sw_connect` / `sw_exec`**。删除 `sw_pick_workspace` 及其词典键。
3. **诚实**：`sw_connect` 只替换本会话已连接机器，不选目录。`sw_status` 的工作区行来自机器登记 / 会话 cwd；没有时指向「添加工作区」目录流，不指向已删工具。UI 仍可写 `setActiveWorkspace`（目录流），只是模型面不再有这条入口。

## 后果

- 旧会话里模型再调 `sw_pick_workspace` 会得到「未知工具」——这是有意的，改走目录流或 `ssh://<id>/<path>`。
- ADR-0001 **superseded**（包名/前缀结论仍成立，清单以本文为准）。

## 被否方案

- **留工具做薄封装**（只转发到 `setActiveWorkspace`）：模型会继续把它当会话工作根，和 ADR-0021 的「cwd 才是工作根」打架。
- **改名保留**：没有新语义，不值得占一个工具槽。
