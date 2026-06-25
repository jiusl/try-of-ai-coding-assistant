#!/usr/bin/env python3
"""kraken_ingest — ingest web content into Kraken knowledge base via smart routing."""
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

    urls = data.get("urls", data.get("url", []))
    query = data.get("query", "").strip()

    # Normalize: accept single URL string or array
    if isinstance(urls, str):
        urls = [urls]
    if not urls or not isinstance(urls, list):
        print("Error: urls is required and must be a non-empty array of URLs")
        sys.exit(1)

    payload = {"urls": urls}
    if query:
        payload["query"] = query

    req_body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{KRAKEN_BASE}/knowledge/smart",
        data=req_body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    print(f"Ingesting {len(urls)} URL(s) via Kraken smart routing...")
    if query:
        print(f"Context query: {query}")
    print(f"URLs: {', '.join(urls[:5])}" + ("..." if len(urls) > 5 else ""))
    print()

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
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

    # Format the response
    print("Ingestion complete.\n")

    if isinstance(result, dict):
        # Show summary
        summary_keys = ["processed", "ingested", "count", "total", "status", "message"]
        for key in summary_keys:
            if key in result:
                print(f"{key}: {result[key]}")

        # Show per-URL results if available
        if "results" in result:
            print("\nPer-URL results:")
            for r in result["results"]:
                if isinstance(r, dict):
                    url = r.get("url", r.get("source", "?"))
                    status = r.get("status", r.get("result", "?"))
                    chunks = r.get("chunks", r.get("chunk_count", ""))
                    extra = f" ({chunks} chunks)" if chunks else ""
                    print(f"  {url}: {status}{extra}")
                else:
                    print(f"  {r}")
    elif isinstance(result, list):
        print(f"Returned {len(result)} items:")
        for item in result:
            print(f"  {json.dumps(item, ensure_ascii=False)[:200]}")
    elif isinstance(result, str):
        print(result)

    print("\nUse kraken_search to query the ingested knowledge.")

if __name__ == "__main__":
    main()
