---
name: edit_file
description: Replace the FIRST occurrence of oldString with newString in a file. The oldString must appear exactly once for the replacement to succeed.
version: 1.0.0
author: builtin
tags: [file, edit, write]
category: file
permission: write
sensitivity: medium
sideEffect: write
safeToRetry: false
defaultEnabled: true
execution:
  type: internal
  impl: edit_file
parameters:
  filePath:
    type: string
    description: Absolute or workspace-relative path to the file
    required: true
  oldString:
    type: string
    description: The exact text to replace (must match precisely, including whitespace)
    required: true
  newString:
    type: string
    description: The replacement text
    required: true
---
Performs precise string replacement in a file. Only replaces the first occurrence.
