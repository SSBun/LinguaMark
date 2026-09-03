# 更新 README：特性、安装、使用与徽章

Status: Completed (2026-09-01 17:36)
Kind: Task

## Scope

- 包含面向使用者的功能概览、发布包与源码安装方式、首次配置、网页分析和本地 Markdown 阅读流程，以及项目徽章。
- 不修改扩展功能、构建配置或发布内容。

## Target
- [x] T1: README 清楚展示工具现有且经项目资料验证的特性和功能。
- [x] T2: README 提供可执行的安装与基本使用说明。
- [x] T3: README 展示与项目相关的徽章。

## Plan

1. 以 Manifest、构建配置和用户入口核对功能、兼容性与安装事实。
2. 将 README 重组为项目简介、徽章、特性、安装、配置、使用、限制与开发说明。
3. 核验文档命令、链接、格式及与当前实现的一致性。

## Result

- T1: README 功能特性、隐私与限制章节已按 Manifest、配置契约和用户入口逐项核对。
- T2: README 已提供 Release 安装、源码构建、首次配置、网页分析与 Markdown 阅读步骤；构建成功且发布包根目录含 manifest.json。
- T3: README 已展示 5 个项目相关徽章，所有徽章端点均返回 HTTP 200。
- Review gate: Skipped — 用户未请求独立对抗审查。

## Verification

- Passed: npm run check、npm run build、git diff --check、README 静态核验及徽章与 Release 链接 HTTP 检查均通过；未运行测试套件。
