# R37 — REQ-I19 工具绑世界 + BUG-11 Linux 矩阵五步修复

- **日期**：2026-09-22 → 2026-09-25（PR #30 / #31 合入）
- **需求**：`REQ-I19`（区域权限矩阵：工具绑世界）、`BUG-11`（Linux 宿主矩阵五步失败）
- **范围**：主/副工作区九区矩阵的工具路由与 jail 铸造规则；Linux 宿主上的本地命令世界

## 目标

命令落在该落的世界上：主工作区在本机时本机命令走官方 `pwsh`/`bash`、远程走 `sw_exec`；
主工作区在远端时反过来。打错世界被英文拒绝；未声明的远程路径不新开可写 jail。
矩阵拍板在 [ADR-0028](../decisions/ADR-0028-region-permission-matrix.md)。

## 拆解

1. **REQ-I19 落地（PR #31）**：`src/region-exec.ts` 按世界路由 exec 工具；
   `src/remote-spawn-policy.ts` 收口 spawn 提权策略；`src/tool-schema.ts` 统一英文 schema。
2. **BUG-11 五步（同 PR #31 内修复）**：
   - L5/L9/L13：`refuse glued ssh workdirs and jail-external cwd`——win32 join 拼出的
     `ssh://` workdir、跨机 workdir、jail 外 cwd 一律在工具层拒绝，不再落到 bwrap ENOENT。
   - L15/L16：`confine local sw_exec and drop stale jails`——Linux 宿主的
     `sw_exec(server: "local")` 改回宿主 confine（不铸宽 jail）；已换掉的工作区不再留在
     remembered jail。
3. **0.1.7-rc.1 接缝**（`align subprocess seams`，即 `UPSTREAM-5` 的代码半边）：同批带进。

## 验证

单测新增 `test/region-exec.test.ts`、`test/req-i18-ux-6.test.ts`、`test/remote-confine.test.ts`，
扩展 `test/exec-tools.test.ts`。UAT [`R37`](../uat/R37-req-i19-region-permissions.md)：
Windows 宿主 **18/18 通过**（2026-09-23，步骤 13 N/A）；Linux 宿主首轮 11/16 不通过
（L5/L9/L13/L15/L16，即 `BUG-11`），修复后 **2026-09-25 用户确认 Linux 复跑收口**。

## 结果

代码、ADR-0028、UAT 均已入库；待办进 §4。

## 遗留

- 步骤 16（显式远程路径 workdir 被改到本机而非拒绝）按当前实现判通过；若要改成直接拒绝，
  走 UAT 反馈另立待办。
- UAT 文档保留 Linux 首轮 11/16 的勾选记录（历史事实）；复跑通过以本报告与 backlog 为准。

来源：PR #30 / #31、[`docs/uat/R37-req-i19-region-permissions.md`](../uat/R37-req-i19-region-permissions.md)。
