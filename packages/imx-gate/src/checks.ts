import { lintJson } from "./jsonlint.js";
import { has, declaredCrs, imxVersion } from "./read.js";
import type { ImxHandle, GeometryScan } from "./read.js";
import type { GateOptions, ImxFinding, ImxStats } from "./types.js";

const MAX_EXAMPLES = 8;

function f(
  ruleId: string,
  rule: string,
  severity: ImxFinding["severity"],
  message: string,
  opts: { repairable?: boolean; context?: Record<string, string> } = {},
): ImxFinding {
  return {
    ruleId,
    rule,
    code: ruleId.replace("-", "_"),
    severity,
    message,
    repairable: opts.repairable ?? false,
    ...(opts.context ? { context: opts.context } : {}),
  };
}

function st(v: number): string {
  const km = Math.floor(v / 1000);
  const m = v - km * 1000;
  return `${km}+${m.toFixed(3).padStart(7, "0")}`;
}

/* ------------------------------------------------------------------ IMX-001 */

export function checkStructure(h: ImxHandle): ImxFinding[] {
  const out: ImxFinding[] = [];
  const required = ["ROADS", "SURFACES", "spatial_ref_sys"];
  const missing = required.filter((t) => !has(h, t));
  if (missing.length) {
    out.push(
      f("IMX-001", "IMX structure", "blocking", `Expected table(s) missing: ${missing.join(", ")}`, {
        context: { missing: missing.join(",") },
      }),
    );
  }
  if (imxVersion(h) === null) {
    out.push(f("IMX-001", "IMX structure", "warning", "IMX_VERSION is absent — file may not be a Civil 3D IMX export"));
  }
  return out;
}

/* ------------------------------------------------- IMX-002 / IMX-007 (one pass) */

export interface SectionScan {
  total: number;
  invalid: { id: number; regionId: string | null; station: number | null; literals: string[]; error: string }[];
  /** Zero-run links with a non-zero rise — these are the ones that yield an infinite slope. */
  infiniteSlopeLinks: { count: number; bySubassembly: Map<string, number>; examples: string[] };
}

export function scanSections(h: ImxHandle): SectionScan {
  const out: SectionScan = {
    total: 0,
    invalid: [],
    infiniteSlopeLinks: { count: 0, bySubassembly: new Map(), examples: [] },
  };
  if (!has(h, "CONSTRAINED_DEF_CORRIDOR_SECTIONS")) return out;

  const stmt = h.db.prepare(
    "select ID, REGION_ID, DISTANCE_2D, JSON_CROSS_SECTION from CONSTRAINED_DEF_CORRIDOR_SECTIONS",
  );
  for (const row of stmt.iterate() as Iterable<{
    ID: number;
    REGION_ID: string | null;
    DISTANCE_2D: number | null;
    JSON_CROSS_SECTION: string | null;
  }>) {
    out.total++;
    const text = row.JSON_CROSS_SECTION;
    if (!text) continue;
    const lint = lintJson(text);
    if (!lint.valid) {
      out.invalid.push({
        id: row.ID,
        regionId: row.REGION_ID,
        station: row.DISTANCE_2D,
        literals: lint.literals,
        error: lint.error ?? "parse error",
      });
      continue;
    }
    collectInfiniteSlopeLinks(text, row.DISTANCE_2D, out.infiniteSlopeLinks);
  }
  return out;
}

interface SubassemblyJson {
  name?: unknown;
  params?: { doubleParams?: { name?: unknown; value?: unknown }[] } | null;
}

/** A slope steeper than this is physically meaningless and one rounding from `inf`. */
export const DEGENERATE_SLOPE = 100;

/**
 * Vertical links are normal inside an assembly — stacked pavement courses share an
 * offset by design. What is not normal is a *computed slope parameter* that has run
 * away, which is the state one rounding step away from the `inf` that makes a section
 * unreadable (IMX-002). Flagging those points at the design condition rather than the
 * symptom, without drowning the report in legitimate vertical links.
 */
function collectInfiniteSlopeLinks(
  text: string,
  station: number | null,
  sink: SectionScan["infiniteSlopeLinks"],
): void {
  let parsed: { subassemblies?: SubassemblyJson[] };
  try {
    parsed = JSON.parse(text) as { subassemblies?: SubassemblyJson[] };
  } catch {
    return;
  }
  for (const sa of parsed.subassemblies ?? []) {
    for (const p of sa.params?.doubleParams ?? []) {
      const name = typeof p.name === "string" ? p.name : "";
      if (!/slope/i.test(name)) continue;
      const v = Number(p.value);
      if (Number.isFinite(v) && Math.abs(v) <= DEGENERATE_SLOPE) continue;
      const sub = typeof sa.name === "string" ? sa.name : "(unnamed)";
      sink.count++;
      sink.bySubassembly.set(sub, (sink.bySubassembly.get(sub) ?? 0) + 1);
      if (sink.examples.length < MAX_EXAMPLES) {
        sink.examples.push(
          `${station === null ? "?" : st(station)} | ${sub} | ${name} = ${Number.isFinite(v) ? v.toFixed(1) : String(p.value)}`,
        );
      }
    }
  }
}

export function checkSections(scan: SectionScan): ImxFinding[] {
  const out: ImxFinding[] = [];

  if (scan.invalid.length) {
    const examples = scan.invalid
      .slice(0, MAX_EXAMPLES)
      .map((i) => `ID ${i.id} at ${i.station === null ? "?" : st(i.station)} (${i.literals.join(", ") || "parse error"})`)
      .join("; ");
    out.push(
      f(
        "IMX-002",
        "Corridor section JSON is readable",
        "blocking",
        `${scan.invalid.length} of ${scan.total} corridor section(s) contain invalid JSON. ` +
          `InfraWorks stops building the road body of a region at the first unreadable section and ` +
          `silently discards every section after it. Examples: ${examples}`,
        {
          repairable: true,
          context: { invalid: String(scan.invalid.length), total: String(scan.total) },
        },
      ),
    );
  }

  const inf = scan.infiniteSlopeLinks;
  if (inf.count) {
    const bySub = [...inf.bySubassembly.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_EXAMPLES)
      .map(([name, n]) => `${name} (${n})`)
      .join(", ");
    out.push(
      f(
        "IMX-007",
        "No runaway link slopes",
        "warning",
        `${inf.count} subassembly slope parameter(s) across ${inf.bySubassembly.size} subassembly(ies) ` +
          `exceed ${DEGENERATE_SLOPE}:1 or are non-finite — the link has effectively no horizontal run. ` +
          `This is the design condition behind IMX-002, usually a cut/fill transition where a daylight ` +
          `link meets existing ground exactly at a sampled station. Subassemblies: ${bySub}. ` +
          `Occurrences: ${inf.examples.join("; ")}`,
        { context: { count: String(inf.count), subassemblies: String(inf.bySubassembly.size) } },
      ),
    );
  }

  return out;
}

/* ------------------------------------------------------------------ IMX-003 */

export function checkRegionJson(h: ImxHandle): ImxFinding[] {
  if (!has(h, "CONSTRAINED_DEF_CORRIDOR_REGIONS")) return [];
  const rows = h.db
    .prepare("select ID, NAME, JSON_ASSEMBLY_DATA from CONSTRAINED_DEF_CORRIDOR_REGIONS")
    .all() as { ID: number; NAME: string | null; JSON_ASSEMBLY_DATA: string | null }[];
  const bad = rows.filter((r) => r.JSON_ASSEMBLY_DATA && !lintJson(r.JSON_ASSEMBLY_DATA).valid);
  if (!bad.length) return [];
  return [
    f(
      "IMX-003",
      "Corridor region JSON is readable",
      "blocking",
      `${bad.length} corridor region(s) carry invalid JSON in JSON_ASSEMBLY_DATA: ` +
        bad.slice(0, MAX_EXAMPLES).map((r) => r.NAME ?? `#${r.ID}`).join(", "),
      { repairable: true, context: { count: String(bad.length) } },
    ),
  ];
}

/* ------------------------------------------------------------------ IMX-004 */

export function checkRebuildState(stats: ImxStats): ImxFinding[] {
  const stale = stats.regions.filter((r) => r.corridorOutOfDate === true || r.baselineOutOfDate === true);
  if (!stale.length) return [];
  return [
    f(
      "IMX-004",
      "Corridor was rebuilt before export",
      "warning",
      `${stale.length} of ${stats.regions.length} region(s) were exported with the corridor or its ` +
        `baseline marked out of date. The export then carries the last built state, so any edit made ` +
        `after the last Rebuild is not in this file. Rebuild the corridor in Civil 3D and export again.`,
      { context: { stale: String(stale.length), total: String(stats.regions.length) } },
    ),
  ];
}

/* ------------------------------------------------------------ IMX-005 / 012 */

export function checkRegionContinuity(stats: ImxStats): ImxFinding[] {
  const out: ImxFinding[] = [];
  const byBaseline = new Map<string, typeof stats.regions>();
  for (const r of stats.regions) {
    const list = byBaseline.get(r.baseline) ?? [];
    list.push(r);
    byBaseline.set(r.baseline, list);
  }

  const breaks: string[] = [];
  for (const [baseline, list] of byBaseline) {
    const sorted = [...list].sort((a, b) => a.startStation - b.startStation);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      const delta = cur.startStation - prev.endStation;
      if (Math.abs(delta) > 0.001) {
        breaks.push(
          `${baseline}: ${delta > 0 ? "gap" : "overlap"} of ${Math.abs(delta).toFixed(3)} m between ` +
            `${prev.name} (ends ${st(prev.endStation)}) and ${cur.name} (starts ${st(cur.startStation)})`,
        );
      }
    }
  }
  if (breaks.length) {
    out.push(
      f(
        "IMX-005",
        "Corridor regions are continuous",
        "warning",
        `${breaks.length} discontinuity(ies) between corridor regions: ${breaks.slice(0, MAX_EXAMPLES).join("; ")}`,
        { context: { count: String(breaks.length) } },
      ),
    );
  }

  const short = stats.regions.filter(
    (r) =>
      r.sectionCount > 0 &&
      r.lastSection !== null &&
      r.lengthM > 1 &&
      r.lastSection - (r.firstSection ?? 0) < r.lengthM - 1,
  );
  if (short.length) {
    out.push(
      f(
        "IMX-012",
        "Sections cover the declared region span",
        "warning",
        `${short.length} region(s) have sections that stop short of the declared span: ` +
          short
            .slice(0, MAX_EXAMPLES)
            .map(
              (r) =>
                `${r.name} declares ${r.lengthM.toFixed(2)} m but sections run ` +
                `${(r.lastSection! - (r.firstSection ?? 0)).toFixed(2)} m`,
            )
            .join("; "),
        { context: { count: String(short.length) } },
      ),
    );
  }

  const empty = stats.regions.filter((r) => r.sectionCount === 0);
  if (empty.length) {
    out.push(
      f(
        "IMX-011",
        "Every region carries sections",
        "warning",
        `${empty.length} corridor region(s) have no cross-sections at all: ` +
          empty.slice(0, MAX_EXAMPLES).map((r) => r.name).join(", "),
        { context: { count: String(empty.length) } },
      ),
    );
  }

  return out;
}

/* ------------------------------------------------------------------ IMX-006 */

export function checkStationSpacing(stats: ImxStats, maxGapM: number): ImxFinding[] {
  const wide = stats.regions.filter((r) => (r.maxStationGapM ?? 0) > maxGapM);
  if (!wide.length) return [];
  return [
    f(
      "IMX-006",
      "Section spacing is within tolerance",
      "warning",
      `${wide.length} region(s) sample sections more than ${maxGapM} m apart, so the imported road ` +
        `body will be coarser than the design: ` +
        wide
          .slice(0, MAX_EXAMPLES)
          .map((r) => `${r.name} (max ${r.maxStationGapM!.toFixed(2)} m)`)
          .join("; "),
      { context: { count: String(wide.length), threshold: String(maxGapM) } },
    ),
  ];
}

/* ------------------------------------------------------------------ IMX-008 */

export function checkGeometry(geo: GeometryScan): ImxFinding[] {
  const out: ImxFinding[] = [];
  if (geo.unreadable.length) {
    out.push(
      f(
        "IMX-008",
        "Geometry blobs are readable",
        "blocking",
        `${geo.unreadable.length} geometry blob(s) could not be decoded: ` +
          geo.unreadable
            .slice(0, MAX_EXAMPLES)
            .map((u) => `${u.table}#${u.id} ${u.name ?? ""} (${u.reason})`)
            .join("; "),
        { context: { count: String(geo.unreadable.length) } },
      ),
    );
  }
  if (geo.nonFinite.length) {
    out.push(
      f(
        "IMX-008",
        "Geometry coordinates are finite",
        "blocking",
        `${geo.nonFinite.length} feature(s) contain a non-finite coordinate: ` +
          geo.nonFinite.slice(0, MAX_EXAMPLES).map((u) => `${u.table}#${u.id} ${u.name ?? ""}`).join("; "),
        { context: { count: String(geo.nonFinite.length) } },
      ),
    );
  }
  if (geo.empty.length) {
    out.push(
      f(
        "IMX-008",
        "No empty geometry",
        "warning",
        `${geo.empty.length} feature(s) have no geometry: ` +
          geo.empty.slice(0, MAX_EXAMPLES).map((u) => `${u.table}#${u.id} ${u.name ?? ""}`).join("; "),
        { context: { count: String(geo.empty.length) } },
      ),
    );
  }
  return out;
}

/* ------------------------------------------------------------------ IMX-009 */

export function checkCrs(h: ImxHandle, stats: ImxStats, opts: GateOptions): ImxFinding[] {
  const out: ImxFinding[] = [];
  const crs = declaredCrs(h);

  if (!crs.name) {
    out.push(
      f("IMX-009", "Coordinate system", "blocking", "The export declares no coordinate system. Assign one in Civil 3D and export again."),
    );
    return out;
  }

  if (opts.epsg && crs.utmZone !== null) {
    const expectedZone =
      opts.epsg >= 32601 && opts.epsg <= 32660
        ? opts.epsg - 32600
        : opts.epsg >= 32701 && opts.epsg <= 32760
          ? opts.epsg - 32700
          : null;
    if (expectedZone !== null && expectedZone !== crs.utmZone) {
      out.push(
        f(
          "IMX-009",
          "Coordinate system matches the project",
          "blocking",
          `The export declares ${crs.name} (UTM zone ${crs.utmZone}, central meridian ` +
            `${crs.centralMeridian}°) but the project expects EPSG:${opts.epsg} (zone ${expectedZone}). ` +
            `Importing this would place the model in the wrong zone.`,
          { context: { declared: crs.name, expected: `EPSG:${opts.epsg}` } },
        ),
      );
    }
  }

  const e = stats.extent;
  if (e) {
    const plausible = e.minX > 100_000 && e.maxX < 900_000 && e.minY > -1 && e.maxY < 10_000_000;
    if (!plausible) {
      out.push(
        f(
          "IMX-009",
          "Coordinates are plausible for a UTM projection",
          "blocking",
          `Road coordinates fall outside the valid UTM envelope ` +
            `(E ${e.minX.toFixed(1)}…${e.maxX.toFixed(1)}, N ${e.minY.toFixed(1)}…${e.maxY.toFixed(1)}). ` +
            `The usual cause is a data source left on "Default" or "Internal PCS".`,
        ),
      );
    }
  }

  return out;
}

/* ------------------------------------------------------------------ IMX-010 */

export function checkContent(stats: ImxStats): ImxFinding[] {
  const out: ImxFinding[] = [];
  if (stats.roads === 0) {
    out.push(f("IMX-010", "Export carries content", "blocking", "The export contains no roads."));
  }
  if (stats.surfaces === 0) {
    out.push(
      f(
        "IMX-010",
        "Export carries content",
        "warning",
        "The export contains no surfaces. Component roads with no terrain beneath them will not daylight correctly.",
      ),
    );
  }
  if (stats.roads > 0 && stats.surfaces > 0 && stats.extent) {
    out.push(
      f(
        "IMX-010",
        "Export carries content",
        "info",
        `${stats.roads} road(s) (${stats.designRoads} design road(s)), ${stats.corridorRegions} corridor ` +
          `region(s), ${stats.corridorSections} section(s), ${stats.surfaces} surface(s), ` +
          `${stats.coverages} coverage(s).`,
      ),
    );
  }
  return out;
}
