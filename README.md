# LinguaMark

[![GitHub Release](https://img.shields.io/github/v/release/SSBun/LinguaMark?display_name=tag&sort=semver)](https://github.com/SSBun/LinguaMark/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/SSBun/LinguaMark/total)](https://github.com/SSBun/LinguaMark/releases)
[![Chrome 120+](https://img.shields.io/badge/Chrome-120%2B-4285F4?logo=googlechrome&logoColor=white)](public/manifest.json)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-34A853?logo=googlechrome&logoColor=white)](public/manifest.json)
[![TypeScript 5.9](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

> Translate. Highlight. Understand.<br>
> 翻译、标注、读懂。

LinguaMark 是一款面向英语阅读的 Chrome 扩展。它直接在原网页上显示逐句翻译、句子重要度和句法角色，并提供学习摘录与本地 Markdown 阅读器，帮助使用者在不离开文章的情况下理解内容。

LinguaMark 采用自带密钥（BYOK）模式，支持 DeepSeek、GLM（ZAI／智谱）和通用 OpenAI 兼容接口。当前仅支持分析英语原文，翻译结果为简体中文。

## 功能特性

| 功能 | 说明 |
| --- | --- |
| 逐句翻译 | 为每个句子生成简体中文翻译；悬停原句或按 `Alt+Shift+T`（macOS 为 `Option+Shift+T`）即可查看。 |
| 阅读层次 | 将句子标记为主旨、支撑或细节，快速看清文章重点。 |
| 句法骨架 | 识别 `SV`、`SVC`、`SVO`、`SVOO`、`SVOC` 等结构，并标记主语、谓语、宾语和补语。 |
| 非破坏性标记 | 使用 CSS Custom Highlight API 在原网页上渲染，不改写正文；每类标记可独立开关，并支持文字变色或彩色下划线。 |
| 增量分析 | 默认聚焦主内容并预加载视口下方区域；滚动或页面正文更新时，新的文字会继续进入分析队列。 |
| 学习卡片 | 从文章中摘录特殊词汇、经典短语和代表性句式，可在悬浮卡片中收藏，并在设置页按日期回顾。 |
| 本地 Markdown 阅读器 | 支持单文件和目录阅读、标题目录、文件树、收藏与最近浏览、代码高亮、任务列表、GitHub Alerts、脚注、KaTeX、Mermaid 与 ZenUML。 |
| 多模型供应商 | 内置 DeepSeek 与 GLM 预设，也可连接 OpenAI 兼容接口，并在设置页测试连接。 |
| 本地配置 | 供应商设置、显示偏好和收藏保存在浏览器本地；API Key 不会注入网页 DOM，也不会发送给 Content script。 |

## 使用要求

- Google Chrome 120 或更高版本。
- 一个受支持模型供应商的 API Key；模型调用可能由供应商计费。
- 当前版本通过 GitHub Release 或源码手动安装，尚未发布到 Chrome Web Store。

## 安装

### 方式一：安装发布包

1. 打开 [最新 Release](https://github.com/SSBun/LinguaMark/releases/latest)。
2. 下载 `LinguaMark-*.zip`，并解压到一个固定目录。
3. 在 Chrome 中打开 `chrome://extensions`。
4. 开启右上角的“开发者模式”。
5. 点击“加载已解压的扩展程序”，选择包含 `manifest.json` 的解压目录。

更新版本时，请下载新发布包并覆盖原解压目录，然后在 `chrome://extensions` 中重新加载扩展。

### 方式二：从源码构建

先安装 Git、Node.js 和 npm，然后执行：

```bash
git clone https://github.com/SSBun/LinguaMark.git
cd LinguaMark
npm install
npm run build
```

构建完成后，按照上面的 Chrome 操作加载项目中的 `dist/` 目录。

## 首次配置

1. 点击 LinguaMark 图标，在 Popup 底部打开“模型设置”。
2. 选择供应商：
   - **DeepSeek**：使用内置 API 地址和默认模型。
   - **GLM（ZAI／智谱）**：使用内置 API 地址和默认模型。
   - **OpenAI 兼容接口**：自行填写 API Base URL 和 Model ID。
3. 填写 API Base URL、Model ID 与 API Key。
4. 点击“测试连接”确认配置可用，再保存设置。
5. 按需调整分析、翻译、摘录与渲染选项。

> API Key 保存在 `chrome.storage.local`，不会进入网页 DOM，但浏览器本地存储并不是加密保险库。请只在受信任的设备和 Chrome Profile 中使用自己的密钥。

## 使用网页分析

1. 打开一篇英文网页。
2. 点击 LinguaMark 图标，选择“分析可见文字”。
3. 分析结果会逐步显示在原网页上；分析期间滚动页面时，新进入分析区域的正文会继续处理。
4. 在 Popup 中按需开关句界、句子重要度和句法角色。
5. 将鼠标停在已分析句子上查看翻译；也可使用 `Alt+Shift+T`（macOS 为 `Option+Shift+T`）。
6. 页面上的 LinguaMark 悬浮入口可打开“解析当前文章”菜单和英文学习卡片；收藏的词汇、短语与句式会出现在设置页的“收藏”标签中。

分析和显示行为还可以在设置页调整：

- 仅分析主内容，过滤导航、侧栏、表单与扩展自身 UI。
- 开关预加载并设置向下预加载比例。
- 设置 1–20 个文本块的并发上限。
- 开关逐句翻译、悬浮翻译和三类学习摘录。
- 在完整句法短语与核心词之间切换。
- 为七类标记设置开关、颜色和显示模式。

## 使用本地 Markdown 阅读器

### 直接打开 `.md` 文件

1. 在 `chrome://extensions` 中打开 LinguaMark 详情页。
2. 开启“允许访问文件网址”。
3. 使用 Chrome 打开本地 `.md` 文件，LinguaMark 会在原 `file://` 标签页中自动渲染内容。

### 使用独立阅读器

1. 在 LinguaMark Popup 中点击“打开阅读器”。
2. 点击顶部“打开文件”选择单个 Markdown 文件，或点击“打开目录”授权一个目录。
3. 目录模式会显示可折叠文件树，并支持打开 Markdown 与常见图片、收藏项目及记录最近浏览。
4. 如需解析当前 Markdown，请再次打开 LinguaMark Popup 并手动开始分析；打开文件本身不会调用模型。

独立阅读器的单文件模式无法访问文件所在目录，因此不能解析相对链接和图片。需要相对资源时，请使用目录模式或直接打开本地 `.md` 文件。

## 隐私与数据边界

- API Key 仅由设置页和 Background service worker 读取。
- Content script 不会接收 API Key，网页 DOM 也无法读取它。
- 分析时，选中的英语正文会随分析指令发送到使用者配置的模型供应商。
- 脚本、样式、代码块、隐藏文字、表单字段值和 LinguaMark 自身 UI 不会进入分析文本。
- 调试日志不会输出 API Key、Authorization、完整正文、Prompt 或模型完整响应。

## 当前限制

- 仅支持英语原文与简体中文逐句翻译。
- 不提供整篇译文视图，也不进行从句递归分析。
- 尚未发布到 Chrome Web Store，需要手动加载扩展。
- 模型响应速度、可用性和费用由所选供应商决定。

## 开发与验证

```bash
npm run check   # TypeScript 类型检查
npm run build   # 构建到 dist/
```

运行 Chrome 自动化前，先安装 Chrome for Testing：

```bash
npm run setup:chrome
npm test
npm run test:chrome
```

如需打开一个加载了开发版扩展的 Chrome 窗口和本地英文测试文章：

```bash
npm run open:test-article
```
