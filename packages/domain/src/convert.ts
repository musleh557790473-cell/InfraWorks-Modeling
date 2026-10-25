import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * DWG → DXF conversion with free tools, tried in order:
 *
 * 1. ODA File Converter — free download from the Open Design Alliance; reads every DWG
 *    release and is the most complete. Free for internal use; bundling it inside a product
 *    you distribute needs an ODA licence.
 * 2. ezdwg (Python, MIT) — pure-Python reader for DWG R2000–R2018. Much less complete
 *    (block content and Civil 3D objects are often missing), so it is the fallback only.
 *
 * Neither tool can read Civil 3D objects (alignments, parcels, corridors…); those arrive as
 * ACAD_PROXY_ENTITY and are reported by validation.
 */

export type ConverterName = "oda" | "ezdwg";

export interface ConversionResult {
  dxfPath: string;
  engine: ConverterName;
  /** One line per engine tried, including the ones that failed before this one. */
  attempts: string[];
}

export class ConversionError extends Error {
  constructor(
    message: string,
    readonly attempts: string[],
  ) {
    super(message);
    this.name = "ConversionError";
  }
}

export interface ConvertOptions {
  /** Engines in the order to try. Default: env CAD_CONVERTERS ("oda,ezdwg") or both. */
  engines?: ConverterName[];
  /** Per-engine timeout in ms. Default 10 minutes — a large DWG can take a few. */
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

/** Locate ODAFileConverter.exe: env ODA_FILE_CONVERTER, else the newest default install. */
export function findOdaConverter(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.ODA_FILE_CONVERTER) return existsSync(env.ODA_FILE_CONVERTER) ? env.ODA_FILE_CONVERTER : null;
  if (process.platform !== "win32") {
    const linux = "/usr/bin/ODAFileConverter";
    return existsSync(linux) ? linux : null;
  }
  const root = join(env.ProgramFiles || "C:\\Program Files", "ODA");
  if (!existsSync(root)) return null;
  const versions = readdirSync(root)
    .filter((d) => d.startsWith("ODAFileConverter"))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const v of versions) {
    const exe = join(root, v, "ODAFileConverter.exe");
    if (existsSync(exe)) return exe;
  }
  return null;
}

/**
 * A short scratch folder. ODA cannot open paths longer than 260 characters, so a deep
 * TEMP (or a deep project folder) is avoided; CAD_CONVERT_TMP overrides.
 */
function scratchDir(env: NodeJS.ProcessEnv): string {
  const base = env.CAD_CONVERT_TMP || tmpdir();
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, "iwdwg-"));
}

function message(err: unknown): string {
  const e = err as { killed?: boolean; code?: unknown; stderr?: string; message?: string };
  if (e.killed) return "timed out";
  const stderr = typeof e.stderr === "string" ? e.stderr.trim().split(/\r?\n/).slice(-3).join(" ") : "";
  return stderr || e.message || String(err);
}

async function viaOda(dwg: string, work: string, timeout: number, env: NodeJS.ProcessEnv): Promise<string> {
  const exe = findOdaConverter(env);
  if (!exe) throw new Error("not installed (set ODA_FILE_CONVERTER to ODAFileConverter.exe)");
  const inDir = join(work, "in");
  const outDir = join(work, "oda");
  mkdirSync(inDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  // A plain ASCII name avoids trouble with spaces and non-Latin file names.
  copyFileSync(dwg, join(inDir, "input.dwg"));
  // ODAFileConverter <in dir> <out dir> <version> <type> <recurse> <audit> [filter]
  await run(exe, [inDir, outDir, "ACAD2018", "DXF", "0", "1", "input.dwg"], {
    timeout,
    windowsHide: true,
  });
  const out = join(outDir, "input.dxf");
  if (existsSync(out)) return out;
  const errFile = join(outDir, "input.dxf.err");
  const detail = existsSync(errFile) ? readFileSync(errFile, "utf8").trim().split(/\r?\n/).pop() : "";
  throw new Error(`produced no DXF${detail ? `: ${detail}` : ""}`);
}

const EZDWG_SCRIPT = [
  "import sys, ezdwg",
  "r = ezdwg.to_dxf(sys.argv[1], sys.argv[2], dxf_version='R2018', modelspace_only=True, explode_dimensions=False)",
  "print(r.written_entities)",
].join("\n");

async function viaEzdwg(dwg: string, work: string, timeout: number, env: NodeJS.ProcessEnv): Promise<string> {
  const python = env.EZDWG_PYTHON || (process.platform === "win32" ? "python" : "python3");
  const out = join(work, "ezdwg.dxf");
  const childEnv = { ...process.env, ...env };
  if (env.EZDWG_PYTHONPATH) childEnv.PYTHONPATH = env.EZDWG_PYTHONPATH;
  try {
    await run(python, ["-c", EZDWG_SCRIPT, dwg, out], { timeout, windowsHide: true, env: childEnv });
  } catch (err) {
    const text = message(err);
    if (/No module named ['"]?ezdwg/.test(text)) throw new Error("not installed (pip install ezdwg==0.16.0)");
    if ((err as { code?: string }).code === "ENOENT") throw new Error(`Python not found ("${python}"; set EZDWG_PYTHON)`);
    throw new Error(text);
  }
  if (!existsSync(out)) throw new Error("produced no DXF");
  return out;
}

const ENGINES: Record<ConverterName, typeof viaOda> = { oda: viaOda, ezdwg: viaEzdwg };

function enginesFrom(opts: ConvertOptions, env: NodeJS.ProcessEnv): ConverterName[] {
  if (opts.engines?.length) return opts.engines;
  const fromEnv = (env.CAD_CONVERTERS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is ConverterName => s === "oda" || s === "ezdwg");
  return fromEnv.length ? fromEnv : ["oda", "ezdwg"];
}

/**
 * Convert `dwgPath` to an ASCII DXF at `outPath`, trying each engine in turn.
 * Throws ConversionError (with every attempt) when none succeeds.
 */
export async function convertDwgToDxf(
  dwgPath: string,
  outPath: string,
  opts: ConvertOptions = {},
): Promise<ConversionResult> {
  const env = opts.env ?? process.env;
  const timeout = opts.timeoutMs ?? 600_000;
  const attempts: string[] = [];

  const sig = readFileSync(dwgPath).subarray(0, 6).toString("latin1");
  if (!/^AC10\d\d$/.test(sig)) {
    throw new ConversionError(`Not a DWG file (signature "${sig.replace(/[^\x20-\x7e]/g, "?")}")`, attempts);
  }

  for (const engine of enginesFrom(opts, env)) {
    const work = scratchDir(env);
    try {
      const produced = await ENGINES[engine](dwgPath, work, timeout, env);
      mkdirSync(dirname(outPath), { recursive: true });
      copyFileSync(produced, outPath);
      attempts.push(`${engine}: converted (${sig})`);
      return { dxfPath: outPath, engine, attempts };
    } catch (err) {
      attempts.push(`${engine}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  throw new ConversionError(`DWG could not be converted to DXF — ${attempts.join("; ")}`, attempts);
}
