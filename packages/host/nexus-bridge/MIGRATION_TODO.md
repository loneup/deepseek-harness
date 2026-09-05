# Nexus Bridge 迁移待办事项

## 状态
🚧 **暂时禁用 - 需要完整迁移到新 API**

## 问题
上游 dsh 0.1.3-alpha.1 删除了以下依赖：
- `@deepseek-ai/dsh-host-apiproxy`
- `@deepseek-ai/dsh-client-runtime`

需要迁移到新的 Typert Remote Controller 架构：
- `ctx.sessionController` (SessionController)
- `ctx.workspaceController` (WorkspaceController)
- `ctx.settingsController` (SettingsController)

## 影响
- 类型错误：11 个
- 主要文件：`src/command.ts`, `src/index.ts`
- 依赖方：`packages/bundle/web-app`

## 迁移计划
1. 替换 `apiProxy` → `SessionController`
2. 更新 Session 事件 API (`.events` → 新 API)
3. 更新 Subagent API (使用 SessionAddress)
4. 测试完整流程

## 临时方案
当前使用 stub 导出让编译通过。功能已禁用。

## 时间估计
完整迁移：4-6 小时

## 优先级
P2 - 不阻塞主线，但需要尽快修复
