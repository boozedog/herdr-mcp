import { ParseFailed } from "./errors.ts";

const MAX_DIAGNOSTIC = 500;

export function truncateStdout(stdout: string, max = MAX_DIAGNOSTIC): string {
  if (stdout.length <= max) return stdout;
  return `${stdout.slice(0, max)}…`;
}

/** Strict JSON parse for Herdr control commands. */
export function parseStrictJson(stdout: string): { ok: true; value: unknown } | { ok: false; error: ParseFailed } {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: new ParseFailed({
        message: "Empty stdout from herdr control command",
        stdout: "",
      }),
    };
  }
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return {
      ok: false,
      error: new ParseFailed({
        message: "Failed to parse herdr control JSON",
        stdout: truncateStdout(stdout),
      }),
    };
  }
}

/** Find the first balanced JSON object in a string. */
export function extractFirstJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

export type PromptParseResult =
  | { kind: "json"; value: unknown }
  | { kind: "accepted"; raw: string }
  | { kind: "error"; error: ParseFailed };

/** Herdr CLI error envelope: `{"error":{"code":"...","message":"..."},"id":"..."}` */
export function extractHerdrCliError(value: unknown): { code: string; message: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const error = (value as { error?: { code?: string; message?: string } }).error;
  if (!error?.code) return undefined;
  return { code: error.code, message: error.message ?? error.code };
}

/** Tolerant parse for agent prompt stdout. */
export function parsePromptOutput(stdout: string, exitCode: number): PromptParseResult {
  const trimmed = stdout.trim();
  if (trimmed) {
    const strict = parseStrictJson(stdout);
    if (strict.ok) {
      const cliError = extractHerdrCliError(strict.value);
      if (cliError) {
        return {
          kind: "error",
          error: new ParseFailed({
            message: `herdr agent prompt failed: ${cliError.code}`,
            stdout: truncateStdout(stdout),
          }),
        };
      }
      return { kind: "json", value: strict.value };
    }

    const extracted = extractFirstJsonObject(stdout);
    if (extracted) {
      try {
        const value = JSON.parse(extracted);
        const cliError = extractHerdrCliError(value);
        if (cliError) {
          return {
            kind: "error",
            error: new ParseFailed({
              message: `herdr agent prompt failed: ${cliError.code}`,
              stdout: truncateStdout(stdout),
            }),
          };
        }
        return { kind: "json", value };
      } catch {
        // fall through
      }
    }
  }

  if (exitCode === 0) {
    return { kind: "accepted", raw: stdout };
  }

  return {
    kind: "error",
    error: new ParseFailed({
      message: "Failed to parse herdr agent prompt output",
      stdout: truncateStdout(stdout),
    }),
  };
}

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export type StatusSnapshot = {
  agent_status: AgentStatus;
  revision?: number;
  state_change_seq?: number;
  pane_id?: string;
  name?: string;
};

/** Parse agent get / pane get into a status snapshot. */
export function snapshotFromHerdrResult(value: unknown): StatusSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const root = value as Record<string, unknown>;
  const result = root.result as Record<string, unknown> | undefined;
  if (!result) return undefined;

  const agent = (result.agent ?? result.pane) as Record<string, unknown> | undefined;
  if (!agent) return undefined;

  const status = agent.agent_status;
  if (typeof status !== "string") return undefined;

  return {
    agent_status: status as AgentStatus,
    revision: typeof agent.revision === "number" ? agent.revision : undefined,
    state_change_seq: typeof agent.state_change_seq === "number"
      ? agent.state_change_seq
      : undefined,
    pane_id: typeof agent.pane_id === "string" ? agent.pane_id : undefined,
    name: typeof agent.name === "string" ? agent.name : undefined,
  };
}

/** Confirm submit by comparing revision and/or state_change_seq. */
export function stateChanged(
  before: StatusSnapshot,
  after: StatusSnapshot,
): boolean {
  if (
    before.revision !== undefined &&
    after.revision !== undefined &&
    after.revision !== before.revision
  ) {
    return true;
  }
  if (
    before.state_change_seq !== undefined &&
    after.state_change_seq !== undefined &&
    after.state_change_seq !== before.state_change_seq
  ) {
    return true;
  }
  return false;
}
