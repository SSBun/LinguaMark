# 悬浮窗点击后展示胶囊菜单

Status: Completed (2026-09-02 10:52)
Kind: Task

## Scope

- 包含：调整现有悬浮菜单的展开形态与视口边界定位。
- 不包含：新增菜单操作或改变解析、学习卡片行为。

## Target
- [x] T1: 点击悬浮窗后在原位置展开纵向长胶囊，现有菜单项在其中纵向排列且保持可用

## Plan

1. 将现有菜单重排为围绕悬浮球展开的纵向胶囊，并保留操作名称与无障碍语义。
2. 让拖动和视口缩放继续约束展开菜单不越出可用区域。
3. 完成类型检查、构建、静态交互核验与差异审查。

## Result

- T1: Chromium 扩展冒烟检查确认点击 LM 展开 52×106px 纵向胶囊，菜单保持在视口内，点击“解析当前文章”会收起菜单并打开学习卡片
- Review gate: Skipped — 用户未要求独立 Reviewer 审批

## Verification

- Passed: npm run check、npm run build、git diff --check、5/5 静态检查、Chromium 扩展冒烟检查与 Context validate 均通过；按项目规则未运行测试套件
