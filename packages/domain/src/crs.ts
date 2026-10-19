import {
  DEFAULT_CRS_NAME,
  DEFAULT_EPSG,
  INFRAWORKS_CRS_HINT,
} from "./types.js";

const CRS_TABLE: Record<number, { name: string; infraWorksCrsHint: string }> = {
  32638: { name: DEFAULT_CRS_NAME, infraWorksCrsHint: INFRAWORKS_CRS_HINT },
  4326: { name: "WGS 84", infraWorksCrsHint: "LL84" },
  3857: { name: "WGS 84 / Pseudo-Mercator", infraWorksCrsHint: "WebMercator" },
};

export function resolveCrs(epsg: number = DEFAULT_EPSG) {
  const known = CRS_TABLE[epsg];
  if (known) {
    return { epsg, name: known.name, infraWorksCrsHint: known.infraWorksCrsHint };
  }
  return {
    epsg,
    name: `EPSG:${epsg}`,
    infraWorksCrsHint: `EPSG:${epsg}`,
  };
}
