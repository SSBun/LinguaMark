# 优化 DeepSeek 解析延迟

Status: Completed (2026-08-29 21:12)
Kind: Task

## Target
- [x] T1: 用分阶段计时复现并解释当前 4–5 秒解析延迟相对既有 1.5–2.1 秒基准的增量来源。
- [x] T2: 移除可避免的延迟，不重新开启 Thinking，不削弱句法、翻译开关、响应恢复或安全校验。
- [x] T3: 在可比输入上记录优化后的首轮请求、纠错请求与整批完成时间，证明常规成功路径不承担额外请求。
- [x] T4: 任一文本块完成解析后立即在原页面渲染并更新进度，不等待同批其他文本块完成。
- [x] T5: 设置页提供可持久化的并发上限配置，默认值为 10；旧设置和非法值安全回退为默认值。
- [x] T6: 每次分析会话固定使用开始时读取的并发上限，调整不影响正在执行的请求或既有解析安全边界。

## Plan

1. 用快慢两个文本块验证现有逐块应用与进度通知路径，并保持其不等待整批完成。
2. 在分析设置中持久化有界并发上限，旧设置默认 10；每个分析会话读取一次并据此调度队列。
3. 验证默认值、非法值回退、会话快照、并发峰值、快块提前渲染、构建产物与失败恢复。

## Result

- T1: 同一五文本块、每请求固定 600ms 的 Chrome 基准在并发 2 时 maxInFlight=2、需 3 波、整批 1844ms；按既有 DeepSeek 单请求 1.5–2.1s 外推即 4.5–6.3s。翻译开启只使五句示例 Prompt 增 112 字符、示例输出约增 6%，不是三倍延迟主因。
- T2: 恢复 README 已声明的五文本块并发上限；未改 deepseek-v4-flash、thinking disabled、Prompt、翻译、句法、纠错次数或输出校验。新增 queueWaitMs 与逐次 requestDurationMs/totalDurationMs 日志。
- T3: 相同五块 600ms 基准优化后 maxInFlight=5、1 波、整批 635ms，相比 1844ms 降低约 66%；服务端恰收 5 次请求，证明五个常规成功块各只发首轮一次。纠错成功与两次封顶 smoke 继续通过。
- T4: 现有 processQueueItem 在单块解析后立即发送 APPLY_ANNOTATIONS，再更新 ANALYSIS_PROGRESS；快慢双块 Chrome smoke 中快块 129ms 即显示 Birds，此时 900ms 慢块尚未完成，最终再加入 Fish。
- T5: 设置页分析区新增 1–20 的并发上限数字项；DisplaySettings 默认和旧／非法值回退均为 10。Chrome smoke 确认默认显示 10、调度峰值 10，改为 3 后持久化且下一会话峰值为 3。
- T6: Background 在会话开始时将 analysisConcurrency 固定进 TabAnalysisState；Chrome smoke 以 2 启动六块分析、中途改为 10，当前会话峰值仍为 2，下一会话读取 10。
- Review gate: Skipped — 用户未要求独立 Reviewer 审查。

## Verification

- Passed: npm run check、npm run build、node --check tests/chrome.mjs、git diff --check、Context validate、dist 静态检查及并发默认／自定义／会话快照／快块提前渲染 Chrome smoke 均通过；按用户规则未运行项目测试套件。
