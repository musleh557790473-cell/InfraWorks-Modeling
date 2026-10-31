import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** The monorepo root: the nearest folder above `start` that holds pnpm-workspace.yaml. */
export function findRepoRoot(start = process.cwd()): string | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * Load the repo's .env once, without overriding variables already set in the shell. Each machine
 * keeps its own .env (it is not committed), so DATA_DIR can point at that machine's OneDrive path.
 */
export function loadRepoEnv(root = findRepoRoot()): void {
  if (!root) return;
  const file = join(root, ".env");
  if (!existsSync(file)) return;
  const before = { ...process.env };
  process.loadEnvFile(file);
  for (const [k, v] of Object.entries(before)) process.env[k] = v;
}

/**
 * Where uploads, packages, converted drawings and the project database live. DATA_DIR (shell or
 * .env) wins, relative to the repo root when not absolute; otherwise <repo>/data. Keeping the data
 * in a OneDrive folder lets two machines share it while the code moves through git.
 */
export function resolveDataDir(start = process.cwd()): string {
  const root = findRepoRoot(start);
  loadRepoEnv(root);
  const base = root ?? resolve(start);
  const v = process.env.DATA_DIR?.trim();
  if (!v) return join(base, "data");
  return isAbsolute(v) ? v : resolve(base, v);
}
