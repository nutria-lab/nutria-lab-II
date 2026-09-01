# CodeGraph

## Purpose

CodeGraph is the first tool for structural questions: architecture, call flows, symbols, dependencies, impact and affected files.

## Required order

1. Resolve the project root with `git rev-parse --show-toplevel || pwd`.
2. Confirm the target is a real project/workspace; never initialize in a home or temporary directory.
3. Check for `.codegraph/`.
4. If missing, initialize once with `codegraph init <project-root>`.
5. Use `codegraph_explore` (MCP) or `codegraph explore` before broad filesystem search.
6. After edits, rely on watcher sync; run `codegraph sync` only when the watcher is disabled or status is stale.

## Safety

Do not run `codegraph uninit`, `install`, `uninstall` or `upgrade` as part of ordinary development. `codegraph index` is recovery-only for index corruption.
