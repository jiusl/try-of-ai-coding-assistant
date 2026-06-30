---
name: recall
description: Recall relevant memories from past conversations. Use when the information needed cannot be obtained from the current session context.
version: 1.0.0
author: builtin
tags: [memory, search, history]
category: search
permission: read
sensitivity: low
sideEffect: read
safeToRetry: true
defaultEnabled: true
execution:
  type: script
  entry: main.py
parameters:
  query:
    type: string
    description: Natural language search query describing what you want to recall
    required: true
---
Searches long-term memory for relevant past conversation context.
