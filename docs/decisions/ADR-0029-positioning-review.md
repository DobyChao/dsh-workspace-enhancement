# ADR-0029: 项目定位复评——官方 SSH 家族进 rc 后的 A/B/C 细化对比

- 状态: proposed（**事实已核实**；§3 推荐待所有者拍板，拍板即关 `UPSTREAM-6`）
- 日期: 2026-10-08
- 范围: 官方 SSH 四包进 `next` 通道后，我方路线的成本 / 收益对比；拍板对命名、
  远程围栏、待办排序的连带后果
- 关联: 细化 **ADR-0026** §5（A/B/C 原文与 0.1.6-alpha 事实仍在那里，本文不复述）；
  连带 **ADR-0025**（远程围栏现行做法）、**ADR-0001**（包名）、`BUG-12`；
  档案 [R48](../rounds/R48-project-direction-review.md)

## 0. 结论

1. **触发条件 ② 半命中**：官方 SSH 四包 `next` = `0.2.0-rc.2`，与宿主 `latest` 同版——
   已进 rc 通道；但**仍未接入 Web 路径**、仍不进默认组合、宿主**仍硬拒 Windows**。
2. **纯 B 今天不可行**：B 等于放弃 Windows 宿主，而 Windows 是所有者自己的主战场。
3. 推荐 **A′**：差异化并存（= A），但把**契约语义**向官方对齐——尤其远程围栏改走
   `confine(argv, policy)` 的逐次策略（官方 `dsh-sandbox-ssh` 的形状），使「上游支持
   Windows 宿主」那天切换成 provider 替换而不是重写。
4. 定位一旦拍定，包名跟随（§4.1）。

## 1. 事实更新（2026-10-08 核，引用均带包 + 版本）

| 事实 | 证据 |
|---|---|
| 四包（`dsh-ssh` / `dsh-fs-ssh` / `dsh-subprocess-ssh` / `dsh-sandbox-ssh`）`next` = `0.2.0-rc.2`（09-29 发），`alpha` = `0.2.1-alpha.1`；`latest` 仍停 `0.1.6-alpha.1` | `npm view … dist-tags` |
| 宿主 `@deepseek-ai/dsh` `latest` = `next` = `0.2.0-rc.2` ⇒ SSH 家族与宿主家族**同版发布** | 同上 |
| `dsh@0.2.0-rc.2`、`dsh-web-app@0.2.0-rc.2` 的 `dependencies` **不含** SSH 四包 ⇒ 仍是自定义 profile 的 opt-in | `npm view … dependencies` |
| 宿主平台：`dsh-ssh@0.2.0-rc.2` `lib/index.js` 仍 `process.platform !== linux/darwin` 即抛 `SSH runtime requires a POSIX client` | 解包 |
| README「Known Limitations」原样保留：No Windows endpoint / automatic provisioning / reconnect or replay；Web workspace UI paths still assume host filesystem access | `dsh-ssh@0.2.0-rc.2` README |
| 远程围栏语义：`SshSandboxProvider.confine(argv, policy, signal)` 把**本次** policy 发到远端 helper，取回 enforcing argv + enforcement + denialSignatures + runnerFailureRules；**`danger-full-access` 由消费者跳过 `confine()`** | `dsh-sandbox-ssh@0.2.0-rc.2` `lib/index.js` + README |
| 子进程语义：「SSH carries requests and observations; it does **not itself confine** the payload」 | `dsh-subprocess-ssh@0.2.0-rc.2` README |

**对照我方（master `8be8b4a`）**：远程 cwd 上 `confine` 被短路成恒等 argv
（`src/remote-confine.ts` `passthroughConfinedArgv`），围栏改在 `SshSubprocessEngine.spawn`
里按会话档施加；单次提权靠 `AsyncLocalStorage` 从 `ctx.shell.run` / `start` 旁路带进 spawn
（`src/remote-spawn-policy.ts`）。上游每多一个执行入口就要再接一次——`BUG-12`
（0.2.0-rc.2 官方 pwsh 改走 `shell.execute`）就是这一结构的直接产物。

## 2. 选项

ADR-0026 的 A/B/C 之外补两个变体：**A′**（A + 契约对齐）与 **B′**（按宿主平台分叉）。

| 维度 | A 并存 | **A′ 并存 + 契约对齐** | B 切官方 | B′ 平台分叉 | C 只走自有 |
|---|---|---|---|---|---|
| Windows 宿主 | ✅ | ✅ | ❌ 放弃 | ✅（走我方） | ✅ |
| 远端前置 | 零预装；围栏档要核心 | 同 A | node + helper + 整棵依赖 + SHA-256 pin | POSIX 宿主同 B，Windows 同 A | 同 A |
| 浏览器面 / 多机注册表 | ✅ | ✅ | 要自己接（官方 Web 未接） | ✅ | ✅ |
| 远程围栏语义 | 现状：spawn 内施加 + 旁路提权 | `confine` 逐次 policy，同官方 | 官方 | 两套 | 现状 |
| 上游执行入口新增时 | 每次补接（BUG-12 类） | **自动覆盖**（入口都走 `confine`） | 免费 | Windows 侧同 A′ | 每次补接 |
| LSP / PTC 等全家桶 | 无 | 无（可后补） | 随上游 | 仅 POSIX 宿主 | 无 |
| 我方维护面 | ssh2 传输 + Go 核心 + 混合门面 + 围栏仿真 | 同 A，围栏仿真变薄 | 只剩注册表 + UI | A′ 全部 + 官方集成，**测试矩阵翻倍** | 同 A |
| 一次性切换成本 | 0 | 中（一轮 spike + 一轮实现） | 高（重写执行面、丢 Windows） | 高 | 0 |
| 何时失效 | 官方接 Web + 支持 Windows | 同左，但届时切换便宜 | — | 官方支持 Windows 后退化成 B | 官方换赛道时不掌握时点 |

量级参照（master `8be8b4a`）：`src/` 约 2.6 万行 TS + `core/` 约 1.6k 行 Go；
09-10 → 10-07 共四代宿主家族（0.1.5 / 0.1.7-rc.2 / 0.2.0-rc.1 / 0.2.0-rc.2），
适配类条目 `UPSTREAM-3/5/8/9/10` + `BUG-12`——**跟上游是常态成本，与选项无关**，
差别只在每次漂移要动多少处。

## 3. 推荐：A′

理由按权重：

1. **Windows 宿主是硬差异**，且根因是结构性的（官方依赖 OpenSSH ControlMaster +
   Unix socket 转发，ADR-0026 §5 补充表）——短期不会消失。这排除了 B。
2. **B′ 的收益（POSIX 宿主上免费拿 LSP/PTC）不抵翻倍的测试矩阵**；所有者主场是 Windows。
3. **C 已不成立**：scope-watch / tag-watch 已上线（`UPSTREAM-7` / `INFRA-20`），我们事实上在评估。
4. **A′ 相对 A 的增量正好打在痛点上**：远程围栏改成 `confine` 逐次策略后，
   - `BUG-12` 一类「新入口漏接提权」整类消失（danger 由消费者跳过 `confine`，原 argv 直跑）；
   - `remote-spawn-policy.ts` 的旁路存储可整块退役（需 spike 确认我方工具 `sw_exec` /
     win32 `bash` 也改为经 `confine`）；
   - 子进程 provider 不再自行施加围栏，与官方 `dsh-subprocess-ssh` 语义一致；
   - 将来官方支持 Windows 宿主时，我方执行面可整体换成官方 provider，注册表 / UI / 目录流保留。

**A′ 的已知代价**：不经 `confine` 的消费者（若有）在远端将不受围栏——这与官方本地语义
一致（本地 `subprocess-local` 同样不自行施加），但相对现状是**收窄**，须在 spike 里列清
受影响消费者并写进 `SECURITY.md`。

## 4. 连带后果

### 4.1 命名

| 选项 | 包名 |
|---|---|
| A / A′ / C | 改名为远程工作区类名称（候选 `dsh-remote-workspace`）；旧包 `npm deprecate` 指向新包。`sw_` 前缀与 `dsw` 命名空间不动（模型面与词典零迁移）。现在改代价最低：3080 已不装、用户面小 |
| B | 退成「注册表 + UI」薄插件，范围变了，届时再定名 |
| B′ | 同 A′ |

### 4.2 远程围栏

A′ 下：`BUG-12` 不单修，作为「围栏改走 `confine`」spike 的验收用例；先做权限真值表与
重叠机制清理（遗留 bwrap 向量、`remoteSandbox` 字段、审批门 UI），再动执行路径。
条目见 backlog `AUDIT-7` / `REQ-I22`。

### 4.3 不受影响

`INFRA-23`（L1 实机冒烟进 CI）、`INFRA-24`（拍板队列）与选项无关，可先行。

## 5. 重评触发（更新 ADR-0026 §5）

| # | 条件 | 2026-10-08 |
|---|---|---|
| ① | 官方支持 Windows 宿主 | 未命中（`lib/index.js` 平台判断仍在） |
| ② | 进 rc / 正式通道**且**接入 Web 路径 | **半命中**：rc 是，Web 否 |
| ③ | 我方维护成本明显超过切换成本 | 未命中（四代漂移各一轮 PR 收口） |
| ④ | 需要官方 LSP / PTC 全家桶 | 无需求 |

① 命中即重开本 ADR；② 全命中时复评 B′。

## 6. 复现证据的命令

```powershell
$c = '.tmp\npm-cache'
npm view @deepseek-ai/dsh-ssh dist-tags --json --cache $c
npm view @deepseek-ai/dsh@0.2.0-rc.2 dependencies --json --cache $c
npm pack @deepseek-ai/dsh-sandbox-ssh@0.2.0-rc.2 --cache $c --pack-destination .tmp\upstream6-0.2.0-rc.2
```

解包产物属本地素材（`.tmp/`，不入库）；引用行号须带包与版本。
