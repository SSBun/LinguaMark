# 规划文章阅读标记逻辑

Status: Completed (2026-08-29 09:05)
Kind: Plan

## Scope

- Included: 可加载运行的最小 Chrome Manifest V3 扩展；首版英语正文段落的句界、句子重要度、五大基本句型与核心句法角色标记；DeepSeek、GLM 与通用 OpenAI 兼容供应商配置和真实模型调用；自动化 Chrome 端到端验证。
- Excluded: 非英语文本、完整句法树、从句内部的递归标记、翻译功能、模型质量基准、扩展商店发布以及后端密钥托管。

## Target
- [x] T1: 对英语正文段落按原文顺序识别完整句子，仅在同段相邻句子之间显示纯视觉 `│` 句界；缩写、小数、引号、分号和省略号不会仅因标点被误切，段末不显示句界。
- [x] T2: 每个完整句子按其在当前段落中的作用标记为 `primary`、`supporting` 或 `detail`，并分别呈现突出、默认或弱化效果；单句段落标记为 `primary`。
- [x] T3: 对存在唯一主句骨架的句子标记 `SV`、`SVC`、`SVO`、`SVOO` 或 `SVOC`，并高亮相应核心角色；无法可靠归类的复杂句使用 `unclassified`，不得强行套用五大句型。
- [x] T4: 句界、重要度和句法角色可以独立开关并同时显示；句法颜色在重要度效果之上仍清晰可读，任何状态下原文的复制、搜索、链接与文本顺序保持不变。
- [x] T5: 过期、结构错误、无法精确锚定或角色重叠的 Agent 结果不会破坏网页内容，并能按既定降级规则保留仍然可信的标记层。
- [x] T6: 独立设置页可保存 DeepSeek、GLM 或通用 OpenAI 兼容供应商的 Base URL、API Key 与 Model ID；API Key 只由扩展页面和 Background service worker 读取，不进入网页 DOM 或 Content script 消息。
- [x] T7: 用户可主动分析当前网页中的英语正文段落，Background service worker 通过统一单 Agent 流程调用所选真实模型供应商，校验结果后驱动 Content script 渲染，并向用户呈现缺少配置、请求失败或响应无效等错误。
- [x] T8: 扩展可作为 unpacked extension 在 Chrome 中加载；自动化 Chrome 端到端场景通过本地 OpenAI 兼容测试服务验证“保存配置 → 发起分析 → 收到模型响应 → 三层渲染 → 独立开关 → 原文保持不变”的完整流程。
- [x] T9: 用户触发分析时只采集与当前浏览器 viewport 相交的正文段落，不发送视口外内容；所有可见候选段落均进入处理队列。
- [x] T10: Background 将可见段落拆成单段请求并按顺序逐一调用 Agent；每段完成后立即应用标记，不等待其余段落，失败段落不阻断后续段落。
- [x] T11: Popup 在逐段处理期间显示“已完成/总数”进度，最终区分成功数与失败数；隔离 Chrome 自动化验证请求数、顺序、增量渲染和视口外段落未发送。
- [x] T12: 只有实际生成至少一个可见句界、重要度或句法 Highlight 的段落才计为成功；解析成功但无可见标记的结果必须降级并在 Popup 中反映，禁止出现“成功但页面无变化”。
- [x] T13: 在真实测试文章上逐段分析后，页面立即出现可观察标记，Popup 的成功／失败／降级计数与 Content script 的实际应用结果一致，并提供足以定位失败阶段的非敏感错误信息。
- [x] T14: 段落进入模型请求队列后立即显示浅蓝色脉冲背景，完成或失败后移除；该处理中状态不改变原文、链接、选择行为或最终语义 Highlight。
- [x] T15: 同一标签页最多并发分析 5 个段落，结果按完成顺序立即渲染；任务去重且单段失败不阻塞其余并发任务。
- [x] T16: 用户首次手动启动分析后，滚动页面会自动发现并分析新进入 viewport、且尚未完成或排队的段落；已处理段落不会重复请求，停止离开页面后不会继续扫描。
- [x] T19: 处理中浅蓝效果按实际文字行片段绘制，不再给整个段落绘制矩形背景、边框或块级圆角；继续保留脉冲反馈、完成／失败后清除及不改变原文 DOM 结构。
- [x] T17: 查明并修复本次实测中解析缓慢、大量片段失败且可见正文无渲染变化的问题，并让状态反馈与实际结果一致。
- [x] T18: 本地预先为句子和词元分配稳定 ID；AI 只返回句子分类、句型和角色对应的词元 ID，本地无需依赖 AI 逐字复制原文即可定位并渲染。
- [x] T20: 真实供应商分析不会因四个可见段落同时超过固定 30 秒而全部失败，并继续逐段反馈完成或具体错误。
- [x] T21: 分析请求不使用人为收紧的输出 Token 上限，沿用模型支持的完整输出预算。
- [x] T22: 模型或网络失败时，Background 日志和用户状态显示经过脱敏的真实底层错误，而不是仅显示代理层兜底原因。
- [x] T23: 使用用户现有 DeepSeek 配置真实复测当前测试文章，并以实际耗时、成功数、失败原因和页面渲染作为结论证据。
- [x] T24: 查明并修复截图所示句子未显示语法角色标记的问题；若句子按产品边界应降级，页面和日志必须明确反映原因。

## Decisions

### 分析单位

- 数据层级固定为“段落 → 完整句子 → 主句骨架 → 核心角色”。句界只分完整句子，不分逗号、分号连接的子句。
- 首版只分析每句唯一的主句骨架；从句内部递归分析和并列复句的多个骨架暂不实现。没有唯一主句骨架时使用 `unclassified`。
- 句子重要度只在当前段落内比较：`primary` 是保留段落主旨所需的最小句子集合，通常为一句；`supporting` 提供必要解释、论据或承接；`detail` 是例子、补充、重复或移除后不影响主旨的细节。不要求 Agent 返回判断理由。

### 五大句型与角色

- 允许的句型和角色组合为：`SV`（S+V）、`SVC`（S+V+SC）、`SVO`（S+V+O）、`SVOO`（S+V+IO+DO）、`SVOC`（S+V+O+OC）。
- 角色枚举为 `subject`、`verb`、`object`、`indirectObject`、`directObject`、`subjectComplement`、`objectComplement`。
- 名词角色只标记代词、中心名词或完整专名；谓语标记助动词／情态动词、主要动词、否定词和不可拆分的短语动词。普通限定词与修饰语不着色；并列中心词或被副词隔开的谓语允许由多个同角色片段组成。
- 副词和介词短语属于修饰语，不改变五大句型主干；例如 `Modern readers move quickly through a crowded world.` 必须按 `SV` 处理，只标记 `readers` 与 `move`。

### Agent 输出契约

- 使用 `@earendil-works/pi-agent-core` 的单 Agent 与 `@earendil-works/pi-ai` 的 OpenAI Completions 通路；本任务只请求标记结果，不新增第二套 Agent 或模型请求。
- Background 先用本地 `Intl.Segmenter` 分句、分词，并为句子与非空白词元分配稳定 ID；常见英文缩写和引号后的报告从句在本地合并。
- Agent 只返回句子 ID、`importance`、`pattern`，以及每个 `role` 对应的连续 `tokenIds`；不返回原文、段落 ID、字符偏移、HTML 或分析过程。
- Background 根据可信的本地 ID 重建精确句子与角色引用，再沿用 Content script 的 DOM Range 渲染；重复文本由唯一词元位置消歧，不依赖模型逐字抄写。
- 请求发出时保存段落文本快照；响应回来后当前文本与快照不一致即丢弃该响应，避免把旧标记应用到新内容。

### 扩展与供应商通路

- 采用无 UI 框架的最小 TypeScript + esbuild Manifest V3 工程。Popup 提供“分析当前页面”和三层开关；Options page 独立保存供应商配置；Content script 只负责正文采集、锚定和渲染；Background service worker 独占 API Key 与模型调用。
- DeepSeek 与 GLM 只提供可编辑的 Base URL／Model ID 预设；通用 OpenAI 兼容模式完全使用用户输入。三者共用 `pi-ai` 的自定义 OpenAI Completions provider，避免维护三套请求实现。
- 用户首次主动触发后只采集 `article`／`main` 中与当前 viewport 相交的段落，缺失时回退到可见 `p`；该标签页随后启用滚动发现，新进入 viewport 的未处理段落自动入队。
- 每个标签页维护稳定段落 ID、去重集合和独立任务队列；真实供应商当前最多并发 2 个单段请求，按完成顺序立即渲染。实测 DeepSeek 长段响应可达 108 秒，因此本地安全超时为 180 秒；单段失败不阻塞其他任务。排队或处理中段落通过 CSS Custom Highlight 按文字行片段显示浅蓝脉冲，不绘制段落矩形背景或边框。
- 自动化测试使用本地 OpenAI 兼容 SSE 服务和测试 API Key，验证真实 Background 网络、Agent、Content script 与 DOM 通路，但不调用或消耗外部模型额度。

### 校验与降级

- 本地分句结果必须按顺序覆盖段落中的全部非空白文本；Agent 必须返回全部已知句子 ID，未知、重复或缺失 ID 会拒绝该段响应。
- 角色只能引用所属句子的已知连续词元 ID，且角色集合必须匹配声明的句型；非法、越界或重叠角色只取消该句的句法层，保留已验证的句界和重要度。
- 非法重要度降级为 `supporting`；单句段落始终归一化为 `primary`；`unclassified` 不显示句型或角色颜色，但仍参与句界和重要度显示。
- Content script 只有在实际创建至少一个句界、重要度或句法 Highlight 时才报告该段成功；零可见标记、原文锚定失败或文本过期都返回明确失败原因。
- 模型输出始终视为不可信数据；只解析已知 JSON 字段和枚举，不把模型文本作为 HTML 注入网页。

### 视觉与交互

- `│` 在结束标点及其右侧引号／括号之后、下一句之前渲染；使用生成内容或不可选择且 `aria-hidden` 的节点，不进入复制文本，也不在段末出现。
- 重要度负责句子层：`primary` 使用轻量背景高亮，`supporting` 保持正文默认样式，`detail` 降低正文对比度但不得低于正常正文的可读性要求。
- 句法角色负责词语层：S、V、O、C 四个角色族使用稳定且可区分的语义颜色；IO／DO 共用 O 色族，SC／OC 共用 C 色族。具体色值使用主题变量，并在亮色、暗色背景下保持可读。
- 层级冲突时，句法角色的前景色优先，重要度保留背景或未标角色文本效果，句界保持中性低对比度。三个开关只改变已有标记的显示状态，不重新请求 Agent。
- 句子与角色效果使用 Chrome 原生 CSS Custom Highlight API；只在句界位置插入无文本的空节点并由伪元素绘制 `│`。不替换段落 `innerHTML`，以保留复制、搜索、链接、强调元素和页面行为；重复渲染不得生成重复句界。

## Plan

1. 建立最小 TypeScript、esbuild 与 Manifest V3 工程，加入 Popup、Options page、Background service worker、Content script 及共享消息／标记类型。
2. 实现独立供应商设置页和 `chrome.storage.local` 读写，提供 DeepSeek、GLM 与通用 OpenAI 兼容预设，并确保 Content script 的消息与存储读取均不包含 API Key。
3. 使用 `pi-agent-core` 与 `pi-ai` 建立自定义 OpenAI Completions provider 和单 Agent 提示词；仅提交 viewport 可见内容并由每标签页队列以最大 2 并发逐段请求，解析纯 JSON、校验字段／枚举／句型组合并返回明确错误。
4. 在 Content script 中维护稳定段落 ID、处理状态和滚动发现，排队即显示浅蓝脉冲，结果或失败到达后移除；把句子及角色引用转换为当前 DOM Range，并处理过期响应、歧义引用、越界和重叠。
5. 使用 CSS Custom Highlight 与空句界节点实现非破坏性三层渲染，增加 Popup 分析入口、独立开关、状态反馈和 Options page 入口。
6. 增加纯逻辑测试，覆盖五大句型契约、句子完整覆盖、重复引用、角色重叠与降级规则。
7. 建立本地文章页和 OpenAI 兼容 SSE 测试服务，自动加载 unpacked extension 到 Chrome，验证保存配置、并发上限、滚动增量发现、处理态、真实网络请求、Agent 响应、渲染、开关、复制文本与链接行为。
8. 运行构建、TypeScript 检查、逻辑测试和 Chrome 端到端测试；检查产物可手动加载，并将实际证据写回本任务。
9. 将解析协议改为本地句子／词元 ID：浏览器先分句分词，模型只分类并选择 ID，本地按 ID 验证和渲染，同时排除页头元数据请求。
10. 恢复模型完整输出预算，保留脱敏后的底层错误并用用户现有 DeepSeek 配置真实复测。

## Result

- T1: npm test 验证缩写、小数与分号边界；Chrome E2E 观察到两个段落仅生成 5 个空句界节点且伪元素为 │。
- T2: Chrome E2E 验证 primary 高亮为 2 处、supporting 保持正文、detail 进入弱化 Highlight，并覆盖单段多句结果。
- T3: npm test 的五大句型样例生成 16 个无重叠角色范围；Chrome E2E 实际读取 S/V 范围并保留 unclassified 复句。
- T4: Chrome E2E 自动关闭和恢复三层开关，选择文本不含 │、两个段落 textContent 未改变且原链接点击监听仍生效。
- T5: npm test 验证未覆盖原文与角色重叠降级；Chrome E2E 在模型响应前修改段落后仅应用未过期的另一个段落。
- T6: Chrome E2E 在独立 Options page 保存 custom Base URL、Model ID 与 test key；请求带授权头且文章 DOM 不含该 key。
- T7: Chrome E2E 通过 Background 中的 pi-agent-core/pi-ai 单 Agent 向本地 OpenAI 兼容 SSE 端点发起真实网络请求并驱动 Content script 标记 2 个段落。
- T8: npm run test:chrome 自动构建并加载 unpacked extension 到 Chrome for Testing，完整流程通过，扩展 ID 为 medhnmkhdmaobcojalkahdeilmbhgfel。
- T9: Content script 现在要求段落矩形与 viewport 相交；隔离 Chrome focused smoke 的页面含 2 个可见段落和 1 个视口外段落，模型仅收到前两段，视口外文本未出现在任何请求。
- T11: 隔离 Chrome focused smoke 在第二段处理中观察到“已完成 1/2 个可见段落”，完成后显示“已标记 2/2 个可见段落”；请求顺序、增量 Highlight 和 offscreen 排除断言均通过。
- T12: Content script 现在返回 visibleMarks，Background 仅在 applied=1 且 visibleMarks>0 时增加成功数；单句段落强制归一化为 primary。Focused Chrome smoke 中 1 个有效段落产生 1 个实际 primary Highlight，另一个无效 JSON 段落未计成功。
- T13: Focused Chrome smoke 观察到页面 primary Highlight 文本与成功段落一致，Popup 最终显示“已标记 1/2 个可见段落，1 个失败：响应 JSON 解析失败：模型未返回纯 JSON”；成功、失败与实际 DOM 结果一致。
- T14: Content script 在段落首次入队时添加 linguamark-parsing，content.css 使用浅蓝 rgb(125 211 252) 的 1.15s 脉冲并提供 reduced-motion 静态态；Focused Chrome smoke 在请求未完成时观察到 7 个处理态段落和对应动画，完成后数量归零。
- T16: 首次手动分析后 Content script 启用 150ms 滚动发现并用稳定 WeakMap ID/queuedIds 去重；Focused Chrome smoke 初始处理 7 段，滚到底部后无需再次点击自动新增 2 个请求，最终 9 个唯一请求和 9 个 Highlight。
- T18: contracts.ts 使用 Intl.Segmenter 生成稳定 sentence/token ID，background.ts 的 Prompt 只请求 ID、importance、pattern 与 role tokenIds，并由本地重建精确引用；TypeScript、构建、语法及索引协议行为检查通过。
- T19: 处理中状态改为独立 CSS Custom Highlight：Content 为每段维护 Range，::highlight(linguamark-parsing) 按 5 个实际行片段绘制浅蓝脉冲；段落自身 background 为透明、box-shadow 为 none、border-radius 为 0。隔离 Chrome focused smoke 验证失败清理后 parsing Highlight 被移除。
- T15: 调度器安全并发上限由 5 降为 2，仍满足“最多 5 个”的边界并降低真实供应商同时过载风险；类型检查与构建通过。
- T10: Background 仍按单段队列请求并完成即渲染；真实 DeepSeek 实测长段耗时 108.174 秒，因此本地安全窗口调整为 180 秒，失败仍不阻断后续任务。
- T20: 原日志四段均在 30 秒被本地中止；最新真实测试中 149 字段落 39.868 秒成功、272 字字段落 108.174 秒成功，不再被 30/60 秒提前判败。
- T21: 分析模型 maxTokens 已从人为收紧的 4096 恢复为模型完整预算 32768；真实响应以 stop 正常结束且仅输出 829/963 字符。
- T22: 失败路径将 assistant.errorMessage 或 Agent error 脱敏后同时写入 Background 日志与段落失败状态，并记录 partialOutputCharacterCount；本地超时会明确标识为本地中止。
- T23: 使用 DevChromeProfile 内现有 DeepSeek deepseek-v4-flash 凭据真实复测：149 字段落 39.868 秒、25 个可见标记、0 失败；272 字长段 108.174 秒、解析 4 句/13 角色并成功渲染。四段 60 秒对照测试为 2 成功/2 超时，证明瓶颈是响应时延而非索引解析。
- T17: 根因为 DeepSeek 默认 Thinking 生成 1.6万–5.2万字符隐藏推理；Parsing Adapter 对 DeepSeek 显式关闭 Thinking，并用紧凑内联协议。真实扩展 smoke 从此前 39–108 秒降为 1.944 秒，1/1 段成功并渲染 25 个标记。
- T24: 紧凑 Prompt 原先未明确副词/介词短语不改变主干，模型会把 move quickly through... 视为不确定结构并不返回角色。现新增通用规则与该句示例；真实 DeepSeek 测试 994ms 返回 SV、subject=readers、verb=move，页面生成 3 个可见标记、0 warning。
- Review gate: Skipped — 用户未要求独立 Reviewer 审查。

## Verification

- Passed: npm run check、npm run build、node --check tests/chrome.mjs 通过；真实 DeepSeek 单句 smoke 1.298 秒完成，CSS Highlight 实测 readers 为 subject、move 为 verb，0 warning。按用户规则未运行项目测试套件。
