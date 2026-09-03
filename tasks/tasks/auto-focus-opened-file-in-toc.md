# 自动定位目录中的当前文件

Status: Completed (2026-09-02 11:07)
Kind: Task

## Scope

- 包含：目录文件树在打开文件和恢复目录后自动定位当前文件。
- 不包含：文档标题目录的导航行为。

## Target
- [x] T1: 用户打开 Markdown 文件或刷新阅读器后，左侧目录自动聚焦当前打开的文件。

## Plan

1. 追踪当前文件选中、目录恢复与手动定位的共享路径。
2. 复用既有定位行为，在当前文件选中时自动展开、滚动并聚焦。
3. 验证打开文件、目录异步恢复、树外文件降级、类型检查与构建。

## Result

- T1: 源码将打开文件与目录恢复的共享选中路径改为自动展开、居中滚动并聚焦；Chromium 冒烟检查确认打开、恢复和树外降级行为。
- Review gate: Skipped — 用户未请求独立 Reviewer；已自查共享调用路径、嵌套目录、手动定位、树外文件和独立文件模式。

## Verification

- Passed: npm run check、npm run build、git diff --check、两组 Chromium 聚焦冒烟检查及 Context/Lessons 校验均通过；按项目规则未运行测试套件。
