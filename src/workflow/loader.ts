import { parse } from "@std/toml";
import { Schema } from "effect";
import { InvalidConfig } from "../errors.ts";
import { normalizeWorkflow, RESEARCH_IMPL_REVIEW_PRESET } from "./preset.ts";
import { WorkflowConfigSchema, type LoadedWorkflow } from "./schema.ts";

export type WorkflowLoadResult =
  | { ok: true; workflow: LoadedWorkflow }
  | { ok: false; error: InvalidConfig };

function xdgConfigPath(): string {
  const xdg = Deno.env.get("XDG_CONFIG_HOME");
  const home = Deno.env.get("HOME") ?? "";
  const base = xdg ?? `${home}/.config`;
  return `${base}/herdr-mcp/config.toml`;
}

/** Discovery order: HERDR_MCP_CONFIG → ./herdr-mcp.toml → XDG config → preset. */
export function discoverConfigPath(cwd = Deno.cwd()): string | null {
  const explicit = Deno.env.get("HERDR_MCP_CONFIG");
  if (explicit) return explicit;
  const local = `${cwd}/herdr-mcp.toml`;
  try {
    Deno.statSync(local);
    return local;
  } catch {
    // missing
  }
  const xdg = xdgConfigPath();
  try {
    Deno.statSync(xdg);
    return xdg;
  } catch {
    // missing
  }
  return null;
}

function formatSchemaError(error: unknown): { schema_path: string; detail: string } {
  const message = String(error);
  return { schema_path: message.split(":")[0] ?? "schema", detail: message };
}

function configUsesRemovedWaitKey(parsed: unknown): boolean {
  if (typeof parsed !== "object" || parsed === null) return false;
  const edges = (parsed as { edges?: unknown }).edges;
  if (!Array.isArray(edges)) return false;
  return edges.some((edge) =>
    typeof edge === "object" && edge !== null && "wait" in edge
  );
}

export function loadWorkflowFromFile(path: string): WorkflowLoadResult {
  let raw: string;
  try {
    raw = Deno.readTextFileSync(path);
  } catch (cause) {
    return {
      ok: false,
      error: new InvalidConfig({
        message: `Failed to read config at ${path}`,
        path,
        schema_path: "file",
        detail: String(cause),
      }),
    };
  }

  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (cause) {
    return {
      ok: false,
      error: new InvalidConfig({
        message: `Invalid TOML at ${path}`,
        path,
        schema_path: "toml",
        detail: String(cause),
      }),
    };
  }

  if (configUsesRemovedWaitKey(parsed)) {
    return {
      ok: false,
      error: new InvalidConfig({
        message: `Config at ${path} uses removed edge field "wait"`,
        path,
        schema_path: "edges.wait",
        detail: 'Remove "wait" from edge definitions; directional tools are fire-and-forget.',
      }),
    };
  }

  try {
    const config = Schema.decodeUnknownSync(WorkflowConfigSchema)(parsed);
    const name = config.preset ?? "custom";
    return {
      ok: true,
      workflow: normalizeWorkflow(config, name, path),
    };
  } catch (cause) {
    const { schema_path, detail } = formatSchemaError(cause);
    return {
      ok: false,
      error: new InvalidConfig({
        message: `Config schema validation failed at ${path}`,
        path,
        schema_path,
        detail,
      }),
    };
  }
}

export function loadWorkflow(cwd = Deno.cwd()): WorkflowLoadResult {
  const path = discoverConfigPath(cwd);
  if (!path) {
    return {
      ok: true,
      workflow: normalizeWorkflow(RESEARCH_IMPL_REVIEW_PRESET, "research-impl-review", null),
    };
  }
  return loadWorkflowFromFile(path);
}
