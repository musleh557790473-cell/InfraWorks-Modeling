import { getTwoLeggedToken, getViewerToken, isApsConfigured } from "./auth.js";
import { APS_BASE, VIEWER_SCRIPT, VIEWER_STYLE, type ApsConfig, type ModelDerivativePreview } from "./types.js";

async function mdFetch(config: ApsConfig, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getTwoLeggedToken(config);
  const base = config.baseUrl ?? APS_BASE;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token.access_token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${base}${path}`, { ...init, headers });
}

/** Start SVF2 translation (aps-simple-viewer translateObject pattern). */
export async function translateObject(
  config: ApsConfig,
  urn: string,
  rootFilename?: string,
): Promise<{ result: string; urn: string; mocked: boolean }> {
  if (!isApsConfigured(config)) {
    return { result: "success", urn, mocked: true };
  }

  const body = {
    input: {
      urn,
      ...(rootFilename
        ? { compressedUrn: true, rootFilename }
        : {}),
    },
    output: {
      formats: [
        {
          type: "svf2",
          views: ["2d", "3d"],
        },
      ],
    },
  };

  const res = await mdFetch(config, "/modelderivative/v2/designdata/job", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      "x-ads-force": "true",
    },
  });

  if (!res.ok && res.status !== 409) {
    throw new Error(`MD translate failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json().catch(() => ({}))) as { result?: string };
  return { result: json.result || "success", urn, mocked: false };
}

export async function getManifest(
  config: ApsConfig,
  urn: string,
): Promise<{ status: string; progress?: string; mocked: boolean } | null> {
  if (!isApsConfigured(config)) {
    return { status: "success", progress: "complete", mocked: true };
  }

  const res = await mdFetch(
    config,
    `/modelderivative/v2/designdata/${encodeURIComponent(urn)}/manifest`,
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`MD manifest failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { status: string; progress?: string };
  return { status: json.status, progress: json.progress, mocked: false };
}

/**
 * Upload already done — translate + poll status into a Viewer-ready preview payload.
 */
export async function buildPreviewFromUrn(
  config: ApsConfig,
  urn: string,
  meta: { objectKey?: string; bucketKey?: string; objectId?: string } = {},
): Promise<ModelDerivativePreview> {
  if (!isApsConfigured(config)) {
    return {
      status: "mocked",
      urn,
      objectId: meta.objectId,
      objectKey: meta.objectKey,
      bucketKey: meta.bucketKey,
      viewerScriptUrl: VIEWER_SCRIPT,
      viewerStyleUrl: VIEWER_STYLE,
      accessToken: "local-mock-token",
      progress: "complete",
      message:
        "APS_CLIENT_ID / APS_CLIENT_SECRET missing — Model Derivative preview is mocked (local URN)",
      mocked: true,
    };
  }

  await translateObject(config, urn);
  const manifest = await getManifest(config, urn);
  const viewerToken = await getViewerToken(config);

  if (!manifest) {
    return {
      status: "pending",
      urn,
      ...meta,
      accessToken: viewerToken.access_token,
      viewerScriptUrl: VIEWER_SCRIPT,
      viewerStyleUrl: VIEWER_STYLE,
      message: "Translation submitted; manifest not ready yet",
      mocked: false,
    };
  }

  const status =
    manifest.status === "success"
      ? "ready"
      : manifest.status === "failed"
        ? "failed"
        : "pending";

  return {
    status,
    urn,
    objectId: meta.objectId,
    objectKey: meta.objectKey,
    bucketKey: meta.bucketKey,
    accessToken: viewerToken.access_token,
    viewerScriptUrl: VIEWER_SCRIPT,
    viewerStyleUrl: VIEWER_STYLE,
    progress: manifest.progress,
    message:
      status === "ready"
        ? "Model Derivative viewables ready"
        : status === "failed"
          ? "Model Derivative translation failed"
          : `Translation ${manifest.status} (${manifest.progress ?? "…" })`,
    mocked: false,
  };
}
