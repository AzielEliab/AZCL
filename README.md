# AZCL

AZCL is Aziel Eliab's local client for the [Aziel Digital Library](https://www.azielcorpuslibrary.net/).

This package is not ready yet. Running it only prints that status.

When it ships, the next step will be the first run: import every public library file and its hashchain, then sync updates into a local append-only vault while you are online.

## Try the stub

1. `python3 -m venv .venv && . .venv/bin/activate`
2. `pip install -e .`
3. `azcl`

`azcl --help` lists this stub. `azcl --json` prints the same status for machines.

Apache-2.0.
