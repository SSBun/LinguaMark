# 增加 Twitter 仅帖子解析模式

Status: Completed (2026-08-29 22:01)
Kind: Task

## Scope

- 包含 `x.com` 与 `twitter.com` 页面中的可见帖子正文。
- 不包含作者信息、互动控件、导航、侧栏、推荐等非帖子文字；不改变模型协议与显示设置。

## Target
- [x] T1: 在 Twitter/X 页面发起解析时，分析输入仅包含帖子正文，不包含页面导航、侧栏等非帖子文字。
- [x] T2: 非 Twitter/X 页面继续使用现有解析行为。

## Plan

1. 将 Twitter/X 页面的文本发现范围限制为可见帖子正文，并复用现有文本块采集与滚动增量流程。
2. 运行类型检查与构建，检查改动范围和生成产物。

## Result

- T1: 构建后浏览器烟测访问 https://x.com/check，仅采集 TWITTER_POST_SENTINEL，导航、作者、互动按钮和侧栏哨兵均未进入分析输入。
- T2: 同一浏览器烟测访问 https://example.com/check，通用采集仍返回正文与侧栏两个普通页面文本块。
- Review gate: Skipped — 用户未要求独立对抗审查；已完成本地差异与失败模式自检。

## Verification

- Passed: npm run check 与 npm run build 均成功；Twitter/普通页面定向浏览器烟测符合 T1/T2；git diff --check 与 Context validate 均通过。
