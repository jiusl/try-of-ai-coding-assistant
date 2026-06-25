---
name: kraken_ingest
description: >
  Ingest web content into the Kraken knowledge base via smart routing.
  Kraken will automatically decide whether to crawl→chunk→summarize→store
  (process flow) or perform autonomous web search (supplement flow).
  Use this tool when the user wants to add URLs to their knowledge base,
  or when you need to fetch external information to answer a question.
  The ingested content will be searchable via kraken_search afterwards.
version: 1.0.0
author: user
tags: [kraken, ingest, knowledge, crawl]
category: search
permission: read
sensitivity: medium
sideEffect: write
safeToRetry: false
defaultEnabled: true
execution:
  entry: run.py
  timeout: 120000
  requireConfirm: true
parameters:
  urls:
    type: array
    description: List of URLs to ingest (e.g., ["https://example.com/doc1", "https://example.com/doc2"])
    required: true
    items:
      type: string
  query:
    type: string
    description: Optional context query to guide processing (e.g., "Extract key technical details")
    required: false
---

Ingests web content into Kraken via POST /knowledge/smart (auto-routing).
The smart endpoint decides between direct crawling (process) and autonomous search (supplement).
Use `kraken_search` afterwards to query ingested knowledge.
The Kraken service address is read from `auth.json` (`kraken.baseUrl`) or the `KRAKEN_BASE_URL` env var, defaulting to http://localhost:3000.
