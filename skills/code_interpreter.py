"""Sandboxed Python code interpreter for SAGE.

Executes small computation scripts (math, symbolic algebra via sympy,
scipy integrations, matplotlib plotting) in a subprocess with:

- subprocess.run(shell=False) and a hard 5s timeout
- an isolated temporary working directory deleted after each run
- a static AST import allowlist (math, numpy, sympy, scipy, matplotlib)
- regex rejection of filesystem/exec escape hatches (open(), eval(),
  exec(), __import__, dunder access)
- stdout/stderr capture (clamped), and matplotlib figures moved into
  sandbox/docs/plots/ (never left in the temp dir, never executed again)

The static scan is best-effort defense in depth; the subprocess
isolation + timeout is the primary containment layer.
"""

import ast
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from skills.sandbox_guard import assert_in_sandbox

REPO_ROOT = Path(__file__).resolve().parent.parent
SANDBOX_ROOT = REPO_ROOT / "sandbox"
PLOTS_DIR = SANDBOX_ROOT / "docs" / "plots"

ALLOWED_IMPORT_ROOTS = {"math", "numpy", "sympy", "scipy", "matplotlib"}

_FORBIDDEN_CALL_RE = re.compile(
    r"\b(?:open|eval|exec|compile|__import__|globals|locals|breakpoint|"
    r"help|input|exit|quit)\s*\("
)
_FORBIDDEN_NAME_RE = re.compile(
    r"\b(?:subprocess|os\.|sys\.|shutil|socket|requests|urllib|urllib3|"
    r"pickle|ctypes|importlib|pkgutil|pathlib|csv|json|io\.)\b"
    r"|\.\s*__\w+__|\b__\w+__\s*\("
)

DEFAULT_TIMEOUT = 5.0
STDOUT_LIMIT = 4000
STDERR_LIMIT = 2000

_MPL_PREAMBLE = (
    "import matplotlib as _sage_mpl\n"
    "_sage_mpl.use('Agg')\n"
)


class CodeRejected(ValueError):
    pass


def _check_script(script: str) -> None:
    if not script or not script.strip():
        raise CodeRejected("empty script")
    if len(script) > 20000:
        raise CodeRejected("script too long (limit 20000 chars)")
    if _FORBIDDEN_CALL_RE.search(script):
        raise CodeRejected(
            "script uses a disallowed built-in call "
            "(open/eval/exec/compile/__import__/globals/locals/exit/...)"
        )
    if _FORBIDDEN_NAME_RE.search(script):
        raise CodeRejected(
            "script references a disallowed module or dunder attribute"
        )
    try:
        tree = ast.parse(script)
    except SyntaxError as exc:
        raise CodeRejected(f"syntax error: {exc}")
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if root not in ALLOWED_IMPORT_ROOTS:
                    raise CodeRejected(
                        f"import '{root}' is not allowed "
                        f"(allowed: {sorted(ALLOWED_IMPORT_ROOTS)})"
                    )
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".")[0]
            if root and root not in ALLOWED_IMPORT_ROOTS:
                raise CodeRejected(
                    f"import from '{root}' is not allowed "
                    f"(allowed: {sorted(ALLOWED_IMPORT_ROOTS)})"
                )


def _collect_plots(workdir: Path) -> List[Path]:
    plot_dir = assert_in_sandbox(PLOTS_DIR)
    plot_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    saved: List[Path] = []
    for idx, src in enumerate(sorted(workdir.rglob("*.png"))):
        target = assert_in_sandbox(
            plot_dir / f"{stamp}_{idx}_{src.name}"
        )
        shutil.move(str(src), str(target))
        saved.append(target)
    return saved


def run_code(
    script: str,
    timeout: float = DEFAULT_TIMEOUT,
    python: Optional[str] = None,
) -> Dict[str, Any]:
    """Run user computation code in an isolated subprocess.

    Returns {ok, stdout, stderr, returncode, plots, error} with output
    clamped; raises CodeRejected for static rule violations.
    """
    _check_script(script)

    interpreter = python or sys.executable
    needs_mpl = "matplotlib" in script or "pyplot" in script
    prefix = _MPL_PREAMBLE if needs_mpl else ""

    with tempfile.TemporaryDirectory(prefix="sage_interp_") as tmp:
        workdir = Path(tmp)
        try:
            proc = subprocess.run(
                [interpreter, "-I", "-c", prefix + script],
                cwd=str(workdir),
                shell=False,
                timeout=timeout,
                capture_output=True,
                text=True,
                input="",
            )
            stdout, stderr, returncode = (
                proc.stdout or "",
                proc.stderr or "",
                proc.returncode,
            )
            timed_out = False
            error = None
        except subprocess.TimeoutExpired as exc:
            stdout = (exc.stdout or b"").decode("utf-8", "replace") if isinstance(exc.stdout, bytes) else (exc.stdout or "")
            stderr = (exc.stderr or b"").decode("utf-8", "replace") if isinstance(exc.stderr, bytes) else (exc.stderr or "")
            stderr += f"\n[execution exceeded {timeout:.0f}s timeout — killed]"
            returncode, timed_out, error = -9, True, "timeout"

        plots = _collect_plots(workdir)
        plot_paths = [
            str(p.relative_to(REPO_ROOT)) for p in plots
        ]

    return {
        "ok": returncode == 0,
        "stdout": stdout[-STDOUT_LIMIT:],
        "stderr": stderr[-STDERR_LIMIT:],
        "returncode": returncode,
        "plots": plot_paths,
        "timeout": timed_out,
        "error": error,
    }
