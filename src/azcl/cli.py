"""Stub command for the AZCL package.

The downloadable client is not ready yet. This module prints that status
and the first-run step already named for the package. It does not import
a library or open a vault.
"""

from __future__ import annotations

import json
import sys

AUTHOR = "Aziel Eliab"
LIBRARY_URL = "https://www.azielcorpuslibrary.net/"
NOT_READY = "This package is not ready yet."
WHEN_IT_SHIPS = (
    "When it ships, the next step will be the first run: "
    "import every public library file and its hashchain from the "
    "Aziel Digital Library, then sync updates into a local append-only vault "
    "while you are online."
)
NEXT_STEP = "Next: run azcl --help. There is no further step in this package."
TRY_NEXT = "Try: azcl   or   azcl --help"


def status_payload() -> dict:
    return {
        "name": "AZCL",
        "author": AUTHOR,
        "ready": False,
        "summary": NOT_READY,
        "library": LIBRARY_URL,
        "when_it_ships": WHEN_IT_SHIPS,
        "next": NEXT_STEP,
    }


def welcome_text() -> str:
    lines = [
        "AZCL",
        f"Author: {AUTHOR}",
        "",
        NOT_READY,
        "",
        "AZCL is the local client for the Aziel Digital Library",
        f"({LIBRARY_URL}).",
        "",
        WHEN_IT_SHIPS,
        "",
        NEXT_STEP,
        "",
    ]
    return "\n".join(lines)


def help_text() -> str:
    lines = [
        "azcl: local client for the Aziel Digital Library",
        "",
        f"{NOT_READY} The lines below only print that status.",
        "",
        "Usage:",
        "  azcl [--json]",
        "  azcl --help",
        "",
        "Options:",
        "  --json       Print the status as JSON",
        "  -h, --help   Show this help",
        "",
        WHEN_IT_SHIPS,
        "",
        "Examples:",
        "  azcl",
        "  azcl --json",
        "",
        f"Author: {AUTHOR}",
        "",
    ]
    return "\n".join(lines)


def _fail(message: str) -> int:
    print(message, file=sys.stderr)
    return 2


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args:
        print(welcome_text(), end="")
        return 0
    if args in (["-h"], ["--help"], ["help"]):
        print(help_text(), end="")
        return 0
    if args == ["--json"]:
        json.dump(status_payload(), sys.stdout, indent=2)
        print()
        return 0
    token = args[0]
    if len(args) > 1 and token in {"--json", "-h", "--help", "help"}:
        extra = args[1]
        return _fail(f'Unexpected argument "{extra}". {NOT_READY} {TRY_NEXT}')
    if token.startswith("-"):
        return _fail(f'Unknown option "{token}". {NOT_READY} {TRY_NEXT}')
    return _fail(f'Unknown command "{token}". {NOT_READY} {TRY_NEXT}')
