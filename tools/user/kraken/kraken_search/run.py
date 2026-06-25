#!/usr/bin/env python3
"""kraken_search — semantic search in Kraken knowledge base."""
import os
import sys
import json
import urllib.request
import urllib.error
from pathlib import Path


def get_kraken_base() -> str:
    """
    按优先级获取 Kraken 服务地址:
    1. 环境变量 KRAKEN_BASE_URL（CI/CD / 服务器部署）
    2. auth.json 中的 kraken.baseUrl（本地开发，不提交仓库）
    3. 默认 http://localhost:3000
    """
    # 1. 环境变量（最高优先级，适合部署场景）
    env_url = os.environ.get("KRAKEN_BASE_URL")
    if env_url:
        return env_url

    # 2. 向上查找 auth.json（与 provider API keys 统一管理，已在 .gitignore）
    try:
        cwd = Path.cwd()
        for parent in [cwd] + list(cwd.parents):
            config_file = parent / "auth.json"
            if config_file.exists():
                with open(config_file, encoding="utf-8") as f:
                    config = json.load(f)
                kraken = config.get("kraken", {})
                if isinstance(kraken, dict) and kraken.get("baseUrl"):
                    return kraken["baseUrl"]
                break
    except Exception:
        pass

    # 3. 默认
    return "http://localhost:3000"


KRAKEN_BASE = get_kraken_base()

def main():
    try:
        raw = sys.stdin.read()
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON input: {e}")
        sys.exit(1)

    query = data.get("query", "").strip()
    limit = int(data.get("limit", 5))

    if not query:
        print("Error: query is required")
        sys.exit(1)

    payload = json.dumps({"query": query, "limit": limit}).encode("utf-8")
    req = urllib.request.Request(
        f"{KRAKEN_BASE}/knowledge/search",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"Kraken returned HTTP {e.code}: {body}")
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Failed to connect to Kraken at {KRAKEN_BASE}: {e.reason}")
        print("Make sure the Kraken service is running.")
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error: {e}")
        sys.exit(1)

    # Format results for LLM consumption
    if not result:
        print("No results found in the knowledge base.")
        return

    # Handle different response shapes
    results = result if isinstance(result, list) else result.get("results", result.get("data", [result]))
    if not isinstance(results, list):
        results = [results]

    if len(results) == 0:
        print("No matching knowledge found.")
        return

    print(f"Found {len(results)} result(s):\n")
    for i, item in enumerate(results, 1):
        if isinstance(item, str):
            print(f"--- Result {i} ---\n{item}\n")
        elif isinstance(item, dict):
            metadata = item.get("metadata", item)
            title = item.get("title") or metadata.get("title") or metadata.get("sourceUrl", f"Result {i}")
            content = item.get("content") or item.get("text") or item.get("snippet", "")
            score = item.get("score", item.get("relevance", None))
            url = item.get("url") or item.get("source_url") or metadata.get("sourceUrl", "")
            summary = metadata.get("summary", "")
            
            header = f"--- {i}. {title}"
            if score is not None:
                header += f" (score: {score:.2f})"
            header += " ---"
            print(header)
            if summary:
                print(f"Summary: {summary}")
            if url:
                print(f"Source: {url}")
            print(content)
            print()

if __name__ == "__main__":
    main()
