---
name: pr-template
version: "1.0.0"
description: 提供 Pull Request 模板和规范，确保代码审查标准化
author: team
tags: [pr, template, review, collaboration]
category: workflow
---

# PR Template Skill

## 用途

当用户创建 Pull Request 时，此 Skill 提供 PR 模板和提交规范指引。

## PR 标题规范

格式: `{type}({scope}): {description}`

类型：
- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档变更
- `refactor`: 代码重构
- `test`: 测试相关
- `chore`: 构建/工具链

## PR 描述模板

```markdown
## 变更摘要
简要描述做了什么

## 动机
为什么需要这个变更

## 测试
- [ ] 单元测试通过
- [ ] 集成测试通过
```

