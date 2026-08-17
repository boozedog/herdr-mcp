/** Herdr injects these when the MCP server runs inside a pane. */
export type HerdrEnvIds = {
  workspace_id: string;
  tab_id: string;
  pane_id: string;
};

/** True when HERDR_ENV is exactly "1". */
export function isInHerdr(env: Record<string, string | undefined> = Deno.env.toObject()): boolean {
  return env.HERDR_ENV === "1";
}

/** Read Herdr pane ids from the environment. */
export function readHerdrEnvIds(
  env: Record<string, string | undefined> = Deno.env.toObject(),
): HerdrEnvIds | undefined {
  const workspace_id = env.HERDR_WORKSPACE_ID;
  const tab_id = env.HERDR_TAB_ID;
  const pane_id = env.HERDR_PANE_ID;
  if (!workspace_id || !tab_id || !pane_id) return undefined;
  return { workspace_id, tab_id, pane_id };
}
