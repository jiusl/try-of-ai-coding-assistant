"""
recall 工具 — 从长期记忆（SQLite FTS5）中检索相关记忆。
从 stdin 读取 JSON: {"query": "..."}
"""
import json
import os
import sys
import sqlite3
import uuid
from datetime import datetime, timezone


def find_workspace_root() -> str:
    """从当前脚本位置向上查找 try.db 所在的工作区根目录。"""
    current = os.path.dirname(os.path.abspath(__file__))
    for _ in range(6):
        db_path = os.path.join(current, "try.db")
        if os.path.isfile(db_path):
            return current
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return os.getcwd()


def search_memories(db_path: str, query: str, limit: int = 10) -> list[dict]:
    """使用 FTS5 全文搜索 + 重要度排序。"""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    try:
        # FTS5 搜索：对查询做简单分词
        fts_query = " OR ".join(f'"{w}"' for w in query.split() if len(w) > 1)

        rows = conn.execute(
            """
            SELECT m.id, m.content, m.category, m.importance,
                   m.source_session_id, m.access_count,
                   m.last_accessed_at, m.created_at, m.updated_at
            FROM memories m
            INNER JOIN memories_fts fts ON m.rowid = fts.rowid
            WHERE memories_fts MATCH ?
            ORDER BY rank
            LIMIT ?
            """,
            (fts_query, limit)
        ).fetchall()

        if not rows:
            # 降级：按重要度 + 最近访问时间排序
            rows = conn.execute(
                """
                SELECT id, content, category, importance,
                       source_session_id, access_count,
                       last_accessed_at, created_at, updated_at
                FROM memories
                ORDER BY importance DESC, last_accessed_at DESC
                LIMIT ?
                """,
                (limit,)
            ).fetchall()

        results = []
        for row in rows:
            row_dict = dict(row)
            # 更新访问计数
            conn.execute(
                "UPDATE memories SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?",
                (int(datetime.now(timezone.utc).timestamp() * 1000), row_dict["id"])
            )
            results.append({
                "id": row_dict["id"],
                "content": row_dict["content"],
                "category": row_dict["category"],
                "importance": row_dict["importance"],
                "score": round(row_dict["importance"] * 0.8 + 0.2, 2),
                "sourceSessionId": row_dict.get("source_session_id"),
            })

        conn.commit()
        return results
    finally:
        conn.close()


def main():
    try:
        raw = sys.stdin.read()
        args = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"参数解析失败: {e}", file=sys.stderr)
        sys.exit(1)

    query = args.get("query", "")

    if not query:
        print("错误: query 不能为空")
        sys.exit(1)

    workspace = find_workspace_root()
    db_path = os.path.join(workspace, "try.db")

    if not os.path.isfile(db_path):
        print("No memory database found. No past memories available yet.")
        return

    try:
        memories = search_memories(db_path, query, 10)
    except Exception as e:
        print(f"搜索记忆失败: {type(e).__name__}: {e}")
        sys.exit(1)

    if not memories:
        print("No relevant memories found from past conversations.")
        return

    lines = [f"Recalled {len(memories)} memor{'y' if len(memories) == 1 else 'ies'}:", ""]
    for m in memories:
        sid = ""
        if m.get("sourceSessionId"):
            sid = f"  (from session: {m['sourceSessionId'][:8]}...)"
        lines.append(f"- [{m['category']}] (score: {m['score']:.2f}) {m['content']}{sid}")

    lines.append("")
    lines.append("Use this context to answer the user's question.")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
