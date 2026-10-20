"use client";

import { useEffect, useRef, useState } from "react";

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

/**
 * DWG preview: mock URN panel locally; Autodesk Viewer when live MD URN + token.
 */
export function DwgPreview({ preview, apiBase }: { preview: PreviewPayload | null; apiBase: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [viewerError, setViewerError] = useState<string>("");

  useEffect(() => {
    if (!preview?.urn) return;
    setViewerError("");

    // Mock path: no real Viewer session — show URN status panel only.
    if (preview.mocked || preview.status === "mocked") {
      return;
    }

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

        const tokenRes = await fetch(`${apiBase}/aps/token`);
        const tokenJson = (await tokenRes.json()) as {
          access_token: string;
          expires_in: number;
          mocked?: boolean;
        };
        if (tokenJson.mocked) {
          setViewerError("Viewer token is mocked — set APS credentials for live Viewer");
          return;
        }

        window.Autodesk.Viewing.Initializer(
          {
            env: "AutodeskProduction2",
            getAccessToken: (cb) => {
              cb(tokenJson.access_token, tokenJson.expires_in || 3600);
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
  }, [preview, apiBase]);

  if (!preview) return null;

  const isMock = Boolean(preview.mocked || preview.status === "mocked");

  return (
    <div className="preview-wrap">
      <div className="preview-meta">
        <span className={isMock ? "pill mock" : "pill live"}>
          {isMock ? "mock URN" : "live MD"}
        </span>
        <span className="status">{preview.status}</span>
        {preview.progress && <span className="status">· {preview.progress}</span>}
        <p className="status">{preview.message}</p>
        {preview.urn && (
          <code className="urn">{preview.urn}</code>
        )}
        {viewerError && <p className="status err">{viewerError}</p>}
      </div>
      {!isMock && (preview.status === "ready" || preview.status === "pending") && (
        <div ref={hostRef} className="viewer-host" />
      )}
      {isMock && (
        <div className="viewer-host mock-host">
          <p>Local mock preview</p>
          <p>Viewer loads Autodesk SVF2 when APS credentials + MD translation succeed.</p>
        </div>
      )}
    </div>
  );
}
