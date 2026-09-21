"""Vercel serverless entry point.

The Python builder finds the ASGI application by static analysis, so `app`
must be assigned once at module level. Wrapping that assignment in a try block
hides it from the detector and the build fails with "Could not find a top-level
app" — hence the factory below rather than an inline try/except.

The factory still catches import errors, because the platform otherwise reports
a bare 500 that names neither the exception nor the file.
"""
import os
import re
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _redact(text: str) -> str:
    """Never echo credentials: a connection string that fails to parse carries
    its password in the exception message."""
    text = re.sub(r"(?i)\b\w+://[^\s@]*@[^\s]*", "<redacted-url>", text)
    text = re.sub(r"\b(sk|rediss?|gh[pousr])[-_][A-Za-z0-9_\-]{12,}", "<redacted>", text)
    return text


def _startup_error_app(exc: BaseException):
    """A stand-in that reports why the real app could not be imported."""
    from fastapi import FastAPI
    from fastapi.responses import PlainTextResponse

    frames = [
        f"{os.path.basename(f.filename)}:{f.lineno} in {f.name}"
        for f in traceback.extract_tb(exc.__traceback__)[-4:]
    ]
    report = "\n".join([
        "STARTUP FAILED",
        f"error: {type(exc).__name__}: {_redact(str(exc))}",
        "where: " + " <- ".join(reversed(frames)),
        f"cwd:   {os.getcwd()}",
        f"root:  {sorted(os.listdir(sys.path[0]))[:40]}",
    ])

    fallback = FastAPI()

    @fallback.get("/{full_path:path}")
    async def _report(full_path: str):
        return PlainTextResponse(report, status_code=500)

    return fallback


def _load_app():
    try:
        from main import app as real_app
        return real_app
    except Exception as exc:  # pragma: no cover - only on a broken deploy
        return _startup_error_app(exc)


# Top-level, unconditional, single assignment. Do not move this into a branch.
app = _load_app()
