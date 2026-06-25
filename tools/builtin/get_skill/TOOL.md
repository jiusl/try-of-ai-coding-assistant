---
name: get_skill
description: Get the full documentation for a specific skill by name. Use after list_skills to load a skill's complete guide.
version: 1.0.0
author: builtin
tags: [skill, documentation]
category: search
permission: read
sensitivity: low
sideEffect: read
safeToRetry: true
defaultEnabled: true
execution:
  type: internal
  impl: get_skill
parameters:
  name:
    type: string
    description: The exact name of the skill to load
    required: true
---
Loads and returns the full SKILL.md content for a specific skill.
