# 为 create-app-icon 增加 Chrome 扩展图标规范

Status: Completed (2026-08-29 12:21)
Kind: Task
Parent: setup-chrome-icons-and-skill-spec

## Scope

- 仅修改 `create-app-icon` 技能包；Chrome 指南必须自包含、使用英文，并保留现有平台分支。

## Target
- [x] T1: create-app-icon 技能明确支持用户选择 Chrome Extension 标准素材，并保持现有 macOS、iOS、Android 流程。
- [x] T2: 技能内的英文 Chrome 规范准确覆盖 PNG 尺寸、128px 透明边距、toolbar Action、manifest 配置、深浅背景和验证要求。

## Plan

1. 检查技能包结构、现有平台材料流程与官方 Chrome Authority。
2. 以最小改动加入 Chrome Extension 选择入口和自包含规范。
3. 运行技能质量门禁与静态差异检查。

## Result

- T1: SKILL.md 现将 Chrome Extension 列为平台素材选项，并保留 macOS、iOS、Android 与原审批流程。
- T2: 新增英文 chrome-extension-icons.md，覆盖 16/24/32/48/128 PNG、96px 商店主体、16px 透明边距、Action、manifest、深浅背景和五项验证。
- Review gate: Skipped — 用户未要求独立或对抗式审查。

## Verification

- Passed: skill-quality 为 0 failures、1 个 1050-token context-budget warning；按适用 workflow 完整性 Lesson 接受该非阻塞 warning，git diff --check 通过。
