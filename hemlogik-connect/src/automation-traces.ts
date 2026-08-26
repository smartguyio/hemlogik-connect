import type { AutomationTraceSummary } from "@hemlogik/connect-protocol";
import type { SupervisorCoreSocket } from "./supervisor-client";

/**
 * A straight port of the main portal repo's
 * integrations/home-assistant/automation-traces.server.ts (toOutcome + the mapping/sort/cap
 * logic) - can't import that portal-server code from this separate ha-app package, so the same
 * mapping is reimplemented here against the same undocumented-ish HA WS shape. Keep the two in
 * sync by hand if HA's trace/list response shape ever changes.
 */
interface RawTraceListItem {
  run_id?: string;
  timestamp?: { start?: string; finish?: string };
  state?: string;
  script_execution?: string;
  error?: string;
}

function toOutcome(item: RawTraceListItem): AutomationTraceSummary["outcome"] {
  if (item.state === "running") return "running";
  if (item.script_execution === "success") return "success";
  if (item.script_execution) return "error";
  return "unknown";
}

/** Most recent trace runs for one automation, newest first, capped at 20. */
export async function listAutomationTraces(socket: SupervisorCoreSocket, configId: string): Promise<AutomationTraceSummary[]> {
  const raw = await socket.listAutomationTraces(configId);
  if (!Array.isArray(raw)) return [];

  return (raw as RawTraceListItem[])
    .filter((item): item is RawTraceListItem & { run_id: string } => typeof item.run_id === "string")
    .map((item) => ({
      runId: item.run_id,
      timestamp: item.timestamp?.start ?? null,
      outcome: toOutcome(item),
      error: typeof item.error === "string" ? item.error : undefined,
    }))
    .sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""))
    .slice(0, 20);
}
