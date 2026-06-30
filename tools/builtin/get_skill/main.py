"""
get_skill 工具 — 获取指定 Skill 的完整文档。
从 stdin 读取 JSON: {"name": "skill-name"}
"""
import json
import os
import sys
import re


SKILLS_DIRS = ["builtin", "user", "remote"]


def find_skills_base() -> str:
    """从当前脚本位置向上查找 skills/ 目录。"""
    current = os.path.dirname(os.path.abspath(__file__))
    for _ in range(5):
        candidate = os.path.join(current, "skills")
        if os.path.isdir(candidate):
            return current
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return os.getcwd()


def find_skill_md(workspace: str, skill_name: str) -> str | None:
    """在 skills/ 目录中查找指定名称的 SKILL.md 文件。
    先精确匹配目录名 → 再扫描 frontmatter name → 最后模糊匹配。"""
    # 1. 精确匹配目录名
    for src in SKILLS_DIRS:
        candidate = os.path.join(workspace, "skills", src, skill_name, "SKILL.md")
        if os.path.isfile(candidate):
            return candidate

    # 2. 扫描所有 SKILL.md，匹配 frontmatter 中的 name
    for src in SKILLS_DIRS:
        src_dir = os.path.join(workspace, "skills", src)
        if not os.path.isdir(src_dir):
            continue
        for dir_name in os.listdir(src_dir):
            skill_dir = os.path.join(src_dir, dir_name)
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
            if fm.get("name") == skill_name:
                return md_path

    # 3. 模糊匹配（大小写不敏感）
    skill_lower = skill_name.lower()
    for src in SKILLS_DIRS:
        src_dir = os.path.join(workspace, "skills", src)
        if not os.path.isdir(src_dir):
            continue
        for dir_name in os.listdir(src_dir):
            if dir_name.lower() == skill_lower:
                md_path = os.path.join(src_dir, dir_name, "SKILL.md")
                if os.path.isfile(md_path):
                    return md_path

    return None


def parse_frontmatter(content: str) -> dict:
    """简易 YAML frontmatter 解析。"""
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
            if key == "tags" and val.startswith("[") and val.endswith("]"):
                val = val[1:-1].strip()
            fm[key] = val
    return fm


def main():
    try:
        raw = sys.stdin.read()
        args = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"参数解析失败: {e}", file=sys.stderr)
        sys.exit(1)

    skill_name = args.get("name", "")

    if not skill_name:
        print("错误: name 不能为空")
        sys.exit(1)

    workspace = find_skills_base()
    filepath = find_skill_md(workspace, skill_name)

    if not filepath:
        print(f"Skill \"{skill_name}\" not found. Use list_skills to see available skills.")
        sys.exit(1)

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception as e:
        print(f"读取 Skill 文件失败: {filepath}\n{type(e).__name__}: {e}")
        sys.exit(1)

    fm = parse_frontmatter(content)

    # 移除 frontmatter 后的正文
    body_match = re.match(r"^---\s*\n.*?\n---\s*\n(.*)", content, re.DOTALL)
    body = body_match.group(1).strip() if body_match else content

    name = fm.get("name", skill_name)
    version = fm.get("version", "1.0.0")
    category = fm.get("category", "general")
    tags = fm.get("tags", "")

    print(f"# Skill: {name} (v{version})")
    print(f"Category: {category}")
    print(f"Tags: {tags}")
    print(f"Description: {fm.get('description', '')}")
    print()
    print(body)


if __name__ == "__main__":
    main()
