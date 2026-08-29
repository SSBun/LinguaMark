# 创建并在 Chrome 打开英文测试文章

Status: Completed (2026-08-29 08:44)
Kind: Task

## Target
- [x] T1: 生成一个可独立打开的英文文章 HTML 测试页，覆盖五大句型、句界边缘标点、段落重要度以及链接和行内强调。
- [x] T2: 通过临时本地 HTTP 地址在 Google Chrome 打开该测试页，并确认活动标签页显示正确页面标题和页面 URL，以便 HTTP/HTTPS Content script 可以运行。
- [x] T3: 使用 unpacked `dist` 扩展启动 Chrome for Testing，通过本地 HTTP 打开英文测试文章，确认扩展 service worker 和页面均已加载，并保持该 Chrome 窗口供手动操作。
- [x] T4: 修复测试文章在启动的 Chrome 窗口中只显示部分内容的问题，确保整篇文章可正常布局和滚动浏览且没有意外裁切。
- [x] T5: 隔离开发 Chrome 使用仓库外的稳定 profile 目录，关闭和重新启动后保留 Options 中的供应商、Model ID 与 API Key；profile 权限受限且不会进入 Git，临时 HTTP 服务仍随窗口关闭。
- [x] T6: 使用最新 `dist` 和稳定开发 Profile 启动 Chrome for Testing，并保持测试文章与设置页可供用户操作。

## Plan

1. 创建一个无外部依赖的英文文章 HTML fixture，以真实段落和专门测试段覆盖标记逻辑。
2. 提供一个受控启动脚本，在脚本生命周期内托管测试页并用 unpacked `dist` 扩展启动 Chrome for Testing。
3. 启动该会话，确认扩展 service worker、页面标题和 HTTP URL，并保持窗口打开直到用户关闭 Chrome。

## Result

- T1: Python HTMLParser 成功解析 tests/fixtures/english-reading-article.html：标题正确、共 14 个段落，并检查到五大句型、缩写小数、引号分号、省略号、链接与强调样例。
- T2: Google Chrome 活动标签页返回标题 LinguaMark English Article Test，页面通过临时本地 HTTP URL http://127.0.0.1:55033/english-reading-article.html 成功加载。
- T3: scripts/open-test-article.mjs 已启动 Chrome for Testing 并加载 dist unpacked extension；Playwright 观测到扩展 service worker ID medhnmkhdmaobcojalkahdeilmbhgfel，活动页标题正确且 HTTP URL 为 http://127.0.0.1:56662/english-reading-article.html；启动器 PID 83671 保持运行。
- T4: 根因为 Playwright headed context 默认固定 1280×720 viewport，浏览器窗口放大后其余区域留白；启动器改为 viewport:null 并 start-maximized。全新会话观测 viewport 3008×1575，屏幕截图确认文章占满内容区并可纵向滚动。
- T5: 根因是启动器每次 mkdtemp 并在 finally 删除 profile。现改用仓库外稳定目录 ~/Library/Application Support/LinguaMark/DevChromeProfile（权限 700），仅关闭临时 HTTP 服务。已迁移当前 profile；隔离检查确认 provider/model/API key 均存在且未输出值，关闭再启动后使用同一 profile。
- T6: npm run open:test-article 已用最新 dist 和稳定 DevChromeProfile 启动 Chrome for Testing；文章 URL 为 http://127.0.0.1:60546/english-reading-article.html，Options page 已打开，viewport 2560×1323，启动器 PID 788 保持运行。
- Review gate: Skipped — 用户未要求独立 Reviewer 审查。

## Verification

- Passed: 启动日志返回 status=ready、正确文章标题、扩展 ID、Options URL、稳定 Profile 与 2560×1323 viewport；PID 788 存活。
