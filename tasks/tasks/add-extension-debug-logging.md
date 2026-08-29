# 增加扩展全链路安全调试日志

Status: Completed (2026-08-28 23:17)
Kind: Task

## Target
- [x] T1: Background、Content script、Popup 与 Options page 在控制台输出带 LinguaMark 命名空间的结构化生命周期日志，覆盖设置、可见段落发现、队列、最大并发、模型请求、解析、渲染、滚动自动入队、进度、失败与恢复。
- [x] T2: 每次分析具有可关联的 session/tab/paragraph 标识和耗时，日志足以独立定位失败阶段，但绝不输出 API Key、Authorization、完整段落文本、模型完整响应或其他敏感内容。
- [x] T3: 隔离 Chrome 验证四个运行上下文均可观察到预期日志，失败路径给出阶段信息，并确认测试凭据和文章正文未出现在日志。

## Plan

1. 增加共享安全日志器，统一 `[LinguaMark:<scope>] <event>` 格式、时间戳和递归敏感字段脱敏。
2. 在 Background 队列／模型／解析／应用、Content 可见发现／滚动／处理态／渲染、Popup 操作／进度、Options 加载／保存／连接测试的每个关键边界记录结构化元数据和耗时。
3. 通过隔离 Chrome 的 page、service worker、Popup 与 Options console 采集日志，验证成功及失败路径，并扫描日志中不得出现测试 Token 或完整正文。

## Result

- T1: 新增共享 debug.ts 安全日志器；Background、Content、Popup、Options 均输出 [LinguaMark:<scope>] 结构化事件，覆盖设置、可见扫描、滚动队列、并发、请求、响应、解析、渲染、处理态、进度和失败。隔离 Chrome 采集计数分别为 27/21/35/41。
- T2: Background 分析状态新增 8 位 sessionId，并在 tabId/paragraphId 上关联排队、模型、应用与完成事件；记录字符数、句子数、角色数、可见标记、active/queued 数和毫秒耗时。日志器递归脱敏敏感字段及 Bearer/sk-* 值，调用点不传正文或模型内容。
- T3: 隔离 Chrome 成功采集四个 scope 共 124 条日志并命中 17 个必需成功/失败事件；故意制造无效 JSON 后观察到 model.response.parse-failed、queue.item.failed 与 content paragraph.failed；完整日志扫描确认测试 Token 和正文 sentinel 均未出现。
- Review gate: Skipped — 用户未要求独立 Reviewer；已完成日志覆盖和敏感信息边界自审。

## Verification

- Passed: npm run build、npm run check 和隔离 Chrome 日志采集 smoke 通过；四个上下文可观测、失败阶段可定位、凭据与完整正文未泄漏；无尾随空白。
