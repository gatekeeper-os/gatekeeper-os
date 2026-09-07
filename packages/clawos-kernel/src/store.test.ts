import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "./store.js";

describe("Store", () => {
  it("migrates and answers isActiveHandle=false for unknown handles", () => {
    const s = new Store(join(mkdtempSync(join(tmpdir(), "st-")), "clawos.sqlite"));
    s.migrate();
    expect(s.isActiveHandle("grant:aaaaaaaa")).toBe(false);
    expect(s.countPending()).toBe(0);
  });
});
