# 增加逐句翻译浮窗

Status: Completed (2026-08-29 20:26)
Kind: Task

## Scope

- 包含：逐句中文翻译、鼠标悬浮查看、快捷键查看鼠标当前所在句，以及翻译与悬浮的独立设置。
- 不包含：整篇翻译、词典、翻译编辑、历史记录、目标语言、浮窗延迟、字号或自定义快捷键设置。

## Target
- [x] T1: 每个成功分析的句子都包含与原句正确对应的中文翻译。
- [x] T2: 鼠标悬浮已分析句子时显示该句的简约翻译浮窗，移开后隐藏。
- [x] T3: 快捷键可显示鼠标当前所在句子的翻译。
- [x] T4: 翻译浮窗不改写网页正文，也不阻断网页原有交互。
- [x] T5: 设置页提供默认开启且可持久化的“启用翻译”和“鼠标悬浮显示”开关，旧设置保持当前开启行为。
- [x] T6: 关闭“启用翻译”后，后续分析不再请求或展示句子翻译。
- [x] T7: 关闭“鼠标悬浮显示”后不再自动弹出翻译浮窗，但快捷键仍可显示已有翻译。
- [x] T8: 设置页以独立“翻译设置”区块承载两个翻译开关，原“渲染配置”区块不再包含翻译配置。
- [x] T9: 开启逐句翻译与悬浮显示后，鼠标停在已分析句子上可靠显示对应翻译，移开后隐藏，快捷键及网页交互保持可用。
- [x] T10: 翻译浮窗以目标句子的可见范围为锚点居中显示在句子上方，并在顶部空间不足时保持完整可见，不再按鼠标坐标定位。

## Plan

1. 让两个分析协议生成并严格校验逐句中文翻译。
2. 将句子范围与翻译绑定，提供悬浮和快捷键浮窗交互。
3. 更新受协议影响的固定数据，并执行不运行测试套件的静态与构建验证。
4. 在现有显示设置中加入翻译与悬浮开关，并保持旧设置兼容。
5. 让分析请求和原页浮窗分别遵循对应开关。
6. 更新受影响的固定数据和说明，并重新执行静态与构建验证。
7. 将两个翻译开关移入独立设置区块，并保持其存储与行为不变。
8. 复现悬浮失效路径，定位根因并以最小改动恢复翻译浮窗。
9. 重新验证悬浮、快捷键、设置开关与网页交互边界。
10. 将翻译浮窗改为句子范围锚定定位，并验证多行句子与视口边缘。

## Result

- T1: 两个分析 Adapter 都要求逐句简体中文翻译，统一解析层拒绝缺失或空白翻译；npm run check 通过。
- T2: Content script 将每句翻译绑定到原句 DOM Range，pointermove 命中后显示浮窗、移开或滚动后隐藏；npm run build 通过。
- T3: Manifest 注册 Alt+Shift+T／Option+Shift+T，Background 将命令转发给当前标签页；构建产物检查确认命令和消息处理均存在。
- T4: 原文继续使用 DOM Range 且不包裹或替换正文；浮窗使用 textContent、pointer-events:none 并排除于后续文本采集。
- T5: Options page 新增逐句翻译与悬浮显示两个开关，DisplaySettings 默认均开启并对旧存储回退为开启；设置写入 chrome.storage.local。
- T6: Background 将 translation 固定到分析会话；关闭时两个 Adapter 明确不翻译并允许无翻译响应，Content script 同时禁止翻译浮窗。
- T7: Content script 仅在 translationHover 开启时自动显示浮窗，而 SHOW_HOVERED_TRANSLATION 快捷键路径只受翻译总开关控制。
- T8: Options page 新增独立 translation-settings 区块承载两个翻译开关；构建产物检查确认 render-settings 区块已不含这两个控件。
- T9: 新临时 Chrome 配置中加载当前 dist，使用本地模型响应完成 1/1 文本块；悬浮后浮窗 hidden=false 且显示“鸟会飞。”，句法高亮与网页交互路径正常，因此无需生产代码修复。
- T10: Content script 使用目标句子 Range 的 bounding rect 计算浮窗位置；浏览器冒烟检查得到 above=true、centerDelta=0，并保留视口边缘回退。
- Review gate: Skipped — 用户未要求独立 Reviewer 审批。

## Verification

- Passed: 浏览器定位冒烟验证、npm run check、npm run build、git diff --check 与 Context validate 均通过；按当前规则未运行测试套件。
