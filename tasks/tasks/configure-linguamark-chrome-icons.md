# 配置 LinguaMark Chrome 扩展图标

Status: Completed (2026-08-29 12:25)
Kind: Task
Parent: setup-chrome-icons-and-skill-spec

## Scope

- 仅生成 Chrome 所需尺寸并接入扩展清单；保留已批准图标构图，不发布商店版本。

## Target
- [x] T1: LinguaMark 包含从已批准主图生成的 16、24、32、48、128 像素方形 RGBA PNG，其中 128px 商店图标主体按官方建议居中在约 96px 范围内。
- [x] T2: 扩展清单同时配置通用 icons 与工具栏 action.default_icon，并且所有引用在构建产物中存在。

## Plan

1. 从透明主图生成并验证 Chrome 尺寸素材。
2. 将素材引用接入扩展清单并构建。
3. 检查类型、构建产物、尺寸、格式、透明边距和引用完整性。

## Result

- T1: 从已批准 master 生成 16/24/32/48/128 五个 RGBA PNG；逐文件解码验证尺寸、透明四角和非空主体，128px 主体 bounds 为 [16,17,111,109]（96×93）。
- T2: public 与 dist manifest 均含 icons 16/32/48/128 和 action.default_icon 16/24/32；脚本确认 10 个 public/dist 引用文件全部存在。
- Review gate: Skipped — 用户未要求独立或对抗式审查。

## Verification

- Passed: npm run check 与 npm run build 通过；清单 JSON、PNG 元数据、alpha、128px 边距、public/dist 路径完整性及深浅背景预览均通过，git diff --check 无错误。
