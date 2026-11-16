// Structural checks for the golden test cases in packages/domain/__fixtures__.
// This validates the test data only; the business rules themselves are implemented in Phase 1.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FIXTURES_DIR = fileURLToPath(new URL("../__fixtures__/", import.meta.url));

type GoldenCase = {
  id: string;
  description: string;
  status: string;
  notes?: string;
  input: unknown;
  expected: unknown;
};

type CaseFile = { module: string; source: string; cases: GoldenCase[] };

const readJson = (file: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, file), "utf8")) as unknown;

const caseFiles = readdirSync(FIXTURES_DIR).filter(
  (f) => f.endsWith(".json") && f !== "settings.default.json",
);

describe("golden fixtures", () => {
  it("has case files", () => {
    expect(caseFiles.length).toBeGreaterThan(0);
  });

  it("default settings include every documented field, including the approved additions", () => {
    const { settings } = readJson("settings.default.json") as { settings: Record<string, unknown> };
    for (const key of ["commission_pct", "mismatch_fee", "checkout_hold_minutes", "cancel_fee"]) {
      expect(settings).toHaveProperty(key);
    }
    expect(settings["cancel_fee"]).toBe(0);
    expect(settings["checkout_hold_minutes"]).toBe(15);
  });

  const seen = new Set<string>();

  for (const file of caseFiles) {
    describe(file, () => {
      const data = readJson(file) as CaseFile;

      it("declares a module, a source and at least one case", () => {
        expect(typeof data.module).toBe("string");
        expect(typeof data.source).toBe("string");
        expect(Array.isArray(data.cases)).toBe(true);
        expect(data.cases.length).toBeGreaterThan(0);
      });

      for (const c of data.cases) {
        it(`${c.id} is well formed`, () => {
          expect(c.id).toMatch(/^[A-Z]{3}-\d{3}$/);
          expect(seen.has(c.id)).toBe(false);
          seen.add(c.id);
          expect(c.description.length).toBeGreaterThan(0);
          expect(["confirmed", "assumption"]).toContain(c.status);
          if (c.status === "assumption") expect(c.notes?.length ?? 0).toBeGreaterThan(0);
          expect(c.input).toBeTypeOf("object");
          expect(c.expected).toBeTypeOf("object");
        });
      }
    });
  }
});
