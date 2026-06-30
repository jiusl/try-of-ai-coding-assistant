---
name: read_command
description: Execute a read-only shell command that does NOT modify the system. Use for queries like: ls, cat, pwd, git status, git log, git diff.
version: 1.0.0
author: builtin
tags: [command, shell, read]
category: command
permission: read
sensitivity: medium
sideEffect: read
safeToRetry: true
defaultEnabled: true
execution:
  type: script
  entry: main.py
parameters:
  command:
    type: string
    description: The shell command to execute
    required: true
  timeout:
    type: integer
    description: Maximum execution time in milliseconds (default: 30000)
    required: false
  cwd:
    type: string
    description: Working directory for the command (default: workspace root)
    required: false
---
Executes a read-only shell command. Does not require user confirmation.
