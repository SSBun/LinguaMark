# Lessons

## L-20260902-verify-native-picker-visible-state — 验证原生选择器的可见交互

### Trigger
- 修改或诊断由浏览器 API 拉起的系统文件或目录选择器，尤其涉及加载状态或启动延迟。

### Rule
- 不得仅凭 API 调用或 browser filechooser 事件就认定系统选择器及时出现；必须分别核验 JavaScript 请求、browser filechooser 与系统原生面板边界。
- 不得使用 CDP／MCP 键盘事件取消原生 chooser；应通过受控拦截，或由 watchdog 关闭隔离浏览器。

### Check
- 在隔离 Chrome 中记录 requested 到原生面板进程出现的时间，核验按钮状态，并使用临时文件覆盖选择／取消；无法观察系统面板时明确披露。

## L-20260901-sync-restored-ui-state — 异步恢复视图后同步当前状态

### Trigger
- 为异步加载或恢复的列表增加依赖“当前项”的控制状态或定位操作。

### Rule
- 除了在用户操作处理器中更新当前项，还必须在列表恢复完成后，根据当前状态重新计算选中项和控制可用性。

### Check
- 验证“当前项先存在、列表后恢复”的路径，并覆盖当前项不在列表中的降级行为。
