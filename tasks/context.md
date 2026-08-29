## Project Core

### Purpose
- LinguaMark 是帮助用户阅读英文文章的 Chrome Manifest V3 扩展，提供文章分析、句子重要度与句法角色标记。

### Global Vocabulary
- Provider 指 DeepSeek、GLM 或通用 OpenAI 兼容模型供应商。
- Provider Settings 指供应商、API Base URL、API Key 与 Model ID 配置。

### System Map
- Options page 管理 Provider Settings，并保存到 `chrome.storage.local`。
- Background service worker 使用 Pi 的浏览器兼容能力调用模型供应商。
- Content script 采集文章内容并在原网页上渲染分析结果。
- Popup 发起当前页面分析并控制标记显示。

### Global Invariants
- API Key 只能由 Options page 和 Background service worker 读取，不得进入网页 DOM 或 Content script 消息。
- `src/` 是扩展源代码，`dist/` 是构建后供 Chrome 加载的产物。

## CTX-annotation-index-protocol — 本地索引标记协议
- Scope: 英语正文的本地分句分词、模型输出契约、角色定位与渲染交接边界。
- Paths: `src/contracts.ts`, `src/parsing.ts`, `src/background.ts`, `src/content.ts`
- Keywords: parsing adapter, sentence ID, token ID, Intl.Segmenter, importance, pattern, grammar role, Highlight
- Authority: `src/contracts.ts`, `src/parsing.ts`, `src/background.ts`
- Recheck: 修改分句规则、词元生成、模型 Prompt、输出 Schema 或角色定位协议时。

### Purpose and Boundaries
- Background 在请求模型前本地分句分词，并为每个句子和非空白词元分配稳定 ID；模型不负责逐字复制原文，也不返回字符偏移。
- Parsing Adapter 负责模型请求编码、Provider 采样参数和响应解码；Background 只依赖稳定的 `IndexedParagraph → ParagraphAnnotation` 边界，Content script 继续通过 DOM Range 非破坏性渲染。
- 当前同时提供 `json-token` 和 `compact-marked` 两种 Adapter，默认使用后者；两者都只返回句子分类、句型和角色词元 ID，不返回原文或字符偏移。

### Decision and Verification Boundaries
- 句子 ID 必须完整且唯一；角色只能引用所属句子的已知连续词元 ID，并且至少包含一个词语类词元。未知、重复或缺失句子 ID 会拒绝响应，非法角色会降级该句的句法层。
- DeepSeek Adapter 请求显式关闭 Thinking；紧凑协议使用内联短 ID、短码输出、中心词规则和疑问倒装示例，并在本地将分号复句和无法唯一归类的引号报告句降为 `unclassified`。
- 副词和介词短语不参与句型角色，也不改变主句骨架；包含这类修饰语的简单句仍按 SV/SVC/SVO/SVOO/SVOC 的核心结构分类。
- 协议变更至少验证两个 Adapter、常见英文缩写、小数、缩约词、疑问倒装、引号后的报告从句、分号、重复词、多词角色和无 `reasoning_content`。

## CTX-render-settings — 渲染设置与显示模式
- Scope: 句界、重要度和语法角色的设置持久化、逐类型启用／颜色／模式及文章实时应用。
- Paths: `src/contracts.ts`, `src/options.ts`, `src/content.ts`, `public/options.html`, `public/content.css`
- Keywords: displaySettings, HighlightSettings, text color, underline, render mode, chrome.storage.local
- Authority: `src/contracts.ts`, `src/content.ts`, `public/content.css`
- Recheck: 修改渲染设置 Schema、Options 控件、CSS Custom Highlight 名称或显示模式时。

### Purpose and Boundaries
- `DisplaySettings.highlights` 为主旨、支撑、细节、主语、谓语、宾语和补语分别保存 `enabled`、`color` 与 `mode`；模式为 `text` 或 `underline`。
- `text` 只改变文字颜色；`underline` 保留网页原文字色并用该类型配置色绘制实线下划线。旧设置缺少 `mode` 时必须读取为 `text`。
- Options page 逐类型编辑后写入 `chrome.storage.local`；Content script 监听变更并在已有 Range 上切换对应 CSS Custom Highlight，不重新请求模型。

### Decision and Verification Boundaries
- 默认模式始终为文字变色；彩色下划线是用户逐类型选择的可选模式，不恢复双线、虚线或点线装饰。
- 模式变更至少验证旧设置兼容、七行控件、持久化、文字色与下划线 Highlight 互斥注册，以及下划线模式不覆盖原文字色。
