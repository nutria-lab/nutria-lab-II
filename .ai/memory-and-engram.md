# Memory and Engram

Engram is mandatory persistent project memory, not an optional assistant feature. The installer provisions the local binary and the MCP configuration invokes it automatically.

## At session start

1. Call `mem_context` for ongoing work.
2. Before architecture-sensitive work, call `mem_review` with `action: list` if available.
3. For past-work questions, use `mem_context`, then `mem_search`, then `mem_get_observation` for the complete record.
4. Treat `needs_review` memories as stale until verified; never mark them reviewed automatically.

## Save immediately

Call `mem_save` after an architecture/design decision, convention/workflow change, bug fix, configuration change, non-obvious discovery, established pattern, significant artifact update, or user preference/confirmed direction.

Use:

- a short verb-first title;
- `bugfix`, `decision`, `architecture`, `discovery`, `pattern`, `config`, or `preference` type;
- `project` scope by default;
- a stable `topic_key` for one evolving topic; and
- **What / Why / Where / Learned** structured content.

Call `mem_save_prompt` before derived saves when the original prompt is observable. Do not overwrite unrelated topics. If a save returns a conflict/judgment, resolve it explicitly.

Never store credentials, tokens, connection strings, PII, raw production data or unreviewed transcripts.

## At session close and after compaction

Before declaring completion, call `mem_session_summary` with Goal, Instructions, Discoveries, Accomplished, Next Steps and Relevant Files. After compaction, persist the summary first, recover context with `mem_context`, and only then continue.
