# A3 — 发布 npm `v0.1.0`

## 目标

把 R0.5–R5 的成果发布为 npm 包 `dsh-workspace-enhancement@0.1.0`：元数据与 CHANGELOG 定稿、
`npm pack` 预检（无 secrets / 无机器数据）、lab tarball 安装冒烟、评审通过后打 tag 并发布。
需求 ID：**A3**（`drafts/ideas.md` 工程遗留表）。

## 拆解

AgentTeams 轮次 `pkg-release-team`（角色：engineer4 / verifier4 / reviewer4）。

| 任务 | 角色 | 依赖 | 内容 |
|---|---|---|---|
| t1 | engineer4 | — | 元数据 + CHANGELOG + tag `v0.1.0` + pack 预检 |
| t2 | verifier4 | t1 | lab tarball 安装冒烟 |
| t3 | reviewer4 | t1 | 评审发布准备（元数据 / CHANGELOG / pack） |

## 验证

- **pack 预检**：`npm pack` → `dsh-workspace-enhancement-0.1.0.tgz`（329,029 B、sha256 `bad2e90c…fc347`、
  **103 文件**）；`--dry-run` 内容核对：含 `lib/`、`cordis.patch.yml`、LICENSE、README×2、package.json；
  **无** `.pem` / `known_hosts` / `machines.json` / `drafts` / `.agent-teams` / secrets / `.tmp` / `.bak`。
- **lab 冒烟（t2）**：**PASS**——既有 web profile 上 `dsh plugin --profile web add <tgz>` 与全新 profile
  两条安装路径均验证；结论「tarball 可发布形态成立」（附一个首次安装摩擦点）。
- **评审（t3）**：**needs-fix（低危，仅文档措辞）**——5 项判据中 ①③④⑤ PASS，② 发现一处
  **事实性过度声明**：CHANGELOG 与 README×2 声称「承载 bash / 文件 / PTY / **LSP**」，
  而全库无任何 LSP 实现（该说法自上游 dsh-ssh README 继承）→ 修复 4 处后 reviewer4 出具
  **confirm**（`git show v0.1.0:README.md | grep -c LSP` = 0），发布闸门判定 **approve**。
- **单测**：175/175（CONTEXT §0/§6.2 记录，发布口径）；typecheck 0 错误。

## 结果

- 元数据定稿：`version=0.1.0`、`author` 指向本仓库维护者、`repository` / `bugs` / `homepage`
  全部指向本仓库（无上游残留；上游仓库名仅作为 README 的来源致谢保留）。
- CHANGELOG 0.1.0 节：R0.5–R5 里程碑、特性清单、UI 抛光、质量与后续排期（手工路径生成，
  因 `commit-and-tag-version` 与未提交元数据策略冲突）。
- 发布：`dsh-workspace-enhancement@0.1.0` 已发布 npm（2026-08-26，**用户 2FA 放行**；团队全程未独立
  publish）；3080 已换 registry 包并重启验证（RPC + client bundle 指纹全绿）。
- 相关提交：`4c59018`（chore: prepare npm v0.1.0 release）、`91aa8d2`（docs: correct changelog
  unit-test count 172→175）。

## 遗留

- **来源口径差异（待核）**：`drafts/CONTEXT.md` §0 记 `tag v0.1.0` = `59d9078`；
  发布轮评审记录中 tag 为 `f49e633`（LSP 措辞修正后重指）。两份权威来源不一致，本报告照录两者，
  以 CONTEXT §0 为准待核。
- 真实 profile 自此改为 **registry 依赖 `^0.1.0`**（不再 link）；`pnpm-workspace.yaml` 的
  `allowBuilds` 已重写干净。
- README 首次安装的 `allowBuilds` 须知已写入。
- 后续轮引用：S1/S2（`v0.1.1`）、R6 I18N（`v0.1.2`）；发布动作一律由用户 2FA 执行。

来源：`.agent-teams/archive/pkg-release-team/team.json` + `inbox/captain.jsonl`；`drafts/CONTEXT.md` §0/§6.1(2)、`CHANGELOG.md` 0.1.0
