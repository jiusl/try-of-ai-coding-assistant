---
name: file_exists
description: Check whether a file or directory exists at the given path. Returns existence and file type (file vs directory).
version: 1.0.0
author: builtin
tags: [file, check]
category: file
permission: read
sensitivity: low
sideEffect: read
safeToRetry: true
defaultEnabled: true
execution:
  type: internal
  impl: file_exists
parameters:
  path:
    type: string
    description: Absolute or workspace-relative path to check
    required: true
---
Checks if a file or directory exists. Returns { exists, isFile, isDirectory }.
