import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { defineGatekeeper } from "./define-gatekeeper.js";

const base = { vendor: "x", apiVersion: 1 as const, id: "gatekeeper-x" as const, name: "X", description: "d",
  resources: [{ urlPattern: "https://x/:id", type: "thing", title: "T", description: "D", grantable: true, observerStrategy: "low-stakes" as const, tools: ["gk_x_thing_get"] }],
  createVendor: () => { throw new Error("unused"); } };

describe("defineGatekeeper", () => {
  it("rejects a tool without grant", () => {
    expect(() => defineGatekeeper({ ...base, tools: [{ name: "gk_x_thing_get", resourceType: "thing", kind: "observation", description: "Get it.", parameters: Type.Object({}) }] })).toThrow(/grant/);
  });
  it("rejects a leaking description", () => {
    expect(() => defineGatekeeper({ ...base, tools: [{ name: "gk_x_thing_get", resourceType: "thing", kind: "observation", description: "Get it after approval.", parameters: Type.Object({ grant: Type.String() }) }] })).toThrow(/leaks/);
  });
  it("accepts a valid tool", () => {
    expect(() => defineGatekeeper({ ...base, tools: [{ name: "gk_x_thing_get", resourceType: "thing", kind: "observation", description: "Get it.", parameters: Type.Object({ grant: Type.String() }) }] })).not.toThrow();
  });
});
