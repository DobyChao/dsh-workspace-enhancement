# R28 — INFRA-15 核心 tarball 残废构建 + npm 分发缺口

## 目标

两个实锤一起收：

1. **残废 tarball**：`core/vendor/`（bwrap/rg）被 gitignore，`build-core.mjs`
   对缺失**静默跳过**——fresh clone 构建出没有 `bin/` 的 tarball，远端安装
   `chmod +x bin/bwrap bin/rg` 断链，面板显示「核心未安装」（用户报告
   「有些服务器装不上」的根因；同一 tarball 在补过 vendor 的机器上构建就正常，
   所以现象随机）。
2. **npm 分发不含工件**：`package.json` `files` 只有 `lib` + `cordis.patch.yml`，
   任何 npm 安装实例 `deployCore` 必报 `core artifact missing`（只有 `link:`
   安装的 lab 靠共享仓库目录侥幸能跑）。

## 政策修订（2026-09-16，所有者拍板，本轮内生效）

第一版修法是「把 linux-x64 `bwrap` + `rg` 入库、打进 tarball」。所有者否掉了它——
**rg/bwrap 这类二进制由本插件提供不合适**（来源说不清、许可要跟着走、二进制进 git
不可回收）。最终政策：

| 工具 | 来源 | 缺失时 |
|---|---|---|
| `dsh-core` | **本仓库**（Go 源码随 npm 包分发，所有者确认没问题） | `core.deploy` 报 `core artifact missing` |
| `bwrap` | **远端发行版**（上游只有源码 tarball，没有官方二进制） | **拒绝**该次围栏操作（`SANDBOX_UNAVAILABLE`），不崩宿主；文案给安装命令 + 「临时 `danger-full-access`」 |
| `rg` | **远端优先**；远端没有才由宿主取 **ripgrep 官方 release** 的静态件 | 降级：核心照装，状态备注给官方地址、sha256 与缓存路径（可手放或远端自行安装） |

即：本仓库**不再分发任何第三方二进制**——不进 git、不进 npm 包。

## 拆解与结果

| 改动 | 内容 |
|---|---|
| `core/vendor.json` + `core/artifact.json` | 单一来源：第三方 pin（官方 URL/sha256/member/许可/安装提示）与第一方版本/架构 |
| `scripts/sync-core-manifest.mjs` | 由两份 JSON 生成 `src/core-artifact.ts` 与 `src/core-vendor-pins.ts`；`check:static` 第 14 道闸门拦漂移 |
| `scripts/build-core.mjs` | 只产 `dsh-core`（不再拷 vendor）；`go build` 失败硬失败；`GOTELEMETRY=off`；日志走 stderr（`npm pack --json` 解析 stdout） |
| `src/core-vendor.ts`（新） | `rg` 的取件/校验/解包/缓存：`curl`（尊重 `https_proxy`；`DSW_CORE_VENDOR_PROXY` / `DSW_CORE_VENDOR_BASE_URL` / `DSW_CORE_VENDOR_OFFLINE` 覆盖），缓存 `$DSH_HOME/cache/dsw-core-vendor/rg-<ver>-<arch>/`，失败给可操作文案 |
| `src/core-deploy.ts` | 部署前探远端 `command -v rg` / `bwrap`：有 `rg` 什么都不推，没有才取官方件并随核心推送；`chmod` 清单按实际推送生成；`MANIFEST` 必填项只剩 `dsh-core` |
| `core/jail.go` | bwrap 解析三层：`DSH_CORE_BWRAP` → 同目录 `bin/bwrap` → 远端 `PATH`；都无 ⇒ 带安装命令的可操作拒绝（新增 `core/jail_test.go` 5 例） |
| 提示词 | `model-prompts.ts` 的远端工具箱提示改写（「别 apt 装 rg」的旧语义作废）；`remote-sandbox.ts` 新增 runner 缺失提示（含各发行版命令） |
| 拒绝文案分诊（2026-09-17 补） | `fenceMissingHint`：detail 里出现 `dsh-core` ⇒ 提示「核心没装/被删，去设置页 `core.deploy`」；只有出现 **runner 名字**（`bwrap`）才提示装 bubblewrap；两者都不是 ⇒ **不给提示**。第一版只看 `No such file or directory` 这类通用串，把「核心被删」误报成「缺 bwrap」（lab 实测抓到） |
| `package.json` / `pack-smoke.mjs` / `release.yml` | `files` 加 `core/dist`；`prepack` 守卫（缺工件即构建、构不出硬失败）；`check` 链加 `build:core`；pack 冒烟硬要求工件、上限 5→15 MB；发布机加 `setup-go@v5` |
| 文档 | `ADR-0024` §0/§1/§3 按新政策改写（含政策修订说明）；backlog INFRA-15 |

## 验证

- **Go**（沙箱内可用：`GOCACHE` 指到工作区）：`go test ./...` 全过（含新增
  `jail_test.go` 5 例：显式覆盖 / 同目录副本 / PATH 回退 / 缺失可操作 / 覆盖不可用）；
  `GOOS=linux GOARCH=amd64 go build` 产出核心工件。
- **工件实测**：`tar -tzf` 只有 `./dsh-core` + `./MANIFEST.json`（无 `bin/`），
  MANIFEST 的 `files` 只有 `dsh-core`。
- **TS**：`typecheck` 干净；`check:static` ALL PASS（79 行 backlog、第 14 道闸门）；
  `test:agent` 502/504（2 例 `(process-level)` 属沙箱受限）；`npm run build` 绿。
- **pack 实测**（`npm_config_cache` 指到工作区）：137 文件 / **5.67 MB**，
  包内只有 `core/dist/dsh-core-0.2.0-dev-linux-x64.tar.gz`，无第三方二进制。
- **负向对照**：sha256 不匹配 → 拒绝且**不写缓存**；`DSW_CORE_VENDOR_OFFLINE=1`
  → fail-closed 且文案含官方地址；bwrap 缺失 → 错误携带 `SANDBOX_UNAVAILABLE` +
  安装命令 + `danger-full-access` 出路。
- **本地怎么模拟「自动装 rg」**（不然 fetch+推送那半只能在真缺 rg 的机器上跑到）：
  ① 宿主级真下载：临时 `DSH_HOME` + `DSW_CORE_VENDOR_PROXY`，直接调 `ensureRgVendor()`；
  ② lab 端到端：起 lab 前设 `DSW_CORE_VENDOR_FORCE_MISSING=rg`（部署会自报该开关），
  清掉 `$DSH_HOME/cache/dsw-core-vendor/` 后点「部署核心」，detail 会写
  `fetched rg …`（首次）或 `provisioned rg … from the host cache`（命中缓存），
  再在远端核对 `~/.dsh-core/current/bin/rg --version`。

## 遗留

- push + PR + CI：`go test` / `go build` 由 CI 权威复核；bug 报告仍以 CI 为准。
- **远端实机四组合 UAT 未跑**：远端「有/无 bwrap」×「有/无 rg」。lab 现有机器都装了
  bwrap，需要一台干净的容器/VM 才能验「缺 bwrap 时拒绝 + 提示」与「缺 rg 时自动取官方件」。
- `rg` 的下载路径在沙箱内只跑了注入 seam 的单测（本地构造 tarball），**真实网络下载**
  要等实机/有网络的 shell 验一次（含代理与镜像两种）。
- `0.2.0-dev` 版本号现在只写在 `core/artifact.json` 一处；升级核心时记得同时看
  `core/vendor.json` 的 pin 是否仍是最新官方 release（不强制跟）。

来源：`docs/decisions/ADR-0024-remote-core-protocol.md` §3；`docs/backlog.md` INFRA-15
