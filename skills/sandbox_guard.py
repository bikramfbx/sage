"""Filesystem guard for SAGE skills.

Every file operation a skill performs is resolved with pathlib and
checked for containment inside the SAGE sandbox directory. Both relative
traversal attempts ("../x") and absolute paths outside sandbox/ raise an
explicit ValueError before any read/write happens.
"""

from pathlib import Path
from typing import Union

REPO_ROOT = Path(__file__).resolve().parent.parent
SANDBOX_ROOT = (REPO_ROOT / "sandbox").resolve()


def assert_in_sandbox(path: Union[str, Path], root: Union[str, Path, None] = None) -> Path:
    """Resolve `path` and enforce containment within `root` (sandbox/).

    Relative paths are interpreted relative to `root`. Symlinks and parent
    components are resolved with Path.resolve(), so traversal via ".." and
    absolute paths outside the sandbox are rejected with an explicit
    ValueError before any read or write happens.
    """
    base = Path(root).resolve() if root is not None else SANDBOX_ROOT
    candidate = Path(str(path))
    if candidate.is_absolute():
        resolved = candidate.resolve(strict=False)
    else:
        resolved = (base / candidate).resolve(strict=False)

    if resolved != base and not resolved.is_relative_to(base):
        raise ValueError(
            f"Path escapes the SAGE sandbox: {path!r} resolved to {resolved}"
        )
    return resolved
