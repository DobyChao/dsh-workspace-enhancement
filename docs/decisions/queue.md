# 拍板队列

待拍板项的**推荐、代价、期限**只收在这里。状态仍在 [`../backlog.md`](../backlog.md) §3；本文件不是第二份待办。

- `reversible-until: YYYY-MM-DD`：含当天。次日 `npm run check:static` 失败。处理方式是执行推荐并把该行挪进文末「留痕」，或把日期往后延并写明原因。
- `irreversible`：不自动执行。定位、改名、红线类决定停在这里，直到所有者写下一句。
- 闸门只报逾期，**不改产品代码**。
- 默认可逆窗从写入日起 14 天。2026-10-28 那批已写入留痕；开放表里不再有可逆项。

## 开放

| ID | 推荐 | 代价 | 期限 |
|---|---|---|---|
| UPSTREAM-6 | A′（ADR-0029：我方运行时并存，契约对齐官方） | 继续维护我方 SSH 运行时 | irreversible |
| REQ-A7 | 改名为 dsh-remote-workspace | 挡于 UPSTREAM-6；要 deprecate 旧包名 | irreversible |
| INFRA-8 | 所有者把标准 profile 写入宿主组合 | 代理不碰产品 profile（红线） | irreversible |

## 留痕

- 2026-10-16，UX-8：分组行锚改为 data-row-key（Session 行槽迁移不做）。原期限 reversible-until: 2026-10-28。
- 2026-10-30，REQ-I25：采纳 ADR-0030 选项 B，未知方法默认转发本地委托。实现仍是待办，本记录不改门面代码。原期限 reversible-until: 2026-10-28。
- 2026-10-30，AUDIT-5：分组视图的 compact 徽标不再修。原期限 reversible-until: 2026-10-28。
