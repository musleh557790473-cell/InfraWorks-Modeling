import { basename } from "node:path";

import { openImx, readRegions } from "@infraworks/imx-gate";

import { dataSources, importedStats, modelRegions, modelWkt, openModel, readPackage, schemaVersion } from "./read.js";
import type { DataSourceRow, ModelHandle } from "./read.js";
import { EXPECTED_TABLE } from "./types.js";
import type { LayerComparison, ModelFinding, ModelGateOptions, ModelGateReport, PackageInfo, RegionComparison } from "./types.js";

const ORDER: Record<ModelFinding["severity"], number> = { blocking: 0, warning: 1, info: 2 };

function f(ruleId: string, rule: string, severity: ModelFinding["severity"], message: string, context?: Record<string, string>): ModelFinding {
  return { ruleId, rule, code: ruleId.replace("-", "_"), severity, message, ...(context ? { context } : {}) };
}

/** UTM zone and hemisphere described by a WKT, or null when it is not a Transverse Mercator UTM. */
export function utmFromWkt(wkt: string | null | undefined): { zone: number; south: boolean } | null {
  if (!wkt || !/^\s*PROJCS/i.test(wkt)) return null;
  const cm = /PARAMETER\s*\[\s*"central_meridian"\s*,\s*(-?[\d.]+)/i.exec(wkt);
  if (!cm) return null;
  const zone = Math.round((Number(cm[1]) + 183) / 6);
  const fn = /PARAMETER\s*\[\s*"false_northing"\s*,\s*(-?[\d.]+)/i.exec(wkt);
  if (zone < 1 || zone > 60) return null;
  return { zone, south: fn ? Number(fn[1]) >= 5_000_000 : false };
}

export function utmFromEpsg(epsg: number): { zone: number; south: boolean } | null {
  if (epsg >= 32601 && epsg <= 32660) return { zone: epsg - 32600, south: false };
  if (epsg >= 32701 && epsg <= 32760) return { zone: epsg - 32700, south: true };
  return null;
}

const isGeographic = (cs: string) => /^\s*GEOGCS/i.test(cs) || /^(EPSG:4326|LL84|WGS ?84)$/i.test(cs.trim());

/** File name without its extension: "road_centerline.geojson" -> "road_centerline". */
const stem = (name: string) => name.replace(/\.[^./]+$/, "");

/**
 * The data source that imported a package layer: matched by file name in its connection string.
 * The extension is ignored, so the same layer imported as .geojson, .shp, .sqlite… still matches;
 * the name itself must match exactly ("road_centerline_old.shp" is not "road_centerline").
 */
function findSource(sources: DataSourceRow[], file: string): DataSourceRow | undefined {
  const want = stem(file.toLowerCase());
  return sources
    .filter((s) => {
      const conn = (s.CONNECTION_STRING ?? "").replace(/\\/g, "/").toLowerCase();
      // Connection strings are a plain path, a ";"-separated list, or key="path"; pairs.
      return conn
        .split(/[;="]/)
        .map((part) => part.trim().split("/").pop() ?? "")
        .some((name) => name !== "" && stem(name) === want);
    })
    .at(-1); // the latest re-import wins
}

/**
 * Gate G3 — check an InfraWorks model after import.
 *
 * Imports into InfraWorks fail quietly: a layer read as WGS 84 degrees lands in the ocean,
 * a source left unconfigured imports nothing, a design road stops building at a bad
 * section. This compares the model's own database with what was sent to it.
 */
export function runModelGate(modelPath: string, opts: ModelGateOptions = {}): ModelGateReport {
  const maxOffset = opts.maxOffsetM ?? 1;
  const maxLoss = opts.maxLengthLoss ?? 0.01;
  const h = openModel(modelPath);
  const findings: ModelFinding[] = [];
  const layers: LayerComparison[] = [];
  const regions: RegionComparison[] = [];

  try {
    /* G3-001 structure */
    const missing = ["DATA_SOURCES", "spatial_ref_sys", "ROADS"].filter((t) => !h.tables.has(t));
    if (missing.length) {
      findings.push(f("G3-001", "InfraWorks model structure", "blocking", `Not an InfraWorks model database — missing table(s): ${missing.join(", ")}`));
    }
    const version = schemaVersion(h);
    const crs = modelWkt(h);

    let pkg: PackageInfo | null = null;
    if (opts.packagePath) {
      pkg = readPackage(opts.packagePath);
      checkCrs(findings, crs.wkt, crs.name, pkg.epsg);
      compareLayers(h, pkg, findings, layers, maxOffset, maxLoss);
    }
    if (opts.imxPath) compareRegions(h, opts.imxPath, findings, regions);
    if (!opts.packagePath && !opts.imxPath) {
      findings.push(f("G3-000", "Nothing to compare", "warning", "Give --package and/or --imx so the model can be checked against what was imported."));
    }

    findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.ruleId.localeCompare(b.ruleId));
    const blockingCount = findings.filter((x) => x.severity === "blocking").length;
    return {
      ok: blockingCount === 0,
      model: modelPath,
      package: opts.packagePath ?? null,
      imx: opts.imxPath ?? null,
      schemaVersion: version,
      modelCrs: crs.name,
      blockingCount,
      warningCount: findings.filter((x) => x.severity === "warning").length,
      infoCount: findings.filter((x) => x.severity === "info").length,
      findings,
      layers,
      regions,
      generatedAt: new Date().toISOString(),
    };
  } finally {
    h.db.close();
  }
}

/* G3-002 — model CRS matches the package */
function checkCrs(out: ModelFinding[], wkt: string | null, name: string | null, epsg: number) {
  const want = utmFromEpsg(epsg);
  const got = utmFromWkt(wkt);
  if (!wkt) {
    out.push(f("G3-002", "Model coordinate system", "blocking", "The model declares no coordinate system."));
    return;
  }
  if (want && got && (want.zone !== got.zone || want.south !== got.south)) {
    out.push(
      f(
        "G3-002",
        "Model coordinate system",
        "blocking",
        `The model is in ${name ?? "?"} (UTM ${got.zone}${got.south ? "S" : "N"}) but the package is EPSG:${epsg} ` +
          `(UTM ${want.zone}${want.south ? "S" : "N"}). Create the model in the package's CRS.`,
        { model: name ?? "", package: `EPSG:${epsg}` },
      ),
    );
  }
}

function compareLayers(h: ModelHandle, pkg: PackageInfo, out: ModelFinding[], rows: LayerComparison[], maxOffset: number, maxLoss: number) {
  const sources = dataSources(h);
  const want = utmFromEpsg(pkg.epsg);

  for (const layer of pkg.layers) {
    const expected = EXPECTED_TABLE[layer.infraFeatureClass] ?? [];
    const src = findSource(sources, layer.file);
    const row: LayerComparison = {
      layer: layer.name,
      infraFeatureClass: layer.infraFeatureClass,
      expectedTable: expected.join(" / "),
      dataSource: src
        ? { id: src.GUID, name: src.NAME ?? "", targetTable: src.TARGET_CLASS_NAME ?? "", sourceCs: (src.SOURCE_CS ?? "").slice(0, 80) }
        : null,
      packageCount: layer.featureCount,
      modelCount: 0,
      packageLength: layer.length,
      modelLength: 0,
      centreOffset: null,
    };
    rows.push(row);

    /* G3-003 layer imported */
    if (!src) {
      out.push(
        f("G3-003", "Every package layer was imported", "blocking", `${layer.file} (${layer.featureCount} feature(s)) has no data source in the model — it was never imported.`, {
          layer: layer.name,
        }),
      );
      continue;
    }

    /* G3-004 imported as the right class, in the right CRS */
    const target = (src.TARGET_CLASS_NAME ?? "").toUpperCase();
    if (expected.length && !expected.includes(target)) {
      out.push(
        f("G3-004", "Layer imported as the right type", "warning", `${layer.file} was imported as ${target || "(none)"}, expected ${expected.join(" or ")}.`, {
          layer: layer.name,
        }),
      );
    }
    const cs = src.SOURCE_CS ?? "";
    if (want && cs && isGeographic(cs)) {
      out.push(
        f(
          "G3-004",
          "Layer read in the package CRS",
          "blocking",
          `${layer.file} was read as geographic WGS 84 (degrees), but its coordinates are EPSG:${pkg.epsg} metres — ` +
            `the features are misplaced. Set the data source coordinate system to EPSG:${pkg.epsg} and refresh.`,
          { layer: layer.name },
        ),
      );
    } else if (want && cs) {
      const got = utmFromWkt(cs) ?? (/(\d{5})/.exec(cs) ? utmFromEpsg(Number(/(\d{5})/.exec(cs)![1])) : null);
      if (got && (got.zone !== want.zone || got.south !== want.south)) {
        out.push(
          f("G3-004", "Layer read in the package CRS", "blocking", `${layer.file} was read as UTM ${got.zone}${got.south ? "S" : "N"}, but the package is UTM ${want.zone}${want.south ? "S" : "N"}.`, {
            layer: layer.name,
          }),
        );
      }
    }

    const stats = importedStats(h, target, src.GUID);
    row.modelCount = stats.count;
    row.modelLength = stats.length;

    /* G3-005 feature count */
    if (stats.count === 0) {
      out.push(f("G3-005", "Features arrived", "blocking", `${layer.file}: 0 of ${layer.featureCount} feature(s) are in the model.`, { layer: layer.name }));
      continue;
    }
    if (stats.count < layer.featureCount) {
      out.push(
        f("G3-005", "Features arrived", "warning", `${layer.file}: ${stats.count} of ${layer.featureCount} feature(s) are in the model — ${layer.featureCount - stats.count} missing.`, {
          layer: layer.name,
          model: String(stats.count),
          package: String(layer.featureCount),
        }),
      );
    }
    if (stats.unreadable) {
      out.push(f("G3-005", "Features arrived", "warning", `${layer.file}: ${stats.unreadable} imported geometry blob(s) could not be read.`, { layer: layer.name }));
    }

    /* G3-006 position */
    if (layer.extent && stats.extent) {
      const cx = (e: typeof stats.extent) => [(e!.minX + e!.maxX) / 2, (e!.minY + e!.maxY) / 2] as const;
      const [px, py] = cx(layer.extent);
      const [mx, my] = cx(stats.extent);
      const offset = Math.hypot(px - mx, py - my);
      row.centreOffset = offset;
      if (offset > maxOffset) {
        out.push(
          f(
            "G3-006",
            "Features are where the package put them",
            "blocking",
            `${layer.file} sits ${offset.toFixed(2)} m from its package position (dE ${(mx - px).toFixed(2)}, dN ${(my - py).toFixed(2)}). ` +
              `Usual causes: wrong source CRS, a data-source offset, or a shifted model origin.`,
            { layer: layer.name, offset: offset.toFixed(3) },
          ),
        );
      }
    }

    /* G3-007 length — the silent truncation, for linear layers */
    if (layer.length > 0) {
      const loss = (layer.length - stats.length) / layer.length;
      if (loss > maxLoss) {
        out.push(
          f(
            "G3-007",
            "Linear features are complete",
            loss > 0.1 ? "blocking" : "warning",
            `${layer.file}: ${stats.length.toFixed(1)} m in the model against ${layer.length.toFixed(1)} m sent — ` +
              `${(loss * 100).toFixed(1)} % (${(layer.length - stats.length).toFixed(1)} m) missing.`,
            { layer: layer.name, loss: loss.toFixed(4) },
          ),
        );
      }
    }
  }

  const imported = rows.filter((r) => r.dataSource && r.modelCount > 0).length;
  out.push(f("G3-000", "Summary", "info", `${imported} of ${pkg.layers.length} package layer(s) found in the model (${basename(pkg.source)}).`));
}

/* G3-008 — design roads: sections Civil 3D exported vs sections InfraWorks built */
function compareRegions(h: ModelHandle, imxPath: string, out: ModelFinding[], rows: RegionComparison[]) {
  const imx = openImx(imxPath, true);
  let imxRegions;
  try {
    imxRegions = readRegions(imx, Number.POSITIVE_INFINITY);
  } finally {
    imx.db.close();
  }
  const model = modelRegions(h);
  const byName = new Map([...model.values()].filter((r) => r.name).map((r) => [r.name!.toLowerCase(), r]));
  let unmatched = 0;

  for (const r of imxRegions) {
    if (!r.sectionCount) continue;
    const m = model.get(r.guid) ?? byName.get(r.name.toLowerCase());
    const imxSpan = (r.lastSection ?? 0) - (r.firstSection ?? 0);
    rows.push({ name: r.name, guid: r.guid, imxSections: r.sectionCount, imxSpan, modelSections: m?.sections ?? null, modelSpan: m?.span ?? null });
    if (!m) {
      unmatched += 1;
      continue;
    }
    const span = m.span ?? 0;
    if (m.sections === 0 || span < imxSpan - 1) {
      out.push(
        f(
          "G3-008",
          "Design roads are built over their full length",
          "blocking",
          `Region ${r.name}: InfraWorks built ${m.sections} section(s) over ${span.toFixed(1)} m; the IMX carries ` +
            `${r.sectionCount} over ${imxSpan.toFixed(1)} m — ${(imxSpan - span).toFixed(1)} m of road is missing. ` +
            `Run the IMX gate (G2) on the export: an unreadable section stops the build silently.`,
          { region: r.name, missingM: (imxSpan - span).toFixed(1) },
        ),
      );
    }
  }
  if (unmatched) {
    out.push(
      f(
        "G3-008",
        "Design roads are built over their full length",
        "warning",
        `${unmatched} IMX region(s) could not be matched to an InfraWorks region by GUID or name, so their length was not checked.`,
      ),
    );
  }
}
