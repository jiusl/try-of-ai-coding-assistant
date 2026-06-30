"""
think 工具 — 记录思考内容，无副作用。
从 stdin 读取 JSON: {"thought": "...", "plan": [...]}
"""
import json
import sys


def main():
    try:
        raw = sys.stdin.read()
        args = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"参数解析失败: {e}", file=sys.stderr)
        sys.exit(1)

    thought = args.get("thought", "")

    plan = args.get("plan")
    if plan and isinstance(plan, list):
        plan_text = "\n".join(f"  {i+1}. {step}" for i, step in enumerate(plan))
        print(f"[Thought recorded]\n{thought}\n\nPlan:\n{plan_text}")
    else:
        print(f"[Thought recorded] {thought}")


if __name__ == "__main__":
    main()
