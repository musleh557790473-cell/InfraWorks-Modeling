# CLAUDE.md

Shared working agreement for this repository. Read before making changes.
Both Claude and Cursor work from this file. Keep `.cursorrules` in sync with it.

---

## 1. What this product is

A **general-purpose** tool that turns 2D CAD drawings plus tabular reports into an
InfraWorks-ready import package: validated GeoJSON layers, an overlay DWG, a manifest, a
validation report and an import checklist.

**It is not a project-specific tool.** No project's coordinate system, plot counts,
tolerances or layer names belong in `packages/domain`. Those live in a profile
(`packages/domain/src/profiles/`). Real project data appears only as fixtures used to
prove the product works.

**It is not a review or compliance tool.** It validates that a package faithfully
represents its source data. Judging whether a *design* is correct is a different product
and does not belong here.

---

## 2. The constraint everything follows from

Autodesk publishes no API that creates an InfraWorks model from arbitrary 2D CAD.
InfraWorks desktop has no .NET API, no COM interface and no scripting surface, and
Autodesk Platform Services has no Design Automation engine for it.

So this product **prepares data for import**. It does not drive InfraWorks.

Two things follow:

1. **Never write to an InfraWorks `.sqlite` model.** Reading one for inspection is fine.
   Writing is unsupported, breaks across releases, corrupts models and voids support.
2. **Never automate the InfraWorks UI.** Brittle, unauditable, and it would make the
   product's output impossible to verify.

Anything that needs real automation belongs in Civil 3D, which *is* scriptable
(.NET API, `accoreconsole` for headless batch). That is a separate component if it is
ever built, not a change to this one.

---

## 3. Non-negotiables

1. **Never fabricate geometry for a user-supplied file.** If a parser cannot read a file,
   it fails loudly. A package built from invented data is worse than no package, because
   it carries the source filename and looks authoritative. See rule IGN-001.
2. **Every feature keeps its provenance** — source file, source layer, source entity id.
   A feature that cannot say where it came from does not ship.
3. **`notForIssue` is always `true`.** No configuration path changes it. The human review
   gate is enforced by the type system, not by discipline.
4. **No blocking issue, no ZIP.** A package is only produced when validation passes.
5. **No magic numbers.** Every numeric constant is either a profile field or traceable to
   a numbered rule in `docs/VALIDATION-RULES.md`. `const TOLERANCE = 0.05` with no source
   fails review even when the value is right.
6. **No default CRS.** A project without a declared coordinate system is an error.

---

## 4. Architecture

```
packages/domain      pure logic — parsing, geometry, CRS, validation, packaging
packages/aps-client  Autodesk Platform Services — auth, Model Derivative
apps/api             Hono + OpenAPI REST, thin shell over domain
apps/worker          job runner
apps/web             Next.js UI
apps/mcp             MCP tools, thin shell over the API
```

`packages/domain` is the single source of truth. API, web and MCP add transport and
nothing else. **If a behaviour appears in two of them, it belongs in the domain.**

---

## 5. Working agreement

- `docs/VALIDATION-RULES.md` is the specification. Code follows it; where they disagree,
  the document is updated first.
- Rule IDs are stable. Never renumber. Deprecate instead.
- One rule, one function, at least one test.
- Where the spec says `[DECISION PENDING]`, **stop and ask**. Do not pick a value, infer
  one from existing code, or leave a `TODO` containing a guess.
- Before a multi-file change, write the plan first — file list, new modules, signature
  changes, test list — and get it approved before writing code.

---

## 6. Conventions

- TypeScript, ESM, Node ≥ 20, pnpm workspaces.
- Zod schemas are the contract. Every exported shape is a schema with an inferred type.
- `schemaVersion` on every persisted artefact. Bump it when the shape changes.
- Errors carry a stable code (`IGN_001_NO_ENTITIES`), not just a message.
- Coordinates are `[E, N]` then optional Z, in the project's declared CRS. Never
  latitude/longitude internally — Civil 3D and Revit cannot receive a geographic CRS, so
  a geographic system never becomes a design basis.
- Metres throughout, 3 decimal places when formatted.

---

## 7. Fixtures

`fixtures/` holds real sample data. It exists to prove the product handles real files,
not to make tests pass. A fixture that only works because of a code path that real data
never hits is worse than no fixture.

Fixtures may come from a live project. Treat their contents as confidential and keep them
minimal — a small extract that exercises the rule, not a full submission.
