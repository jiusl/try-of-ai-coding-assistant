---
name: run_command
description: Execute a shell command that may modify the system (write/delete files, install packages, etc.). Requires user confirmation before execution.
version: 1.0.0
author: builtin
tags: [command, shell, write]
category: command
permission: execute
sensitivity: high
sideEffect: write
safeToRetry: false
defaultEnabled: true
execution:
  type: internal
  impl: run_command
  requireConfirm: true
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
Executes a shell command that modifies the system. Requires user confirmation.
