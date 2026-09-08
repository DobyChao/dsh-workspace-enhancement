# ADR-0012: 副工作区 `fs:只读 + exec:开` 已知绕过尚未拍板
- 状态: proposed
- 日期: 2026-08-26（用户实测记录；2026-09-02 lab 审计补证）

## 背景

2026-08-26 用户实测（`drafts/CONTEXT.md` §7-⑧）：主工作区为远程、副工作区为**本地**且配置
`fs:'r' + exec:'on'` 时，模型用官方 `pwsh`/`bash` 工具的 **`workdir` 参数**指向本地副工作区绝对路径，
混合 provider 的 `worldOfCwd(workdir)` 判为本地世界 → spawn 落到本地 → 命令文本内的写操作（如
`Set-Content`）**绕过 fs 门**（fs 只挡文件工具，命令文本本就不解析）。

2026-09-02 lab 审计（隔离沙箱实例 + `test/side-workspace-attacks.test.ts` 真实分支 13/13，
矩阵见 `drafts/security-audit.md`）证明绕过面**比 ⑧ 更宽**：

- **H1**：主工作区 world 的命令用**绝对路径**写 `fs:'r'` 副工作区，`exec:on`/`off` **都拦不住**（TC04）；
- **H2**：⑧ 的 `workdir` 相对写复现（TC05，已实锤）；
- **H3**：只读根内文件可被主 world 命令**删除**，无完整性保护（TC06）；
- 补充：`workspace-write` 档位下 runtime 层仍无进程围栏（TC12），补充围栏只可能在官方 tool/sandbox 层；
- 门禁侧 8 项（文件工具写/edit、exec 门含嵌套子目录与 PTY、大小写+正斜杠归一、rw+off 语义）
  **全部符合文档行为**，无实现级 bug。

根因：① 官方 shell 工具有 `workdir` 参数（本插件无法改官方工具）；② fs 只读是**文件工具级**门，
命令世界按 cwd 路由且命令文本不扫描（有意为之）；③ `exec:'on'` 意味着「允许在该世界启动进程」，
进程内写自然不受 fs 门管（`drafts/CONTEXT.md` §7-⑧「根因」、`drafts/security-audit.md` §1/§3）。

## 决定

**未拍板（proposed）**。候选补强方案（`drafts/CONTEXT.md` §7「候选补强（未拍板）」）：

- **a)** 提示注入对 `fs:'r'` 的副工作区**强制建议/醒目声明**「必须搭配 `exec:'off'` 才是真只读」
  （现状文案仅泛述）；
- **b)** 门层把 `fs:'r' + exec:'on'` 组合视为**非法配置**——attach/update 时拒绝保存或强制把 `exec` 置 `'off'`
  （UI 一致性 + 安全语义最干净，属行为变更，需拍板）；
- **c)** UI 只读档位默认联动 `exec:'off'`；
- **d)** 维持现状、文档诚实声明（`r+on` 组合的语义上限）。

## 后果

- 现状（方案 d 的等价物）下，用户预期「没做什么防护」在命令面上成立：对 pwsh/bash/终端这一整面，
  `fs:'r'` 基本是装饰性的（`drafts/security-audit.md` §3-1）。
- 方案 **b 只封 H2**；**H1/H3 只能靠 a 或 d** —— 在不解析命令文本的前提下，门层没有可行的拦截面
  （`drafts/security-audit.md` §4）。
- `test/side-workspace-attacks.test.ts` 的 G2 组（TC04/05/06）断言的是**当前现实**，补强落地后应翻红作为
  回归警报；G1 组（8 项）是门禁行为的长期回归（`drafts/security-audit.md` §4）。
- 备注：`sw_exec` 不受 H2 影响（它不接受本地 server）；入口只有官方 `pwsh`/`bash` 的 `workdir`
  （`drafts/CONTEXT.md` §7-⑧「备注」）。

## 被否方案

无（尚未拍板）。唯一被排除的方向是**在门层解析/扫描命令文本以拦截写操作**——命令文本有意不扫描
（不可靠，且会让门层承诺无法兑现的保证）（`drafts/r5-design.md` §5、`drafts/security-audit.md` §3）。
