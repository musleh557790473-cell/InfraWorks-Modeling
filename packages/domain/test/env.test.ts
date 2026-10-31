import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { findRepoRoot, resolveDataDir } from "../src/index.js";

function repo(env?: string) {
  const root = mkdtempSync(join(tmpdir(), "iw-env-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
  if (env !== undefined) writeFileSync(join(root, ".env"), env);
  const app = join(root, "apps", "api");
  mkdirSync(app, { recursive: true });
  return { root, app };
}

test("data folder: <repo>/data by default, found from inside an app folder", () => {
  const saved = process.env.DATA_DIR;
  delete process.env.DATA_DIR;
  try {
    const { root, app } = repo();
    assert.equal(findRepoRoot(app), root);
    assert.equal(resolveDataDir(app), join(root, "data"));
  } finally {
    if (saved !== undefined) process.env.DATA_DIR = saved;
  }
});

test("data folder: DATA_DIR from .env (absolute, or relative to the repo); the shell's value wins", () => {
  const saved = process.env.DATA_DIR;
  delete process.env.DATA_DIR;
  try {
    const shared = join(tmpdir(), "OneDrive", "InfraWorks-Modeling-Data");
    const a = repo(`LOCAL_MODE=1\nDATA_DIR=${shared}\n`);
    assert.equal(resolveDataDir(a.app), shared);

    delete process.env.DATA_DIR;
    const b = repo("DATA_DIR=../shared-data\n");
    assert.equal(resolveDataDir(b.app), join(b.root, "..", "shared-data"));

    process.env.DATA_DIR = join(tmpdir(), "from-shell");
    assert.equal(resolveDataDir(a.app), join(tmpdir(), "from-shell"));
  } finally {
    if (saved === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = saved;
  }
});

test("the store records data-folder paths relative to it, and reads old absolute ones from another machine", async () => {
  const { createFileStore } = await import("../src/index.js");
  const { readFileSync, existsSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "iw-store-"));
  const store = createFileStore(dir);
  const p = store.createProject("t", 32638);
  const path = join(store.uploadDir, p.id, "a.dxf");
  mkdirSync(join(store.uploadDir, p.id), { recursive: true });
  writeFileSync(path, "0\nEOF\n");
  store.addUpload({ projectId: p.id, filename: "a.dxf", kind: "dxf", path, size: 0 });
  // An upload written on the other laptop, before paths were relative.
  const db = join(dir, "db", "uploads.json");
  const rows = JSON.parse(readFileSync(db, "utf8"));
  assert.equal(rows[0].path, `uploads/${p.id}/a.dxf`, "stored relative, with forward slashes");
  rows.push({ ...rows[0], id: "old", path: ["C:", "Users", "other", "OneDrive", "Data", "uploads", p.id, "a.dxf"].join("\\") });
  writeFileSync(db, JSON.stringify(rows));

  const again = createFileStore(dir).listUploads(p.id);
  assert.equal(again.length, 2);
  for (const u of again) {
    assert.equal(u.path, path);
    assert.ok(existsSync(u.path));
  }
});
