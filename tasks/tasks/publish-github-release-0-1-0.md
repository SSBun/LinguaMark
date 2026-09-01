# 提交本地改动并发布 GitHub Release 0.1.0

Status: Completed (2026-09-01 17:23)
Kind: Task

## Target
- [x] T1: 当前工作区的全部本地改动均已提交，且发布提交后工作区干净。
- [x] T2: ssbun 账号下已创建公开的 LinguaMark GitHub 仓库，并已推送发布所需提交。
- [x] T3: 版本 0.1.0 已作为 GitHub Release 发布，并指向已推送的发布提交。

## Plan

1. 审查待提交文件、版本元数据、凭据风险与 GitHub 目标状态。
2. 运行类型检查和构建，生成 0.1.0 可安装压缩包并核验内容。
3. 提交当前工作区的全部本地改动。
4. 经独立安全确认后，创建公开仓库、推送提交并发布 GitHub Release。
5. 核验远程仓库、Release、资产与最终工作区状态。

## Result

- T1: 提交 7f6ace2 纳入 139 个待提交文件，提交后 git status --short 为空；发布收尾记录将随最终 bookkeeping 提交纳入。
- T2: gh repo view 确认 SSBun/LinguaMark 为 PUBLIC，main 已推送且远程 SHA 与 7f6ace2 一致。
- T3: GitHub Release v0.1.0 已发布，tag 指向 7f6ace2；下载资产 SHA-256 与本地包一致。
- Review gate: Skipped — 用户未请求独立对抗审查。

## Verification

- Passed: npm run check、npm run build、git diff --check、ZIP 完整性、远程 main/tag 与下载资产校验均通过；按项目规则未运行测试套件。
