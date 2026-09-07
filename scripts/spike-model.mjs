// Test-only OpenAI-compatible model. Never persists prompts, headers or response bodies.
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
if (process.env.CLAWOS_SPIKE_VM !== '1') throw new Error('Test VM required');
let serial = 0;
let toolCalls = 0;
const server = createServer(async (req, res) => {
  if (req.method !== 'POST') { res.writeHead(200); res.end('{}'); return; }
  try {
    let input = '';
    for await (const chunk of req) {
      input += chunk;
      if (input.length > 2_000_000) { res.writeHead(413); res.end(); return; }
    }
    const request = JSON.parse(input);
    const names = (request.tools ?? []).map(t => t.function?.name ?? t.name);
    appendFileSync(join(process.env.OPENCLAW_STATE_DIR, 'os', 'model-tools.jsonl'), JSON.stringify({ names })+'\n', { mode: 0o600 });
    const messages = request.messages ?? [];
    const lastUser = messages.findLastIndex(m => m.role === 'user');
    const alreadyCalled = messages.slice(lastUser+1).some(m => m.role === 'tool');
    const selected = names.includes('probe_late') && toolCalls % 2 ? 'probe_late' : 'probe_echo';
    const call = !alreadyCalled && names.includes(selected);
    if (call) toolCalls++;
    const id = `probe-${++serial}`;
    const message = call ? {role:'assistant',content:null,tool_calls:[{id,type:'function',function:{name:selected,arguments:'{}'}}]} : {role:'assistant',content:'probe-complete'};
    if (request.stream) {
      res.writeHead(200, {'Content-Type':'text/event-stream'});
      const delta = call ? {role:'assistant',tool_calls:[{index:0,...message.tool_calls[0]}]} : {role:'assistant',content:'probe-complete'};
      for (const part of [{delta,finish_reason:null},{delta:{},finish_reason:call?'tool_calls':'stop'}])
        res.write('data: '+JSON.stringify({id,object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:'spike',choices:[{index:0,...part}]})+'\n\n');
      res.end('data: [DONE]\n\n');
    } else {
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({id,object:'chat.completion',model:'spike',choices:[{index:0,message,finish_reason:call?'tool_calls':'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}));
    }
  } catch { res.writeHead(400); res.end('{}'); }
});
server.listen(19101,'127.0.0.1');
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>process.exit(0)));
