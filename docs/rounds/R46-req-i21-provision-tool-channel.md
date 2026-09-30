# R46 — REQ-I21：核心供给并入工具面——四次拍板、双根因、sha256 溯源

> 用户 lab 实测报告触发（会话 `9d527388`：删核心后无 approve 提示）的一轮 = 一个 PR
> （#55，squash `f9def11`）。日期：2026-09-30。同轮四次用户拍板，PR 内五次迭代全 CI 绿。

## 1. 排障：会话转录定位双根因

- 转录（zstd 多帧）显示 turn 3 bash 吃到 fail-closed 文案，但**无任何 `approval/asked`/
  `approval/decided` 审计对** ⇒ `ApprovalService.request()` 从未被调用；而 asker 五个 false
  路径零日志——断在哪环不可定位（可观测性缺陷）。
- 排除法：lab 进程晚于 tarball 安装启动（非旧代码）；`approval` 服务在组合里（dump-config）；
  cordis 兄弟/嵌套 fiber 服务可见（同版本实验）；registry 连接通（serve exec 有回包）。
- **根因②（通道复测实锤）**：供给门按机器 `remoteSandbox` 字段门控，而围栏跟**会话**走
  （`resolveRemoteSessionMode` fail-safe read-only）——用户会话 workspace-write、机器字段 `off`，
  预热与审批两条部署路径全被挡。修正：供给只看机器是否存在（机器字段只管终端守卫/旧路径/显示）。

## 2. 四次拍板 → 最终形态

1. **工具渠道（集成进 sw_connect，用户点名方向）**：`sw_connect` 对每台可达机器同步跑
   `provisionRemoteCore` 梯子并逐机报结果；`sw_status` 报每台已连接机器核心态
   （当前/版本不符+期望/未安装/探测失败）。fail-closed 文案先指 `re-run sw_connect`。
2. **部署必问（三条规则）**：凡尝试部署必先经平台 approval（拒绝=报告行 `core: deploy was not
   approved (left at <现状>)`，机器保持连接，重跑再问）；danger-full-access 会话不尝试部署；
   已是当前版本不问不装。后台预热（turn 外问不了）降级纯探测+告警——**问不了的部署不部署**。
   「无感化」表述就此作废（ADR-0024）。
3. **版本门放宽（依赖语义）**：同 major.minor 线内任意 patch 直接可用（不问不装、`sw_status`
   如实显示）；跨 minor/major 拒 + 走询问部署。判定集中 `coreVersionAccepted`（解析失败回退精确
   匹配）；开连接的 proto+caps 校验仍拦真不兼容的新核。
4. **sha256 白名单溯源**：版本串是自报的、hash 不是——open 后插件经控制通道 `sha256sum` 磁盘
   二进制，不在 `core/artifact.json` `compatHashes` 内即拒（confined 拒带肇事 hash；danger 落
   SFTP——不运行来历不明二进制）；活会话复用不重查（运行中 inode 不可换）；deployCore 装后校验
   安装哈希 = MANIFEST。诚实边界：信任远端 coreutils，防误换/损坏/伪造版本串，非全面攻陷防线。

## 3. CI 抓到的结构性问题（本轮最有价值）

- **Go 构建跨工具链不可字节复现**：溯源门首跑 CI 红——CI 重建核心 hash（`ead3132…`）≠ 本地
  旧构建（`a0f28eae…`），手维护静态清单必然过时。修法：**构建自登记**——`ensure-core` 在保证
  tarball 后把其二进制 hash 追加进 `compatHashes` 并重投影（`npm run build` 改为先 ensure 后
  tsc）；pack-smoke 加**包内自洽**断言（投影清单必须包含 dist 二进制 hash，陈旧投影发不出去）。
- **prepack stdout 污染**：自登记 spawn sync 用 inherit，其 stdout 打进 `npm pack --json` 输出
  （ensure-core 头注释自己警告过的坑）——sync 改 stdout ignore，并用「未登记状态跑 pack」模拟
  验证闭环。
- Windows tar 路径坑：绝对路径 `D:\…` 的冒号被 GNU tar 当远程主机——`distCoreSha256` 用
  cwd+相对文件名。

## 4. 验证

- 单测 648+（溯源三例、approve 门、拒绝行、danger 跳过、漂移=当前、`coreVersionAccepted` 单点）；
  check:static（含 compatHashes 登记）/ WSL verify-linux（两轮）/ boot 哨兵 / pack-smoke
  （含模拟未登记路径）全绿；CI 四档绿（PR 内五次提交，两次红均当日定位修复）。
- lab 实机：装分支 tarball 后通道 `core.status` 正常；warmup 纯探测确认无静默部署；c1（真 WSL
  远端）真部署闭环曾实证（通道触发 → 收敛 `{ok:true, version:0.2.2, caps:[fs,spawn,rg]}`）。
- **尾巴**：弹问闭环完整 UAT（删核心→拒→再问→允许→bash 恢复；低版本/danger 两场景）待用户
  实机——PR 描述给了三步脚本；matrix N8 顺带。

## 5. 工程备忘

- lab 重装需先停宿主（Windows 文件锁 ssh2 原生模块）；`pnpm remove` 会卡代理，绕开重试。
- 本轮 python heredoc 转义三次坑（模板字符串嵌套、`\\b`→退格符、未落盘的 import）——凡含反斜杠
  的补丁改用 Edit/node chr() 拼装，并 grep 复核。
