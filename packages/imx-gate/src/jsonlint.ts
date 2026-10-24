/**
 * Civil 3D writes raw C/C++ floating-point literals into the JSON columns of an .imx
 * file when a subassembly parameter evaluates to a non-finite number — most often
 * `"Link Slope": inf` where a link has zero horizontal run. `inf`, `nan` and the MSVC
 * `1.#INF` family are not legal JSON, so a strict parser throws.
 *
 * This matters because InfraWorks parses each corridor section's JSON while building
 * the road body and aborts that region at the first section it cannot read, silently
 * discarding every section after it. One bad record can drop hundreds of metres of road
 * with no message in the UI.
 *
 * Observed 2026-10-21 on NEOM PKG 4 C1-P3: a single bad record out of 2,327 dropped
 * 925 m of the 1,174 m southbound carriageway.
 */

/** Matches a non-finite numeric literal in value position (never inside a string). */
const NON_FINITE =
  /(:\s*)(-?(?:inf(?:inity)?|nan(?:\([a-z]*\))?|1\.#INF|1\.#IND|1\.#QNAN|1\.#SNAN))(\s*[,}\]])/gi;

/** The matching display strings Civil 3D writes alongside the bad value. */
const FORMATTED = /("formattedValue"\s*:\s*")(-?(?:Infinity|NaN|1\.#INF|1\.#IND))(")/g;

export interface JsonLintResult {
  valid: boolean;
  /** Parse error message when `valid` is false. */
  error?: string;
  /** Distinct non-finite literals found, e.g. ["inf"]. */
  literals: string[];
}

export function lintJson(text: string): JsonLintResult {
  try {
    JSON.parse(text);
    return { valid: true, literals: [] };
  } catch (err) {
    const literals = new Set<string>();
    NON_FINITE.lastIndex = 0;
    for (const m of text.matchAll(NON_FINITE)) literals.add(m[2]!);
    return {
      valid: false,
      error: err instanceof Error ? err.message : String(err),
      literals: [...literals],
    };
  }
}

export interface JsonRepairResult {
  repaired: boolean;
  text: string;
  /** Number of literal substitutions made. */
  substitutions: number;
  /** Set when the repaired text still does not parse. */
  error?: string;
}

/**
 * Replace every non-finite literal with 0.0 and its display string with "0.000000".
 *
 * Only parameter *metadata* is touched. InfraWorks builds road geometry from the
 * `points`, `links` and `shapes` arrays of each subassembly, never from `params`, so a
 * repaired section produces geometry identical to the one Civil 3D intended.
 */
export function repairJson(text: string): JsonRepairResult {
  let substitutions = 0;
  let out = text.replace(NON_FINITE, (_m, lead: string, _lit: string, tail: string) => {
    substitutions++;
    return `${lead}0.0${tail}`;
  });
  out = out.replace(FORMATTED, (_m, lead: string, _lit: string, tail: string) => {
    substitutions++;
    return `${lead}0.000000${tail}`;
  });

  if (substitutions === 0) {
    return { repaired: false, text, substitutions: 0, error: "no non-finite literal found" };
  }
  try {
    JSON.parse(out);
  } catch (err) {
    return {
      repaired: false,
      text,
      substitutions,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return { repaired: true, text: out, substitutions };
}
