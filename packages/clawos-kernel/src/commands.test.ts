import { expect,it } from "vitest";
import { operatorCommand } from "./commands.js";
it("claims only exact operator commands and parses bounded decisions",()=>{
  expect(operatorCommand("Please /approvals apply all")).toBeUndefined();
  expect(operatorCommand("/approvals-else")).toBeUndefined();
  expect(operatorCommand("/approvals")).toEqual({surface:"approvals",verb:"list"});
  expect(operatorCommand("/approvals apply 1,2")).toEqual({surface:"approvals",verb:"apply",ids:[1,2]});
  expect(operatorCommand("/grants revoke grant:abcdefgh")).toEqual({surface:"grants",verb:"revoke",handle:"grant:abcdefgh"});
});
it.each(["/approvals apply 1,1","/approvals apply 0","/approvals apply all extra","/approvals connect fs","/grants revoke missing","/approvals list all"])("denies malformed command %s",body=>{expect(()=>operatorCommand(body)).toThrow();});
it('supports exact short aliases and explicit URL introduction',()=>{
  expect(operatorCommand('/approve 1,2')).toEqual({surface:'approvals',verb:'apply',ids:[1,2]});
  expect(operatorCommand('/reject all')).toEqual({surface:'approvals',verb:'reject',ids:'all'});
  expect(operatorCommand('/grant file:///safe/')).toEqual({surface:'grants',verb:'introduce',url:'file:///safe/'});
  expect(operatorCommand('/approvals preview 1')).toEqual({surface:'approvals',verb:'preview',ids:[1]});
});
it.each(['/approve','/reject 1 extra','/approve 01','/approve 1e2','/grant https://user:password@example.org','/grant https://example.org/?code=abc','/grant javascript:alert(1)'])('rejects malformed short command %s',body=>expect(()=>operatorCommand(body)).toThrow());
