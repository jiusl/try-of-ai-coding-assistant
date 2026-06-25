---
name: hello_world
description: A simple hello world tool that echoes back a greeting with the given name
version: 1.0.0
author: user
tags: [demo, greeting]
category: command
permission: read
sensitivity: low
sideEffect: read
safeToRetry: true
defaultEnabled: true
execution:
  entry: run.sh
  timeout: 10000
  requireConfirm: false
parameters:
  name:
    type: string
    description: The name to greet
    required: true
  language:
    type: string
    description: Language for the greeting (en, zh, ja, es)
    required: false
    default: en
    enum: [en, zh, ja, es]
---

This is a demo user-defined tool.
It greets the user in the specified language.
