# 按功能拆分并提交本地改动

Status: In Progress (2026-08-29 10:37)
Kind: Task

## Target

- [ ] T1: 当前本地改动按独立功能或关注点拆分为多个 conventional-style Git 提交，互不混杂。
- [ ] T2: 每个提交仅暂存其逻辑分组并记录清晰提交信息，最终工作区不存在遗漏的待提交改动。

## Plan

1. 提交 Node／TypeScript／Manifest 构建骨架与依赖配置。
2. 提交模型供应商、解析 Adapter、队列、内容采集与非破坏性渲染核心。
3. 提交 Popup、Options 与 Glassmorphism 设置／渲染控制界面。
4. 提交逻辑测试、Chrome 端到端覆盖与英文文章 fixture。
5. 提交持久开发 Chrome 启动器。
6. 提交项目说明文档。
7. 最后提交 workspace Context 与任务记录，并检查提交内容和干净工作区。
