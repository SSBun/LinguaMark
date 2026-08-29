# 安装 LinguaMark 开发扩展到 Google Chrome

Status: Cancelled (2026-08-28 20:06)
Kind: Task

## Target

- [ ] T1: 构建当前 LinguaMark 扩展并将 dist 作为 unpacked extension 加载到用户的常用 Google Chrome，而不是仅加载到临时 Chrome for Testing。
- [ ] T2: 确认 Google Chrome 的扩展管理页显示 LinguaMark，且扩展可在普通 HTTP/HTTPS 页面运行；不修改或移除其他扩展。

## Plan

1. 重新构建 `dist`，确认 Manifest 与扩展产物有效。
2. 检查常用 Google Chrome 的运行状态与用户 profile，优先通过开发者模式“加载已解压的扩展程序”安装，避免替换 profile 或改动其他扩展。
3. 在 Google Chrome 中确认 LinguaMark 的扩展条目和普通网页注入能力。
