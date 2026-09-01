# 解析页面全部可见文本

Status: Completed (2026-08-29 21:45)
Kind: Task

## Scope

- Included: 发现并解析当前视口内所有用户可见文本；覆盖标题、导航、按钮、侧栏等正文外文字；继续在滚动时增量发现；可选择标记核心词或完整主谓宾补短语。
- Excluded: 脚本、样式、隐藏文本和表单字段值；不新增状语、定语或介词短语等独立角色，不改动并发策略。

## Target
- [x] T1: 页面分析覆盖当前视口中的所有可见文本字符串，包括正文外的标题、导航、按钮和侧栏文字，不再仅限正文内容。
- [x] T2: 滚动后新进入视口的可见文本继续按现有增量流程进入解析。
- [x] T3: 复现并解释截图中大量可见内容未被检测和解析的根因。
- [x] T4: 完整短语模式将主语、谓语、宾语和补语标记为完整角色短语，包含其限定词与内部修饰语；短语外的状语等成分仍不标记。
- [x] T5: 修复不纳入脚本、样式、隐藏文本或表单字段值，并保留滚动增量发现行为。
- [x] T6: 设置页提供“完整句法短语”开关并持久化；默认开启，关闭后恢复核心词解析。
- [x] T7: 复现并解释截图中仍有完整句子未生成任何句法角色的根因。
- [x] T8: 修复后，截图中的可解析英文句子不再仅因并列、分号、引语报告结构或现有句型限制而整句无标记。
- [x] T9: 完整短语／核心词开关、可见文本发现、滚动增量和既有安全降级保持有效。
- [x] T10: 每个包含显式限定谓语的完整英文句子至少生成一组可见句法角色，不得以空角色结果完成解析。
- [x] T11: 只有标题、标签、残句等确实不存在显式完整句式的文本片段可以保持无句法角色；句子重要度和现有显示行为保持有效。
- [x] T12: 复现并量化截图中高频解析失败发生在模型输出、响应校验还是渲染阶段，并给出根因证据。
- [x] T13: 优化后，普通正文和常见复合结构不会因可修复的模型格式或角色遗漏而频繁整块失败，同时仍禁止静默空解析。
- [x] T14: 优化保持请求次数有界、错误可观察，并保留完整短语开关、可见文本发现、滚动增量和安全边界。
- [x] T15: `pre` 代码块及其语法高亮后代不进入初次、预加载或滚动增量分析，也不生成 LinguaMark 标记。
- [x] T16: 排除代码块不改变普通正文、标题、按钮和正文内行内代码的既有发现行为。

## Plan

1. 在共享文本发现入口排除语义化代码块，使初次、预加载和滚动扫描共用同一边界。
2. 保留普通正文中的行内代码，不按不稳定站点类名扩大排除范围。
3. 验证代码块不进入模型或 Highlight、行内代码仍随正文分析，并完成类型检查与构建。

## Result

- T1: 聚焦 Chromium smoke 收集到导航链接、标题、正文、侧栏、按钮和 SVG 文字，排除了脚本、隐藏文字与表单字段值；正文和 SVG 均成功非破坏性渲染 Highlight。
- T2: 聚焦 Chromium scroll smoke 在滚动事件后只将新进入视口的 footer 文字发送为 QUEUE_VISIBLE_PARAGRAPHS。
- T3: 截图中的句界与角色线证明文本已进入解析；根因是旧 Prompt 明确只返回中心词、排除限定词与修饰语，且复杂句可降为 unclassified，并非可见文本发现失败。
- T4: 独立 Chrome mock smoke 在默认模式将 Modern readers 渲染为完整主语，关闭模式后同一文本仅渲染 readers；Prompt 同时保留短语外状语排除规则。
- T5: 本轮未修改 Content script 的可见文本发现、排除选择器或滚动队列；原 T1/T2 Chromium 证据保持有效，类型检查与构建通过。
- T6: 独立 Chrome smoke 确认旧／空设置默认开启完整短语，开关写入 storage、联动预览，并让后续分析分别使用完整短语与核心词 Prompt。
- T7: 根因确认：旧 Prompt 要求复合结构直接 unclassified，紧凑响应解析还会在本地强制把分号与部分引语报告句清空角色，因此整句必然无句法标记。
- T8: 新增 multi 句型承载按原文顺序重复的顶层分句角色，移除本地强制清空；最终 Chrome mock smoke 同时渲染 Birds/fish/He/his assistant 与 fly/swim/left/stayed。
- T9: 完整短语与核心词规则继续共用同一 multi 协议；本轮未修改可见文本发现、排除选择器或滚动队列，旧设置与原安全降级仍由现有读取和 unclassified 路径保留。
- T10: 正文 p/blockquote 现携带 requireRoles；模型若返回 fragment、空角色或与句型不完整的角色集合会在响应入口被拒绝并计为失败。Chrome mock 已证实正文 Birds fly. 被错误降为 fragment 时不会成功。
- T11: 标题、标签等非正文块允许 fragment 空角色；结构不确定的完整句改用至少含限定谓语的 unclassified。Chrome mock 证实 unclassified 的 fly 可见，原重要度与显示设置保持。
- T12: Chrome mock 稳定复现：两句正文中 s0 完全有效、s1 的 SVO 缺宾语时，旧响应校验在 model.response.parse-failed 阶段拒绝整块，导致有效 s0 也无任何 Highlight；截图现象与该失败模式一致。
- T13: 含有效谓语但角色集合不完整时现保守降为 unclassified、保留 S/V/翻译并记录警告；无谓语、缺句、缺翻译或非法 JSON 才纠错一次。Chrome smoke 证实原整块失败案例单请求成功渲染两句。
- T14: Chrome smoke 分别证实首次失败后第二次纠错成功，以及连续两次无效时恰好发出两次请求并显示最终错误；日志记录 attempt、willRetry、attemptCount 与降级句数，现有模式和发现代码未改。
- T15: 共享 TreeWalker 排除选择器新增 pre 与 [role=code]，并从文本流根选择器移除 pre；Chrome smoke 中可见和滚动后代码块哨兵均未进入模型 Prompt，也未出现在任何 CSS Highlight。
- T16: 排除通过祖先 pre／role=code 生效，不全局排除 code；Chrome smoke 证实正文内 INLINE_CODE_SENTINEL 仍进入首轮 Prompt，普通正文与滚动 footer 继续解析。
- Review gate: Skipped — 用户未要求独立 Reviewer 审查。

## Verification

- Passed: npm run check、npm run build、node --check tests/chrome.mjs、git diff --check、Context validate、dist 静态检查及代码块初次／滚动排除与行内代码保留 Chrome smoke 均通过；按用户规则未运行项目测试套件。
