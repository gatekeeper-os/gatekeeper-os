import { beforeEach, describe, expect, it, vi } from "vitest";
import { readOwnedConfig } from "./openclaw.js";
import { resolveCell } from "./cell.js";
import { run } from "./proc.js";
vi.mock("./proc.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./proc.js")>();
  return { ...actual, run: vi.fn() };
});
const mocked = vi.mocked(run);
beforeEach(() => { mocked.mockReset(); });
describe("ownership snapshot failures", () => {
  it("accepts only upstream's explicit unset-path verdict as absence", () => {
    mocked.mockImplementation((_cmd, args) => ({ code: 1, stderr: "", stdout: JSON.stringify({
      ok: false, error: { message: `Config path is valid but unset: ${args[2]}. The runtime default applies.` }
    }) }));
    expect(readOwnedConfig(resolveCell())).toEqual({});
  });
  it("does not treat a failed read as an absent path", () => {
    mocked.mockReturnValue({code: 1, stdout: JSON.stringify({ok:false, error:{message:"permission denied"}}), stderr:""});
    expect(() => readOwnedConfig(resolveCell())).toThrow(/refusing reconciliation/);
  });
  it("does not accept unparseable successful output", () => {
    mocked.mockReturnValue({code: 0, stdout: "not json", stderr:""});
    expect(() => readOwnedConfig(resolveCell())).toThrow(/refusing reconciliation/);
  });
});
