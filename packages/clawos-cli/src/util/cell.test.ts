import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertCellName, resolveCell } from "./cell.js";
import { ensureDir, modeOf, writeFileIfChanged } from "./fsx.js";
import { renderDropIn } from "../commands/install.js";
import { checkPermissions, permissionTargets } from "../commands/doctor.js";

describe("assertCellName", () => {
  it.each(["default", "firma", "firm-a", "a", "x1"])("accepts %s", (name) => {
    expect(() => assertCellName(name)).not.toThrow();
  });

  // A cell name becomes a systemd unit name and a directory under $HOME, so traversal and separators are rejected.
  it.each(["", "../evil", "Firm A", "firm_a", "-lead", "trail-", "UPPER", "a".repeat(40), "a/b"])(
    "rejects %s",
    (name) => {
      expect(() => assertCellName(name)).toThrow(/invalid cell name/);
    },
  );
});

describe("resolveCell", () => {
  it("puts the default cell in ~/.openclaw with upstream's unit name", () => {
    const cell = resolveCell("default");
    expect(cell.stateDir).toBe(join(homedir(), ".openclaw"));
    expect(cell.unit).toBe("openclaw-gateway.service");
    expect(cell.env.OPENCLAW_PROFILE).toBe("");
    expect(cell.env.OPENCLAW_CONFIG_PATH).toBe(cell.configPath);
    expect(cell.env.OPENCLAW_GATEWAY_PORT).toBe("18789");
    expect(cell.env.OPENCLAW_NO_AUTO_UPDATE).toBe("1");
  });

  it("maps macOS cells to distinct upstream LaunchAgent labels and rejects reserved collisions", () => {
    expect(resolveCell("default", 18789, "darwin").unit).toBe("ai.openclaw.gateway");
    expect(resolveCell("firma", 18801, "darwin").unit).toBe("ai.openclaw.firma");
    expect(() => resolveCell("gateway", 18789, "darwin")).toThrow(/collides/);
    expect(() => resolveCell("node", 18789, "darwin")).toThrow(/collides/);
  });

  it("uses upstream's profile convention for a named cell", () => {
    const cell = resolveCell("firma", 18801);
    expect(cell.stateDir).toBe(join(homedir(), ".openclaw-firma"));
    expect(cell.osDir).toBe(join(homedir(), ".openclaw-firma", "os"));
    expect(cell.unit).toBe("openclaw-gateway-firma.service");
    expect(cell.env.OPENCLAW_PROFILE).toBe("firma");
    expect(cell.env.OPENCLAW_GATEWAY_PORT).toBe("18801");
  });

  it("gives two cells fully separate state directories and units", () => {
    const a = resolveCell("firma", 18801);
    const b = resolveCell("firmb", 18802);
    expect(a.stateDir).not.toBe(b.stateDir);
    expect(a.unit).not.toBe(b.unit);
    expect(a.port).not.toBe(b.port);
  });
});

describe("renderDropIn", () => {
  it("carries the two environment variables Phase 1 requires", () => {
    const conf = renderDropIn(resolveCell("default"));
    expect(conf).toContain("Environment=OPENCLAW_NO_AUTO_UPDATE=1");
    expect(conf).toContain("Environment=CLAWOS_CELL=default");
    expect(conf).toContain("[Service]");
  });

  it("adds the profile and port for a named cell only", () => {
    expect(renderDropIn(resolveCell("firma", 18801))).toContain("Environment=OPENCLAW_PROFILE=firma");
    expect(renderDropIn(resolveCell("default"))).not.toContain("OPENCLAW_PROFILE");
  });

  it("references the token by file, never inlining it into the unit", () => {
    const conf = renderDropIn(resolveCell("default"));
    expect(conf).toContain("EnvironmentFile=-");
    expect(conf).not.toMatch(/Environment=CLAWOS_GATEWAY_TOKEN=/);
  });
});

describe("fsx", () => {
  it("creates directories at 700 and repairs a drifted mode", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "clawos-fsx-")), "os");
    expect(ensureDir(dir, 0o700)).toBe(true);
    expect(modeOf(dir)).toBe(0o700);
    expect(ensureDir(dir, 0o700)).toBe(false); // idempotent
    chmodSync(dir, 0o755);
    expect(ensureDir(dir, 0o700)).toBe(true); // repaired
    expect(modeOf(dir)).toBe(0o700);
  });

  it("writes at 600 and reports no change on an identical rewrite", () => {
    const file = join(mkdtempSync(join(tmpdir(), "clawos-fsx-w-")), "cell.key");
    expect(writeFileIfChanged(file, "secret\n", 0o600)).toBe(true);
    expect(modeOf(file)).toBe(0o600);
    expect(writeFileIfChanged(file, "secret\n", 0o600)).toBe(false);
    expect(writeFileIfChanged(file, "other\n", 0o600)).toBe(true);
  });

  it("repairs a drifted mode even when the content is unchanged", () => {
    const file = join(mkdtempSync(join(tmpdir(), "clawos-fsx-m-")), "openclaw.json");
    writeFileIfChanged(file, "{}\n", 0o600);
    chmodSync(file, 0o644);
    expect(writeFileIfChanged(file, "{}\n", 0o600)).toBe(true);
    expect(modeOf(file)).toBe(0o600);
  });
});

describe("checkPermissions", () => {
  it("names every path the Phase 1 criterion covers", () => {
    const paths = permissionTargets("/state").map((t) => t.path);
    expect(paths).toEqual(["/state", "/state/openclaw.json", "/state/os", "/state/os/cell.key", "/state/.env"]);
  });

  it("reports a world-readable config as an error with a chmod hint", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "clawos-perm-"));
    chmodSync(stateDir, 0o700);
    writeFileSync(join(stateDir, "openclaw.json"), "{}");
    chmodSync(join(stateDir, "openclaw.json"), 0o644);
    const findings = checkPermissions(stateDir);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("error");
    expect(findings[0]!.hint).toMatch(/^chmod 600 /);
  });

  it("reports nothing when every present path has the required mode", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "clawos-perm-ok-"));
    chmodSync(stateDir, 0o700);
    writeFileIfChanged(join(stateDir, "openclaw.json"), "{}\n", 0o600);
    expect(checkPermissions(stateDir)).toEqual([]);
  });
});
