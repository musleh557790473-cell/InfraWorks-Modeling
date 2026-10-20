/** Known projected CRS lookup — no domain default EPSG. */
const CRS_TABLE: Record<number, { name: string; infraWorksCrsHint: string }> = {
  32638: { name: "WGS 84 / UTM zone 38N", infraWorksCrsHint: "UTM84-38N" },
  32637: { name: "WGS 84 / UTM zone 37N", infraWorksCrsHint: "UTM84-37N" },
  32639: { name: "WGS 84 / UTM zone 39N", infraWorksCrsHint: "UTM84-39N" },
  3857: { name: "WGS 84 / Pseudo-Mercator", infraWorksCrsHint: "WebMercator" },
};

export function resolveCrs(epsg: number): {
  epsg: number;
  name: string;
  infraWorksCrsHint: string;
  known: boolean;
} {
  const known = CRS_TABLE[epsg];
  if (known) {
    return { epsg, name: known.name, infraWorksCrsHint: known.infraWorksCrsHint, known: true };
  }
  if (!Number.isFinite(epsg) || epsg <= 0) {
    return { epsg, name: "UNDECLARED", infraWorksCrsHint: "UNDECLARED", known: false };
  }
  return {
    epsg,
    name: `EPSG:${epsg}`,
    infraWorksCrsHint: `EPSG:${epsg}`,
    known: false,
  };
}

export function isUtmProjected(epsg: number): boolean {
  return (epsg >= 32601 && epsg <= 32660) || (epsg >= 32701 && epsg <= 32760);
}
