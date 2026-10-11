# R51 — 三个 P1 一轮：REQ-I22 围栏 spike + INFRA-23 L1 进 CI + UPSTREAM-11 桌面适配

> 一轮 = 用户点名三个 P1（2026-10-10「三个P1的你编排一下做」）= 一个 PR（分支
> `feat/req-i22-confine-spike`，`Refs: REQ-I22 INFRA-23 UPSTREAM-11`）。
> 基线 master `9012af2`。三个只读侦察子代理并行（上游 confine 调用面 / e2e 设计 / 桌面方案落地）。

## 0. preflight（INFRA-21）

node 24.18 ✓ / npm 11.16 ✓ / git ✓ / gh 已登录 ✓ / wsl bash 可用 ✓ / 50599 被占（lab 在跑，
本轮未用）/ 50600 空闲 ✓ / pack tarball 0.2.2 ✓ / browser-use 自报**可用但未用**（本轮无 UI
改动）。**事后追加的 blocked**：① WSL 本地预验（WSL dsh 停 0.1.7-rc.2 未升级 + WSL 网络栈
坏——Mirrored 启动失败 0x8007054f、eth0 缺失、Windows↔WSL 转发不可用；用户 10-11 指示停调）；
② WSL Linux 复验（`verify-linux.sh` 依赖 `npm ci`，同因网络不可达）。Linux 侧由 CI ubuntu 兜底。

## 1. REQ-I22 — 远程围栏 `confine` 化 spike → ADR-0031（proposed）

**产出**：[`ADR-0031`](../decisions/ADR-0031-remote-fence-confine-policy.md)。两个待核问题答死：

1. **不调 confine 的调用方**（0.2.0-rc.2 磁盘全量枚举）：浏览器终端
   （`dsh-api-terminal-controller` 裸 argv 直达 spawnTerminal，无模式检查）、
   workspace-changes git 探针 ×3、tool-fs-search ripgrep、sensevoice worker；`-local` 执行器
   组合整体不围（执行器选择的属性）。fs 写不经 confine（进程内栅栏）——不属收窄。
2. **交互终端两条路**：persistent shell 工具（`dsh-terminal-bash` `spawnArgv`）**经 confine**；
   浏览器终端**不经**。⇒ 终端策略**所有者 10-11 已拍**（ADR-0031 §4）：persistent shell
   （模型侧）仍拒；浏览器终端（人开的）对齐官方**放行不设防**（「人开的终端当然不设限」）。
3. **可行性**：两家族 `dsh-sandbox`/`dsh-subprocess` seam **SHA256 全等** ⇒ confine 模型可双家族
   同开；danger=消费者跳过 confine（三处同形证据）；官方无魔法前缀协议（policy 编进 runner
   flag、spawn 不解标记）——我方标记 argv 与官方 runner-argv **同构**；`SubprocessSpawnSpec`
   无 policy 字段正是 ALS 旁路存在的原因。

**防伪造**：进程内 `WeakMap<argv 对象, {mode,root}>` 身份登记，不认字符串前缀（伪造 = miss =
`--sandbox off`，无逃逸收益；注册表保的是路由正确性）。**实施切分**：`REQ-I27`（新 todo/P1），
`BUG-12` 提权半作其验收。**未核实**：0.1.7 消费者集合（磁盘无包）；dsh-sandbox-ssh /
dsh-subprocess-ssh registry 现状（两磁盘源未装，ADR-0029 §6 pack 成功为旧证）。

## 2. INFRA-23 — L1 冒烟进 CI（假模型路线）

**拍板**（设计侦察结论）：M3–M7 断言全是**工具/宿主行为**，但断言位置在真 agent-loop 的 render、
真 jobs owner 契约、官方工具链里——直驱会自证。路线 = **脚本化假模型**：
`dsh-headless`（官方，`--json` NDJSON 事件流，含 tool_call/tool_result）+
`dsh-llm-deepseek` 的 settings `llm-deepseek.baseURL` 指向本地假 Anthropic Messages 服务器 +
Actions services sshd 容器。

**落地**（P1+P2 切片）：
- `scripts/e2e-l1/fake-model.mjs` — 假 Anthropic 服务器（SSE/非流式双支持；steps 支持**函数步**，
  从上一轮 tool_result 里动态取 M4 的 job id）。
- `scripts/e2e-l1/profile.mjs` — boot-smoke 同款临时 DSH_HOME 物化：三 bundle profile
  （base+headless+本插件）+ settings 钉假模型端点 + machines.json（key/password 双模式）+
  `dsw-routes` 占位树会话 cwd。
- `scripts/e2e-l1/run-cases.mjs` — M3（echo/exit3/no-output 标记）+ M4（后台 job id/增量/exit
  标记）+ M5（fs 写读回 + 无 CAS 误报）逐例断言，case 工厂闭包跨步传状态。
- `package.json` `e2e:l1`；`ci.yml` 新 `e2e-l1` 作业（每 PR，ubuntu + `lscr.io/linuxserver/
  openssh-server` 容器 2222 + `dsh@0.2.0-rc.2`；**secret 未配置时自跳过并留 notice**）；
  `matrix.md` §3 加 CI 通道注记；`AGENTS.md` §3 加命令行。

**首验现场（WSL，已 blocked）**：管道本身通（宿主 boot、事件流、断言编排都工作），卡在组合层——
`dsw: target names unknown connection "c1"`（发生在任何工具调用前，占位 cwd 解析时 registry 查
无此机）+ 我方 web 行 headless 下 pending（等 `connection` 服务，warning 不致命）。**假设**（留
CI 迭代）：占位树/注册表在 headless 组合的解析路径与 web 不同，或 `sshRegistry` 侧 machines
装载路径差异。CI lane（健康 Linux + 0.2.0 家族）是首验通道，红了就修。

**待所有者**：repo secret `DSW_E2E_SSH_PASSWORD`（一次性建，即弃容器口令；建好前 e2e-l1 自跳过）。
命名（`e2e:l1` 独立 vs 并进 `e2e`）按 B 建议取独立——`e2e` 的 L4 语义（testing.md）不动。

## 3. UPSTREAM-11 — 桌面适配方案 1（所有者 10-10 点名执行）

- **每周探测**：`scripts/upstream-desktop.mjs`（+ 基线 + 9 用例单测）——monorepo
  （`deepseek-ai/deepseek-harness`，public/master，2026-10-11 实测三+1 文件全可达）**四文件**
  指纹（sha256/bytes/version）：`apps/desktop/package.json`、`project-manager.ts`（+
  **语义断言**：必须仍含 `PROFILE_TEMPLATES.web`，断裂时 issue 点名「方案 1 前提失效」）、
  `core-package-set.ts`（子代理新发现的组合 pin 机制文件）、`desktop-host/src/index.ts`。
  `upstream.yml` 加 `desktop-watch` 作业（周一 05:00 UTC + 手动，tag-watch 同款 issue 模式）。
- **文档**：`compatibility.md` 新 §7（四耦合面存续/安装入口受限/双端并跑与更新行为/哨兵盲区；
  §7→§8 顺移，§1 不另立桌面行）+ §3 L3 补 desktop watch + §8 维护义务；README 处的安装路径与
  防混淆（社区假包 `dsh-desktop` 0.2.0，@deepseek-ai/dsh-desktop E404 实测）都收在 §7.1/7.2。
- **UAT**：`docs/uat/UPSTREAM-11-desktop.md`（9 步：注入/通道/ssh2/目录流/语言/应用更新
  sanitizeProfile/端口事实 D6/双端并发 D7 含备份前置；**执行人=用户**）；`uat/README.md` 表补行；
  `AGENTS.md` §3 补 `upstream-desktop.mjs` 命令行。
- **10-11 复核事实**：桌面=web 等价性在 master 仍成立（桌面 `0.2.1-alpha.2` == 宿主 alpha 同版本）；
  端口档案漂移（19387 vs master `--port 0`）做成 D6 实机记录而非猜测。

## 4. 本轮验证

`check:static` ALL PASS（lib/ WARN 为既有，本轮未动 src/）· `typecheck` 0 · `test:agent`
602 pass / 0 fail（3 skip 为 JSX 沙箱常态）· `upstream-desktop` 9/9 · 桌面三+1 文件 raw 直取
200 实测 · e2e-l1 管道在 WSL 半程验证（见 §2 blocked）。**WSL Linux 复验 blocked（网络）**，
Linux 侧由 CI ubuntu（check 22/24 + e2e-l1）承担。

## 5. 遗 tail（待用户/所有者）

| 事项 | 谁 |
|---|---|
| 建 repo secret `DSW_E2E_SSH_PASSWORD`（e2e-l1 从自跳过转真跑） | 所有者 |
| ADR-0031 整册拍板（§4 终端策略已拍：persistent shell 拒、人开浏览器终端放行不设防）→ 解挡 `REQ-I27` 开工 | 所有者 |
| 桌面 UAT D1–D7（先装官方桌面版；D5 等桌面下一版） | 用户 |
| e2e-l1 CI 首跑红 → 修到绿（§2 的组合层假设） | 代理（本 PR 内迭代） |
| WSL 修复（升级 dsh 到 0.2.0 线 + Mirrored 网络配置）后补本地预验 | 用户/环境 |

来源：backlog §1 三行；ADR-0029 §4.3；R48 §3；三个子代理侦察报告（上游 confine 调用面 /
INFRA-23 设计 / UPSTREAM-11 落地清单）；`matrix.md`；`docs/testing.md`。
