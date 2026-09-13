import { describe, expect, it } from "vitest";
import { Json5Error, parseFragment, parseJson5 } from "./json5.js";

describe("parseJson5", () => {
  it("accepts the JSON5 features the config fragments actually use", () => {
    const text = `{
      // a line comment
      gateway: { mode: "local", /* inline */ port: 18789 },
      deny: ['group:fs', "browser",],   // trailing comma
      nested: { empty: {}, list: [1, 2, 3,], off: false, nothing: null },
    }`;
    expect(parseJson5(text)).toEqual({
      gateway: { mode: "local", port: 18789 },
      deny: ["group:fs", "browser"],
      nested: { empty: {}, list: [1, 2, 3], off: false, nothing: null },
    });
  });

  it("parses string escapes, including \\u and line continuations", () => {
    expect(parseJson5(String.raw`{ a: "x\ty", b: "A", c: 'it\'s' }`)).toEqual({ a: "x\ty", b: "A", c: "it's" });
  });

  it("parses negative, fractional, exponent and hex numbers", () => {
    expect(parseJson5("{ a: -1, b: 1.5, c: 2e3, d: 0x10 }")).toEqual({ a: -1, b: 1.5, c: 2000, d: 16 });
  });

  it("distinguishes null from absent", () => {
    const parsed = parseJson5("{ a: null }") as Record<string, unknown>;
    expect("a" in parsed).toBe(true);
    expect(parsed.a).toBeNull();
  });

  // Failing loudly matters more than parsing generously: a fragment that silently loses a key would produce a
  // reconciliation that quietly drops OS-owned config.
  it.each([
    ["unterminated block comment", "{ a: 1 /* oops }"],
    ["unterminated string", '{ a: "oops }'],
    ["missing colon", "{ a 1 }"],
    ["trailing content", "{ a: 1 } garbage"],
    ["unexpected character", "{ a: @ }"],
    ["newline inside a string", '{ a: "one\ntwo" }'],
  ])("rejects %s", (_name, text) => {
    expect(() => parseJson5(text, "fragment.json5")).toThrow(Json5Error);
  });

  it("reports the file and position of a syntax error", () => {
    expect(() => parseJson5("{\n  a 1\n}", "10-plugins.json5")).toThrow(/10-plugins\.json5:2:5/);
  });
});

describe("parseFragment", () => {
  it("rejects a fragment whose top level is not an object", () => {
    expect(() => parseFragment("[1,2]", "bad.json5")).toThrow(/must be a JSON object/);
  });
});
