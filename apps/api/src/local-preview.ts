import { isAbsolute, resolve } from "node:path";
import { existsSync } from "node:fs";
import {
  parseCadInput,
  toGeoJson,
  resolveCrs,
  type MappingProfile,
} from "@infraworks/domain";
import type { UploadedFile } from "@infraworks/domain";

function resolveUploadPath(path: string): string {
  if (isAbsolute(path) && existsSync(path)) return path;
  const candidates = [
    resolve(process.cwd(), path),
    resolve(process.cwd(), "../../", path),
    resolve(process.cwd(), "../", path),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return resolve(process.cwd(), path);
}

/**
 * Local free preview: parse CAD with domain DXF/stub — never calls APS.
 * Returns GeoJSON layers for 2D SVG/canvas map in the web UI.
 */
export function buildLocalPreview(opts: {
  cad: UploadedFile;
  profile: MappingProfile;
  epsg: number;
}) {
  const filePath = resolveUploadPath(opts.cad.path);
  const parsed = parseCadInput(filePath, opts.cad.filename, opts.profile);
  const crs = resolveCrs(opts.epsg);
  const geojson = toGeoJson(parsed.features);

  return {
    status: "ready" as const,
    previewMode: "local" as const,
    mocked: false,
    apsCalled: false,
    format: parsed.format,
    layers: parsed.layers,
    featureCount: parsed.features.length,
    notes: parsed.notes,
    crs,
    geojson,
    message:
      parsed.format === "dwg-stub"
        ? "Local free preview (DWG stub geometry) — FREE · no APS"
        : "Local free preview (DXF/local parse) — FREE · no APS",
  };
}
