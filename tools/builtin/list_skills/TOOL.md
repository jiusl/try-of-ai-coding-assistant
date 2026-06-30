---
name: list_skills
description: List all available skills (domain-specific guides/instructions). Use this to discover what expertise guides are available before deciding which to load.
version: 1.0.0
author: builtin
tags: [skill, discover]
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
  tag:
    type: string
    description: Filter by tag
    required: false
  category:
    type: string
    description: Filter by category
    required: false
---
Lists available skills with name, description, tags, and category.
