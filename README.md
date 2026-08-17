# herdr-mcp

MCP server for [Herdr](https://github.com/boozedog/herdr) — multi-agent coordination inside terminal panes.

This repository implements the stdio MCP surface described in [issue #1](https://github.com/boozedog/herdr-mcp/issues/1). Slice 1 ([#2](https://github.com/boozedog/herdr-mcp/issues/2)) is a Deno + Effect Schema scaffold that speaks MCP SDK v2 over stdio.

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

When `HERDR_ENV` is not `1`, tools still appear in `tools/list`, but every call returns a structured `not_in_herdr` error. The process stays alive so clients can probe capabilities at connect time.

## Tools (v0)

| Tool | Description |
| --- | --- |
| `whoami` | Return workspace/tab/pane ids when running inside Herdr |

## Architecture

See [issue #1](https://github.com/boozedog/herdr-mcp/issues/1) for the architecture thesis and implementation sequence. Workflow roles and edges will be config-driven ([#7](https://github.com/boozedog/herdr-mcp/issues/7)); this slice intentionally avoids hardcoding a four-role pipeline.

## License

MIT — see [LICENSE](LICENSE).
