# 为路径树增加上下文菜单

Status: Completed (2026-09-01 16:08)
Kind: Task

## Scope

- 包含：路径树文件和文件夹的右键菜单、名称与相对路径复制、文件收藏切换及文件夹子树控制。
- 不包含：Finder 原生定位、系统绝对路径或原生伴随程序。

## Target
- [x] T1: 右键路径树中的任一文件或文件夹项目时，会显示适用于该项目的上下文菜单。
- [x] T3: 右键打开上下文菜单后，菜单保持可交互，直到用户选择操作、点击菜单外部或按 Escape 主动关闭。
- [x] T4: 路径树右键菜单不再显示或触发 “Open in File Picker”。
- [x] T5: 文件和文件夹菜单提供 “Copy Relative Path” 与 “Copy Name”，分别复制相对于授权根目录的路径和项目名称。
- [x] T6: 文件菜单根据收藏状态提供 “Add to Favorites” 或 “Remove from Favorites”，并持久化对应变更。
- [x] T7: 文件夹菜单提供 “Expand Subtree” 与 “Collapse Subtree”，并递归展开或折叠该文件夹下的目录。
- [x] T8: 通过导航栏收藏按钮或文件右键菜单切换收藏后，两个入口显示并执行同一收藏状态。

## Plan

1. 将当前文件的绝对路径与目录树根相对路径视为同一收藏身份。
2. 导航栏、右键菜单和收藏列表统一读取该身份，并在目录树异步恢复后重新计算状态。
3. 验证两个入口的收藏与取消收藏、旧重复记录降级、类型和构建结果。

## Result

- T4: 源码与构建产物均不再包含 Open in File Picker 菜单项或其菜单触发路径；7/7 源码检查通过。
- T5: Chrome 冒烟从 docs/readme.md 文件项验证 Copy Relative Path 写入 docs/readme.md，Copy Name 写入 readme.md；文件夹菜单同样包含两个操作。
- T7: Chrome 冒烟对两层 details 子树验证 Expand Subtree 后全部展开，Collapse Subtree 后全部折叠。
- T1: 最新构建的 Chrome 冒烟确认当前目录文件右键可打开文件菜单并执行收藏操作。
- T3: Chrome 双向收藏冒烟多次通过真实右键打开菜单并点击操作，菜单在右键释放后保持可交互；manual Popover 关闭逻辑未回归。
- T6: Chrome 冒烟确认右键菜单按共享身份显示 Add/Remove from Favorites，收藏与取消收藏均写入同一 markdownViewerFavorites 结果并更新导航栏。
- T8: Chrome 冒烟覆盖导航栏收藏→菜单显示移除、菜单移除→导航栏未收藏、菜单收藏→导航栏已收藏、导航栏移除→菜单显示添加；绝对路径与根相对路径旧别名仅展示一次且取消时全部移除，目录树后恢复会重新同步，树外当前项不误匹配。
- Review gate: Skipped — 用户未要求独立对抗审查；已复查路径别名、异步恢复顺序、旧重复记录、树外降级和双向切换。

## Verification

- Passed: npm run check、npm run build、7/7 收藏同步源码检查、Chrome 双向切换／旧别名／异步恢复／树外降级冒烟、行尾空白检查、git diff --check、Context validate 与 Lesson Check 均通过；按项目规则未运行测试套件。
