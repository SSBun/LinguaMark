# 基准比较解析协议

Status: Completed (2026-08-29 08:38)
Kind: Plan

## Target
- [x] T1: DeepSeek Chat Completions 解析请求显式关闭 Thinking、不设置调用方 `max_tokens`；五句基准连续两次均在 5 秒内完成且没有 `reasoning_content`。
- [x] T2: 每个完整段落在本地分句分词后，以 `S0:[0]word` 形式内联短 ID；模型只返回紧凑句子分类、句型和角色词元 ID，不复制原文。
- [x] T3: 五大句型基准连续两次返回全部句子、正确句型和精确中心词角色，不把限定词或形容词修饰语纳入名词角色。
- [x] T4: 缩写、标点、缩约词、疑问倒装、引号报告句和分号复句由本地切分／词元保护与明确示例共同约束；无法安全定位时使用 `unclassified`，不得生成标点专用或重叠角色。
- [x] T5: 新协议保留逐段失败隔离、重要度分类、五大句型、S/V/O/C 颜色映射和本地不可信输出校验。
- [x] T6: 底层解析实现通过一个稳定 Adapter 接口完成请求编码、模型选项和响应解码；Background 不直接依赖具体 Wire Format。
- [x] T7: Adapter 同时提供方法 1 的 JSON 词元策略和方法 4 的增强紧凑内联策略；增强紧凑策略为默认，JSON 策略可独立选择和验证，不增加设置页 UI。

## Scope

- Included: 当前 JSON 词元、内联完整 ID、内联短 ID／紧凑输出、关闭 Thinking、中心词强化和疑问句示例；使用五大句型段落及标点／引号边界文本进行真实 DeepSeek 重复测量。
- Excluded: 修改 `src/`、`public/` 或构建配置；更换供应商／模型；统计显著性的长期性能基准。

## Decisions

- 最大速度瓶颈不是标记格式，而是 DeepSeek V4 Flash 默认 Thinking：三种协议开启 Thinking 时平均 69.3–76.9 秒，产生约 3.1–3.6 万字符 `reasoning_content`；关闭 Thinking 后平均降至 1.7–3.1 秒且推理字符为 0。Chat Completions 使用官方参数 `thinking: { "type": "disabled" }`。
- 选用“内联短 ID + 紧凑数组输出 + 中心词明确规则”。两次五句基准分别为 2.076／1.483 秒，均正确；平均输出 294 字符，比 JSON 基线 1893 字符减少约 84%。
- 不选未经强化的纯紧凑 Prompt：虽然平均 1.670 秒，但两次都把 `difficult`、`useful`、`complex` 等修饰语纳入名词角色。加入中心词规则后只增加约 0.11 秒并连续两次精确。
- 本地标记格式为 `S0:[0]Birds [1]fly[2].`；模型输出短码数组，例如 `{"s":[["0","d","SV",[["S",["0"]],["V",["1"]]]]]}`。实现层再把短码扩展为现有语义类型。
- 缩约词必须允许子词元切分，例如 `[0]What[1]'s [2]your [3]name[4]?`；仅给通用规则时两次均误判，加入明确疑问倒装示例后两次均在 1.038 秒内返回正确 SVC 与 S/V/SC。
- 标点边界实验显示：分号复句可通过明确规则稳定降为 `unclassified`，但“引号疑问句 + 报告从句”仍可能被错误强套 SVO。实现时必须加入本地守卫：标点专用角色、跨分句角色或无法唯一归类的引号报告句直接降为 `unclassified`，不能只信 Prompt。
- 所有实验使用相同 `deepseek-v4-flash`、零温度、流式请求、无调用方 `max_tokens`，串行执行；API Key 仅在扩展页面内读取，未输出或写入基准产物。

## Plan

1. 在 Provider 请求选项中仅对确认支持的 DeepSeek Chat Completions 发送 `thinking: { type: "disabled" }`；其他供应商维持各自兼容路径，并继续不收紧模型输出预算。
2. 将每个本地句子的非空白词元转换为短数字 ID，并按原始字符位置把标记直接插入句子文本；对缩约词增加可独立定位的子词元。
3. 把模型输出契约改为紧凑数组和短码，在本地恢复 `importance`、`pattern`、`GrammarRole`，并校验句子齐全、ID 范围、连续性、角色集合与重叠。
4. 在 Prompt 中保留中心词规则和最小疑问倒装示例；在本地对标点专用角色、分号复句和无法唯一归类的引号报告句执行 `unclassified` 降级。
5. 定义最小解析 Adapter 契约，把本地索引、Provider 选项和 ParagraphAnnotation 作为稳定边界；实现 JSON 词元与增强紧凑内联两个策略，默认选择后者。
6. 增加确定性协议测试和真实 DeepSeek focused smoke：覆盖两个 Adapter、五大句型、缩写／小数、缩约词疑问句、引号报告句、分号、重复词、输出大小、Thinking 关闭及无 `reasoning_content`。

## Result

- T1: 真实 DeepSeek 基准在 thinking disabled 且无调用方 max_tokens 时连续两次为 2.076/1.483 秒；扩展集成 smoke 为 1.853 秒且无 reasoning_content。
- T2: compact-marked Adapter 将整段编码为 P/句子行和内联短词元 ID，并解码紧凑 s 数组；模型响应不含原文，真实 smoke 输出仅 294 字符。
- T3: 中心词强化紧凑 Prompt 的两次五句基准均返回 SV/SVC/SVO/SVOO/SVOC 和精确 16 角色；扩展 smoke 同样解析 5 句/16 角色、0 warning。
- T4: 本地保留缩写/报告句合并，新增缩约词子词元、标点专用角色拒绝、分号和引号报告句 unclassified 守卫；疑问倒装 worked example 两次真实请求均正确。
- T5: 真实扩展 smoke 通过既有队列和 Content 渲染成功应用 25 个可见标记，保留重要度、五大句型、S/V/O/C、本地 ID 校验及失败隔离边界。
- T6: 新增 parsing.ts 的 ParsingAdapter 契约，封装 IndexedParagraph 请求编码、Provider samplingParams 和 ParagraphAnnotation 响应解码；Background 只调用该稳定接口。
- T7: parsingAdapters 同时注册 json-token 与 compact-marked，默认指向 compact-marked；确定性检查证明两者对同一索引生成等价 ParagraphAnnotation，未增加设置页 UI。
- Review gate: Skipped — 用户未要求独立 Reviewer 审查。

## Verification

- Passed: npm run check、npm run build、node --check tests/chrome.mjs、Adapter 确定性检查通过；真实 DeepSeek 扩展 smoke 1.944 秒完成、1/1 成功、25 个可见标记。按用户规则未运行项目测试套件。
