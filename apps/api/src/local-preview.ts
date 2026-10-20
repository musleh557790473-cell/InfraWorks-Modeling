import { isAbsolute, resolve } from "node:path";
import { existsSync } from "node:fs";
import {
  parseCadInput,
  toGeoJson,
  resolveCrs,
  type ProjectProfile,
  ParseError,
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
 * Local free preview: parse CAD — never calls APS, never synthesizes.
 */
export function buildLocalPreview(opts: {
  cad: UploadedFile;
  profile: ProjectProfile;
  epsg: number;
}) {
  const filePath = resolveUploadPath(opts.cad.path);
  try {
    const parsed = parseCadInput(filePath, opts.cad.filename, opts.profile);
    const crs = resolveCrs(opts.epsg > 0 ? opts.epsg : opts.profile.crs.epsg);
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
      parseMeta: parsed.parseMeta,
      crs,
      geojson,
      message: `Local free preview (${parsed.format} via ${parsed.parseMeta.parserPath}) — FREE · no APS`,
    };
  } catch (err) {
    if (err instanceof ParseError) {
      return {
        status: "failed" as const,
        previewMode: "local" as const,
        mocked: false,
        apsCalled: false,
        error: err.message,
        code: err.code,
        details: err.details,
      };
    }
    throw err;
  }
}
