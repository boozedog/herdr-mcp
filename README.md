# herdr-mcp

MCP server for [Herdr](https://github.com/boozedog/herdr) — multi-agent coordination inside terminal panes.

This repository implements the stdio MCP surface described in [issue #1](https://github.com/boozedog/herdr-mcp/issues/1). Workflow roles and edges are **config-driven** ([#7](https://github.com/boozedog/herdr-mcp/issues/7)); the four-role research/impl/review pipeline is a built-in preset, not hardcoded tool names.

## Requirements

- [Deno](https://deno.com/) 2.x (development, `deno task install`, and Nix wrapper only — not required for the Homebrew install)
- [Herdr](https://github.com/boozedog/herdr) **0.8+** on `PATH` (for live coordination)
- A Herdr pane with `HERDR_ENV=1` when you want tools to call into Herdr (see [Environment](#environment))

## Install

Clone the repo, then install a `herdr-mcp` command on your `PATH`:

```bash
git clone https://github.com/boozedog/herdr-mcp.git
cd herdr-mcp
deno task install
```

`deno task install` runs `deno install --global` and places a launcher in `~/.deno/bin`. That launcher runs `src/main.ts` from this clone and still requires Deno at runtime — moving or deleting the clone breaks the command. Ensure `~/.deno/bin` is on your `PATH`.

**Alternative:** compile a relocatable standalone binary and copy it somewhere on `PATH`:

```bash
deno task compile
# e.g. cp herdr-mcp ~/.local/bin/
```

Do not commit the compiled `herdr-mcp` binary; it is gitignored.

### Homebrew (macOS arm64)

Prebuilt binary via the public tap — no Deno required at runtime:

```bash
brew install boozedog/tap/herdr-mcp
```

Or:

```bash
brew tap boozedog/tap
brew install herdr-mcp
```

Upgrade and uninstall:

```bash
brew upgrade herdr-mcp
brew uninstall herdr-mcp
```

Requires [Herdr](https://github.com/boozedog/herdr) 0.8+ on `PATH`. Launch your MCP client from inside a Herdr pane so `HERDR_*` is inherited (see [Environment](#environment)).

### Nix (flake)

Add this repo as a flake input and put `herdr-mcp` on `PATH`:

```nix
# flake.nix inputs
herdr-mcp.url = "github:boozedog/herdr-mcp";

# home-manager / NixOS / nix profile
environment.systemPackages = [ inputs.herdr-mcp.packages.${system}.herdr-mcp ];
```

One-off use without adding an input:

```bash
nix run github:boozedog/herdr-mcp
nix build github:boozedog/herdr-mcp
```

From a clone, `nix build` produces `./result/bin/herdr-mcp`. The wrapper seeds a writable Deno cache under `$XDG_CACHE_HOME/herdr-mcp` (or `~/.cache/herdr-mcp`) and runs `deno run --cached-only -A` against the store-copied source. `-A` matches the non-Nix install path and allows env, subprocess (`herdr`), and cache read/write.

For development without installing Deno globally:

```bash
nix develop   # devShell with deno
deno task check
deno task test
```

**Refreshing the Deno cache hash:** after bumping `deno.lock`, set `outputHash` in `flake.nix` to a placeholder (e.g. `sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`), run `nix build`, and copy the `got:` hash from the mismatch error into `outputHash`. The FOD prefetches all Linux `msgpackr-extract` optional deps so one hash serves both `x86_64-linux` and `aarch64-linux`.

## MCP client configuration

Wire the server as a **stdio** process. The MCP client must launch `herdr-mcp` **from inside a Herdr pane** so `HERDR_*` variables are inherited. A GUI-started client outside Herdr will only see structured `not_in_herdr` errors on every tool call.

Grok-style TOML:

```toml
[mcp_servers.herdr]
command = "herdr-mcp"
```

Cursor / VS Code-style JSON:

```json
{
  "mcpServers": {
    "herdr": {
      "command": "herdr-mcp"
    }
  }
}
```

For local development without installing, point `command` at Deno instead:

```json
{
  "mcpServers": {
    "herdr": {
      "command": "deno",
      "args": ["run", "-A", "--config", "deno.json", "src/main.ts"],
      "cwd": "/path/to/herdr-mcp"
    }
  }
}
```

Replace `/path/to/herdr-mcp` with your clone path. Prefer `command = "herdr-mcp"` after `deno task install`.

## Run (development)

Stdio MCP server without installing:

```bash
deno task dev
```

## Test

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

Full v1 spec and rationale: [issue #1](https://github.com/boozedog/herdr-mcp/issues/1).

## Non-goals (v1)

This server is a **protocol MCP** for agent coordination, not a transport wrap of the full `herdr` CLI. It will not:

- Expose raw pane, tab, or workspace CRUD (`herdr pane *`, splits, focus, and similar)
- Provide SSH session tools ([#6](https://github.com/boozedog/herdr-mcp/issues/6) tracks follow-up work)
- Replace Herdr itself — install and run Herdr separately
- Enforce impl-only file edits (mutation policy stays in client instructions / `AGENTS.md`)
- Hard-reject handoff markdown shape (envelope checks warn; they do not block submit)

## Architecture

See [issue #1](https://github.com/boozedog/herdr-mcp/issues/1) for the architecture thesis. Herdr physics (workspace scope, busy-peer gate, parse/confirm rules) stay in code; roles and edges are data ([#7](https://github.com/boozedog/herdr-mcp/issues/7)).

## Releasing

Tagged pushes matching `v*` trigger [`.github/workflows/release.yml`](.github/workflows/release.yml) on a native `macos-15` (arm64) runner. The workflow:

1. Runs `deno task compile` for `aarch64-apple-darwin`
2. Ad-hoc codesigns the binary (`codesign -s -`)
3. Packs `herdr-mcp-<version>-aarch64-apple-darwin.tar.gz` and attaches it to the GitHub Release

The job log prints the tarball SHA-256. Bump the Homebrew tap locally (same pattern as [smoovmux `scripts/release.sh`](https://github.com/boozedog/smoovmux/blob/main/scripts/release.sh)):

```bash
VERSION=0.2.0
SHA256=<from release workflow log>
TAP=../homebrew-tap   # or your clone of boozedog/homebrew-tap
FORMULA="$TAP/Formula/herdr-mcp.rb"

sed -i.bak -E "s/^(  version )\"[0-9]+\.[0-9]+\.[0-9]+[^\"]*\"/\1\"$VERSION\"/" "$FORMULA"
sed -i.bak -E "s/^(  sha256 )\"[a-f0-9]{64}\"/\1\"$SHA256\"/" "$FORMULA"
rm -f "$FORMULA.bak"

cd "$TAP"
git add Formula/herdr-mcp.rb
git commit -m "bump herdr-mcp to $VERSION"
git push
```

## License

MIT — see [LICENSE](LICENSE).
