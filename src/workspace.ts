/** Workspace-scoped id checks per #4. */

export function isInWorkspace(id: string, workspaceId: string): boolean {
  return id.startsWith(`${workspaceId}:`);
}

export function filterWorkspaceTabs<T extends { tab_id: string; workspace_id?: string }>(
  tabs: T[],
  workspaceId: string,
): T[] {
  return tabs.filter(
    (tab) =>
      tab.workspace_id === workspaceId &&
      isInWorkspace(tab.tab_id, workspaceId),
  );
}

export function filterWorkspacePanes<T extends { pane_id: string; workspace_id?: string }>(
  panes: T[],
  workspaceId: string,
): T[] {
  return panes.filter(
    (pane) =>
      pane.workspace_id === workspaceId &&
      isInWorkspace(pane.pane_id, workspaceId),
  );
}
