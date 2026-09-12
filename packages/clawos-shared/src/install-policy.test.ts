import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateInstall, type InstallMaterial } from "./install-policy.js";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, {recursive:true,force:true}); });
const material: InstallMaterial = {targetType:"plugin",sourcePath:"/staging/plugin",sourcePathKind:"directory",request:{kind:"plugin-install",mode:"install",requestedSpecifier:"npm:@clawkeepers/kernel@0.1.0"}};
describe("shared install boundary", () => {
  it("denies absent/empty/malformed rules and missing requested identity", () => {
    for (const rules of [undefined,{}, {allowSources:[]}]) expect(evaluateInstall(rules,material).decision).toBe("block");
    expect(evaluateInstall({allowSources:["*"]},{...material,request:{kind:"plugin-install",mode:"install"}}).decision).toBe("block");
    expect(evaluateInstall({allowSources:[""]},material).decision).toBe("block");
  });
  it("matches the entire source, escapes regex, and covers updates and skills", () => {
    const rules={allowSources:["npm:@clawkeepers/*"]};
    expect(evaluateInstall(rules,material).decision).toBe("allow");
    for (const requestedSpecifier of ["npm:@clawkeepers-evil/kernel","https://evil/npm:@clawkeepers/kernel", "npm:@clawkeepers/kernel\n"]) expect(evaluateInstall(rules,{...material,request:{...material.request,requestedSpecifier}}).decision).toBe("block");
    expect(evaluateInstall({allowSources:["clawhub:reviewed@1.0.0"]},{...material,targetType:"skill",request:{kind:"skill-install",mode:"update",requestedSpecifier:"clawhub:reviewed@1x0x0"}}).decision).toBe("block");
    expect(evaluateInstall(rules,{...material,targetType:"skill",request:{...material.request,mode:"update"}}).decision).toBe("allow");
  });
  it("does not let registry namespace wildcards authorize URL, file or alias overrides", () => {
    for (const requestedSpecifier of ["npm:@clawkeepers/kernel@https://evil.invalid/p.tgz", "npm:@clawkeepers/kernel@/tmp/evil", "npm:@clawkeepers/kernel@npm:evil@1", "clawhub:@clawkeepers/kernel@file:/tmp/evil", "@clawkeepers/kernel@../evil"]) {
      expect(evaluateInstall({allowSources:["npm:@clawkeepers/*","clawhub:@clawkeepers/*","@clawkeepers/*"]},{...material,request:{...material.request,requestedSpecifier}}).decision).toBe("block");
    }
  });
  it("hashes staged bytes, rejects changed content, symlinks and unmeasured directories", () => {
    const root=mkdtempSync(join(tmpdir(),"install-policy-"));dirs.push(root);
    const file=join(root,"package.tgz");writeFileSync(file,"reviewed");
    const rules={allowHashes:[`sha256:${createHash("sha256").update("reviewed").digest("hex")}`]};
    const input={...material,sourcePath:file,sourcePathKind:"file"};
    expect(evaluateInstall(rules,input).decision).toBe("allow");
    symlinkSync(file,join(root,"link"));expect(evaluateInstall(rules,{...input,sourcePath:join(root,"link")}).decision).toBe("block");
    expect(evaluateInstall(rules,{...input,sourcePath:root,sourcePathKind:"directory"}).decision).toBe("block");
    writeFileSync(file,"unreviewed");expect(evaluateInstall(rules,input).decision).toBe("block");
  });
});
