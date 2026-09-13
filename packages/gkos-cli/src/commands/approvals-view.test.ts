import { expect, it } from 'vitest';
import { approvalView } from './approvals-view.js';
const row={id:1,status:'pending',descriptionJson:JSON.stringify({title:'Comment',description:'Add a comment',actionKind:{tag:'github.issue.comment'},implementsRevert:true,preview:{body:'visible only on request'}})};
it('shows a bounded table without bodies, and an explicit preview',()=>{
  const list=approvalView({actions:[row]});expect(list).toContain('github.issue.comment');expect(list).not.toContain('visible only');
  expect(approvalView({actions:[row]},true)).toContain('visible only on request');
});
it('neutralizes terminal, bidi and newline injection in metadata',()=>{
  const view=approvalView({actions:[{...row,descriptionJson:JSON.stringify({title:'x\x1b]52;c;evil\x07\nFORGED\u202e'})}]});
  expect(view).not.toMatch(/[\x1b\x07\u202e]/);expect(view).toContain('\\u000a');
});
it('reports malformed metadata and truncation without leaking arbitrary fields',()=>{
  const result=approvalView({actions:[{...row,descriptionJson:'invalid',token:'not-visible'}],truncated:true});
  expect(result).toContain('Preview unavailable');expect(result).toContain('truncated');expect(result).not.toContain('not-visible');
});
