import { describe, it, expect } from "vitest";
import { pkg001, pkg002, pkg003, pkg004, pkg005 } from "../../rules/pkg/index.js";
import { baseCollection, ldipProfile } from "../helpers.js";

describe("PKG rules", () => {
  it("PKG-001: notForIssue must be true", () => {
    const ok = pkg001.run({
      profile: ldipProfile(),
      collection: baseCollection(),
      packageDraft: { manifest: { notForIssue: true } },
    });
    expect(ok).toHaveLength(0);
    const bad = pkg001.run({
      profile: ldipProfile(),
      collection: baseCollection(),
      packageDraft: { manifest: { notForIssue: false as unknown as true } },
    });
    expect(bad[0]?.code).toBe("PKG-001");
  });

  it("PKG-002: ZIP↔manifest mismatch → blocking", () => {
    const issues = pkg002.run({
      profile: ldipProfile(),
      collection: baseCollection(),
      packageDraft: {
        manifest: { files: ["manifest.json", "a.json"] },
        zipFiles: ["manifest.json"],
      },
    });
    expect(issues[0]?.severity).toBe("blocking");
  });

  it("PKG-003: generatedAt must match", () => {
    const issues = pkg003.run({
      profile: ldipProfile(),
      collection: baseCollection(),
      packageDraft: {
        manifest: { generatedAt: "2020-01-01T00:00:00.000Z" },
        validationGeneratedAt: "2020-01-02T00:00:00.000Z",
      },
    });
    expect(issues[0]?.code).toBe("PKG-003");
  });

  it("PKG-004: blockingCount>0 with hasZip → issue", () => {
    const issues = pkg004.run({
      profile: ldipProfile(),
      collection: baseCollection(),
      packageDraft: { blockingCount: 2, hasZip: true },
    });
    expect(issues[0]?.code).toBe("PKG-004");
  });

  it("PKG-005: manifest records profile id and schemaVersion", () => {
    const issues = pkg005.run({
      profile: ldipProfile(),
      collection: baseCollection(),
      packageDraft: { manifest: { notForIssue: true } },
    });
    expect(issues.some((i) => i.code === "PKG-005")).toBe(true);
    const ok = pkg005.run({
      profile: ldipProfile(),
      collection: baseCollection(),
      packageDraft: {
        manifest: { notForIssue: true, profileId: "ldip-tawazun", profileSchemaVersion: "1.0.0" },
      },
    });
    expect(ok).toHaveLength(0);
  });
});
