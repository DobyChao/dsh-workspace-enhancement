# R42 — INFRA-19/20：实机测试矩阵 + WSL Linux lab + 上游信号升级

> 一轮 = 一条指令（用户点名 INFRA-20 + 19）= 一个 PR（#47，squash `3b550cb`）。
> 日期：2026-09-28。前置：R41（UPSTREAM-8/9 已合并，peer pin 已升 `^0.1.7-rc.2`）。

## 1. 背景

用户定调管理模型后的首个派发轮。两个 gap 的动机：

- **实机**：UPSTREAM-8 证明 typecheck / 单测 / boot 三层对「工具执行路径」的运行时
  断点全盲（render / 后台 jobs 只在真实工具调用时走到）；用户明确：本机有 WSL，
  lab 覆盖 Windows + Linux 双宿主，browser-use 驱动，case 不宜太少或太多。
- **上游**：2026-09-28 `latest` 翻版是用户肉眼发现的——上游信号缺一个廉价的日常探针。

## 2. 机理修正（本轮最重要的事实纠错）

R41 曾写「drift 装新家族却 boot 旧全局宿主 ⇒ 运行时接缝漏网」。**核对 upstream.yml
后确认此说不确**：CI drift 的 boot smoke 步骤一直 scratch 安装 `dsh@<channel>`（含
CLI 闭包不动点安装）再 boot——boot 的就是被测的；只有**本地** boot-smoke 用全局
0.1.5 宿主。真正的漏网是**没有任何用例驱动工具执行路径**。R41 已加追记；INFRA-20
的范围据此重定：

1. `latest` 翻版检测（tag 每日轻探）——昨天的翻版确实无哨兵；
2. 真实安装家族的服务面契约测试——settings 面若再被重写，CI 先红；
3. 工具路径覆盖 → 归 INFRA-19 实机矩阵（M3/M4），不冒充 CI 能拦。

## 3. 交付（PR #47）

**INFRA-19**：
- `docs/uat/matrix.md`：实机 case 唯一清单。L1 每 PR 冒烟 7 条 + L2 发版前 12 条 +
  双 lab 对拍；每条锚定真实事故（F1/F2、BUG-3/5/7/9/10/11、REQ-I11/I18/I19、
  UPSTREAM-8 ①②）；数量纪律 = 无事故锚点不进清单；跨 agent 执行协议：能力缺失 →
  `agent-missing:<cap>` 标 blocked，不静默跳过；含结果表模板。
- `scripts/dev-lab-wsl.{ps1,sh}`：WSL Linux 宿主 lab（50600）。踩掉三个真坑：
  ① WSL 继承 Windows PATH，`command -v dsh` 捞到 `/mnt/c` 假 shim（只认 Linux 侧
  二进制 + 探测 `~/.local/node/bin` 等非登录 PATH）；② 本机 WSL 藏着 **0.1.0-rc.6**
  远古 CLI（家族校验：与 peer pin 不符 → 重装 `@next` + 重置一次性 profile——远古
  CLI 不写 `allowBuilds` 等新模板，混用直接 `ERR_PNPM_IGNORED_BUILDS`）；③ 宿主
  `pnpm-workspace.yaml` 模板把 `allowBuilds` 留占位符等操作者拍板（win32 是用户手填
  的；一次性 lab home 由脚本代填）。smoke 探针 = token 兑换 303 → cookie → `GET /`
  200 → `/api/dsw/connections.list` ok=true（0.1.7 裸 `/` 不回 200，必须带会话）。

**INFRA-20**：
- `scripts/upstream-tags.mjs` + 基线 + `upstream.yml` 每日作业（04:00 UTC + 手动）：
  宿主包 dist-tag 漂移开 issue，逐通道含义（latest=peer-pin 政策 / next=手动
  dispatch drift / alpha=预警）；纯逻辑单测。
- `test/settings-family-face.test.ts`：真实安装家族 settings 面 ⊆ 两族已知并集
  （0.1.5-rc.1 全局 / 0.1.7-rc.2 仓库，`Object.getOwnPropertyNames` 实测枚举）+
  UPSTREAM-8 崩坏复现（无 `get` 的真实面 → `localePreferenceOf` 不抛回退 EN）。

文档：AGENTS.md §3（新命令 + 矩阵指针）、docs/testing.md §8（实机层）、CHANGELOG。

## 4. 验证

- 本地全套：`check:static` + `typecheck` + `test:agent`（50 文件，含两个新测试）+
  `build` + WSL `verify-linux.sh` 全绿；`.gitattributes` LF 罩住新 `.sh`（FIX-7 前鉴）。
- **WSL lab 真机 smoke PASS**：家族重装 0.1.0→0.1.7-rc.2、allowBuilds 代填、tarball
  安装、boot + 通道断言全绿（ssh2/cpu-features 原生构建缺 make 回落纯 JS，可用）。
- `node scripts/upstream-tags.mjs` 本地实跑：基线写入 + silent 通过。
- CI：PR #47 ubuntu 22/24 + windows + 标题闸门全绿。

## 5. 遗 tail

- **L1/L2 首轮 browser-use 执行未跑**（本 PR 不涉工具路径改动，按矩阵 §2 不触发）：
  下一个涉工具/服务/接缝的 PR 试运行并回填结果表，摩擦处修清单。
- tag-watch 默认每次 tag 动都开 issue——噪声节奏待用户反馈后调。
- WSL 缺 `make`：`apt install build-essential` 可启用原生构建（当前纯 JS 回落够用）。
- 管理模型其余部分（跨 agent 能力预检 + 点名派发写死进 AGENTS.md）= `INFRA-21`，
  未派发。
