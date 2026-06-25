---
name: fetch_webpage
description: Fetch and extract the main text content from a web page given its URL. Use to read documentation, API references, tutorials, or any publicly accessible web content.
version: 1.0.0
author: builtin
tags: [web, fetch, http]
category: search
permission: read
sensitivity: medium
sideEffect: read
safeToRetry: true
defaultEnabled: true
execution:
  type: internal
  impl: fetch_webpage
parameters:
  url:
    type: string
    description: Full URL to fetch (http:// or https://)
    required: true
---
Fetches a webpage and extracts its main text content using HTML-to-text extraction.
