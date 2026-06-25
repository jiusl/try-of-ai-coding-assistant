---
name: kraken_search
description: >
  Semantic search across previously ingested knowledge in Kraken.
  Use this tool when the user asks questions about content that was
  previously processed and stored (e.g., "what do we know about X",
  "search my knowledge base for Y", "find documents about Z").
  Returns ranked results with content snippets and relevance scores.
version: 1.0.0
author: user
tags: [kraken, search, knowledge, rag]
category: search
permission: read
sensitivity: low
sideEffect: read
safeToRetry: true
defaultEnabled: true
execution:
  entry: run.py
  timeout: 30000
  requireConfirm: false
parameters:
  query:
    type: string
    description: Natural language search query (e.g., "What is the architecture of Project X?")
    required: true
  limit:
    type: integer
    description: Maximum number of results to return (default: 5)
    required: false
    default: 5
---

Searches the Kraken knowledge base using semantic search. The knowledge must have been previously ingested via `kraken_ingest`.
The Kraken service address is read from `auth.json` (`kraken.baseUrl`) or the `KRAKEN_BASE_URL` env var, defaulting to http://localhost:3000.
