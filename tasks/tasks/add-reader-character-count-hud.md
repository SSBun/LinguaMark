# 为阅读器增加内容字符统计 HUD

Status: Completed (2026-09-03 16:18)
Kind: Task

## Target
- [x] T1: Reader 页面左下角以低干扰的简单标签展示当前内容统计，不使用醒目的卡片样式，并在内容变化后同步更新。
- [x] T2: 标签显示一个合计值，等于中文汉字数加英文单词数，并以“字词”为单位。
- [x] T3: 字词标签占用左下角独立区域，不覆盖文章目录或文件树内容。

## Plan

1. 复用 Reader 现有排版与弱化文字令牌保留左下角统计标签。
2. 按中文汉字与英文单词分别计数后显示合计值，并在初始渲染、文件切换和异步恢复后同步。
3. 为标签预留独立布局区域，保持文章目录与文件树内容无遮挡。
4. 运行类型检查、构建和桌面／窄屏浏览器冒烟核验。

## Result

- T1: 左下角标签继续保持 12px 弱化文字、透明背景、无边框和阴影，1200px 与 375px 视口均完整可读且不拦截指针。
- T2: 直接 fixture 与浏览器同为 263 字词；standalone 混排显示 9/10 并在重载后保持 10；新增持久断言及 Chrome 冒烟确认“中文，hello world! 123 can’t/can’t state-of-the-art”按 2 汉字加 5 英文词显示 7 字词。
- T3: 1200×900 Chrome 中目录底边为 852px、标签顶边为 869.6px，间隔 17.6px 且重叠为 0；80 项长目录可滚动到底，末项完整位于目录边界内；375px 抽屉层级覆盖标签，不遮挡目录。
- Review gate: Approved — 强制独立审查确认侧栏独立预留区、长列表滚动和窄屏层级正确，无 confirmed finding；文件树运行时与极低视口为非阻塞风险。

## Verification

- Passed: npm run check、npm run build、node --check tests/file-picker.mjs、git diff --check、Context/Lessons 校验及桌面长目录/375px 抽屉 Chrome 冒烟核验通过；按规则未运行测试套件。
