/** In-process review round counter keyed by workspace + caller + target + edge. */
const counters = new Map<string, number>();

function counterKey(
  workspaceId: string,
  callerPaneId: string,
  targetPaneId: string,
  edgeId: string,
): string {
  return `${workspaceId}:${callerPaneId}:${targetPaneId}:${edgeId}`;
}

/** Peek the next submit round without mutating the counter. */
export function peekSubmitRound(
  workspaceId: string,
  callerPaneId: string,
  targetPaneId: string,
  edgeId: string,
  reset: boolean,
): number {
  const key = counterKey(workspaceId, callerPaneId, targetPaneId, edgeId);
  if (reset) return 1;
  return (counters.get(key) ?? 0) + 1;
}

/** Commit a round after a prompt was successfully sent. */
export function commitSubmitRound(
  workspaceId: string,
  callerPaneId: string,
  targetPaneId: string,
  edgeId: string,
  round: number,
): void {
  counters.set(counterKey(workspaceId, callerPaneId, targetPaneId, edgeId), round);
}

/** Test-only: clear all in-process round state. */
export function resetAllRoundCounters(): void {
  counters.clear();
}
