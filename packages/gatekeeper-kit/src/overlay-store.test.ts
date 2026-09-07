import { describe, expect, it } from "vitest";
import { OverlayStore } from "./overlay-store.js";

describe("OverlayStore", () => {
  it("reflects pending and forgets rejected", () => {
    const o = new OverlayStore();
    o.add({ actionId: 1, kind: "comment", payload: { body: "hi" } });
    const merge = { comment: (v: string[], e: { payload: unknown }) => [...v, (e.payload as { body: string }).body] };
    expect(o.applyTo(["a"], merge)).toEqual(["a", "hi"]);
    o.remove(1);
    expect(o.applyTo(["a"], merge)).toEqual(["a"]);
  });
});
