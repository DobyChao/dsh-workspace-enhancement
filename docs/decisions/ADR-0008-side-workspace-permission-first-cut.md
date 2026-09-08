# ADR-0008: 副工作区权限第一刀 = fs 只读/读写 + 执行开关
- 状态: accepted
- 日期: 2026-08-25

## 背景

副工作区需要「逐工作区权限」，但 core 的权限模型无法表达它：`sandbox/mode` 是每会话一个 knob，
而 `dsh-workspace` 只认 canonical cwd 对应的单个工作区（`drafts/r5-design.md` §2）。
权限维度的候选很多（命令白名单、网络、装包……），需要先定一个可交付、可验证的「第一刀」。

## 决定

2026-08-25 用户拍板（`drafts/ideas.md`「R5 拍板」、`drafts/r5-design.md` §1/§5）：

- 每个副工作区独立一组权限：**`fs: r | rw`** + **`exec: on | off`**；
- **fs 写门**：命中 `fs:'r'` 根的写类操作（`writeText` / `editText`）拒绝，抛
  `FsError(FS_PERMISSION_DENIED)`；
- **exec 门**：命中 `exec:'off'` 根时拒绝 `spawn` / `spawnTerminal`，判定输入仅
  `spec.cwd` 与 `spec.argv[0]`；
- 两道门都实现在混合门面内（`src/mixed.ts`），本地与远程副工作区都参与；主工作区无权限概念
  （永远 rw + exec）；
- 命令白名单 / 网络 / 装包留作后续档位。

## 后果

- 门禁在**声明范围内**真实有效：lab 审计的 8 项门禁用例（文件工具写/edit、exec 门含嵌套子目录与 PTY、
  大小写与正斜杠归一、rw+off 语义）全部符合文档行为，无实现级 bug（`drafts/security-audit.md` §2/§3）。
- 语义诚实性：只读/禁执行是**启动层**强制——命令文本有意不扫描，进程一旦启动即脱离全部管控
  （`drafts/r5-design.md` §5、`drafts/security-audit.md` §1/§3）。
- 默认建议：真正要只读 → `fs:'r'` **同时** `exec:'off'`；提示注入写明这一点。
- 已知绕过面（H1/H2/H3 与 runtime 层无进程围栏）另行决策，见 ADR-0012。

## 被否方案

- **命令白名单 / 网络 / 装包档位**：留作后续档位，不在第一刀（`drafts/ideas.md` R5 拍板）。
- **复用每会话 `sandbox/mode`**：无法表达逐工作区语义（`drafts/r5-design.md` §2）。
- **扫描/解析命令文本以拦截写操作**：有意不扫描——不可靠，且会让门层承诺它无法兑现的保证
  （`drafts/r5-design.md` §5、`drafts/security-audit.md` §3）。
