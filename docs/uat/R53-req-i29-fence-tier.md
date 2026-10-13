# UAT：REQ-I29 — 围栏档位（bwrap 功能探测 + Landlock 后备 + 引导）

> 流程与 lab 用法见 [README.md](./README.md)。单测/CI 覆盖决策表与 linux 强制力；
> 本脚本覆盖真机：真 Docker（禁 userns）降档、真部署链路的 fenceinfo 上报、设置页档位行。

## 0. 基本信息

| 项 | 值 |
|---|---|
| 轮次 / 主题 | R53 — REQ-I29（含并入的 REQ-I30 方向） |
| 验收对象 | bwrap 只在功能探测通过后使用；不可用降 Landlock（诚实备注）；双缺拒给全指引；部署/状态面带档位 |
| 需求 / 缺陷 ID | `REQ-I29` `REQ-I30` |
| 脚本作者 / 日期 | 代理 / 2026-10-13 |
| 预期耗时 | 40 分钟 |

## 1. 前置条件

| 项 | 值 |
|---|---|
| 版本 | 0.2.3（core artifact 0.2.3） |
| 分支 | `feat/REQ-I29-fence-tier` |
| 构建产物 | `npm run build` → `npm pack` → lab remove/add tarball |
| lab 地址 | `http://127.0.0.1:50599/` |
| 其他前置 | 一台正常 Linux 远端（有 bwrap）；一个**禁 userns 的 Docker 容器**作 SSH 远端（`docker run --rm -it -p 2222:22 …` + 装 openssh-server；默认 docker 即禁非特权 userns）；可选：无 bwrap 的极简容器 |

## 2. fenceinfo 三态（远端直接跑，或经 sw_connect）

1. 正常远端：`~/.dsh-core/current/dsh-core fenceinfo`
   - [ ] `{"tier":"bwrap",…,"landlockAbi":<本机>}`——bwrap 是**功能探测通过**后的结论。
2. 禁 userns 容器：同命令
   - [ ] `tier":"landlock"`，notes 含 `fell back from bwrap (…)` 与 `no mount isolation`；`bwrapProbeErr` 非空。
   - [ ] 容器内 `sw_exec` 受限写：workspace-write 会话里写工作区内成功、写 `/etc/xxx` 拒绝、写 `/tmp/xxx` **成功**（宿主方言一致：真实共享 /tmp 可写，与 bwrap 的差异只在隔离性不在可用性；写 $HOME 外工作区外路径拒绝）。
3. 双缺环境（无 bwrap + 内核无 Landlock，或临时 `DSH_CORE_FENCE_TIER=none`）：
   - [ ] `fenceinfo` 仍 exit 0，`tier":"none"`。
   - [ ] 受限会话执行：拒绝文案含安装提示（apt/dnf/pacman/zypper）、Landlock 内核提示、sandbox off 三条出路。

## 3. 部署/状态链路（宿主侧）

1. lab 连一台新远端触发部署（或设置页「部署远程组件」）。
   - [ ] 部署结果 detail 含 `fence tier: …`（正常机 bwrap；Docker 机 landlock）。
2. 设置页机器行 / `sw_status`：
   - [ ] bwrap 机：`远程组件 0.2.3 x86_64 · 围栏 bwrap`。
   - [ ] landlock 机：`· 围栏 landlock（abi N，降档：…）`。
   - [ ] none 机：`⚠ 无法围栏` 行 + 指引（不是绿灯硬扛）。
3. serve 启动的降档可见性：Docker 机开受限会话，查宿主日志
   - [ ] 能看到 `dsh-core: fence tier: landlock (abi N — …)` 一行（stderr 进捕获）。

## 4. 回归锚点

- [ ] 正常 bwrap 机的受限会话行为与旧版一致（read-only 读通、workspace-write 只写工作区+tmpfs /tmp 可写）。
- [ ] `DSH_CORE_BWRAP` 覆盖、`bin/bwrap` 伴随部署、PATH 三序不变。
- [ ] 老远端残留 core 0.2.2：版本门放行（patch 漂移零打扰），状态面 fence 显示 unknown 而非猜测。

## 5. 结果记录

| 步骤 | 通过 | 备注 |
|---|---|---|
| 2 fenceinfo 三态 | ☐ | |
| 2 landlock 档强制力 | ☐ | |
| 3 部署/状态/设置页 | ☐ | |
| 3 降档 stderr 可见 | ☐ | |
| 4 回归锚点 | ☐ | |
