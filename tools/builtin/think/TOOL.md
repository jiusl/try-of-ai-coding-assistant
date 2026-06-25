---
name: think
description: Use this tool to think through a problem or plan a sequence of actions. This tool doesn't perform any actions, it's just for reasoning.
version: 1.0.0
author: builtin
tags: [reasoning, planning]
category: reasoning
permission: read
sensitivity: low
sideEffect: read
safeToRetry: true
defaultEnabled: true
execution:
  type: internal
  impl: think
parameters:
  thought:
    type: string
    description: Your internal reasoning
    required: true
  plan:
    type: array
    description: List of planned steps
    required: false
    items:
      type: string
---
Records a thought for reasoning purposes. No side effects.
