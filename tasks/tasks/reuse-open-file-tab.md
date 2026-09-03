# 复用已打开文件的 Chrome 标签页

Status: Completed (2026-09-03 10:06)
Kind: Task

## Target
- [x] T1: 打开文件时，若 Chrome 已有该文件的页面，则定位并刷新该页面，不创建重复页面。

## Plan

1. 确认本地文件进入 Chrome 标签页的生命周期与重复页面产生边界。
2. 在已有同一文件页面时复用并刷新该页面，保持首次打开行为不变。
3. 运行类型检查、构建和浏览器重复打开冒烟核验。

## Result

- T1: 隔离 Chrome 同窗口与跨窗口重复打开只保留并激活一个已刷新 file:// 页；两个独立 Reader 选择同一 FileSystemFileHandle 时关闭空白重复页、刷新旧页并读取更新内容。
- Review gate: Skipped — 用户未请求独立对抗性审查；已完成差异自审。

## Verification

- Passed: npm run check、npm run build、node --check tests/file-picker.mjs、git diff --check、Context/Lessons 校验及隔离 Chrome 冒烟核验均通过；按规则未运行测试套件。
