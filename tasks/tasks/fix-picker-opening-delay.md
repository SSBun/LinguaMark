# 修复文件和目录选择器打开延迟

Status: Completed (2026-09-03 10:01)
Kind: Task

## Scope

- 包含：文件与目录选择器直接打开、避免恢复到响应缓慢的历史位置、隐私安全的选择器日志，并通过项目级 Chrome DevTools MCP 与隔离 Chrome 核验。
- 不包含：修改 macOS、个人 Chrome 配置、个人浏览标签、凭据或云盘服务的系统配置。

## Target
- [x] T1: 点击“打开文件”或“打开目录”后，LinguaMark 会立即发起对应选择流程，不再因自身逻辑长时间阻塞选择页面出现
- [x] T2: 文件选择与取消操作、目录只读权限边界及已授权目录的读取行为保持不变
- [x] T3: 点击“打开文件”会直接打开系统文件选择器，等待期间不把按钮或光标显示为持续加载状态；选择 Markdown 后打开文件，取消时保持当前内容
- [x] T4: 点击“打开文件”会可靠触发系统文件选择器，并为点击、选择、取消或失败提供不包含本地路径和文件内容的诊断日志
- [x] T5: Chrome DevTools MCP 已按官方方式安装，并用于在真实 Chrome 扩展页面复现和核验“打开文件”交互及诊断日志
- [x] T6: 使用隔离 Chrome 与临时文件运行聚焦测试，复现或准确定位“打开文件”卡死边界，并以自动化回归检查证明修复后选择、取消和页面可用性
- [x] T7: 点击“打开目录”或“更换目录”会直接显示系统目录选择器，不再先展示 LinguaMark 目录授权中间页；选择后加载目录，取消时保持当前内容
- [x] T8: 独立 Viewer 继续持久化目录授权；`file://` 页面直接选择的新目录仅在当前标签页有效，页面重载后由用户重新选择，且目录句柄不写入页面来源存储
- [x] T9: `file://` 页面点击目录按钮会显示可见的系统目录选择器，重复点击不会产生“File picker already active”错误；选择后加载目录，取消时保持当前内容

## Plan

1. 复现 `showDirectoryPicker()` 已激活但不可见的 `file://` 行为，并保留 standalone Viewer 的可见系统 picker 与持久授权。
2. 将 `file://` 目录入口改为浏览器原生 directory file input；从返回的临时 FileList 建立文件树和受限读取映射。
3. 防止重复激活错误，保持选择、取消、目录内 Markdown／图片读取及当前标签页隔离。
4. 增加可见 chooser、文件树和回归检查，再运行完整测试套件。

## Decisions

- 截图中的加载光标来自按钮在 `showOpenFilePicker()` Promise 等待期间被禁用，而禁用样式使用 `cursor: wait`；页面因此看起来假死。
- 单文件选择使用 `showOpenFilePicker({ startIn: "downloads" })`；standalone 目录选择使用 `showDirectoryPicker({ startIn: "downloads" })`；`file://` 目录选择使用标准 directory file input。三个入口均在当前页面的用户点击内直接调用系统选择器且不在等待期间禁用按钮。
- 单文件与 standalone 目录选择器从 Downloads 开始且不传 picker ID，避免恢复指向 iCloud MyWiki 的历史位置。
- Chrome DevTools MCP 使用项目级 `.mcp.json`、固定版本 1.8.0、临时隔离 profile、Chrome for Testing 与扩展工具，并关闭 MCP 使用统计与 CrUX 请求；不连接个人 Chrome。Pi MCP adapter 未提供 workspace roots，故 `install_extension` 按安全策略拒绝项目路径；改由 MCP 启动参数加载 unpacked extension。
- MCP 真实点击立即返回并记录 `requested`，随后观察到 `selected` 与 `opened`，应用调用链正常。Chrome for Testing 的原生 chooser 无法由 CDP `Escape` 安全取消且意外采用了系统既有选择，因此后续不再自动化该 chooser；未继续读取意外文件。
- 新增聚焦 picker 回归检查；项目 Chrome E2E 同步适配当前 Pi text content 结构和“重新分析先清除旧标记、忽略 stale 响应”的现有行为。
- `file://` 页面是 secure context，但 `showDirectoryPicker()` 可能 active 而不可见；扩展 iframe 又因非顶层上下文收到 `NotAllowedError`。目录句柄不能安全跨来源持久化，写入 `file://` IndexedDB 也会让页面脚本读到该句柄。用户选择方案 A：`file://` 使用标准 directory file input，FileList 与文件映射只保留在内容脚本内存，sessionStorage 仅保存无敏感信息的会话标记以确保重载后重新选择；standalone Viewer 继续使用扩展来源的 tab-scoped 句柄并跨重载恢复。
- CGWindow 可见窗口核验确认：点击最终 `file://` directory file input 后新增 on-screen Chrome 窗口；回归通过 FileChooser 安全注入临时目录，未再调用 `showDirectoryPicker()`，因此不会产生 `File picker already active`。

## Result

- T3: 点击“打开文件”直接调用系统 `showOpenFilePicker`，等待期间按钮不 disabled；聚焦回归证明选择后打开 Markdown，取消后保持当前内容。
- T4: requested、cancelled、selected、opened、request.failed 与 open.failed 日志均由回归检查覆盖，静态检查确认不记录路径、文件名或内容。
- T5: 项目级 .mcp.json 通过 npx 接入 chrome-devtools-mcp@1.8.0（34 个工具）；隔离 Chrome for Testing 成功加载 LinguaMark，MCP 完成扩展、页面、DOM、Console 与真实点击诊断。
- T1: 最终构建中单文件与 standalone 目录使用 File System Access API，`file://` 目录使用标准 directory input；三个入口均由用户点击直接触发且不在等待期间禁用按钮。
- T2: 完整 picker 回归验证文件选择／取消、directory FileList 受限路径树、Markdown 读取、目录取消及 standalone 授权恢复；`npm run verify` 全部通过。
- T6: 文件／目录 picker 回归和真实可见窗口检查完成；完整 verify 通过 17 个单元测试、两个 picker 浏览器脚本及 Chrome E2E，所有本次隔离进程均已清理。
- T7: `file://` 单击通过 directory input 触发系统 chooser，CGWindow 检查观察到新增 on-screen Chrome 窗口且未创建中间页；临时目录选择后文件树与 Markdown 正常，取消保持当前目录。
- T8: 回归验证 standalone 句柄按标签页跨重载恢复；`file://` 仅在内容脚本内存持有 FileList／File 映射，sessionStorage 仅保存布尔标记，重载后要求重新选择。
- T9: 最终 `file://` 路径不再调用 `showDirectoryPicker()`，故不会产生 `File picker already active`；CGWindow 证明 directory input 打开 on-screen 系统窗口，浏览器回归覆盖选择、取消与页面可用性。
- Review gate: Skipped — 用户未要求独立对抗性审查。

## Verification

- Passed: npm run verify 全部通过：TypeScript、17 个单元测试、文件／目录 picker 回归和 Chrome E2E；CGWindow 可见系统窗口、无中间页／遗留消息、git diff --check、Context／Lessons 及无残留进程检查均通过。
