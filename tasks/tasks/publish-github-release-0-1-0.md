# 提交本地改动并发布 GitHub Release 0.1.0

Status: In Progress (2026-09-01 17:12)
Kind: Task

## Target

- [ ] T1: 当前工作区的全部本地改动均已提交，且发布提交后工作区干净。
- [ ] T2: ssbun 账号下已创建公开的 LinguaMark GitHub 仓库，并已推送发布所需提交。
- [ ] T3: 版本 0.1.0 已作为 GitHub Release 发布，并指向已推送的发布提交。

## Plan

1. 审查待提交文件、版本元数据、凭据风险与 GitHub 目标状态。
2. 运行类型检查和构建，生成 0.1.0 可安装压缩包并核验内容。
3. 提交当前工作区的全部本地改动。
4. 经独立安全确认后，创建公开仓库、推送提交并发布 GitHub Release。
5. 核验远程仓库、Release、资产与最终工作区状态。
