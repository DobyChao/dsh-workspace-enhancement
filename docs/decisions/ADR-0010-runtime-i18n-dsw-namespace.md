# ADR-0010: 运行时国际化——复用框架 `ctx.locale`、命名空间 `dsw`、单一共享词典
- 状态: accepted
- 日期: 2026-09-01（R6 I18N 落地补记）

## 背景

R6 需要把三面（客户端 UI 文案 / 宿主「远程认知」系统提示 / `sw_*` 工具描述与错误）统一为 zh/en 双语。
盘点规模约 240+ 条（`drafts/i18n-audit.md` §6-1，经 `drafts/i18n-design.md` 收口为 zh/en 各 340 键）。
关键排他事实：官方 client 包已注册的命名空间包含 `workspace`（`dsh-client-ui-workspace`），而
`ctx.locale.register` 对重复 (ns, locale) **抛错**——用 `workspace` 会让本包直接崩溃
（`drafts/i18n-design.md` §2.1）。

## 决定

（`drafts/i18n-design.md` §0 决策表、§14 定稿文本；`drafts/CONTEXT.md` §5.12）

- **复用框架 locale 体系与设置页 Language 行**，不发明语言存储、不新增语言 UI、不写 preference。
- **单一共享词典 `src/locale/`**：`dsw.ts`（zh = 键集真源）、`dsw.en.ts`（`Record<DswKey, string>`，
  缺/多键即编译错）、`index.ts`（出口 + 纯 `lookup`）、`host.ts`（宿主语言与 `localizeTool`）。
- **命名空间 `dsw`**（不可用 `workspace`）；键命名 `<surface>.<scope>.<item>`，
  surface ∈ {flow, form, side, settings, status, rpc, prompt, tool, permission}；禁止字符串拼接键名。
- **宿主语言**：`ctx.get('settings')?.get('locale')?.preference ?? 'en'`，**每次求值即时读**
  （无缓存、无订阅；`settings` 为可选服务，缺失定格 `en`）。
- **工具描述/参数 getter 化**（路线 B）：`defineTool` 之后用 `Object.defineProperty` 把 `description` /
  `parameters` 覆盖为 getter（官方 `run_code` 自证范式）；输出渲染与错误在执行时取词。
- 客户端 `inject` 加 `'locale'`（硬依赖）；row-badges 用 `CONN_STATE_LABEL_KEY` 单一键源 + 切语言就地重绘。
- **运行时零新增依赖**（`dsh-client-locale` 仅 devDep 类型源；不进 tsdown EXTERNALS）。

## 后果

- 三面全量双语，zh/en 键集严格相等（340/340），typecheck 0 错误、单测 225/225（`CHANGELOG.md` 0.1.2）。
- **已知不一致窗口**：无持久化 preference + 中文浏览器时，客户端 UI 为 zh 而宿主模型面为 en
  （框架 `FALLBACK_LOCALE = 'en'` 语义）；在设置页 Language 选一次即收敛为三面一致
  （`drafts/i18n-design.md` §4.2/§8）。
- 例外清单（`drafts/i18n-design.md` §13-1~8，无新增例外）：机器可 parse 标记两语**逐字节一致**、
  `tool call aborted`、`bad-request: …` 协议层、品牌与枚举值、库原始错误、注释/日志、数量词不做复数、
  禁止动态键；协议/数据校验与路由错误（registry / transport / session-workspaces）与 win32 `bash` 守卫
  统一按宿主语言取词。

## 被否方案

- **命名空间 `workspace`**：与 `dsh-client-ui-workspace` 注册冲突直接崩溃（`drafts/i18n-design.md` §2.1）。
- **两份镜像词典（宿主一份、客户端一份）**：会漂移——`prompt` 与 UI 共享 `permission.*` 词条，拆分即双写
  （`drafts/i18n-design.md` §1）。
- **非类型化 `register(ns, locale, dict)`**：放弃「防漏译 + 键名防拼错」的类型收益（§3.4）。
- **工具描述路线 A（静态）**：无法随语言变化；**路线 C（unregister + re-register）**：触发
  `tools/change`、客户端工具目录 churn 与注册时机竞态（§6.2）。
- **宿主侧缓存语言 / 仿浏览器探测 / 持久化 provisional**：越权改框架行为且无信息来源（§4.1、§8）。
