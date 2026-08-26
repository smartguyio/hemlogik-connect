const LEVELS = ["debug", "info", "warning", "error"] as const;
type Level = (typeof LEVELS)[number];

const configured = (process.env.LOG_LEVEL ?? "info").toLowerCase() as Level;
const threshold = LEVELS.includes(configured) ? LEVELS.indexOf(configured) : LEVELS.indexOf("info");

/** Plain console logging, level-gated by the App's `log_level` option - s6 captures stdout/stderr into the App's log viewer in Home Assistant, so nothing fancier is needed here. */
function log(level: Level, message: string, ...rest: unknown[]) {
  if (LEVELS.indexOf(level) < threshold) return;
  const line = `[hemlogik-connect] [${level}] ${message}`;
  if (level === "error") console.error(line, ...rest);
  else if (level === "warning") console.warn(line, ...rest);
  else console.log(line, ...rest);
}

export const logger = {
  debug: (message: string, ...rest: unknown[]) => log("debug", message, ...rest),
  info: (message: string, ...rest: unknown[]) => log("info", message, ...rest),
  warning: (message: string, ...rest: unknown[]) => log("warning", message, ...rest),
  error: (message: string, ...rest: unknown[]) => log("error", message, ...rest),
};
