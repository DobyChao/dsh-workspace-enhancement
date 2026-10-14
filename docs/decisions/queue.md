# 拍板队列

待拍板项的**推荐、代价、期限**只收在这里。状态仍在 [`../backlog.md`](../backlog.md) §3；本文件不是第二份待办。

- `reversible-until: YYYY-MM-DD`：含当天。次日 `npm run check:static` 失败。处理方式是执行推荐并把该行挪进文末「留痕」，或把日期往后延并写明原因。
- `irreversible`：不自动执行。定位、改名、红线类决定停在这里，直到所有者写下一句。
- 闸门只报逾期，**不改产品代码**。
- 默认可逆窗从写入日起 14 天。本表可逆项的期限是 2026-10-28。

## 开放

| ID | 推荐 | 代价 | 期限 |
|---|---|---|---|
| UPSTREAM-6 | A′（ADR-0029：我方运行时并存，契约对齐官方） | 继续维护我方 SSH 运行时 | irreversible |
| REQ-A7 | 改名为 dsh-remote-workspace | 挡于 UPSTREAM-6；要 deprecate 旧包名 | irreversible |
| UX-8 | A：分组行锚改为 data-row-key | Session 行槽迁移（B）不做 | reversible-until: 2026-10-28 |
| REQ-I25 | ADR-0030 选项 B：未知方法默认转发本地委托 | 纯本地会话更接近官方；路径方法仍拦 | reversible-until: 2026-10-28 |
| INFRA-8 | 所有者把标准 profile 写入宿主组合 | 代理不碰产品 profile（红线） | irreversible |
| AUDIT-5 | 分组视图的 compact 徽标不再修，除非所有者说留 | 丢掉一个未确认要不要的徽标修复 | reversible-until: 2026-10-28 |

## 留痕

尚无逾期执行。执行过的推荐写在这里：日期、ID、做了什么、原期限。
