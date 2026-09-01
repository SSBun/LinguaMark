# LinguaMark

> Translate. Highlight. Understand.<br>
> 翻译、标注、读懂。

LinguaMark 是一款帮助用户阅读外语文章的 Chrome 扩展。它在原始网页内容之上提供翻译与关键语法高亮，让用户不必频繁离开当前文章即可理解文本。

## 首版目标

- 为网页文章提供翻译。
- 识别并高亮影响理解的关键语法结构，并给出简短解释。
- 集成单智能体系统，统一生成翻译和语法标注结果。
- 支持以下模型供应商：
  - DeepSeek
  - GLM（ZAI／智谱）
  - 通用 OpenAI 兼容接口
- 提供独立的 Chrome 扩展设置页，不把供应商配置混入文章阅读界面。

## 供应商配置

独立设置页至少保存以下信息：

- 当前供应商
- API Base URL
- API Key
- Model ID

DeepSeek 和 GLM 提供预设配置；通用 OpenAI 兼容供应商允许用户填写 Base URL 和 Model ID。

## Pi SDK 可行性结论

完整的 `@earendil-works/pi-coding-agent` SDK 面向 Node.js 22 及以上环境，并依赖文件系统、进程和终端相关能力，因此不适合直接打包到 Chrome 扩展中。Pi 目前没有独立命名的 Web Coding Agent SDK。

首版采用 Pi 的浏览器兼容底层能力，而不是完整 Coding Agent SDK：

- `@earendil-works/pi-agent-core`：提供智能体状态、消息循环、工具调用和事件流。
- `@earendil-works/pi-ai`：官方文档明确支持浏览器环境，并提供 DeepSeek、ZAI 及自定义 OpenAI 兼容供应商能力。

这条路径保留 Pi 的智能体模型，同时避免把 Node.js 专属的编码工具、会话文件和终端运行时带入扩展。

## 初始结构

LinguaMark 将采用 Chrome Manifest V3：

- **Content script**：读取网页可见文字并渲染翻译与语法高亮。
- **Background service worker**：运行智能体并调用模型供应商。
- **Options page**：独立管理供应商、模型和凭据。
- **`chrome.storage.local`**：保存扩展设置。

API Key 不会注入网页 DOM 或交给页面脚本。需要注意，`chrome.storage.local` 不是加密保险库；首版采用用户自带密钥的本地扩展模式，后续只有在需要托管密钥或多人使用时才考虑后端代理。

## 当前实现

首版已经提供可加载的 Chrome Manifest V3 扩展：

- Popup 主动分析当前网页，并独立开关句界、句子重要度和句法角色；每次点击“打开阅读器”都会新建一个状态独立的空白 Viewer，用户再从 Viewer 顶部选择单个 Markdown 文件或目录。Popup 与 Options page 使用 StyleKit Glassmorphism 视觉规范。
- 开启 Chrome 的“允许访问文件网址”后，直接打开本地 `.md` 会在原标签页按当前 Typora Lightmind 主题自动渲染；顶部导航栏可切换按标题自动生成的左侧目录，桌面默认展开、窄屏默认收起。用户还可授权一个目录，在左侧递归浏览全部文件：Markdown 与常见图片可打开，其他文件保留但禁用；目录句柄保存到扩展 IndexedDB，并在权限失效时要求重新授权。Viewer 支持任务列表、Alerts、脚注、YAML、代码高亮、KaTeX 公式和 Mermaid 图表（含 ZenUML）。原始 HTML/CSS 保留视觉效果，但脚本、事件处理器、可执行 URL 和未隔离 iframe 会被阻止。打开文件或切换目录内容不会自动调用模型，分析仍需用户手动触发。
- Options page 保存 DeepSeek、GLM（ZAI／智谱）或通用 OpenAI 兼容配置；DeepSeek 默认使用 `deepseek-v4-flash`。独立的“翻译设置”区块可分别关闭逐句翻译与鼠标悬浮显示；七种文本标记颜色可从 Apple 系统强调色预设中选择，也可直接输入自定义 `#RRGGBB`。
- Background service worker 使用 `@earendil-works/pi-agent-core` 和 `@earendil-works/pi-ai` 发起单 Agent 请求。
- Content script 默认只采集当前分析区域内的主内容，忽略导航、侧栏和 UI 控件；设置页可关闭该限制以恢复既有页面范围。预加载会向 viewport 下方扩展采集区域，滚动覆盖前后区域，分析期间新增或原位更新的可见文本也会增量入队。脚本、样式、代码块、隐藏文字和表单字段值不会进入分析。Background 并发上限默认 10 且可配置；首轮按文本块请求，缺失或无效句子只定向恢复一次，每个文本版本最多请求两次。已通过严格校验的句子会独立渲染并按发现、有效、已渲染和失败句数更新进度，不再被同块坏句阻断。
- Content script 通过 CSS Custom Highlight API 非破坏性渲染：
  - 为每个已分析句子保存简体中文翻译；鼠标悬浮原句，或按 `Alt+Shift+T`（macOS 为 `Option+Shift+T`），会在目标句子上方显示不改写正文的简约翻译浮窗。
  - 在完整句子之间显示纯视觉 `│`。
  - 以 `primary`、`supporting`、`detail` 表示段落内重要度。
  - 标记 `SV`、`SVC`、`SVO`、`SVOO`、`SVOC` 的完整 S／V／O／C 短语；设置页可切回仅标记核心词。
  - 并列、分号和引语报告结构用 `multi` 保留多个互不重叠的顶层分句角色；结构不确定的完整句仍至少返回谓语角色，只有没有限定谓语的标题、标签或残句使用空角色 `fragment`。
- API Key 只由 Options page 与 Background service worker 读取，不会进入网页 DOM 或 Content script 消息。

首版只支持英语原文；整篇翻译、从句递归分析和扩展商店发布尚未包含。

## 调试日志

扩展会以 `[LinguaMark:<scope>] <event>` 输出结构化控制台日志：

- `content`：文章页 DevTools Console，包含可见文本发现、文本版本、滚动／DOM 变化入队、处理态与逐句渲染结果。
- `background`：`chrome://extensions` 中 LinguaMark service worker 的 Inspect Console，包含队列、并发、两次请求预算、有效／已渲染／失败句数、耗时与失败阶段。
- `popup`：Popup DevTools Console，包含用户操作、进度和最终状态。
- `options`：Options page DevTools Console，包含配置保存和连接测试。

日志只包含 ID、计数、长度、状态和耗时，不输出 API Key、Authorization、完整文章正文、Prompt 或模型完整响应。

## 本地开发

```bash
npm install
npm run build
```

然后在 Chrome 的 `chrome://extensions` 中启用开发者模式，选择“加载已解压的扩展程序”，加载 `dist/`。

首次使用：

1. 打开扩展的模型设置页。
2. 选择供应商并填写 Base URL、API Key 与 Model ID。
3. 打开英文网页，点击扩展图标。
4. 选择“分析当前页面”，再按需切换三层标记。

阅读本地 Markdown：

1. 可直接在 Chrome 中打开本地 `.md`；先在 LinguaMark 扩展详情页开启“允许访问文件网址”，扩展会保持原 `file://` URL 并自动渲染。
2. 也可在 Popup 点击“打开阅读器”；扩展每次都会新建一个空白 Viewer，再通过顶部“打开文件”选择单个 `.md`。
3. 如需浏览目录，点击顶部“打开目录”，在授权窗口中选择目录。左侧会递归显示全部文件；`.md` 与 PNG、JPEG、GIF、WebP、AVIF、SVG 可打开，其他文件仅显示。
4. 每个由 Popup 新建的 Viewer 标签页分别保留自己的目录授权；新建 Viewer 不会载入其他页面最近选择的目录。若 Chrome 撤销权限，点击“重新授权”。
5. 如需 LinguaMark 标记，再点击扩展图标手动开始分析。

## 验证

首次运行 Chrome 自动化前安装 Chrome for Testing：

```bash
npm run setup:chrome
```

然后执行：

```bash
npm run check
npm test
npm run test:chrome
```

Chrome 自动化测试会构建并加载 unpacked extension，使用本地 OpenAI 兼容 SSE 服务验证完整通路，不消耗真实模型额度。

如需保留一个加载了 unpacked extension 的 Chrome 窗口并手动操作英文测试文章：

```bash
npm run open:test-article
```

该命令会在 Chrome 窗口关闭时自动停止临时 HTTP 服务，但会保留 `~/Library/Application Support/LinguaMark/DevChromeProfile`，因此供应商、Model ID 与 API Key 会在下次启动时继续存在。可通过 `LINGUAMARK_DEV_PROFILE` 指定另一隔离 profile。
