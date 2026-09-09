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
