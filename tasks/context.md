## Project Core

### Purpose
- LinguaMark 是帮助用户阅读英文文章的 Chrome Manifest V3 扩展，提供文章分析、句子重要度与句法角色标记。

### Global Vocabulary
- Provider 指 DeepSeek、GLM 或通用 OpenAI 兼容模型供应商。
- Provider Settings 指供应商、API Base URL、API Key 与 Model ID 配置。

### System Map
- Options page 管理 Provider Settings，并保存到 `chrome.storage.local`。
- Background service worker 使用 Pi 的浏览器兼容能力调用模型供应商。
- Content script 采集当前视口内可见页面文字（排除脚本、样式、隐藏文字和表单字段值），并在原网页上渲染分析结果；滚动时增量发现新进入视口的文字。
- Popup 发起当前页面分析并控制标记显示。

### Global Invariants
- API Key 只能由 Options page 和 Background service worker 读取，不得进入网页 DOM 或 Content script 消息。
- `src/` 是扩展源代码，`dist/` 是构建后供 Chrome 加载的产物。

## CTX-annotation-index-protocol — 本地索引标记协议
- Scope: 英语页面分析区域文本块的本地分句分词、模型输出契约、角色、翻译与学习条目定位、原页渲染交接边界。
- Paths: `src/contracts.ts`, `src/parsing.ts`, `src/background.ts`, `src/content.ts`, `public/content.css`, `public/manifest.json`
- Keywords: parsing adapter, analysisConcurrency, preload, preloadPercent, sentence ID, token ID, Intl.Segmenter, importance, pattern, grammar role, translation, learningItems, vocabulary, phrase, tooltip, commands, Highlight
- Authority: `src/contracts.ts`, `src/parsing.ts`, `src/background.ts`, `src/content.ts`, `public/content.css`, `public/manifest.json`
- Recheck: 修改文本发现范围、预加载设置、并发上限、分句规则、词元生成、模型 Prompt、输出 Schema、角色定位、学习条目、翻译浮窗或快捷键协议时。

### Purpose and Boundaries
- Content script 将分析区域内用户可见文字组织为不重叠、带版本的文本块；预加载默认开启并将区域从 viewport 底部向下扩展 30% 屏幕高度。滚动扫描覆盖前后分析区域的并集，DOM 文本新增或原位变化也会合并触发扫描；同一目标原文变化时递增版本，旧版本结果不得覆盖新内容。`mainContentOnly` 默认开启：优先采集 `main`／`[role='main']`，其次全局 `article`，没有语义主容器时回退到 body 并排除页眉页脚、导航、侧栏、表单及交互控件。关闭后恢复既有站点采集范围。仅标题、列表／表格标签、图注、SVG／Math 和独立交互文字允许 `fragment`，普通块级正文默认要求句法角色。脚本、样式、`pre`／`[role='code']` 代码块、隐藏文字和表单字段值不进入模型；正文内行内 `code` 保留。
- Twitter/X 页面（`x.com`、`twitter.com` 及其子域）只从 `[data-testid='tweetText']` 采集可见帖子正文；选择器缺失时不回退到整页，以避免导航、侧栏和推荐文字进入模型。非 Twitter/X 页面继续从 `document.body` 采集。
- Background 在请求模型前本地分句分词，并为每个句子和非空白词元分配稳定 ID；句子的原文起止位置由本地生成并随有效结果交给渲染层，模型仍不返回字符偏移。每次分析会话固定使用开始时读取的并发上限，默认 10、允许 1–20。任一文本块完成后立即发送到 Content script，不等待同批其他文本块；进度分别统计已发现、校验有效、成功渲染和失败的句子数，文本块数只用于调度诊断。
- Parsing Adapter 负责模型请求编码、Provider 采样参数和响应解码；首轮仍按文本块请求并逐句严格校验，保留有效句子。缺失或无效句子只进入一次定向恢复，网络、超时、截断或非法 JSON 则使用第二次预算重试整块；每个文本版本最多两次模型请求。第二次仍无效只记录对应句子失败，不阻断已验证兄弟句；Content script 按本地位置部分渲染。
- 当前同时提供 `json-token` 和 `compact-marked` 两种 Adapter，默认使用后者；两者返回句子分类、句型和角色词元 ID，并在逐句翻译开启时返回简体中文翻译；每个文本块还可返回最多三个特殊词汇、经典短语或代表性句式，条目包含原文连续引用和简短中文说明。除学习条目引用外，模型不返回原文或字符偏移。`multi` 用重复角色码承载多个互不重叠的顶层分句；`fragment` 专用于没有显式限定谓语的标题、标签、日期或残句。
- `DisplaySettings.fullPhrases` 决定 Adapter 请求完整角色短语或核心词，`DisplaySettings.translation` 决定是否请求翻译，`DisplaySettings.excerpts` 分别控制特殊词汇、经典短语和代表性句式摘录；Background 在每次分析会话开始时固定这些设置，滚动增量沿用同一会话模式。
- Content script 将已返回的翻译绑定到完整句子的 DOM Range；`translationHover` 开启时鼠标悬浮原句自动显示浮窗，关闭后扩展命令 `show-hovered-translation` 仍可显示。浮窗以句子 Range 为锚点居中显示在句子上方，顶部空间不足时改放下方并保持在视口内；它使用 `textContent`、不接收指针事件且不进入后续文本采集。`translation` 关闭时两种触发均不显示。

### Decision and Verification Boundaries
- 每个请求所要求的句子 ID 必须完整且唯一；逐句翻译开启时每句翻译必须是非空字符串。角色只能引用所属句子的已知连续词元 ID，并至少包含一个词语类词元。含有效谓语的非法／不完整角色集合保守降为 `unclassified` 并产生警告；重复或缺失句子、缺失翻译、空角色等句级错误进入定向恢复，非法 JSON 等响应级错误重试整块。任何无效句子不得渲染，但不得牵连同块已严格验证的句子；日志分别记录文本版本、两次请求、有效／失败句数、渲染句数和耗时。
- DeepSeek Adapter 请求显式关闭 Thinking；紧凑协议使用内联短 ID、短码输出和随 `fullPhrases` 切换的完整短语／核心词规则；并列、分号、冒号和引语报告结构使用 `multi`。除 `fragment` 外任何句型都必须返回与句型匹配的非空角色；正文块禁止 `fragment`，结构不确定时使用至少含限定谓语的 `unclassified`。
- 完整短语模式纳入角色内部的限定词与前后修饰语；核心词模式只保留中心词。独立状语和介词附加语不成为新角色，也不改变 SV/SVC/SVO/SVOO/SVOC 骨架。
- 学习条目只接受当前文本块某个句子中的精确连续引用，按类型和规范化文本去重，并忽略未启用类型、缺少中文说明、引用不存在或超过每块三个上限的候选；学习条目无效不得破坏有效的句法分析结果。
- 协议变更至少验证两个 Adapter 在翻译开关和摘录类型开关下的 Prompt 与解析、有效兄弟句保留、缺句／坏句定向恢复、第二次失败后的部分结果、响应级整块重试和两次请求封顶；还需覆盖本地句子位置、过期版本拒绝、快速滚动区域并集、DOM 新增与原位更新、未变化文本去重、主内容根优先级、`fragment` 边界、代码块排除与行内代码保留。既有学习条目、完整短语／核心词、五大句型、`multi`、翻译交互和无 `reasoning_content` 约束继续验证。

## CTX-render-settings — 渲染设置与显示模式
- Scope: 主内容过滤、解析预加载、句界、重要度、语法角色、逐句翻译、摘录类型、悬浮学习卡片、设置页收藏回顾与完整短语解析模式的持久化和应用。
- Paths: `src/contracts.ts`, `src/options.ts`, `src/content.ts`, `src/parsing.ts`, `src/background.ts`, `public/options.html`, `public/content.css`, `public/ui.css`
- Keywords: displaySettings, mainContentOnly, analysisConcurrency, preload, preloadPercent, HighlightSettings, fullPhrases, translation, translationHover, excerpts, learningFavorites, collectedAt, collection tab, date grouping, floating ball, learning card, complete role phrase, text color, Apple accent colors, Hex, underline, render mode, chrome.storage.local
- Authority: `src/contracts.ts`, `src/options.ts`, `src/content.ts`, `src/parsing.ts`, `src/background.ts`, `public/options.html`, `public/content.css`, `public/ui.css`
- Recheck: 修改显示设置 Schema、Options 控件或标签页、主内容过滤、预加载范围、翻译或摘录开关、悬浮学习卡片、收藏时间／存储／日期分组、完整短语解析模式、CSS Custom Highlight 名称或显示模式时。

### Purpose and Boundaries
- `DisplaySettings.highlights` 为主旨、支撑、细节、主语、谓语、宾语和补语分别保存 `enabled`、`color` 与 `mode`；模式为 `text` 或 `underline`。
- `text` 只改变文字颜色；`underline` 保留网页原文字色并用该类型配置色绘制实线下划线。旧设置缺少 `mode` 时必须读取为 `text`。
- Options page 在渲染配置上方用固定英语样句预览当前句界、层开关、完整短语开关、逐类型启用、颜色与模式的合成结果；逐句翻译和悬浮显示开关位于独立的“翻译设置”区块，不属于“渲染配置”。
- `fullPhrases` 默认开启；关闭后下一次分析恢复核心词解析。`translation` 与 `translationHover` 也默认开启；前者关闭后下一次分析不再请求翻译，后者关闭只停止自动悬浮显示而保留快捷键。现有存储缺少这些字段时均按开启读取。
- Options page 的“摘录设置”分别保存默认开启的单词、短语和句子摘录开关；Background 在会话开始时固定已启用类型，Prompt 仅请求这些类型，响应解析也丢弃未启用类型。既有收藏不受开关影响。
- Options page 的“分析设置”保存并发与预加载配置：`analysisConcurrency` 默认 10、允许 1–20，并由 Background 在会话开始时固定；`preload` 默认开启，`preloadPercent` 默认 30。独立“解析控制”区块保存默认开启的 `mainContentOnly`。预加载开启时 Content script 将当前区域扩展到 `innerHeight * (1 + preloadPercent / 100)`，关闭时保持 viewport 高度；滚动使用前后区域并集，DOM 文本变化扫描当前区域。旧设置或非法值回退到各自默认值。
- 每行颜色控件用前置色块选择八种固定 Apple 系统强调色参考值，并用相邻文本字段接受自定义 `#RRGGBB`；持久化仍只保存标准化 Hex。Content script 监听显示变更并在已有 Range 上切换对应 CSS Custom Highlight，不重新请求模型。
- Content script 在文章页注入紧凑、可拖动、可关闭的悬浮入口；点击圆球只会向上展开操作菜单且不会发起分析，只有点选菜单中的“解析当前文章”才由 Background 以发送消息的标签页作为目标启动现有分析并打开学习卡片；指针停留两秒仍可直接打开卡片。卡片随初次与滚动增量结果追加三类学习条目；仅用户收藏的条目写入 `chrome.storage.local` 的 `learningFavorites`，按类型和规范化文本去重并在首次收藏时写入 `collectedAt`，已收藏条目再次出现时自动恢复状态。悬浮 UI 必须排除在后续文本采集之外。
- Options page 通过“设置”与“收藏”标签切换原配置和全部本地收藏；收藏按本地日历日期倒序分组并标出类型，无 `collectedAt` 的既有数据保留在“日期未知”组。Options page 监听 `learningFavorites` 变更并实时刷新列表。

### Decision and Verification Boundaries
- 默认模式始终为文字变色；彩色下划线是用户逐类型选择的可选模式，不恢复双线、虚线或点线装饰。
- 模式变更至少验证旧设置兼容、七行控件、持久化、文字色与下划线 Highlight 互斥注册，以及下划线模式不覆盖原文字色。
- 完整短语开关变更至少验证默认值、旧设置回退、设置页持久化、预览联动和下一次分析使用对应 Prompt；翻译开关变更还需验证两个开关位于独立翻译区块且不出现在渲染区块、独立持久化、翻译关闭时下一次 Prompt 不请求翻译，以及悬浮关闭时快捷键仍可显示已有翻译。
- 摘录开关变更至少验证三个开关独立持久化、旧设置默认全部开启、会话快照、Prompt 仅允许已启用类型，以及模型越界返回的禁用类型仍被过滤。
- 解析控制与分析设置变更至少验证主内容模式默认开启、`main` 优先于全局 `article`、无主容器回退、UI 组件排除、关闭后恢复范围、普通 div 正文要求角色、预加载和滚动沿用，以及并发上限默认值、范围、会话快照、调度峰值和快文本块先于慢文本块渲染；预加载还需验证默认 30%、独立持久化、非法值回退、前后滚动区域无空档、DOM 新增／原位更新可发现且未变化文本不重复请求。
- 颜色控件变更至少验证八个固定预设、任意有效自定义 Hex 的标准化与实时应用、已有 Hex 还原，以及无效输入不会覆盖已保存颜色。
- 悬浮学习卡片变更至少验证紧凑尺寸、圆球点击只在上方展开菜单且不发送分析消息、菜单解析操作才发起当前标签页分析并打开卡片、停留两秒展开卡片、拖动边界、关闭、初次与滚动增量追加、逐项收藏／取消、收藏时间、跨页面持久化、去重、再次列举的已收藏状态，以及悬浮 UI 不进入模型输入。
- 设置页收藏回顾变更至少验证标签点击与方向键切换、原设置仍可访问、三类收藏按本地日期倒序分组、存储变更实时刷新、空状态，以及无时间旧收藏进入“日期未知”组且不丢失。

## CTX-local-markdown-viewer — 本地 Markdown 阅读器
- Scope: Chrome 原标签页内的本地 `.md` 自动渲染、Lightmind 阅读样式与宽度、目录授权与文件树、收藏与最近浏览、扩展 Markdown 能力、安全边界及手动 LinguaMark 分析衔接。
- Paths: `src/markdown.ts`, `src/directory.ts`, `src/background.ts`, `src/content.ts`, `src/popup.ts`, `public/manifest.json`, `public/viewer.html`, `public/popup.html`, `public/markdown.css`, `public/katex.min.css`, `public/fonts`, `scripts/build.mjs`, `tests/fixtures/markdown-viewer.md`, `tests/file-picker.mjs`, `tests/directory-picker.mjs`
- Keywords: file://, standalone Viewer, Popup reader, local Markdown, Markdown Viewer, Lightmind, markdown-it, Mermaid, KaTeX, file picker, directory picker, FileSystemDirectoryHandle, IndexedDB, file tree, image preview, favorites, recent browsing, fixed width, full width, chrome.storage.local, left TOC, top navigation, raw HTML, sandbox, isAllowedFileSchemeAccess
- Authority: `src/markdown.ts`, `src/directory.ts`, `src/background.ts`, `src/content.ts`, `public/manifest.json`, `public/markdown.css`, `scripts/build.mjs`
- Recheck: 修改本地文件权限或匹配范围、目录句柄存储与恢复、文件树或图片预览、收藏或最近浏览、阅读宽度、Markdown 解析和增强特性、顶部导航与目录布局、Lightmind 样式、安全过滤、相对资源处理、降级行为或手动分析衔接时。

### Purpose and Boundaries
- Manifest 只在 `file:///*.md` 注入 Markdown 与既有 Content script；用户仍须在扩展详情页开启“允许访问文件网址”。Viewer 在原标签页内将 Chrome 原始文本替换为 `article#write`，保持原 `file://` URL；Popup 识别本地 Markdown 并在权限未开放时给出指引。同一本地 Markdown 再次进入 Chrome 时，Background 会定位并刷新既有标签页，然后关闭新产生的重复标签页。
- Viewer 将 `article#write` 放入顶部 sticky 导航栏与 CSS Grid 主区域；每篇文档根据 H1–H6 自动生成左侧目录并移除正文 `[TOC]` 占位。页面左下角以无边框、背景或阴影的低干扰文字标签展示当前 Markdown 的“字词”合计：每个中文汉字计 1，每个由拉丁字母组成且内部可含撇号或连字符的英文词计 1，两者相加后以“字词”为单位；桌面侧栏在底部为标签预留独立区域，文章目录与文件树的可滚动边界结束在标签上方，不会被覆盖；空白页与图片显示 0，直接文件、独立文件、目录文件切换及异步恢复都会同步更新，标签自身用 `data-linguamark-ui` 排除在分析文本之外。桌面侧栏默认展开，文档目录与目录文件树共用可拖动、可键盘操作的宽度分隔边界，调整结果仅保留在当前页面；900px 以下默认收起为固定宽度覆盖式抽屉。顶部原侧栏按钮使用原生选择控件在授权目录文件树、当前文章目录与隐藏侧栏之间切换；打开新 Markdown 时文章目录随内容更新，图片或无标题内容会禁用不可用视图。目录链接跳转到带 sticky 偏移的标题。顶部右侧宽度按钮在当前页面内切换默认 980px 固定阅读宽度与内容区 100% 整屏宽度，并同步文字、提示和 `aria-pressed` 状态；宽度偏好不持久化。重载动画开关默认关闭，状态保存在当前标签页的会话存储中并跨该页面重载保留；关闭时即时恢复滚动位置，开启时平滑恢复，系统“减少动态效果”始终优先。
- Popup 每次点击“打开阅读器”都会创建新的 `viewer.html` 标签页。每个独立 Viewer 初始显示不进入分析的空状态，中央复用收藏与最近浏览列表，并分别保留当前页面打开的单文件或目录；顶部“打开文件”在用户点击内调用 `showOpenFilePicker({ startIn: "downloads" })` 打开系统 Markdown 文件选择器，避免恢复响应缓慢的历史位置，等待期间不禁用按钮；单文件句柄按标签页保存在扩展来源 IndexedDB，同一文件再次被选择时通过 `isSameEntry()` 定位并刷新既有 Viewer，关闭新建的空白重复页，且既有 Viewer 重载后从该句柄重新读取文件。Console 以 `markdown.file-picker.*` 记录 requested、cancelled、selected、opened、reused 与失败阶段，且不记录路径、文件名或内容。“打开目录”在当前页面的用户点击内直接调用系统目录选择器；standalone 使用 File System Access API，`file://` 使用标准 directory file input。
- 独立 Viewer 选择单个 `.md` 后按 Lightmind 渲染并生成标题目录；由于单文件句柄不暴露父目录，单文件模式禁用相对文件和图片链接并提示改用目录模式。独立 Viewer 仍可手动分析，目录模式的存储和文件树能力与直接 `file://` Viewer 共用。
- 顶部“打开目录／更换目录”不再打开 LinguaMark 授权中间页。独立 Viewer 直接调用 `showDirectoryPicker({ startIn: "downloads" })`，将句柄按标签页 ID 保存到扩展来源 IndexedDB，跨重载恢复并在标签页关闭时清理。`file://` 页面因 `showDirectoryPicker()` 可能在系统中 active 但不可见，改用隐藏的标准 `<input type="file" webkitdirectory multiple>` 打开可见目录选择器；选择结果仅以 FileList 和文件映射保留在内容脚本内存，sessionStorage 只保存无敏感信息的会话标记以确保重载后重新选择，绝不把目录句柄或 File 写入页面可访问存储。既有扩展来源句柄仍由 Background 兼容恢复和读取。单文件与 standalone 目录 picker 固定从 Downloads 开始且不传持久 picker ID。
- Viewer 顶部右侧可收藏当前目录或文件，并用原生模态弹窗展示全部收藏与最近 5 条去重浏览记录；桌面弹窗以更大的默认尺寸打开，可在当前页面内原生调整宽高并受最小尺寸和视口限制；收藏与最近浏览保留两个独立列表，各列表占用可用高度但 cell 按内容高度从顶部向下紧凑排列，使用一致内边距和间距而不拉伸；700px 以下改为不可调整的视口内单列布局，尺寸不持久化。两组路径分别持久化到 `chrome.storage.local` 的 `markdownViewerFavorites` 与 `markdownViewerRecents`，目录内文件使用授权根名称加相对路径，独立文件选择受浏览器限制只保存文件名。直接 `file://` 文件的绝对路径与当前授权目录树中指向同一文件的根相对路径按同一收藏身份处理，导航栏、文件右键菜单和收藏列表在目录树异步恢复后重新同步，旧别名不会重复展示且任一入口取消收藏会同时移除别名。收藏状态先更新界面再异步持久化并在失败时回滚；列表弹窗同步打开，点击响应不得等待存储或重建列表。列表条目使用原生按钮打开：当前授权目录内项目复用 Viewer，绝对本地路径跳转到对应 `file://` 页面；缺少当前目录访问权限时，条目点击会直接打开系统目录选择器，正确选择目标目录后继续打开原项目，取消或选择其他目录时不继续；不为每个条目持久化文件系统句柄。
- 目录模式递归展示全部文件并默认折叠文件夹；文件树面板上方的工具栏以单个按钮切换全部展开／折叠。打开文件或恢复目录后，文件树会自动展开父目录、选中、滚动并聚焦当前文件，工具栏的定位按钮可重复执行同一行为。文件与文件夹项目的右键菜单可复制相对于授权根目录的路径和项目名称；文件菜单还可切换收藏，文件夹菜单可递归展开或折叠自身子树。菜单不提供目录选择、Finder 原生定位或系统绝对路径。`.md` 与 PNG／JPEG／GIF／WebP／AVIF／SVG 可打开，其他文件显示为禁用项且 Background 拒绝读取。Markdown 在当前 Viewer 切换，图片使用固定扩展名 MIME 的 Data URL 预览，顶部显示目录内相对路径。
- 目录内 Markdown 的相对链接和图片按当前文件路径在授权根内规范化；`..` 可返回上级但不得逃出根目录。Content script 仅在当前 `file://` 标签页内存中持有用户本次选择的 FileList 与文件映射；Background 与本地读取路径均拒绝含空段、`.`、`..` 或 NUL 的请求。
- `src/markdown.ts` 使用随扩展打包的 Markdown、任务列表、脚注、代码高亮、KaTeX 与 Mermaid 能力，并应用当前 Lightmind 主题快照；YAML、`[TOC]` 和 GitHub Alerts 由渲染后处理补齐。相对图片和链接依靠保留的原文件 URL 解析。
- 打开文件只做本地渲染，不发送分析消息；用户手动触发后继续使用既有 Background 与 CSS Custom Highlight 流程。代码块、公式和 Mermaid 容器不进入模型文本采集。
- 原始 HTML 经净化和重新克隆后进入正文；脚本、事件处理器和可执行 URL 被移除，iframe 强制 sandbox。原始 CSS 经 CSSOM 解析并限制在 `#write` 作用域内，不能覆盖 LinguaMark 控件。
- 整体渲染失败时保留 Chrome 原始 Markdown；单个 Mermaid 失败时保留对应源码块并移除 Mermaid 临时错误节点，其他内容继续显示。KaTeX 使用非抛错渲染保留无效公式源码。

### Decision and Verification Boundaries
- 变更至少验证本地文件权限开关、原 URL 保留、Lightmind 样式、相对图片与链接、任务列表、Alerts、脚注、公式、有效与无效 Mermaid、原始 HTML/CSS、脚本／事件／可执行 URL 阻断、iframe 隔离、打开时无模型请求、手动文本采集与标记，以及 HTTP/HTTPS 页面采集不回归。
- 导航或标题目录变更还需验证无 `[TOC]` 文档自动生成标题层级、正文 `[TOC]` 被移除、文件树／文章目录往返切换、打开新文档后目录更新、图片或无标题内容降级、侧栏隐藏、桌面默认展开、窄屏默认收起与抽屉遮罩、控件和 ARIA 状态、标题跳转不被 sticky 导航遮挡，以及导航文字不进入模型采集。侧栏宽度变更还需验证指针拖动、方向键与 Home／End、200px 至半视口宽度边界、视口缩小时重夹取、侧栏显隐、无目录状态及窄屏禁用分隔器。重载动画开关变更还需验证新标签页默认关闭、同一标签页重载后状态保留、开关两种状态均恢复滚动位置、系统“减少动态效果”覆盖动画，以及 Content script 同步初始化不回归。
- 阅读宽度变更还需验证默认固定宽度、整屏宽度、反复切换、按钮文字／提示／`aria-pressed` 状态、目录展开与收起下的可用内容宽度、窄屏无横向溢出，以及文档内容和分析状态不重建。字符统计标签变更还需验证左下角定位、标签与文章目录／文件树边界不相交且列表可滚动到底、无卡片装饰、桌面与窄屏可读性、千位分隔、中文汉字与英文单词的混排合计、数字和标点不误计、空白／Markdown／图片状态、文件切换和异步恢复，以及标签文字不进入分析内容。
- 收藏或最近浏览变更还需验证当前目录与文件状态、导航栏与右键菜单双向收藏同步、绝对路径与根相对路径别名、当前项先存在而目录树后恢复、当前项不在恢复树中的降级、旧别名去重、收藏切换及失败回滚、跨重载持久化、路径去重、全部收藏展示、最近记录严格限制为 5 条且按新近顺序排列、点击可见响应不等待存储或列表重建、弹窗默认尺寸、原生拖动调整、最小尺寸和视口上限、双列表保留、稀疏列表顶端紧凑排列、cell 内边距与间距一致、长列表滚动、调整尺寸后 cell 不拉伸、窄屏单列与禁用调整、模态关闭与 ARIA、弹窗背景不使用高成本模糊，以及弹窗文字不进入模型采集。
- 授权目录变更还需验证首次选择、IndexedDB 跨重启恢复、prompt／denied 重新授权、递归排序、默认折叠、工具栏全量展开与折叠、全部文件可见、文件与文件夹右键菜单、复制相对路径与名称、文件收藏切换及持久化、文件夹子树递归展开与折叠、非支持类型禁用且不可读取、Markdown 与图片切换、相对 Markdown／图片／锚点、越界路径拒绝、旧分析状态清理、目录 UI 不进入模型采集，以及直接文件和 HTTP 页面不回归。
- Popup 或独立 Viewer 变更还需验证每次“打开阅读器”都创建新的空白标签页、多个 Viewer 可分别保留不同文件或目录且互不串页、空状态不进入分析、文件和目录选择只由用户点击触发、单文件渲染与相对资源禁用、同一单文件的跨 Viewer 复用和重载刷新、独立 Viewer 手动分析、目录通知刷新，以及直接 `file://` Viewer 不回归。直接本地文件标签页复用还需覆盖首次打开、同窗口重复打开、跨窗口重复打开、既有标签页刷新和重复标签关闭。
