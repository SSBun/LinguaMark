# 配置 Chrome 扩展图标并更新图标技能规范

Status: Completed (2026-08-29 12:26)
Kind: Queue

## Scope

- 包含：更新外部 `create-app-icon` 技能包中的 Chrome Extension 素材规范，并将已批准图标按同一规范接入 LinguaMark。
- 不包含：重新设计图标、发布 Chrome Web Store、修改其他技能包或扩展功能。

## Target
- [x] T1: LinguaMark 构建产物按 Chrome 官方规范包含并使用扩展图标，同时 create-app-icon 技能包含与该实现一致的 Chrome 扩展图标规范与生成边界。

## Children

1. [为 create-app-icon 增加 Chrome 扩展图标规范](add-chrome-icon-spec-to-create-app-icon.md)
2. [配置 LinguaMark Chrome 扩展图标](configure-linguamark-chrome-icons.md)

## Plan

1. 完成并验证 `add-chrome-icon-spec-to-create-app-icon`。
2. 依据已确认规范完成并验证 `configure-linguamark-chrome-icons`。
3. 对技能规范与实际构建产物执行最终一致性检查。

## Result

- T1: 最终集成检查确认 create-app-icon Chrome 规范与 LinguaMark public/dist 清单、10 个 PNG 产物完全一致；128px 主体 bounds 为 [16,17,111,109]。
- Review gate: Skipped — 用户未要求独立或对抗式审查。

## Verification

- Passed: npm run check、npm run build、跨仓规范一致性、PNG/alpha/边距/清单路径及两仓 diff-check 均通过；skill-quality 0 failures，仅有已接受的 1050-token context-budget warning。
