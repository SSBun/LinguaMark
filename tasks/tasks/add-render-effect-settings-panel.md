# 在设置页添加渲染效果面板

Status: Completed (2026-08-29 10:34)
Kind: Task

## Target
- [x] T1: 设置页提供渲染效果面板。
- [x] T2: 默认渲染仅按标记类型改变颜色，不添加下划线、双下划线或其他特殊装饰。
- [x] T3: 渲染效果面板以列表展示主旨、支撑、细节、主语、谓语、宾语和补语七种文本标记；句界保留独立开关。
- [x] T4: 用户可逐项编辑是否高亮及颜色，设置会持久化并应用到文章。
- [x] T5: 七种文本标记可逐项选择“文字变色”或“彩色下划线”高亮模式。
- [x] T6: 旧设置和新设置默认使用文字变色；模式选择会持久化并实时应用，下划线模式使用该项配置颜色且不改变原文字色。
- [x] T7: 修复用户切换到彩色下划线后文章渲染效果不变化的问题，并在当前开发 Chrome 中验证切换立即可见。

## Plan

1. 为每种文本标记增加可持久化的高亮模式，并兼容没有模式字段的旧设置。
2. 在渲染列表中增加逐行模式选择，保持现有启用开关和颜色编辑。
3. 让 Content script 按模式生成文字颜色或彩色下划线，并实时响应设置变化。
4. 补充两个模式的可运行检查并完成类型检查、构建与静态验证。

## Result

- T1: 设置页构建产物包含渲染效果面板、句界/重要度/句法三个开关及 S/V/O/C 颜色图例；开关写入现有 displaySettings 并通过 storage.onChanged 同步文章。
- T2: content.css 的全部 Highlight 样式仅设置 color，不含 text-decoration 或背景装饰；句界默认关闭。
- T3: 设置页渲染表格列出主旨、支撑、细节、主语、谓语、宾语和补语七行，每行提供高亮开关与颜色编辑器；句界仍为独立开关。
- T4: 逐项 enabled/color 写入 displaySettings.highlights；旧设置会补全默认值，Content script 通过 storage.onChanged 和 CSS 变量实时应用，Popup 图例同步自定义颜色。
- T5: Options 渲染表格七行均新增 text/underline 模式选择；DisplaySettings 为每个类型持久化 mode，Content 在原逻辑 Highlight 与 -underline Highlight 间逐项切换。
- T6: readDisplaySettings 将旧设置和非法模式回退为 text；浏览器 smoke 将 subject 切换为 underline 后仅注册 linguamark-subject-underline，原文 color 保持 rgb(20,30,40)，下划线为 underline 且颜色 rgb(255,0,255)。
- T7: 根因为开发 Chrome 于 09:05 启动，而下划线 dist 于 10:10 构建；旧 Content script 不识别 mode，故设置保存但文章效果不变。已关闭旧会话、重载扩展并以最新 dist 重启；独立 Chrome smoke 证明 subject 在 text/underline 名称间互斥切换且下划线颜色生效。
- Review gate: Skipped — 用户未要求独立 Reviewer 审查。

## Verification

- Passed: 时间戳证实旧运行时早于新构建；npm run check/build、静态检查和浏览器实时模式 smoke 通过。最新开发 Chrome 已以 status=ready 启动于 http://127.0.0.1:52708/english-reading-article.html。按用户规则未运行项目测试套件。
