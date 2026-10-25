"use client";

import { useEffect, useMemo, useState } from "react";

const CLASSES = ["road_centerline", "coverage", "water", "parcel", "pipeline", "annotation", "unmapped"] as const;
type FeatureClass = (typeof CLASSES)[number];

type LayerMapping = { dwgLayer: string; infraFeatureClass: FeatureClass; joinKeyAttribute?: string };
type ReportJoin = { reportFile: string; joinKeyColumn: string; featureJoinAttribute: string; sheet?: string };
type AssetKeys = {
  pattern?: string;
  xdataApps: string[];
  attributeTags: string[];
  textLayers: string[];
  textMaxDistance: number;
  normalize: "exact" | "trim-upper" | "alnum-upper";
};
export type Profile = {
  id: string;
  name: string;
  team?: string;
  layers: LayerMapping[];
  reportJoins: ReportJoin[];
  assetKeys?: Partial<AssetKeys>;
};

type ScanRow = {
  layer: string;
  entityCount: number;
  types: Record<string, number>;
  infraFeatureClass: FeatureClass;
  joinKeyAttribute?: string;
  source: "profile" | "suggested" | "none";
  rule?: string;
};
type Scan = {
  file?: string;
  converter?: string;
  conversionError?: string;
  layers: ScanRow[];
  notes: string[];
  skippedEntities: Record<string, number>;
  insunits?: number;
  keyStats: { xdata: number; attribute: number; text: number; missing: number };
};
type ReportInfo = { uploadId: string; filename: string; kind: string; columns: string[]; sheets?: string[]; rowCount: number; error?: string };

type EditRow = { layer: string; entityCount: number; types: string; rule: string; cls: FeatureClass; joinAttr: string; source: ScanRow["source"] };
type EditJoin = { use: boolean; reportFile: string; kind: string; sheets?: string[]; sheet?: string; columns: string[]; joinKeyColumn: string; featureJoinAttribute: string };

const DEFAULT_KEYS: AssetKeys = {
  xdataApps: ["INFRAWORKS"],
  attributeTags: ["ASSET_ID", "ROAD_ID", "PARCEL_ID", "PLOT_ID", "PLOT_NO"],
  textLayers: [],
  textMaxDistance: 10,
  normalize: "trim-upper",
};

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const UNIT: Record<number, string> = { 0: "unitless", 1: "inches", 2: "feet", 4: "mm", 5: "cm", 6: "metres" };

export function MappingEditor({ api, projectId, current, onApplied }: {
  api: string;
  projectId: string;
  current?: Profile;
  onApplied: (msg: string) => void;
}) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [base, setBase] = useState<Profile | undefined>(current);
  const [scan, setScan] = useState<Scan | null>(null);
  const [rows, setRows] = useState<EditRow[]>([]);
  const [keys, setKeys] = useState<AssetKeys>({ ...DEFAULT_KEYS, ...(current?.assetKeys ?? {}) });
  const [joins, setJoins] = useState<EditJoin[]>([]);
  const [name, setName] = useState(current && current.id !== "ldip-default" ? current.name : "");
  const [team, setTeam] = useState(current?.team ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${api}/mapping-profiles`).then((r) => r.json()).then(setProfiles).catch(() => setProfiles([]));
  }, [api]);

  const profile = useMemo<Profile>(() => {
    const layers: LayerMapping[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      if (r.cls === "unmapped" || !r.rule.trim()) continue;
      const k = r.rule.trim().toUpperCase();
      if (seen.has(k)) continue; // first rule wins, as in the build
      seen.add(k);
      layers.push({ dwgLayer: r.rule.trim(), infraFeatureClass: r.cls, ...(r.joinAttr.trim() ? { joinKeyAttribute: r.joinAttr.trim() } : {}) });
    }
    // Keep a saved team profile's rules that this drawing did not exercise (the team's other drawings
    // may need them) — but never copy the built-in default's rules into a team profile.
    const keepBase = base && base.id !== "ldip-default" ? base.layers : [];
    for (const l of keepBase) {
      if (!seen.has(l.dwgLayer.toUpperCase())) layers.push(l);
    }
    const reportJoins: ReportJoin[] = joins
      .filter((j) => j.use && j.joinKeyColumn)
      .map((j) => ({ reportFile: j.reportFile, joinKeyColumn: j.joinKeyColumn, featureJoinAttribute: j.featureJoinAttribute || "asset_id", ...(j.sheet ? { sheet: j.sheet } : {}) }));
    const assetKeys = { ...keys, pattern: keys.pattern?.trim() || undefined };
    return {
      id: base && base.id !== "ldip-default" ? base.id : "",
      name: name.trim() || "Unnamed profile",
      ...(team.trim() ? { team: team.trim() } : {}),
      layers,
      reportJoins,
      assetKeys,
    };
  }, [rows, joins, keys, name, team, base]);

  function loadProfile(id: string) {
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    setBase(p);
    setName(p.id === "ldip-default" ? "" : p.name);
    setTeam(p.team ?? "");
    setKeys({ ...DEFAULT_KEYS, ...(p.assetKeys ?? {}) });
    setScan(null);
    setRows([]);
  }

  async function runScan() {
    setBusy(true);
    setError("");
    try {
      const body = base ? JSON.stringify({ ...base, assetKeys: keys }) : "{}";
      const res = await fetch(`${api}/projects/${projectId}/scan-layers`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      const s = data as Scan;
      setScan(s);
      setRows(
        s.layers.map((l) => ({
          layer: l.layer,
          entityCount: l.entityCount,
          types: Object.entries(l.types).map(([t, n]) => `${t} ${n}`).join(", "),
          rule: l.rule ?? l.layer,
          cls: l.infraFeatureClass,
          joinAttr: l.joinKeyAttribute ?? "",
          source: l.source,
        })),
      );
      const reports = (await fetch(`${api}/projects/${projectId}/reports`).then((r) => r.json())) as ReportInfo[];
      setJoins(
        reports.map((r) => {
          const existing = base?.reportJoins.find((j) => j.reportFile.toLowerCase() === r.filename.toLowerCase());
          const guess = r.columns.find((c) => /id|no|number|رقم/i.test(c)) ?? r.columns[0] ?? "";
          return {
            use: Boolean(existing) || reports.length === 1,
            reportFile: r.filename,
            kind: r.kind,
            sheets: r.sheets,
            sheet: existing?.sheet,
            columns: r.columns,
            joinKeyColumn: existing?.joinKeyColumn ?? guess,
            featureJoinAttribute: existing?.featureJoinAttribute ?? "asset_id",
          };
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveTeamProfile() {
    setBusy(true);
    setError("");
    try {
      const body = { ...profile, id: profile.id || undefined };
      const res = await fetch(`${api}/mapping-profiles`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setBase(data);
      setProfiles(await fetch(`${api}/mapping-profiles`).then((r) => r.json()));
      onApplied(`Team profile "${data.name}" saved`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${api}/projects/${projectId}/mapping`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...profile, id: profile.id || "project" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Apply failed");
      onApplied(`Mapping applied: ${profile.layers.length} layer rule(s), ${profile.reportJoins.length} report join(s)`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const setRow = (i: number, patch: Partial<EditRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setJoin = (i: number, patch: Partial<EditJoin>) => setJoins((js) => js.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="mapping">
      <div className="row">
        <label>
          Team profile
          <select value={base?.id ?? ""} onChange={(e) => loadProfile(e.target.value)}>
            <option value="" disabled>
              Choose…
            </option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.team ? ` — ${p.team}` : ""}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={busy} onClick={runScan}>
          {busy ? "Working…" : "Scan drawing layers"}
        </button>
      </div>

      {scan && (
        <>
          <p className="status">
            {scan.file}
            {scan.converter ? ` · converted with ${scan.converter.toUpperCase()}` : ""}
            {scan.insunits !== undefined ? ` · units: ${UNIT[scan.insunits] ?? scan.insunits}` : ""}
            {` · asset ids: ${scan.keyStats.xdata} XDATA, ${scan.keyStats.attribute} attribute, ${scan.keyStats.text} text, ${scan.keyStats.missing} missing`}
          </p>
          {scan.conversionError && <p className="status err">{scan.conversionError}</p>}
          {Object.keys(scan.skippedEntities).length > 0 && (
            <p className="hint">
              Not converted: {Object.entries(scan.skippedEntities).map(([t, n]) => `${t} (${n})`).join(", ")}
            </p>
          )}

          <h3>Layers</h3>
          <p className="hint">
            Rule = layer name or wildcard (<code>*ROAD*CL*</code>) — a wildcard covers the same layer in this team&apos;s other drawings.
            Rows marked <em>suggested</em> were guessed from the layer name; check them.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Layer</th>
                  <th>Entities</th>
                  <th>Rule</th>
                  <th>InfraWorks class</th>
                  <th>Asset id attribute</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.layer} className={r.cls === "unmapped" ? "dim" : ""}>
                    <td>
                      {r.layer}
                      {r.source !== "profile" && r.cls !== "unmapped" && <span className="tag">suggested</span>}
                    </td>
                    <td title={r.types}>{r.entityCount}</td>
                    <td>
                      <input value={r.rule} onChange={(e) => setRow(i, { rule: e.target.value })} />
                    </td>
                    <td>
                      <select value={r.cls} onChange={(e) => setRow(i, { cls: e.target.value as FeatureClass })}>
                        {CLASSES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input value={r.joinAttr} placeholder="—" onChange={(e) => setRow(i, { joinAttr: e.target.value })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Where this team keeps asset ids</h3>
          <p className="hint">Tried in order: XDATA → block attribute → nearest text label. The pattern lets ids be found anywhere.</p>
          <div className="row">
            <label>
              Id pattern (regex)
              <input value={keys.pattern ?? ""} placeholder="^RD-\d+$" onChange={(e) => setKeys({ ...keys, pattern: e.target.value })} />
            </label>
            <label>
              XDATA apps
              <input value={keys.xdataApps.join(", ")} onChange={(e) => setKeys({ ...keys, xdataApps: list(e.target.value) })} />
            </label>
            <label>
              Attribute tags
              <input value={keys.attributeTags.join(", ")} onChange={(e) => setKeys({ ...keys, attributeTags: list(e.target.value) })} />
            </label>
            <label>
              Label layers
              <input value={keys.textLayers.join(", ")} placeholder="*TEXT*" onChange={(e) => setKeys({ ...keys, textLayers: list(e.target.value) })} />
            </label>
            <label>
              Label distance
              <input type="number" min={0.1} step={0.5} value={keys.textMaxDistance} onChange={(e) => setKeys({ ...keys, textMaxDistance: Number(e.target.value) || 10 })} />
            </label>
            <label>
              Compare ids
              <select value={keys.normalize} onChange={(e) => setKeys({ ...keys, normalize: e.target.value as AssetKeys["normalize"] })}>
                <option value="trim-upper">ignore case / spaces</option>
                <option value="alnum-upper">letters and digits only</option>
                <option value="exact">exact</option>
              </select>
            </label>
          </div>

          <h3>Reports</h3>
          {joins.length === 0 && <p className="hint">No CSV/XLSX report uploaded.</p>}
          {joins.map((j, i) => (
            <div className="row" key={j.reportFile}>
              <label className="check">
                <input type="checkbox" checked={j.use} onChange={(e) => setJoin(i, { use: e.target.checked })} />
                {j.reportFile}
              </label>
              {j.sheets && j.sheets.length > 1 && (
                <label>
                  Sheet
                  <select value={j.sheet ?? j.sheets[0]} onChange={(e) => setJoin(i, { sheet: e.target.value })}>
                    {j.sheets.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Id column
                <select value={j.joinKeyColumn} onChange={(e) => setJoin(i, { joinKeyColumn: e.target.value })}>
                  {j.columns.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Matches attribute
                <input value={j.featureJoinAttribute} onChange={(e) => setJoin(i, { featureJoinAttribute: e.target.value })} />
              </label>
            </div>
          ))}

          <h3>Save</h3>
          <div className="row">
            <label>
              Profile name
              <input value={name} placeholder="e.g. Parsons roads" onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Team / consultant
              <input value={team} onChange={(e) => setTeam(e.target.value)} />
            </label>
            <button type="button" className="secondary" disabled={busy || !name.trim()} onClick={saveTeamProfile}>
              Save as team profile
            </button>
            <button type="button" disabled={busy} onClick={apply}>
              Apply to project
            </button>
          </div>
        </>
      )}
      {error && <p className="status err">{error}</p>}
    </div>
  );
}
