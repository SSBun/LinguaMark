# 为 Markdown Viewer 增加收藏与最近浏览列表

Status: Completed (2026-08-31 20:06)
Kind: Task

## Scope

- 包含：Markdown 阅读器当前目录或文件的收藏、本地持久化、收藏列表与最近浏览展示。
- 不包含：从弹窗重新打开收藏项、跨设备同步或同时管理多个目录授权。

## Target
- [x] T1: Markdown 阅读器导航栏右上角提供收藏当前目录或文件的按钮，以及打开收藏列表的按钮。
- [x] T2: 点击收藏列表按钮后打开列表弹窗，并展示全部已收藏的目录和文件路径。
- [x] T3: 收藏列表弹窗同时展示最近 5 条浏览记录。
- [x] T4: 收藏与收藏列表按钮点击后立即响应，不再出现可感知卡顿，同时保留现有收藏持久化和列表内容。

## Plan

1. 移除点击响应路径中的异步存储等待与重复列表重建。
2. 收藏状态先在界面更新、后台持久化失败时回滚；列表弹窗同步打开并移除高成本背景模糊。
3. 验证即时响应、失败回滚、持久化内容及现有阅读流程。

## Result

- T1: 检查 src/markdown.ts：导航栏右侧操作组包含收藏与收藏列表按钮，当前本地文件、独立文件、授权根目录及目录内文件都会更新收藏目标；npm run check 通过。
- T2: 检查源码与 dist/markdown.js、dist/markdown.css：收藏写入 markdownViewerFavorites，原生 dialog 渲染全部目录和文件路径，构建产物包含对应控件与样式。
- T3: 检查源码与构建产物：浏览项按最近优先去重，并在读取和写入时均限制为 MAX_VIEWER_RECENTS=5，弹窗最近浏览区使用该列表。
- T4: 检查并构建 src/markdown.ts 与 public/markdown.css：收藏状态在 storage.set 前同步更新，列表点击路径无 await 和列表重建，dialog 同步 showModal，背景模糊已移除；静态检查输出三项均符合预期。
- Review gate: Skipped — 用户未要求独立对抗审查。

## Verification

- Passed: npm run check、npm run build 与 git diff --check 通过；点击路径检查结果为 favoriteVisibleUpdateBeforeStorage=true、listClickHasAsyncWait=false、listClickRebuildsList=false，弹窗 backdrop 无 backdrop-filter。
