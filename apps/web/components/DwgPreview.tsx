"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type PreviewGeoJson = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id?: string | number;
    geometry: {
      type: string;
      coordinates: unknown;
    };
    properties?: Record<string, unknown>;
  }>;
};

export type PreviewPayload = {
  status: string;
  urn?: string;
  accessToken?: string;
  viewerScriptUrl?: string;
  viewerStyleUrl?: string;
  message?: string;
  mocked?: boolean;
  progress?: string;
  objectKey?: string;
  previewMode?: "local" | "aps";
  geojson?: PreviewGeoJson;
  featureCount?: number;
  layers?: Array<{ name: string; entityCount: number }>;
  format?: string;
  apsCalled?: boolean;
  error?: string;
};

declare global {
  interface Window {
    Autodesk?: {
      Viewing: {
        Initializer: (
          opts: { env: string; getAccessToken: (cb: (token: string, expires: number) => void) => void },
          cb: () => void,
        ) => void;
        GuiViewer3D: new (el: HTMLElement) => {
          start: () => void;
          loadDocumentNode: (doc: unknown, node: unknown) => Promise<unknown>;
          finish?: () => void;
        };
        Document: {
          load: (
            urn: string,
            onSuccess: (doc: { getRoot: () => { getDefaultGeometry: () => unknown } }) => void,
            onError: (code: number, msg: string) => void,
          ) => void;
        };
      };
    };
  }
}

const CLASS_COLORS: Record<string, string> = {
  road_centerline: "#c4a35a",
  coverage: "#3d8f6e",
  water: "#5b8def",
  parcel: "#9bb5a8",
  annotation: "#e07a5f",
  unmapped: "#889988",
};

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

function loadCss(href: string): void {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function collectCoords(geom: { type: string; coordinates: unknown }): number[][] {
  const out: number[][] = [];
  const walk = (c: unknown, depth: number) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      out.push([c[0] as number, c[1] as number]);
      return;
    }
    for (const item of c) walk(item, depth + 1);
  };
  walk(geom.coordinates, 0);
  return out;
}

function LocalMapPreview({ geojson }: { geojson: PreviewGeoJson }) {
  const paths = useMemo(() => {
    const all: Array<{ d: string; color: string; cls: string; fill?: string }> = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const feats = geojson.features || [];
    for (const f of feats) {
      for (const [x, y] of collectCoords(f.geometry)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (!Number.isFinite(minX)) {
      return { paths: all, viewBox: "0 0 100 100" };
    }
    const pad = 0.08;
    const w = Math.max(maxX - minX, 1e-6);
    const h = Math.max(maxY - minY, 1e-6);
    const sx = 1000 / w;
    const sy = 1000 / h;
    const s = Math.min(sx, sy) * (1 - pad * 2);
    const ox = (1000 - w * s) / 2;
    const oy = (1000 - h * s) / 2;
    const tx = (x: number, y: number) => {
      const px = ox + (x - minX) * s;
      const py = 1000 - (oy + (y - minY) * s);
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    };

    const circles: Array<{ cx: string; cy: string; color: string }> = [];
    for (const f of feats) {
      const cls = String(f.properties?.infraFeatureClass || "unmapped");
      const color = CLASS_COLORS[cls] || CLASS_COLORS.unmapped;
      const coords = collectCoords(f.geometry);
      if (coords.length === 0) continue;
      if (coords.length === 1 || f.geometry.type === "Point") {
        const [x, y] = coords[0];
        const [cx, cy] = tx(x, y).split(",");
        circles.push({ cx, cy, color });
        continue;
      }
      const closed = f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon";
      let d = coords.map((c, i) => `${i === 0 ? "M" : "L"}${tx(c[0], c[1])}`).join(" ");
      if (closed) d += " Z";
      all.push({ d, color, cls, fill: closed ? `${color}33` : "none" });
    }
    return { paths: all, circles, viewBox: "0 0 1000 1000" };
  }, [geojson]);

  return (
    <div className="viewer-host local-map-host" data-testid="local-map-preview">
      <svg viewBox={paths.viewBox} className="local-map-svg" role="img" aria-label="Local layer map">
        <rect width="1000" height="1000" fill="rgba(0,0,0,0.25)" />
        {paths.paths.map((p, i) => (
          <path
            key={i}
            d={p.d}
            fill={p.fill || "none"}
            stroke={p.color}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {paths.circles.map((c, i) => (
          <circle key={`c${i}`} cx={c.cx} cy={c.cy} r="8" fill={c.color} />
        ))}
      </svg>
      <div className="local-map-legend">
        {Object.entries(CLASS_COLORS)
          .filter(([k]) => k !== "unmapped")
          .map(([k, c]) => (
            <span key={k}>
              <i style={{ background: c }} /> {k}
            </span>
          ))}
      </div>
    </div>
  );
}

/**
 * Preview: local GeoJSON/SVG map (free) or Autodesk Viewer when APS live.
 */
export function DwgPreview({ preview, apiBase }: { preview: PreviewPayload | null; apiBase: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [viewerError, setViewerError] = useState<string>("");

  const isLocal = preview?.previewMode === "local" || Boolean(preview?.geojson);

  useEffect(() => {
    if (!preview?.urn || isLocal) return;
    setViewerError("");

    if (preview.status !== "ready" && preview.status !== "pending") {
      return;
    }

    let cancelled = false;
    let viewer: { finish?: () => void } | null = null;

    async function boot() {
      try {
        if (preview!.viewerStyleUrl) loadCss(preview!.viewerStyleUrl);
        if (preview!.viewerScriptUrl) await loadScript(preview!.viewerScriptUrl);
        if (cancelled || !hostRef.current || !window.Autodesk) return;

        const tokenRes = await fetch(`${apiBase}/aps/token?previewMode=aps`);
        const tokenJson = (await tokenRes.json()) as {
          access_token?: string;
          expires_in?: number;
          mocked?: boolean;
          error?: string;
        };
        if (!tokenRes.ok || !tokenJson.access_token) {
          setViewerError(tokenJson.error || "APS token failed");
          return;
        }

        window.Autodesk.Viewing.Initializer(
          {
            env: "AutodeskProduction2",
            getAccessToken: (cb) => {
              cb(tokenJson.access_token!, tokenJson.expires_in || 3600);
            },
          },
          () => {
            if (cancelled || !hostRef.current || !window.Autodesk) return;
            const v = new window.Autodesk.Viewing.GuiViewer3D(hostRef.current);
            v.start();
            viewer = v;
            const docId = preview!.urn!.startsWith("urn:")
              ? preview!.urn!
              : `urn:${preview!.urn!}`;
            window.Autodesk.Viewing.Document.load(
              docId,
              async (doc) => {
                const defaultModel = doc.getRoot().getDefaultGeometry();
                await v.loadDocumentNode(doc, defaultModel);
              },
              (code, msg) => setViewerError(`Document load failed (${code}): ${msg}`),
            );
          },
        );
      } catch (e) {
        setViewerError(e instanceof Error ? e.message : String(e));
      }
    }

    void boot();
    return () => {
      cancelled = true;
      viewer?.finish?.();
    };
  }, [preview, apiBase, isLocal]);

  if (!preview) return null;

  return (
    <div className="preview-wrap">
      <div className="preview-meta">
        <span className={isLocal ? "pill free" : "pill live"}>
          {isLocal ? "FREE · local" : "APS · live"}
        </span>
        <span className="status">{preview.status}</span>
        {preview.progress && <span className="status">· {preview.progress}</span>}
        {typeof preview.featureCount === "number" && (
          <span className="status">· {preview.featureCount} features</span>
        )}
        <p className="status">{preview.message}</p>
        {preview.urn && <code className="urn">{preview.urn}</code>}
        {viewerError && <p className="status err">{viewerError}</p>}
        {preview.error && <p className="status err">{preview.error}</p>}
      </div>
      {isLocal && preview.geojson ? (
        <LocalMapPreview geojson={preview.geojson} />
      ) : !isLocal && (preview.status === "ready" || preview.status === "pending") ? (
        <div ref={hostRef} className="viewer-host" />
      ) : null}
    </div>
  );
}
