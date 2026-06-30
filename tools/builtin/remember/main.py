"""
remember 工具 — 将重要信息保存到长期记忆（SQLite）。
从 stdin 读取 JSON: {"content": "...", "category": "可选", "importance": 可选}
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


def ensure_tables(conn: sqlite3.Connection):
    """确保所需表存在。"""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS memories (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            category TEXT DEFAULT 'general',
            importance REAL DEFAULT 0.5,
            source_session_id TEXT,
            access_count INTEGER DEFAULT 0,
            last_accessed_at INTEGER,
            embedding BLOB,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
    """)
    conn.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
            content,
            content_rowid='rowid',
            tokenize='unicode61'
        )
    """)


def check_duplicate(conn: sqlite3.Connection, content: str, threshold: float = 0.9) -> str | None:
    """检查是否存在高度重复的记忆，返回已有 ID 或 None。"""
    # 简单去重：完全相同的内容
    row = conn.execute(
        "SELECT id FROM memories WHERE content = ? LIMIT 1",
        (content,)
    ).fetchone()
    if row:
        return row[0]
    return None


def save_memory(
    db_path: str,
    content: str,
    category: str = "general",
    importance: float = 0.5,
) -> dict:
    """保存记忆条目，返回保存的条目信息。"""
    conn = sqlite3.connect(db_path)

    try:
        ensure_tables(conn)

        # 去重检查
        existing_id = check_duplicate(conn, content)
        if existing_id:
            # 更新重要度（取更高值）和访问时间
            conn.execute(
                """UPDATE memories
                   SET importance = MAX(importance, ?),
                       updated_at = ?,
                       access_count = access_count + 1,
                       last_accessed_at = ?
                   WHERE id = ?""",
                (importance, int(datetime.now(timezone.utc).timestamp() * 1000),
                 int(datetime.now(timezone.utc).timestamp() * 1000), existing_id)
            )
            conn.commit()
            row = conn.execute("SELECT * FROM memories WHERE id = ?", (existing_id,)).fetchone()
            return {
                "id": row[0], "content": row[1], "category": row[2],
                "importance": row[3], "duplicate": True,
            }

        entry_id = str(uuid.uuid4())
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

        conn.execute(
            """INSERT INTO memories (id, content, category, importance,
               access_count, last_accessed_at, created_at, updated_at)
               VALUES (?, ?, ?, ?, 0, NULL, ?, ?)""",
            (entry_id, content, category, importance, now_ms, now_ms)
        )

        # 同步到 FTS5 索引
        conn.execute(
            "INSERT INTO memories_fts(rowid, content) VALUES (?, ?)",
            (conn.execute("SELECT last_insert_rowid()").fetchone()[0], content)
        )

        conn.commit()

        return {
            "id": entry_id, "content": content, "category": category,
            "importance": importance, "duplicate": False,
        }
    finally:
        conn.close()


VALID_CATEGORIES = {"preference", "fact", "context", "general"}


def main():
    try:
        raw = sys.stdin.read()
        args = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"参数解析失败: {e}", file=sys.stderr)
        sys.exit(1)

    content = args.get("content", "")
    category = args.get("category", "general")
    importance = args.get("importance", 0.5)

    if not content:
        print("错误: content 不能为空")
        sys.exit(1)

    if category not in VALID_CATEGORIES:
        category = "general"

    if not isinstance(importance, (int, float)) or importance < 0 or importance > 1:
        importance = 0.5

    workspace = find_workspace_root()
    db_path = os.path.join(workspace, "try.db")

    try:
        result = save_memory(db_path, content, category, importance)
    except Exception as e:
        print(f"保存记忆失败: {type(e).__name__}: {e}")
        sys.exit(1)

    cat = result["category"]
    imp = result["importance"]
    star = " ⭐ high importance" if imp >= 0.8 else ""

    if result.get("duplicate"):
        print(f"Memory already exists (updated): [{cat}]{star} \"{result['content']}\"")
    else:
        print(f"Memory saved: [{cat}]{star} \"{result['content']}\"")


if __name__ == "__main__":
    main()
