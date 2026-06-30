"""
强制 stdin/stdout/stderr 使用 UTF-8 编码，解决 Windows 中文路径在 cp936 下的乱码问题。

用法：在 main.py 最顶部（json/sys 导入之后、其他导入之前）执行:
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "_shared"))
    import encoding  # noqa: F401 — 副作用导入，立即生效

注意：
- 需要 Python 3.7+ 才支持 reconfigure()
- 对于 Python 3.5/3.6，reconfigure 不可用，但 Bun.spawn 传入的
  PYTHONIOENCODING=utf-8 环境变量已覆盖此场景
"""
import sys


def _force_utf8() -> None:
    """将所有标准流的文本编码强制为 UTF-8"""
    for stream_name, stream in (
        ("stdin", sys.stdin),
        ("stdout", sys.stdout),
        ("stderr", sys.stderr),
    ):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8")
            except Exception:
                # 某些环境（如被重定向）可能失败，静默忽略
                pass


_force_utf8()
