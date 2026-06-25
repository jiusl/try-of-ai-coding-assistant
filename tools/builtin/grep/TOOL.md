---
name: grep
description: Search for a regex pattern in file contents. Combines file-finding and content-searching.
version: 1.0.0
author: builtin
tags: [search, grep, regex]
category: search
permission: read
sensitivity: low
sideEffect: read
safeToRetry: true
defaultEnabled: true
execution:
  type: internal
  impl: grep
parameters:
  pattern:
    type: string
    description: A regex pattern to search for (e.g. 'function|class', 'TODO|FIXME')
    required: true
  path:
    type: string
    description: Directory (absolute path) or glob pattern relative to workspace
    required: false
  recursive:
    type: boolean
    description: Search subdirectories (default: false)
    required: false
  ignoreCase:
    type: boolean
    description: Case-insensitive search (default: false)
    required: false
---
Searches file contents with regex, returning file path, line number, and matching line.
