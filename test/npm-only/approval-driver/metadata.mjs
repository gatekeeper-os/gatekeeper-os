// Fixed synthetic resource, deliberately distinct from the real filesystem driver.
export const resources=[{type:'record',urlPattern:'https://npm-acceptance.invalid/:path+',title:'Synthetic approval record',description:'VM fixture only',grantable:true,observerStrategy:'low-stakes',tools:['gk_fixture_record_write']}];
export const tools=[{name:'gk_fixture_record_write',resourceType:'record',kind:'action',description:'Record a fixture operation.',parameters:{type:'object',additionalProperties:false,properties:{grant:{type:'string'}},required:['grant']}}];
