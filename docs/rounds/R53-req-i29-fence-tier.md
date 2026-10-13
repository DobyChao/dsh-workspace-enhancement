# R53 — REQ-I29 围栏档位（bwrap 功能探测 + Landlock 后备 + 用户引导）

> 2026-10-13。派发 = 用户点名 REQ-I29（含并入的 REQ-I30 方向），并明确要求「好好测试，沙箱这块返工很多次了，
> 必要的话可以重构」。一轮一 PR（#69，squash 进 master 为 `dde001a`）。

## 1. 做了什么

| 层 | 落点 |
|---|---|
| Go 核心（决策） | `core/fence_tier.go`：档位决策纯函数（bwrap 功能探测 → Landlock ABI → none），探测全部可注入；`DSH_CORE_FENCE_TIER` 可强制档位但**不强制可行性**（forced 不可行 → 拒绝而非假设）；forced-none 的拒绝文案点名覆盖本身，不谎称内核缺层 |
| Go 核心（执行） | `maybeJail` 重构为档位驱动：bwrap 仅在功能探测（真跑 read-only profile 包 `true`）通过后 exec(2)；Landlock 档进程内限制（`core/landlock_*.go`，手写 UAPI 三 syscall + prctl，go.mod 保持零依赖）；双缺在 exec 前_fail-closed_拒绝，文案列全出路（四发行版装法 / Landlock 内核 ≥5.13 / sandbox off） |
| Go 核心（探测面） | `dsh-core fenceinfo` 子命令：JSON 决策，恒 exit 0；landlock 档附真实限制验证（probe 后即退） |
| 宿主侧 | 部署与 `sw_status` 跑 fenceinfo，`CoreStatusView.fence` 带档位；`parseFenceInfo` 对非形态答案返回 unknown（老同线 core 诚实降级）；设置页机器行三态（bwrap ✓ / landlock 降档 / ⚠ 无法围栏 + 指引，zh/en）；系统提示括注更新档位词汇 |
| 版本 | core artifact 0.2.2 → 0.2.3（fenceinfo 能力在 version 应答可见；patch 漂移零打扰），新 sha 登记 compatHashes |
| 折入 | UX-4 沙箱车道回归：`CONN_STATE_COLOR` 移入 `client/conn-state.ts`（「逻辑归 .ts」纪律），修 #67 引入的 `.tsx` 动态 import 使 `test:agent` 红的问题 |

## 2. 授权语义（对齐宿主蓝本——本轮最重要的纠偏）

宿主 `dsh-sandbox-local` `landlockProfileArgs`：**两种模式都给 `/dev/null` 写权**（只读围栏不能重定向会坏一半工具链）；**workspace-write 给真实 `/tmp` 写权** + 工作区。与 bwrap 档的差异是**隔离性**（共享真实 /tmp vs 一次性 tmpfs），不是可用性。

初版我按 fail-safe 臆断了「/tmp 拒写、比 bwrap 更严」——用户质疑「deepseek-harness 的 landlock 应该不是这样的」，回磁盘读实后逐位修正。副根写入经核为档位无关：宿主侧 `resolveCoreWorkspace` 每 spawn 解析唯一 jail 根（副根 spawn = 自己的 serve 会话以副根为 workspace），两档同构。

## 3. 验证栈（用户点名「好好测试」）

1. Go 决策表 10 例（Windows 本地，含 forced 语义与拒绝文案真实性）；
2. `GOOS=linux` 交叉 build + vet；
3. **WSL 真内核**（abi 7）：fenceinfo 三态冒烟 + 出厂 tarball 解包直跑 + **编译出的 linux 测试二进制**在真内核执行强制力用例（子进程重执行模式，结果走预开 fd 的文件通道）；
4. CI ubuntu 真内核 `go test`（同套强制力用例）；
5. 完整 `npm run check`（core 重建、sha 登记、pack-smoke 溯源门）+ `test:agent`（61 文件）+ WSL `verify-linux.sh`；
6. TS：解析/文案/设置行 15 例。

## 4. 过程中真内核抓到的三个真 bug（都进了提交历史）

1. **CI 首跑**：landlock 测试 helper 先自我限制 read-only 再写结果文件——被自己拒，父进程看不到结果。修法利用 Landlock 语义：**管 open 不管已开 fd**，结果通道先开 fd。
2. **WSL 冒烟**：bwrap 成功路径懒查询 ABI ⇒ fenceinfo 报 `landlockAbi:0` 假信息；forced=landlock 在 bwrap 可用时返回 bwrap 却配谎话备注。重写决策：ABI 无条件查询、forced 只覆盖偏好不覆盖可行性。
3. **用户质疑驱动的对齐**：/tmp、/dev/null 授权缺失（初版过度收紧）+ 非目录 path_beneath 规则带目录位 ⇒ 内核 EINVAL（WSL 真内核在 CI 之前抓到）。`addRule` 对非目录自动裁剪到文件位。

教训：**对齐蓝本要读到实现层再动手**，fail-safe 臆断会发明宿主从未有过的语义；真内核冒烟（WSL 跑 linux 测试二进制）便宜且致命有效，进默认动作集。

## 5. 尾巴（用户实机）

`docs/uat/R53-req-i29-fence-tier.md`：真 Docker（禁 userns）降档、部署链路 fenceinfo 上报、设置页三态、降档 stderr 可见性、老 0.2.2 远端的 unknown 降级、bwrap 机回归锚点。

## 6. 状态

REQ-I29 §4 done（含 REQ-I30 方向与 UX-4 车道修复）；§1 清空。§2 下一批候选：REQ-I28（上传/产物，已定形）、REQ-A6 A 档、REQ-I26（arm64——landlock UAPI 号为 asm-generic，arm64 直接复用）。
