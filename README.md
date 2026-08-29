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

- **Content script**：读取文章文本并渲染翻译与语法高亮。
- **Background service worker**：运行智能体并调用模型供应商。
- **Options page**：独立管理供应商、模型和凭据。
- **`chrome.storage.local`**：保存扩展设置。

API Key 不会注入网页 DOM 或交给页面脚本。需要注意，`chrome.storage.local` 不是加密保险库；首版采用用户自带密钥的本地扩展模式，后续只有在需要托管密钥或多人使用时才考虑后端代理。

## 当前实现

首版已经提供可加载的 Chrome Manifest V3 扩展：

- Popup 主动分析当前网页，并独立开关句界、句子重要度和句法角色；Popup 与 Options page 使用 StyleKit Glassmorphism 视觉规范。
- Options page 保存 DeepSeek、GLM（ZAI／智谱）或通用 OpenAI 兼容配置；DeepSeek 默认使用 `deepseek-v4-flash`。
- Background service worker 使用 `@earendil-works/pi-agent-core` 和 `@earendil-works/pi-ai` 发起单 Agent 请求。
- Content script 只采集当前 viewport 可见的正文段落；首次手动分析后，滚动会自动发现新进入视口的段落。Background 最多并发处理 5 段，每段排队后通过 CSS Custom Highlight 按文字行片段显示浅蓝脉冲，完成即渲染并移除处理态。只有真正产生可见标记的段落才计为成功，失败阶段会显示在 Popup 中。
- Content script 通过 CSS Custom Highlight API 非破坏性渲染：
  - 在完整句子之间显示纯视觉 `│`。
  - 以 `primary`、`supporting`、`detail` 表示段落内重要度。
  - 标记 `SV`、`SVC`、`SVO`、`SVOO`、`SVOC` 的 S／V／O／C 核心词。
  - 对无法可靠归类的复杂句使用 `unclassified`，不强行着色。
- API Key 只由 Options page 与 Background service worker 读取，不会进入网页 DOM 或 Content script 消息。

首版只支持英语；翻译、从句递归分析和扩展商店发布尚未包含。

## 调试日志

扩展会以 `[LinguaMark:<scope>] <event>` 输出结构化控制台日志：

- `content`：文章页 DevTools Console，包含可见段落发现、滚动入队、处理态与渲染结果。
- `background`：`chrome://extensions` 中 LinguaMark service worker 的 Inspect Console，包含队列、并发、模型请求、解析、耗时与失败阶段。
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
3. 打开英文文章，点击扩展图标。
4. 选择“分析当前页面”，再按需切换三层标记。

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
