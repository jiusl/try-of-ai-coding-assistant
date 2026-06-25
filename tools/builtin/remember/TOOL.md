---
name: remember
description: Save an important fact or insight to long-term memory so it can be recalled in future conversations. Be selective — only save genuinely important, reusable information.
version: 1.0.0
author: builtin
tags: [memory, save, persistent]
category: reasoning
permission: read
sensitivity: low
sideEffect: write
safeToRetry: true
defaultEnabled: true
execution:
  type: internal
  impl: remember
parameters:
  content:
    type: string
    description: The memory content to save
    required: true
  category:
    type: string
    description: One of preference, fact, context, general (default: general)
    required: false
    enum: [preference, fact, context, general]
  importance:
    type: number
    description: A number between 0.0 (trivial) and 1.0 (critical), default 0.5
    required: false
---
Saves a fact to long-term memory with auto-deduplication.
