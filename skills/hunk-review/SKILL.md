---
name: hunk-review
description: Use when the task involves Hunk diffs, Hunk agent-context sidecars, or live Hunk MCP review sessions. Helps Pi choose the right Hunk launch mode, refresh `.hunk/latest.json`, and use Hunk MCP to inspect sessions, navigate hunks, and leave inline review comments.
compatibility: Requires Hunk from this repo or the published hunkdiff package. Works best with a real TTY for interactive review.
---

# Hunk Review

Use this skill when working with Hunk itself or when the user wants a code-review workflow centered on Hunk.

When this skill activates, start by briefly explaining what Hunk is in plain language before jumping into commands or MCP details.

## What Hunk is

Hunk is a review-first terminal diff viewer for agent-authored changesets.

Keep these product rules in mind:
- The main pane is one top-to-bottom multi-file review stream.
- The sidebar is navigation only; selecting a file should jump within the stream, not collapse the review to one file.
- Layouts are `auto`, `split`, and `stack`.
- `[` and `]` navigate hunks across the full review stream.
- Agent notes belong beside the code they explain.

## Choose the right launch path

If you are modifying the Hunk repo itself, prefer the source entrypoint so you review the code you just changed:

```bash
bun run src/main.tsx -- diff
bun run src/main.tsx -- show HEAD~1
bun run src/main.tsx -- diff /tmp/before.ts /tmp/after.ts
```

Outside the repo, prefer the installed CLI:

```bash
hunk diff
hunk show
hunk patch -
```

For command details and review entrypoints, read [references/commands.md](references/commands.md).

## Review workflow expectations

When using Hunk for agent changes:
- prefer a real TTY or tmux session over redirected stdout captures
- use `hunk diff --agent-context .hunk/latest.json` when the repo has fresh review notes
- refresh `.hunk/latest.json` after code changes if the repo expects it
- keep `.hunk/latest.json` concise and review-oriented
- if new files should show up before commit, use `git add -N <path>`

## Hunk MCP workflow

Hunk's MCP support is a local loopback daemon that brokers commands to live Hunk sessions.

Important behavior:
- normal Hunk sessions auto-start and register with the daemon when MCP is enabled
- `hunk mcp serve` exists for manual startup or debugging
- `HUNK_MCP_DISABLE=1` disables MCP registration for a session
- one daemon can serve many Hunk sessions

When using Hunk MCP from Pi, prefer this flow:
1. `list_sessions`
2. `get_session` when you need broad session metadata
3. `get_selected_context` to respect the current reviewer focus
4. `navigate_to_hunk` if you need to move to a specific location
5. `comment` to add the inline review note

Guidelines:
- If multiple sessions are live, pass `sessionId` explicitly.
- Prefer `get_selected_context` before navigating blindly.
- Use `navigate_to_hunk` for hunk-level movement; avoid inventing extra remote-control behavior.
- Use `comment` for review notes tied to real diff lines, with `reveal: true` unless the user wants a quieter action.

For concrete MCP tool behavior and examples, read [references/mcp-review.md](references/mcp-review.md).

## What this skill should steer Pi toward

Prefer a skill over a prompt dump:
- keep the always-loaded context small
- load the full Hunk workflow only when the task is actually about review
- use Hunk's existing MCP tools rather than inventing new ad hoc shell parsing

Prefer review-oriented actions:
- inspect the current diff session
- move to the right hunk
- attach concise inline review comments
- keep agent rationale spatially tied to the code
