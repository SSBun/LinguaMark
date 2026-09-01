# 为 Markdown Viewer 增加目录浏览

Status: Completed (2026-08-31 15:23)
Kind: Task

## Scope

- 包含：用户授权的目录选择、扩展侧目录句柄持久化、递归 Markdown/图片文件树、当前 Viewer 内 Markdown 切换与单图预览、目录内相对资源解析。
- 不包含：文件写入、非 Markdown 文档预览、图片画廊、目录外资源访问或静默绕过 Chrome 权限。

## Target
- [x] T1: 顶部导航栏提供“打开目录”操作，并且只在用户主动点击后请求 Chrome 目录访问权限
- [x] T2: 用户选择目录后，左侧区域递归展示该目录及子目录中的全部文件；Markdown 与支持的图片可打开，其他文件保持可见但明确禁用且不可打开
- [x] T3: 点击 `.md` 会在当前 Viewer 中按 Lightmind 样式渲染；点击 PNG、JPEG、GIF、WebP、AVIF 或 SVG 会显示图片预览；顶部明确显示当前相对路径
- [x] T4: 所选 Markdown 的目录内相对图片、相对 Markdown 链接与标题锚点继续正确工作
- [x] T5: 打开目录和切换文件只做本地读取与渲染，模型分析仍由用户手动触发
- [x] T6: 现有直接打开 file:// Markdown、导航目录、安全处理和 HTTP/HTTPS 页面行为保持不变
- [x] T7: 已选择的目录句柄保存到 IndexedDB；再次进入 Viewer 时尝试恢复，权限失效时通过明确的用户操作重新授权而不静默绕过 Chrome

## Plan

1. 确定目录选择、扩展侧句柄存储与权限恢复架构。
2. 实现递归文件树和受限的文件读取协议。
3. 接入 Markdown 切换、图片预览与目录内相对资源解析。
4. 验证权限恢复、安全边界、桌面/窄屏交互及既有 Viewer 行为。

## Decisions

- 使用独立扩展授权窗口调用目录选择器；目录句柄保存到扩展来源的 IndexedDB，Background 只按已验证的相对路径枚举和读取文件。
- Content script 不持有目录句柄；Markdown 以文本返回，图片以本地 Data URL 返回。权限不再为 granted 时显示重新授权入口。
- 文件树展示全部文件；Markdown 与受支持图片使用可操作按钮，其他文件使用禁用项，仅展示名称与类型而不发送读取请求。
- 当前版本在授权后一次递归读取目录树并默认展开文件夹；若真实大型目录出现性能问题，再改为按文件夹懒加载。
- Markdown 相对资源只解析到授权根目录内；Background 拒绝含空段、`.`、`..` 或 NUL 的读取路径，并按文件扩展名固定图片 MIME。

## Result

- T1: 顶部“打开目录/更换目录”按钮会打开 520×390 扩展授权窗口；真实 Chromium 确认该窗口暴露 showDirectoryPicker，Background 只接受本地 Markdown tab 的用户操作请求。
- T2: 扩展 IndexedDB 中的 Notes 目录恢复后，文件树递归显示 3 个 Markdown、2 个图片和 2 个其他文件，文件夹默认展开；其他文件全部 disabled 且没有读取监听器。
- T3: 点击 README.md、docs/guide.md、Mermaid 文档、SVG 与 PNG 均在当前 Viewer 切换；顶部依次显示相对路径，文件树活动项同步高亮，图片预览使用对应 Data URL。
- T4: 目录 Markdown 的 ../ 相对链接、跨文档 #anchor 和相对 SVG 均通过授权根内路径解析；锚点目标未被顶部导航遮挡，越界 ../../ 链接被转为 aria-disabled。
- T5: 目录切换只发送受限本地读取消息；旧 CSS Highlight 在切换后清除，新 START_ANALYSIS 仅采集当前 Markdown 正文且不包含目录名或禁用文件名，未自动发起模型分析。
- T6: 无目录句柄时仍显示既有标题目录；安全净化、Lightmind、KaTeX、有效/无效 Mermaid、14 类图表与直接 file:// 行为保持，HTTP 烟雾页仍只返回唯一预期正文。
- T7: FileSystemDirectoryHandle 成功存入扩展来源 IndexedDB，并在关闭重启 Chromium 后自动恢复 Notes 文件树；picker complete 通知即时刷新目标 tab，授权窗口显示已保存目录的恢复入口。
- Review gate: Skipped — 用户未请求独立对抗性审查。

## Verification

- Passed: npm run check、npm run build、npm audit --omit=dev、目录 helper 检查、git diff --check、Context validate，以及真实 Chromium 首次/通知/重启恢复、全部文件树、禁用项、Markdown/图片/相对资源/锚点/Mermaid/窄屏/分析重置/HTTP 烟雾检查均通过；未运行项目测试套件。
