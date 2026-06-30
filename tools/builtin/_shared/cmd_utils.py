"""
共享命令执行工具 — 供 run_command / read_command 的 main.py 导入使用。
处理 Windows cmd.exe .bat 文件方案、venv 激活、输出清理。
"""
import os
import sys
import tempfile
import subprocess
from typing import Tuple


def get_shell() -> str:
    """检测当前平台的 shell：Windows → cmd.exe, 其他 → /bin/bash"""
    if sys.platform == "win32":
        # 检查是否有 Git Bash
        git_bash_paths = [
            r"C:\Program Files\Git\bin\bash.exe",
            r"C:\Program Files (x86)\Git\bin\bash.exe",
            r"C:\Git\bin\bash.exe",
        ]
        for p in git_bash_paths:
            if os.path.exists(p):
                return p
        return "cmd"  # 兜底 cmd.exe
    return "/bin/bash"


def wrap_with_venv(command: str, cwd: str) -> str:
    """如果 cwd 下存在 .venv，将命令包裹为「先激活再执行」"""
    venv_path = os.path.join(cwd, ".venv")
    if not os.path.isdir(venv_path):
        return command

    py_env = "set PYTHONIOENCODING=utf-8 && "

    shell = get_shell()
    if shell not in ("cmd", "/bin/bash") and "bash" in shell:
        # Git Bash
        return f'export PYTHONIOENCODING=utf-8 && source "{venv_path}/Scripts/activate" && {command}'
    if shell == "/bin/bash":
        return f'export PYTHONIOENCODING=utf-8 && source "{venv_path}/bin/activate" && {command}'
    # cmd.exe
    if " " in venv_path:
        return f'{py_env}call "{venv_path}\\Scripts\\activate.bat" && {command}'
    return f"{py_env}call {venv_path}\\Scripts\\activate.bat && {command}"


def clean_output(raw: str) -> str:
    """清理 cmd.exe 输出中的残留字符"""
    import re
    cleaned = raw
    cleaned = re.sub(r'^Microsoft Windows \[.*?\]\r?\n', '', cleaned)
    cleaned = re.sub(r'^\(c\) Microsoft Corporation[^\n]*\r?\n', '', cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r'^[A-Za-z]:\\.*?>', '', cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r'^Active code page: \d+\r?\n', '', cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r'^(\r?\n)+', '', cleaned)
    return cleaned


def execute_command(command: str, cwd: str, timeout_ms: int) -> Tuple[str, str, int]:
    """
    执行 shell 命令，返回 (stdout, stderr, exit_code)。
    Windows 上使用临时 .bat 文件方案避免 cmd.exe 引号嵌套问题。
    """
    resolved = wrap_with_venv(command, cwd)
    timeout_sec = timeout_ms / 1000.0
    shell = get_shell()

    if shell == "cmd":
        # Windows cmd.exe — 临时 .bat 文件方案
        tmp_dir = os.path.join(tempfile.gettempdir(), "try-cmd")
        os.makedirs(tmp_dir, exist_ok=True)
        bat_path = os.path.join(tmp_dir, f"cmd_{os.getpid()}_{hash(command) & 0x7FFFFFFF}.bat")

        bat_content = f"@echo off\r\nchcp 65001 >nul\r\n{resolved}\r\n"
        with open(bat_path, "w", encoding="utf-8") as f:
            f.write(bat_content)

        try:
            result = subprocess.run(
                ["cmd.exe", "/d", "/c", bat_path],
                cwd=cwd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout_sec,
            )
            stdout = clean_output(result.stdout)
            stderr = clean_output(result.stderr)
            return stdout, stderr, result.returncode
        except subprocess.TimeoutExpired:
            return "", f"命令超时 ({timeout_ms}ms)", -1
        finally:
            try:
                os.unlink(bat_path)
            except OSError:
                pass
    else:
        # Git Bash 或 Linux bash
        try:
            result = subprocess.run(
                [shell, "-c", resolved],
                cwd=cwd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout_sec,
            )
            return result.stdout, result.stderr, result.returncode
        except subprocess.TimeoutExpired:
            return "", f"命令超时 ({timeout_ms}ms)", -1
