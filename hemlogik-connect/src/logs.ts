import type { LogEntry, LogLevel } from "@hemlogik/connect-protocol";
import { LOG_LEVELS } from "@hemlogik/connect-protocol";
import type { HaSystemLogEntry, SupervisorCoreSocket } from "./supervisor-client";

/**
 * Straight port of integrations/home-assistant/logs.server.ts's toLogEntry() in the main portal
 * repo - same mapping, kept in sync by hand since ha-app is a separate Node package that can't
 * import portal server code. Level lowercased (defaulting to "info" for anything unrecognized),
 * HA's array-or-string message joined, an exception appended, a repeat count folded into a
 * "(xN) " prefix.
 */
const KNOWN_LEVELS = new Set<string>(LOG_LEVELS);

function toLogEntry(entry: HaSystemLogEntry): LogEntry {
  const lowerLevel = (entry.level ?? "info").toLowerCase();
  const level: LogLevel = KNOWN_LEVELS.has(lowerLevel) ? (lowerLevel as LogLevel) : "info";
  const messageText = Array.isArray(entry.message) ? entry.message.join("\n") : entry.message;
  const withException = entry.exception ? `${messageText}\n${entry.exception}` : messageText;
  const countPrefix = entry.count && entry.count > 1 ? `(×${entry.count}) ` : "";

  return {
    timestamp: new Date(entry.timestamp * 1000).toISOString(),
    level,
    logger: entry.name,
    message: countPrefix + withException,
  };
}

/**
 * HA's system_log/list is a bounded, in-memory rolling buffer, not an incremental/since-last-call
 * feed - a burst of entries between two fetches can age older ones out of HA's own buffer before
 * this ever captures them. Known, permanent limitation (documented in the architecture doc),
 * mitigated but not eliminated by pushing this on a cadence (see index.ts's periodic resync)
 * rather than only ever fetching on demand.
 */
export async function listLogs(socket: SupervisorCoreSocket): Promise<LogEntry[]> {
  const raw = await socket.listRawSystemLog();
  return [...raw].sort((a, b) => b.timestamp - a.timestamp).map(toLogEntry);
}
