import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectPlugins } from "./plugins.js";
import { resolveCell } from "./cell.js";
const dirs: string[]=[];
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
function fixture(){
  const root=mkdtempSync(join(tmpdir(),"plugin-projection-"));dirs.push(root);
  const templates=join(root,"templates"),source=join(templates,"plugins");mkdirSync(source,{recursive:true});
  for(const id of ["gkos-kernel","gkos-gatekeeper-fs"]){mkdirSync(join(source,id));writeFileSync(join(source,id,"package.json"),JSON.stringify({version:"0.1.0"}));}
  writeFileSync(join(source,"install-policy.mjs"), "// standalone policy fixture\n");
  writeFileSync(join(source,"catalog.json"),JSON.stringify({version:1,gatekeepers:[{pluginId:"gkos-gatekeeper-fs"}]}));
  const cell={...resolveCell("unit-test"),stateDir:join(root,"state"),osDir:join(root,"state/os")};
  return {source,templates,cell};
}
it("projects inert defaults, retains local overrides and repeats without changes",()=>{
  const {templates,cell}=fixture();
  expect(projectPlugins(cell,templates).changed).toBe(true);
  const local=join(cell.osDir,"config.d/90-local.json5");writeFileSync(local,"{plugins:{deny:['untrusted']}}");
  expect(projectPlugins(cell,templates).changed).toBe(false);
  expect(readFileSync(local,"utf8")).toContain("untrusted");
  const cfg=JSON.parse(readFileSync(join(cell.osDir,"config.d/15-runtime.json"),"utf8"));
  expect(cfg.plugins.entries["gkos-gatekeeper-fs"].config.roots).toEqual([]);
  expect(cfg.plugins.entries["gkos-kernel"].config.install.allowSources).toEqual([]);
  expect(cfg.security.installPolicy.exec.args.slice(-2)).toEqual(["--cell","unit-test"]);
});
it("refuses corrupt installed content without overwriting it",()=>{
  const {templates,cell}=fixture();projectPlugins(cell,templates);
  const catalog=JSON.parse(readFileSync(join(cell.osDir,"gatekeepers.json"),"utf8"));
  const path=join(catalog.gatekeepers[0].root,"package.json");writeFileSync(path,"corrupt");
  expect(()=>projectPlugins(cell,templates)).toThrow(/refusing in-place overwrite/);
  expect(readFileSync(path,"utf8")).toBe("corrupt");
});
it("rejects symlinked package content",()=>{
  const {templates,source,cell}=fixture();symlinkSync("catalog.json",join(source,"link"));
  expect(()=>projectPlugins(cell,templates)).toThrow(/non-regular/);
});
