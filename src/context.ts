import {
  AmbiguousTarget,
  BusyPeer,
  ConfirmationError,
  encodeError,
  type HerdrMcpError,
  NotInHerdr,
  notInHerdrError,
  ParseFailed,
  UnknownEdge,
  UnknownTarget,
  WrongRole,
} from "./errors.ts";
import {
  createCliHerdrClient,
  createDefaultRunner,
  type HerdrClient,
  type HerdrPane,
  type HerdrTab,
  parsePaneList,
  parseTabList,
} from "./herdr/client.ts";
import { isInHerdr, readHerdrEnvIds, type HerdrEnvIds } from "./herdr-env.ts";
import {
  detectRole,
  findTabLabelsForPair,
  isBareAgentKind,
  type RoleMatch,
} from "./pairing.ts";
import {
  parsePromptOutput,
  parseStrictJson,
  snapshotFromHerdrResult,
  stateChanged,
  extractHerdrCliError,
  type AgentStatus,
  type StatusSnapshot,
} from "./parse.ts";
import { filterWorkspacePanes, filterWorkspaceTabs, isInWorkspace } from "./workspace.ts";
import { loadWorkflow, type WorkflowLoadResult } from "./workflow/loader.ts";
import type { Edge, EdgePairMode, LoadedWorkflow, Role } from "./workflow/schema.ts";

export type ToolResult = {
  isError?: boolean;
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
};

export type ServerContext = {
  env: Record<string, string | undefined>;
  workflowResult: WorkflowLoadResult;
  herdr: HerdrClient;
};

export function createServerContext(
  env: Record<string, string | undefined> = Deno.env.toObject(),
  herdr: HerdrClient = createCliHerdrClient(createDefaultRunner(env)),
  cwd = Deno.cwd(),
): ServerContext {
  return {
    env,
    workflowResult: loadWorkflow(cwd),
    herdr,
  };
}

export function isToolResult(value: unknown): value is ToolResult {
  return typeof value === "object" && value !== null && "content" in value;
}

export function workflowOrError(ctx: ServerContext): LoadedWorkflow | ToolResult {
  if (ctx.workflowResult.ok) return ctx.workflowResult.workflow;
  return errorResult(ctx.workflowResult.error);
}

export function requireHerdr(ctx: ServerContext): HerdrEnvIds | ToolResult {
  if (!isInHerdr(ctx.env)) return errorResult(notInHerdrError());
  const ids = readHerdrEnvIds(ctx.env);
  if (!ids) {
    return errorResult(
      new NotInHerdr({
        message: "HERDR_ENV=1 but Herdr pane ids are missing from the environment.",
      }),
    );
  }
  return ids;
}
export function errorResult(error: HerdrMcpError): ToolResult {
  const structured = encodeError(error);
  return {
    isError: true,
    content: [{ type: "text", text: error.message }],
    structuredContent: structured,
  };
}

export function successResult(data: Record<string, unknown>): ToolResult {
  const text = JSON.stringify(data);
  return {
    content: [{ type: "text", text }],
    structuredContent: data,
  };
}

export async function fetchWorkspaceData(
  ctx: ServerContext,
  workspaceId: string,
): Promise<{ tabs: HerdrTab[]; panes: HerdrPane[] } | ToolResult> {
  const tabStdout = await ctx.herdr.tabList(workspaceId);
  const paneStdout = await ctx.herdr.paneList(workspaceId);

  const tabParsed = parseStrictJson(tabStdout);
  if (!tabParsed.ok) return errorResult(tabParsed.error);
  const paneParsed = parseStrictJson(paneStdout);
  if (!paneParsed.ok) return errorResult(paneParsed.error);

  const tabs = filterWorkspaceTabs(parseTabList(tabStdout), workspaceId);
  const panes = filterWorkspacePanes(parsePaneList(paneStdout), workspaceId);
  return { tabs, panes };
}

export function findRole(workflow: LoadedWorkflow, roleId: string): Role | undefined {
  return workflow.roles.find((r) => r.id === roleId);
}

export function findEdge(workflow: LoadedWorkflow, edgeId: string): Edge | undefined {
  return workflow.edges.find((e) => e.id === edgeId);
}

export function effectiveEdgePair(edge: Edge): EdgePairMode {
  return edge.pair ?? "suffix";
}

export function resolvePeerPane(
  workflow: LoadedWorkflow,
  caller: RoleMatch,
  toRoleId: string,
  tabs: HerdrTab[],
  panes: HerdrPane[],
  pair: EdgePairMode = "suffix",
): HerdrPane | UnknownTarget | AmbiguousTarget {
  const toRole = findRole(workflow, toRoleId);
  if (!toRole) {
    return new UnknownTarget({
      message: `Unknown role ${toRoleId}`,
      target: toRoleId,
    });
  }
  const labels = findTabLabelsForPair(tabs, toRole, pair, caller.suffix);
  if (labels.length === 0) {
    return new UnknownTarget({
      message: pair === "unsuffixed"
        ? `No unsuffixed tab found for role ${toRoleId}`
        : `No tab found for role ${toRoleId} with suffix "${caller.suffix}"`,
      target: toRoleId,
    });
  }
  if (labels.length > 1) {
    const paneIds: string[] = [];
    for (const label of labels) {
      const tab = tabs.find((t) => t.label === label);
      if (!tab) continue;
      for (const pane of panes.filter((p) => p.tab_id === tab.tab_id)) {
        paneIds.push(pane.pane_id);
      }
    }
    return new AmbiguousTarget({
      message: pair === "unsuffixed"
        ? `Multiple unsuffixed tabs found for role ${toRoleId}; provide pane_id`
        : `Multiple tabs found for role ${toRoleId} with suffix "${caller.suffix}"; provide pane_id`,
      tab_label: labels[0]!,
      pane_ids: paneIds,
    });
  }
  const label = labels[0]!;
  const tab = tabs.find((t) => t.label === label);
  if (!tab) {
    return new UnknownTarget({
      message: `Tab for role ${toRoleId} not found`,
      target: toRoleId,
    });
  }
  const tabPanes = panes.filter((p) => p.tab_id === tab.tab_id);
  if (tabPanes.length === 0) {
    return new UnknownTarget({
      message: `No pane found for tab ${tab.tab_id}`,
      target: tab.tab_id,
    });
  }
  if (tabPanes.length > 1) {
    return new AmbiguousTarget({
      message: `Tab ${label} has ${tabPanes.length} panes; provide pane_id`,
      tab_label: label,
      pane_ids: tabPanes.map((p) => p.pane_id),
    });
  }
  return tabPanes[0]!;
}

export function resolveByTabLabel(
  tabLabel: string,
  workspaceId: string,
  tabs: HerdrTab[],
  panes: HerdrPane[],
): HerdrPane | UnknownTarget | AmbiguousTarget {
  const tab = tabs.find((t) => t.workspace_id === workspaceId && t.label === tabLabel);
  if (!tab) {
    return new UnknownTarget({
      message: `No tab with label ${tabLabel} in workspace ${workspaceId}`,
      target: tabLabel,
    });
  }
  const tabPanes = panes.filter((p) => p.tab_id === tab.tab_id);
  if (tabPanes.length === 0) {
    return new UnknownTarget({
      message: `No panes found for tab ${tabLabel}`,
      target: tabLabel,
    });
  }
  if (tabPanes.length > 1) {
    return new AmbiguousTarget({
      message: `Tab ${tabLabel} has ${tabPanes.length} panes; provide pane_id`,
      tab_label: tabLabel,
      pane_ids: tabPanes.map((p) => p.pane_id),
    });
  }
  return tabPanes[0]!;
}

export type PaneTargetInput = {
  pane_id?: string;
  tab_label?: string;
};

export function resolvePaneTarget(
  input: PaneTargetInput,
  workspaceId: string,
  tabs: HerdrTab[],
  panes: HerdrPane[],
): HerdrPane | UnknownTarget | AmbiguousTarget {
  const hasPaneId = input.pane_id !== undefined && input.pane_id !== "";
  const hasTabLabel = input.tab_label !== undefined && input.tab_label !== "";
  if (hasPaneId === hasTabLabel) {
    return new UnknownTarget({
      message: "Provide exactly one of pane_id or tab_label",
    });
  }
  if (hasPaneId) {
    return resolveByPaneId(input.pane_id!, workspaceId, panes);
  }
  return resolveByTabLabel(input.tab_label!, workspaceId, tabs, panes);
}

export function resolveByPaneId(
  paneId: string,
  workspaceId: string,
  panes: HerdrPane[],
): HerdrPane | UnknownTarget {
  if (isBareAgentKind(paneId)) {
    return new UnknownTarget({
      message: "Cannot target a bare agent kind",
      target: paneId,
    });
  }
  if (!isInWorkspace(paneId, workspaceId)) {
    return new UnknownTarget({
      message: `Pane ${paneId} is not in workspace ${workspaceId}`,
      target: paneId,
    });
  }
  const pane = panes.find((p) => p.pane_id === paneId);
  if (!pane) {
    return new UnknownTarget({
      message: `Pane ${paneId} not found in workspace`,
      target: paneId,
    });
  }
  return pane;
}

export type ResolveInput = {
  edge?: string;
  role?: string;
  pane_id?: string;
};

export function resolveTarget(
  workflow: LoadedWorkflow,
  caller: RoleMatch,
  tabs: HerdrTab[],
  panes: HerdrPane[],
  workspaceId: string,
  input: ResolveInput,
): HerdrPane | UnknownTarget | UnknownEdge | AmbiguousTarget {
  if (input.pane_id) {
    return resolveByPaneId(input.pane_id, workspaceId, panes);
  }
  if (input.edge) {
    const edge = findEdge(workflow, input.edge);
    if (!edge) {
      return new UnknownEdge({
        message: `Unknown edge ${input.edge}`,
        edge: input.edge,
      });
    }
    return resolvePeerPane(
      workflow,
      caller,
      edge.to,
      tabs,
      panes,
      effectiveEdgePair(edge),
    );
  }
  if (input.role) {
    const outbound = workflow.edges.filter(
      (edge) => edge.from === caller.role_id && edge.to === input.role,
    );
    const pair = outbound.length === 1 ? effectiveEdgePair(outbound[0]!) : "suffix";
    return resolvePeerPane(workflow, caller, input.role, tabs, panes, pair);
  }
  return new UnknownTarget({
    message: "Provide edge, role, or pane_id",
  });
}

export function assertEdgeRole(caller: RoleMatch, edge: Edge): WrongRole | undefined {
  if (caller.role_id !== edge.from) {
    return new WrongRole({
      message: `Edge ${edge.id} requires role ${edge.from}, caller is ${caller.role_id}`,
      expected_role: edge.from,
      actual_role: caller.role_id,
    });
  }
}

export async function readStatus(
  ctx: ServerContext,
  target: string,
): Promise<StatusSnapshot | ToolResult> {
  const agentStdout = await ctx.herdr.agentGet(target);
  const agentParsed = parseStrictJson(agentStdout);
  if (agentParsed.ok) {
    const snap = snapshotFromHerdrResult(agentParsed.value);
    if (snap) return snap;
  }
  const paneStdout = await ctx.herdr.paneGet(target);
  const paneParsed = parseStrictJson(paneStdout);
  if (!paneParsed.ok) return errorResult(paneParsed.error);
  const snap = snapshotFromHerdrResult(paneParsed.value);
  if (!snap) {
    return errorResult(new ParseFailed({
      message: "Could not parse agent status",
      stdout: paneStdout.slice(0, 200),
    }));
  }
  return snap;
}

export function checkBusyPeer(
  status: AgentStatus,
  paneId: string,
  allowInterrupt: boolean,
): BusyPeer | undefined {
  if (allowInterrupt) return undefined;
  if (status === "working" || status === "blocked") {
    return new BusyPeer({
      message: `Peer ${paneId} is ${status}`,
      pane_id: paneId,
      agent_status: status,
    });
  }
}

export function promptTarget(pane: HerdrPane): string {
  return pane.name ?? pane.pane_id;
}

export async function submitHandoff(
  ctx: ServerContext,
  pane: HerdrPane,
  message: string,
  allowInterrupt: boolean,
): Promise<ToolResult> {
  const target = promptTarget(pane);
  const statusTarget = pane.pane_id;
  if (isBareAgentKind(target)) {
    return errorResult(new UnknownTarget({
      message: "Cannot target a bare agent kind",
      target,
    }));
  }

  const before = await readStatus(ctx, statusTarget);
  if (isToolResult(before)) return before;
  const beforeSnap = before;

  const busy = checkBusyPeer(beforeSnap.agent_status, pane.pane_id, allowInterrupt);
  if (busy) return errorResult(busy);

  const promptRun = await ctx.herdr.agentPrompt(target, message);
  const parsed = parsePromptOutput(promptRun.stdout, promptRun.exitCode);
  if (parsed.kind === "error") return errorResult(parsed.error);

  const accepted = parsed.kind === "accepted" ||
    (parsed.kind === "json" && extractHerdrCliError(parsed.value) === undefined);
  if (!accepted) {
    return errorResult(new ParseFailed({
      message: "herdr agent prompt was not accepted",
      stdout: promptRun.stdout.slice(0, 500),
    }));
  }

  const after = await readStatus(ctx, statusTarget);
  if (isToolResult(after)) {
    return errorResult(new ConfirmationError({
      message: "Submit succeeded but confirmation get failed",
      pane_id: pane.pane_id,
      detail: after.content[0]?.text,
    }));
  }
  const afterSnap = after;

  return successResult({
    pane_id: pane.pane_id,
    target,
    accepted,
    state_changed: stateChanged(beforeSnap, afterSnap),
    revision_before: beforeSnap.revision,
    revision_after: afterSnap.revision,
    state_change_seq_before: beforeSnap.state_change_seq,
    state_change_seq_after: afterSnap.state_change_seq,
    final_status: afterSnap.agent_status,
    raw_stdout: promptRun.stdout.slice(0, 500),
  });
}

export async function getCallerContext(
  ctx: ServerContext,
  ids: HerdrEnvIds,
  workflow: LoadedWorkflow,
): Promise<
  { caller: RoleMatch; tabLabel: string; tabs: HerdrTab[]; panes: HerdrPane[] } | ToolResult
> {
  const data = await fetchWorkspaceData(ctx, ids.workspace_id);
  if (isToolResult(data)) return data;
  const tab = data.tabs.find((t) => t.tab_id === ids.tab_id);
  const tabLabel = tab?.label ?? "unknown";
  const caller = detectRole(tabLabel, workflow.roles);
  return { caller, tabLabel, tabs: data.tabs, panes: data.panes };
}

export function buildWhoamiEdges(
  workflow: LoadedWorkflow,
  caller: RoleMatch,
  tabs: HerdrTab[],
  panes: HerdrPane[],
) {
  return workflow.edges
    .filter((edge) => edge.from === caller.role_id)
    .map((edge) => {
      const peer = resolvePeerPane(
        workflow,
        caller,
        edge.to,
        tabs,
        panes,
        effectiveEdgePair(edge),
      );
      const paired_pane_id = peer instanceof UnknownTarget || peer instanceof AmbiguousTarget
        ? undefined
        : peer.pane_id;
      return {
        id: edge.id,
        to: edge.to,
        ...(edge.round !== undefined ? { round: edge.round } : {}),
        paired_pane_id,
      };
    });
}
