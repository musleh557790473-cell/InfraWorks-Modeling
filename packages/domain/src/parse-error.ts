/** Stable parse failures — never fabricate geometry (IGN-001). */
export class ParseError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ParseError";
    this.code = code;
    this.details = details;
  }
}

export const PARSE_CODES = {
  IGN_001_NO_ENTITIES: "IGN_001_NO_ENTITIES",
  IGN_DWG_UNSUPPORTED: "IGN_DWG_UNSUPPORTED",
  GEO_001_INVALID_GEOMETRY: "GEO_001_INVALID_GEOMETRY",
} as const;
