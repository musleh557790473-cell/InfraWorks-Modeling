/** Preview / APS product mode: local free (no APS) vs APS live. */

export type PreviewMode = "local" | "aps";
export type ApsModeReport = "off" | "mock" | "live";
export type ApsModeEnv = "local" | "auto" | "live";

export function readApsModeEnv(
  env: NodeJS.ProcessEnv = process.env,
): ApsModeEnv {
  const raw = (env.APS_MODE || "local").trim().toLowerCase();
  if (raw === "live" || raw === "aps") return "live";
  if (raw === "auto") return "auto";
  return "local";
}

/** Server default preview mode. Free use defaults to local. */
export function defaultPreviewMode(
  env: NodeJS.ProcessEnv = process.env,
): PreviewMode {
  return readApsModeEnv(env) === "live" ? "aps" : "local";
}

/**
 * Resolve per-request preview mode.
 * Precedence: query `previewMode` → header `X-Preview-Mode` → body.previewMode → env default.
 */
export function resolvePreviewMode(opts: {
  query?: string | null;
  header?: string | null;
  body?: string | null;
  env?: NodeJS.ProcessEnv;
}): PreviewMode {
  const pick = opts.query ?? opts.header ?? opts.body;
  if (pick) {
    const v = pick.trim().toLowerCase();
    if (v === "local" || v === "free" || v === "off") return "local";
    if (v === "aps" || v === "live") return "aps";
  }
  return defaultPreviewMode(opts.env);
}

/** Health badge: off when local-default / no creds; live when credentials present; mock only for auto+empty. */
export function reportApsMode(
  apsConfigured: boolean,
  env: NodeJS.ProcessEnv = process.env,
): ApsModeReport {
  const mode = readApsModeEnv(env);
  if (mode === "local") return "off";
  if (apsConfigured) return "live";
  if (mode === "auto") return "mock";
  return "off";
}
