# 增加仅解析主内容设置

Status: Completed (2026-08-29 22:21)
Kind: Task

## Target
- [x] T1: 设置页提供独立的解析控制区块和可持久化的“仅渲染主内容”开关。
- [x] T2: 开启后只分析并渲染主内容，忽略导航栏、侧边栏和其他 UI 控制组件；关闭后保留现有页面文本范围。
- [x] T3: 开关默认开启，旧设置缺少该字段时也按开启读取。

## Plan

1. 在独立“解析控制”区块持久化默认开启的主内容模式，并在分析开始时固定本次扫描值。
2. 优先从 `main`、`article`、`[role='main']` 采集；无语义主容器时回退到 body，但排除导航、侧栏、表单和交互控件。
3. 验证开启／关闭、旧设置回退、预加载和滚动扫描、代码块排除及正文行内链接／代码保留。

## Result

- T1: 设置页新增独立“解析控制 / PARSER”区块和“仅渲染主内容”开关；开关写入 displaySettings.mainContentOnly，且不混入分析设置、翻译设置或渲染配置区块。
- T2: Chrome smoke 默认只发送 article 内 Main heading 与含行内 code 的正文，未发送 Header、Navigation、Sidebar、Button、Footer 或代码块；关闭开关后上述 UI 文本恢复进入 Prompt，而代码块仍排除。
- T3: DEFAULT_DISPLAY_SETTINGS.mainContentOnly=true，readDisplaySettings 对旧设置缺失字段回退为 true；新 Chrome 配置页初始开关为开启并可持久化关闭。
- Review gate: Skipped — 用户未要求独立 Reviewer 审查。

## Verification

- Passed: npm run check、npm run build、node --check tests/chrome.mjs、git diff --check、Context validate、dist 静态检查及主内容开关开启／关闭 Chrome smoke 均通过；按用户规则未运行项目测试套件。
