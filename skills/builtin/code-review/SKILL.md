---
name: code-review
version: 1.0.0
description: 代码审查规范，检查代码质量、安全性和最佳实践
author: opencode
tags: [review, quality, security]
category: code-quality

# 纯文档型 Skill 无需 execution 字段
# 混合型 Skill 需要以下字段：
# execution:
#   type: script
#   entry: ./review.py  # 或 ./workflow.ts, ./script.sh
#   interpreter: python3  # 可选，默认根据扩展名推断
#   timeout: 60000
#   requireConfirm: false
---

# Code Review Skill

## 适用场景
当用户请求代码审查、PR 检查、代码质量评估时使用。

## 审查要点

### 1. 代码质量
- 命名是否清晰、符合规范
- 函数是否过长（超过 50 行建议拆分）
- 是否有重复代码

### 2. 安全性
- 是否有 SQL 注入风险
- 是否有硬编码的密钥/密码
- 输入验证是否充分

### 3. 最佳实践
- 错误处理是否完善
- 日志记录是否合理
- 是否遵循项目约定

## 使用示例
用户说："帮我 review 这个文件 src/user.ts"

## 输出格式
按以下格式输出审查结果：

## 📋 审查报告

### ✅ 优点
- ...

### ⚠️ 问题
| 行号 | 严重程度 | 问题描述 | 建议 |
|------|----------|----------|------|
| 15 | 中 | ... | ... |

### 💡 建议
- ...
