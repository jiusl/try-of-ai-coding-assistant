"""
list_skills 工具 — 列出所有可用的 Skill（轻量元数据）。
从 stdin 读取 JSON: {"tag": "可选", "category": "可选"}
"""
import json
import os
import sys
import re


SKILLS_DIRS = ["builtin", "user", "remote"]


def parse_frontmatter(content: str) -> dict:
    """简易 YAML frontmatter 解析：提取 name/description/version/category/tags。"""
    m = re.match(r"^---\s*\n(.*?)\n---", content, re.DOTALL)
    if not m:
        return {}
    fm = {}
    for line in m.group(1).split("\n"):
        line = line.strip()
        if ":" in line:
            key, _, val = line.partition(":")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            # 处理 tags: [...] 列表
            if key == "tags" and val.startswith("[") and val.endswith("]"):
                val = val[1:-1].strip()
            fm[key] = val
    return fm


def scan_skills(skills_base: str, source: str) -> list[dict]:
    """扫描指定 source 目录下的所有 SKILL.md 文件。"""
    results = []
    source_dir = os.path.join(skills_base, "skills", source)
    if not os.path.isdir(source_dir):
        return results

    for name in os.listdir(source_dir):
        skill_dir = os.path.join(source_dir, name)
        if not os.path.isdir(skill_dir):
            continue
        md_path = os.path.join(skill_dir, "SKILL.md")
        if not os.path.isfile(md_path):
            continue

        try:
            with open(md_path, "r", encoding="utf-8") as f:
                content = f.read()
        except Exception:
            continue

        fm = parse_frontmatter(content)
        tags_str = fm.get("tags", "")
        results.append({
            "name": fm.get("name", name),
            "description": fm.get("description", ""),
            "version": fm.get("version", "1.0.0"),
            "category": fm.get("category", "general"),
            "tags": [t.strip() for t in tags_str.split(",") if t.strip()] if tags_str else [],
            "source": source,
        })
    return results


def find_skills_base() -> str:
    """从当前脚本位置向上查找 skills/ 目录。"""
    current = os.path.dirname(os.path.abspath(__file__))
    # tools/builtin/list_skills/main.py → 向上 4 级
    for _ in range(5):
        candidate = os.path.join(current, "skills")
        if os.path.isdir(candidate):
            return current  # workspace root
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return os.getcwd()


def main():
    try:
        raw = sys.stdin.read()
        args = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"参数解析失败: {e}", file=sys.stderr)
        sys.exit(1)

    tag_filter = args.get("tag")
    category_filter = args.get("category")

    workspace = find_skills_base()

    all_skills = []
    for src in SKILLS_DIRS:
        skills = scan_skills(workspace, src)
        all_skills.extend(skills)

    # 过滤
    if tag_filter:
        all_skills = [s for s in all_skills if tag_filter in s["tags"]]
    if category_filter:
        all_skills = [s for s in all_skills if s["category"] == category_filter]

    if not all_skills:
        print("No skills found.")
        return

    lines = [f"Available skills ({len(all_skills)}):", ""]
    for s in all_skills:
        tags_str = ", ".join(s["tags"])
        lines.append(f"- **{s['name']}** (v{s['version']}) [{s['category']}] — {s['description']}")
        lines.append(f"  tags: {tags_str}")
        lines.append("")

    print("\n".join(lines))


if __name__ == "__main__":
    main()
