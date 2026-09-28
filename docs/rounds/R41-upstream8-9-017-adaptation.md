# R41 — UPSTREAM-8/9：0.1.7-rc.2 实机两断点修复 + `latest` 翻版升 pin

> 一轮 = 一条指令 = 一个 PR（#44，squash `89b5c3f`；原 #45 stacked PR 按用户要求并入关闭）。
> 日期：2026-09-28。前置：0.2.2 已发布（R40），宿主 `latest` 仍是 0.1.5-rc.3。

## 1. 背景

用户实机报告 0.2.2 × 宿主 0.1.7-rc.2 两处断点：

1. `lib/locale/host.js` 的 `hostLocaleOf` 调 `settings?.get('locale')`，宿主已无此方法——凡渲染本地化标记（空输出 / exit code / 沙箱拒绝）即 render 抛错。
2. `lib/exec-tool.js` 三处后台任务 `owner: exec.agent`（对象），与宿主要求不符——后台 bash/sw_exec 全灭。

同日实测宿主包 `@deepseek-ai/dsh` 的 `latest` 翻到 `0.1.7-rc.2`——触发 UPSTREAM-5 留下的「peer 等 `latest` 翻再升」。

## 2. 契约核验（磁盘权威源，红线 7）

本机三处权威源（产品 profile / 全局 / lab）均无 0.1.7 家族 ⇒ 按 upstream.yml 同款方式在
`.tmp/next-contract` scratch 安装 `@next`（`--no-save --legacy-peer-deps`，**所有包必须一条命令装齐**，
分次装会互相回收——workflow 注释里 warn 过的坑）核出真实契约：

| 契约 | 0.1.5-rc.x | 0.1.7-rc.2 |
|---|---|---|
| settings 服务 | `get(namespace)` 命名空间读取器 | **整个重写为 `SettingsForms`**（`describe`/`update`/`replace`/`mutate` 配置表单面），无 `get`；`describe()` 每次遍历全部 profile 条目、带 revision 副作用（发 `settings/document-updated`），是配置 UI 读取不是热路径读 |
| jobs `start` owner | `owner?: Agent`（实例） | `owner?: SessionId`（**字符串**；owner 预检要求 id 命中在册 agent） |
| jobs 输出 | hooks `readOutput()`（增量） | spec `output` **pull source**（registry 泵进 ring，模型经 `read` 消费带 channel 的 chunks）；`run(job)` 收 `JobHandle` |
| 家族判别 | — | registry 上的 `readAt`（0.1.7 独有） |
| 官方 bash 标记 | — | 0.1.7 硬编码 EN（`(no output)` / `[exit code: N]`），不走 settings 翻译 |

关键发现：**两个断点都比报告的范围大**——locale 不止缺方法而是读取模型没了；后台不止 owner
变了，输出通道也换了（只改 owner 的话 `job_output` 会读到空 ring）。

## 3. 处置（PR #44，单提交）

- `src/locale/host.ts`：新增 `localePreferenceOf` 防御窄化——settings 有 `get` 走 0.1.5 读法
  （zh 保留），否则回退 EN（与官方 0.1.7 工具一致）；`t()`/`active()` 不再抛。
- `src/exec-tools.ts` 三处后台注册（远程 sw_exec / 本地 sw_exec / win32 bash）：
  - `jobOwnerOf`：`readAt` 在场判 ring 家族——0.1.7 传 `agent.id`（官方 bash 同款），0.1.5 传实例；
  - `collectSources`：collect readers 晚绑定 pull source（官方 bash 的 `processSources` 同款接法）；
  - `deltaRingSource`：宿主 shell 增量 `readOutput()` 的字节游标桥——8 MiB 保留界、UTF-8
    码点边界裁剪、窗口下读 lossy 不报错（ring 同语义）；0.1.5 路径原样保留（`readOutput` hook）。
- pin：13 peer + 21 devDep `^0.1.5-rc.1` → `^0.1.7-rc.2`；cordis `^4.0.4` / schemastery `^3.18.4`
  （家族闭包 `~4.0.4`/`~3.18.4`；**锁文件会把 cordis 压回旧版**，range 必须一起升）。
- 文档：compatibility.md（§1 未发布行 + §2 案例行 + §3.1 通道表 + 「seam 包 latest 不作数」注记）、
  README 双语兼容表重排（0.1.7 = 锚定；0.1.5 = 停在 0.2.2，运行时兼容）、CHANGELOG Unreleased。

## 4. 验证

- 0.1.7 形状 fixture 锁进测试：`test/locale-host.test.ts`（SettingsForms 无 `get` 不抛、回退 EN）、
  `test/exec-tools.test.ts`（`jobOwnerOf` 双家族、`deltaRingSource` 字节游标/码点边界/lossy、三处
  ring 注册的 owner + 输出源晚绑定）。
- 首次以 0.1.7-rc.2 为主家族：typecheck 零红 + test:agent 全绿 + build + WSL verify-linux 全绿
  （npm ci / 617+ tests / pack smoke）。
- 跨家族回归：boot 哨兵在 **0.1.5-rc.1 全局宿主**上仍 SMOKE PASS——已装 0.2.2 的 0.1.5 宿主不回退。
- CI：PR #44 ubuntu 22/24 + windows + 标题闸门全绿（两轮：分体提交与合并单提交各跑过一遍）。

## 5. 遗 tail / 教训

- **0.1.7 侧为契约级验证**，真机 UAT 待用户：后台 bash/sw_exec 起任务、`job_output` 读到输出、
  zh 会话标记渲染（0.1.7 上现为 EN，与官方一致）。
- **检出链是用户实机，不是自动化**：typecheck / 单测 / boot 三层当时全绿——断的是运行时契约
  而非编译期形状。两个直接产物：①契约 fixture 从磁盘权威源当轮落盘的纪律（compatibility.md
  已记）；②drift「装新家族却 boot 旧宿主」的结构性漏网 → `INFRA-20`。
  **【2026-09-28 追记纠错】②的机理表述不确**：CI drift 的 boot smoke 步骤**一直是** scratch
  安装 `dsh@<channel>`（含 CLI 闭包不动点安装，upstream.yml boot 步骤）再 boot——boot 的就是
  被测的，本地 boot-smoke 才用全局 0.1.5 宿主。真正的漏网是：**没有任何用例驱动工具执行路径**
  （render / 后台 jobs 只在真实工具调用时走到；boot 哨兵只探 boot + connections.list）。
  对应修正见 R42（INFRA-20 改为：真实家族形状契约测试 + 每日 tag 轻探；工具路径覆盖归
  INFRA-19 实机矩阵的 L1 M3/M4）。
- 本机网络：7890 代理当日长时间抖动/宕机，gh/git 需绕行（`env -u *_PROXY`）；WSL 内 npm 对
  registry 直连绕代理后恢复。
- 管理侧定调（本轮对话）：交互模型 = 用户提需求 → 用户点名一组 backlog（恰好一个 PR）→
  用户合并 → 用户发版；实机测试矩阵（`INFRA-19`）与跨 agent 能力预检（`INFRA-21`）立项。
