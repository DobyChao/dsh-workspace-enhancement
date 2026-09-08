# Pull Request

<!-- 一个 PR = 一轮可验收的改动。小修直接改也行，但状态与记录规则不变。 -->

## 关联

- 需求/待办 ID（`docs/backlog.md`）：`REQ-` / `INFRA-` / `SEC-` / `BUG-`
- 相关决策（如有）：`docs/decisions/ADR-`

## 改了什么

<!-- 一段话；列出主要文件/模块 -->

## 怎么验证的

- [ ] `npm run check` 通过（本地或 CI）
- [ ] 沙箱内用 `npm run test:agent` 跑过（若涉及单测）
- [ ] 涉及 UI：`npm run e2e` 关键场景通过（lab 50599，绝不碰 3080）
- [ ] 涉及组合/挂载：`--dump-config` 断言过
- [ ] 涉及上游依赖：`docs/compatibility.md` 已更新

## 风险与边界

<!-- 已知限制、未覆盖场景、需要用户拍板的点 -->

## 用户验收（UAT）

- 脚本：`docs/uat/`
- 反馈模板：`docs/uat/FEEDBACK.md`

- [ ] 本 PR 附带了 UAT 脚本（涉及用户可见行为时必需）
