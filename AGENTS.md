# AGENTS.md

Project rules for agents working in `herdr-mcp`.

## Scope

- Implement one issue slice at a time. Follow the sequence in GitHub issue #1.
- Stdio MCP only. Do not add HTTP transport.
- Use Effect Schema for tool inputs and tagged errors. Do not wrap the MCP SDK in `Effect.gen` end-to-end.
- Do not add Foldkit/TEA or a service Layer graph before there are two real backends.

## Verify

```bash
deno task check
deno task test
```

## Git

- Propose commit title + body and wait for human approval before `git commit`.
- Get explicit approval before `git push`.
- Never use `git commit --no-verify` or `--no-gpg-sign`.

## Public artifacts

Keep README and GitHub issues public-safe: no internal hostnames, tailnets, or fleet paths.

## Herdr coordination

When `HERDR_ENV=1`, check the current tab label before mutating. Tree edits belong on `impl` tabs. Hand off to paired `review` after verify passes.
