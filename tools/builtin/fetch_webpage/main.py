"""
fetch_webpage 工具 — 获取网页并提取正文文本。
从 stdin 读取 JSON: {"url": "..."}
"""
import json
import sys
import re
import urllib.request
import urllib.error


def extract_text(html: str) -> str:
    """从 HTML 中提取纯文本内容。"""
    cleaned = html
    # 移除 script / style / head / nav / footer / header 标签
    for tag in ("script", "style", "head", "nav", "footer", "header"):
        cleaned = re.sub(rf"<{tag}[^>]*>[\s\S]*?</{tag}>", "", cleaned, flags=re.IGNORECASE)

    # 提取 title
    title_match = re.search(r"<title[^>]*>([\s\S]*?)</title>", cleaned, re.IGNORECASE)
    title = title_match.group(1).strip() if title_match else ""

    # 标签 → 换行
    text = cleaned
    for tag in ("br", "p", "h1", "h2", "h3", "h4", "h5", "h6", "li"):
        text = re.sub(rf"<{tag}\s*/?>", "\n", text, flags=re.IGNORECASE)
        text = re.sub(rf"</{tag}>", "\n", text, flags=re.IGNORECASE)

    # 移除所有 HTML 标签
    text = re.sub(r"<[^>]+>", "", text)

    # HTML 实体解码
    entities = {
        "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
        "&#39;": "'", "&nbsp;": " ", "&apos;": "'",
    }
    for entity, char in entities.items():
        text = text.replace(entity, char)

    # 清理多余空行
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)

    # 前置标题
    parts = []
    if title:
        parts.append(f"Title: {title}")
    parts.append(text.strip())

    return "\n\n".join(parts)


def main():
    try:
        raw = sys.stdin.read()
        args = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"参数解析失败: {e}", file=sys.stderr)
        sys.exit(1)

    url = args.get("url", "")

    if not url:
        print("错误: url 不能为空")
        sys.exit(1)

    # 确保 URL 有 scheme
    if not re.match(r"^https?://", url, re.IGNORECASE):
        url = "https://" + url

    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (compatible; OpenCodeBot/1.0)"}
        )
        with urllib.request.urlopen(req, timeout=15) as response:
            content_type = response.headers.get("Content-Type", "")
            if "text/html" not in content_type and "text/plain" not in content_type:
                print(f"不支持的内容类型: {content_type}")
                sys.exit(1)

            encoding = response.headers.get_content_charset() or "utf-8"
            html = response.read().decode(encoding, errors="replace")

    except urllib.error.HTTPError as e:
        print(f"HTTP 错误: {e.code} {e.reason}")
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"网络错误: {e.reason}")
        sys.exit(1)
    except Exception as e:
        print(f"请求失败: {type(e).__name__}: {e}")
        sys.exit(1)

    text = extract_text(html)
    print(text)


if __name__ == "__main__":
    main()
