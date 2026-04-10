# Agent workflows

Hunk supports two agent workflows:

- steer a live Hunk window from another terminal with `hunk session ...` (recommended)
- load agent comments from a file with `--agent-context`

## Steer a live Hunk window

Use the Hunk review skill: [`../skills/hunk-review/SKILL.md`](../skills/hunk-review/SKILL.md).

You can get the absolute path to the skill file from your local install by running `hunk skill path`.

A good generic prompt is:

```text
Load the Hunk skill and use it for this review.
```

That skill teaches the agent how to inspect a live Hunk session, navigate it, reload it, and leave inline comments.

## How live session control works

When a Hunk TUI starts, it registers with a local loopback daemon. `hunk session ...` talks to that daemon to find the right live window and control it.

Use it to:

- inspect the current review context
- export the loaded review structure for agent workflows
- optionally include raw patch text when an agent truly needs it
- jump to a file, hunk, or line
- reload the current window with a different `diff` or `show` command
- add, batch-apply, list, and remove inline comments

Most users only need `hunk session ...`. Use `hunk mcp serve` only for manual startup or debugging of the local daemon.

### Common session commands

```bash
hunk session list
hunk session get --repo .
hunk session context --repo .
hunk session review --repo . --json
hunk session review --repo . --include-patch --json
hunk session navigate --repo . --file README.md --hunk 2
hunk session reload --repo . -- diff
hunk session reload --repo /path/to/worktree -- diff
hunk session reload --session-path /path/to/live-window --source /path/to/other-checkout -- diff
hunk session reload --repo . -- show HEAD~1 -- README.md
hunk session comment add --repo . --file README.md --new-line 103 --summary "Tighten this wording"
hunk session comment add --repo . --file README.md --new-line 103 --summary "Tighten this wording" --focus
printf '%s\n' '{"comments":[{"filePath":"README.md","newLine":103,"summary":"Tighten this wording"}]}' | hunk session comment apply --repo . --stdin
printf '%s\n' '{"comments":[{"filePath":"README.md","hunk":2,"summary":"Explain this hunk"}]}' | hunk session comment apply --repo . --stdin --focus
hunk session comment list --repo .
hunk session comment rm --repo . <comment-id>
hunk session comment clear --repo . --file README.md --yes
```

`hunk session review --json` returns file and hunk structure by default. Add `--include-patch` only when a caller truly needs raw unified diff text in the response.

`hunk session reload ... -- <hunk command>` swaps what a live session is showing without opening a new TUI window. Pass `--focus` to jump the live session to the new note, or to the first note in a batch apply.

`hunk session comment apply` reads one stdin JSON object with a top-level `comments` array. Each item needs `filePath`, `summary`, and exactly one target such as `hunk`, `hunkNumber`, `oldLine`, or `newLine`.

- `--repo <path>` selects the live session by its current loaded repo root.
- `--source <path>` is reload-only: it changes where the nested `diff` or `show` command runs, but does not select the session.
- For normal worktree use, prefer targeting the worktree session directly with `hunk session reload --repo /path/to/worktree -- diff`.
- Use `--session-path` + `--source` only for advanced cases where you want to repoint an already-open live window to another checkout or path.

## Load agent comments from a file

Use `--agent-context` to attach agent-written comments or rationale from a JSON sidecar file. For a compact real example, see [`../examples/3-agent-review-demo/agent-context.json`](../examples/3-agent-review-demo/agent-context.json).

```bash
hunk diff --agent-context notes.json
hunk patch change.patch --agent-context notes.json
```
