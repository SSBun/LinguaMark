# 以玻璃拟态重写扩展面板和设置页

Status: Completed (2026-08-28 20:58)
Kind: Task

## Target
- [x] T1: LinguaMark Popup 面板和 Options 设置页采用链接 StyleKit 的 Glassmorphism 视觉语言，保持现有分析、三层开关、供应商配置与保存行为。
- [x] T2: 两个页面在亮暗背景下均保持清晰层级、键盘可用性、可读对比度和明确状态反馈，且不引入新 UI 框架。
- [x] T3: 在隔离的开发 Chrome 中加载 unpacked extension，自动验证 Popup、Options 保存和核心扩展流程，并保留可供用户查看的隔离 Chrome 窗口。
- [x] T4: 消除 Popup 周围非预期的黑色容器／外框，使玻璃面板自然贴合扩展弹窗可视区域，同时保留必要的玻璃层次、圆角和内容可读性。
- [x] T5: 为 Popup 恢复清晰的外轮廓圆角面板，同时避免重新出现宽黑色容器边框，并保持内容不裁切、弹窗高度不超过 Chrome 限制。
- [x] T6: 保留 Chrome 原生 action popup，使用贴边方形外轮廓消除黑色宿主角；内部控件继续保留圆角玻璃层次，并以实际 Chrome 锚定 Popup 截图验证。

## Plan

1. 按 StyleKit Glassmorphism 规范统一 Popup 与 Options：深墨夜景、5%–12% 无色玻璃、40–60px blur、180% saturation、受光顶边、暗色底边、2%–3% 颗粒和唯一香槟金强调色 `#E4B863`。
2. 重写两个页面的结构和状态样式，覆盖 hover、focus-visible、active、disabled、loading、error、success、44px 点击区域与 reduced-motion，同时保留全部现有 DOM ID 和业务行为。
3. 扩展隔离 Chrome 测试以检查样式 tokens、键盘焦点、设置保存、分析流程与开关，再构建并启动持久隔离 Chrome 供用户检查。

## Result

- T1: Popup 与 Options 已按 StyleKit Glassmorphism 重写：#0B1322 深墨场景、7%/11% 中性玻璃、48px blur、180% saturation、受光顶边、暗色内缘、2.5% 噪点及唯一界面强调色 #E4B863；原业务 DOM ID 保持。
- T2: CSS 覆盖 hover、focus-visible、active、disabled、loading、error、success、44px+ 控件、无 blur 回退及 prefers-reduced-motion；Popup 实测尺寸 390×593，未超过 Chrome 600px popup 高度。
- T3: npm run verify 通过 6 个逻辑测试和隔离 Chrome E2E；E2E 断言玻璃 tokens、48px 控件、设置成功态、分析/渲染/开关全流程。持久隔离 Chrome 已加载扩展与 Options，文章 URL 为 http://127.0.0.1:49699/english-reading-article.html，启动器 PID 44222。
- T4: 根因为 Popup 使用 10px 外层 padding 包裹圆角玻璃面板，深墨 body 背景从四周露出形成黑色矩形容器。现已改为面板 0,0 起始、390px edge-to-edge、无外层边框/圆角；Focused Chrome smoke 实测高度 575px 且截图无黑色外框。
- T5: Popup 已采用 24px 外轮廓圆角：body 保持透明，深墨场景移入同尺寸 popup-shell，shell 与 panel 均裁切为 24px，避免宽黑色外框。Focused Chrome smoke 实测 390×577、panel 贴边；透明 PNG 角点 alpha=0、面板内 alpha=255。
- T6: 按用户选择保留原生 action popup，并将 popup-shell/popup-panel 外轮廓统一为 0px 方形、贴边覆盖原生矩形宿主；内部按钮、开关组和图例继续保留圆角。通过 chrome.action.openPopup() 打开真实锚定 Popup 并截图，确认无额外黑色角块。
- Review gate: Skipped — 用户未要求独立 Reviewer；已用真实 Chrome 锚定 Popup 截图完成常规自审。

## Verification

- Passed: npm run build 通过；隔离 Chrome 真实 action popup 成功打开并截图，方形外轮廓完整覆盖宿主表面、内部圆角未受影响；持久隔离 Chrome 已重新启动。
