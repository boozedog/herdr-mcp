# herdr-mcp

MCP server for [Herdr](https://github.com/boozedog/herdr) — multi-agent coordination inside terminal panes.

This repository implements the stdio MCP surface described in [issue #1](https://github.com/boozedog/herdr-mcp/issues/1). Workflow roles and edges are **config-driven** ([#7](https://github.com/boozedog/herdr-mcp/issues/7)); the four-role research/impl/review pipeline is a built-in preset, not hardcoded tool names.

## Requirements

- [Deno](https://deno.com/) 2.x
- A Herdr pane when you want live coordination context (`HERDR_ENV=1`)

## Install

```bash
git clone https://github.com/boozedog/herdr-mcp.git
cd herdr-mcp
```

## Run

Stdio MCP server (for MCP clients and Herdr panes):

```bash
deno task dev
```

Check and test:

```bash
deno task check
deno task test
```

## Environment

Herdr injects these variables into panes that host agents:

| Variable | Purpose |
| --- | --- |
| `HERDR_ENV` | Must be `1` inside a Herdr pane |
| `HERDR_WORKSPACE_ID` | Workspace id |
| `HERDR_TAB_ID` | Tab id |
| `HERDR_PANE_ID` | Pane id |

Optional workflow config (first match wins):

1. `HERDR_MCP_CONFIG`
2. `./herdr-mcp.toml` (process cwd)
3. `$XDG_CONFIG_HOME/herdr-mcp/config.toml`
4. Built-in preset `research-impl-review`

When `HERDR_ENV` is not `1`, tools still appear in `tools/list`, but every call returns a structured `not_in_herdr` error. Invalid user-supplied config keeps the process alive and returns `invalid_config` on every call (no silent fallback to the preset).

## Tools (v1)

Always registered:

| Tool | Description |
| --- | --- |
| `whoami` | Workspace/tab/pane ids, role, `mutate`, suffix, and edges available from this tab |
| `workflow` | Dump loaded workflow name, roles, edges, and config path |
| `peers` | Tabs and panes in the current `HERDR_WORKSPACE_ID` only |
| `handoff` | Submit a message (fire-and-forget with revision/seq confirmation); does not wait |
| `wait` | Wait until a peer reaches `idle`, `done`, or `blocked` |
| `read` | `agent read --source recent-unwrapped` transcript |

With the default preset, these directional tools are also registered (`edge.tool = true` in config):

| Tool | From | To | Wait |
| --- | --- | --- | --- |
| `research_to_impl` | research* | paired impl | no |
| `impl_to_review` | impl* | paired review | yes (handoff + wait + read) |
| `review_to_impl` | review* | paired impl | no |

Custom configs may register different `{edge.id}` tools or set `tool = false` and use `handoff { edge = "..." }` instead.

## Architecture

See [issue #1](https://github.com/boozedog/herdr-mcp/issues/1) for the architecture thesis. Herdr physics (workspace scope, busy-peer gate, parse/confirm rules) stay in code; roles and edges are data ([#7](https://github.com/boozedog/herdr-mcp/issues/7)).

## License

MIT — see [LICENSE](LICENSE).
