# ADR-0003: 镜像/同步功能完全放弃
- 状态: accepted
- 日期: 2026-08（`drafts/CONTEXT.md` §5.8 决策；具体日来源未明确）

## 背景

`dsh-remote` 的核心模型是「镜像工作区」：选远程目录后在 `$DSH_HOME/remote-workspaces/<host>-<user>-<port>/<basename>`
建真实本地副本，配 `.dsh-remote-meta.json`，再用三方冲突感知的 `rw_sync` / `rw_push`（含 `ignore` 规则、
`autoPush` watcher、TaskManager 后台任务）双向同步（`drafts/features-breakdown.md` §2.3/§2.4）。
合并草案曾把它设计为「模式 B：镜像（按需）」，默认模式 A 远程原生（`drafts/CONTEXT.md` §4.2、§5.3）。

## 决定

**完全放弃镜像/同步**——`sync` / `ignore` / `tasks` / `mirror` 目录逻辑一律不移植；需要时再做开关
（`drafts/CONTEXT.md` §5.8）。

## 后果

- 工作区只有「远程原生」一种形态：`ssh://` 路由 + 占位目录，不产生本地副本（`drafts/CONTEXT.md` §5.3、§4.2）。
- 没有同步心智负担，也没有三方冲突算法需要维护；`rw_sync` / `rw_push` / `autoPush` / `ignore` 均不存在
  （R0.6「全砍」清单，`drafts/CONTEXT.md` §6.1-1c）。
- 代价：官方工作区注册表看不见远程工作区（占位目录即 cwd），且镜像曾提供的「绕开路径」也一并消失
  （`drafts/CONTEXT.md` §7「dsh-workspace 注册表」条）。
- dsh-remote 时代留下的镜像 meta 目录成为可清理残留（`drafts/CONTEXT.md` §2.5）。

## 被否方案

- **模式 B 按需镜像**（`drafts/CONTEXT.md` §4.2/§5.3 草案）：需要本地工具链/离线改/大文件分段的场景，
  但引入双重心智与同步正确性负担，未采用。
- **移植 `sync.js` + `ignore.js` 作为 `sw_sync` / `sw_push`**：曾在合并映射表里列为 ➕ 移植项
  （`drafts/features-breakdown.md` §4），随后被 §5.8 推翻。
