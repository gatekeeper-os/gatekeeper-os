#!/usr/bin/env bash
set -euo pipefail

export GKOS_SPIKE_VM=1
state_dir="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
config_path="${OPENCLAW_CONFIG_PATH:-$state_dir/openclaw.json}"
evidence_dir="${1:-$HOME/phase-3-evidence}"
backup=""
model_pid=""
cleanup_done=false

cleanup() {
  if [ "$cleanup_done" = true ]; then
    return
  fi
  cleanup_done=true

  if [ -n "$model_pid" ] && kill -0 "$model_pid" >/dev/null 2>&1; then
    kill "$model_pid" >/dev/null 2>&1 || true
  fi

  if [ -n "$backup" ] && [ -f "$backup" ]; then
    if [ -f "$config_path" ]; then
      rm -f "$config_path"
    fi
    mv "$backup" "$config_path"
  fi
}

trap cleanup EXIT

if [ ! -f "$config_path" ] || [ ! -d "$state_dir" ]; then
  echo "phase-3 deterministic turns require an active openclaw config/state" >&2
  exit 1
fi

mkdir -p "$evidence_dir"
backup="${state_dir}/openclaw.json.phase-3-backup"
cp "$config_path" "$backup"

node - <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const configPath = process.env.OPENCLAW_CONFIG_PATH;
const stateDir = process.env.OPENCLAW_STATE_DIR;
if (!configPath || !stateDir) throw new Error('Missing OPENCLAW_CONFIG_PATH/OPENCLAW_STATE_DIR');
const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
cfg.models ??= {};
cfg.models.providers ??= {};
cfg.models.providers.spike = {
  baseUrl: 'http://127.0.0.1:19101/v1',
  api: 'openai-completions',
  apiKey: randomBytes(32).toString('hex'),
  models: [{ id: 'spike', name: 'Deterministic test model', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1024 }],
};
cfg.agents ??= {};
cfg.agents.defaults ??= {};
cfg.agents.defaults.workspace ??= `${stateDir}/workspace`;
cfg.agents.defaults.model = { primary: 'spike/spike' };
cfg.agents.list ??= [];
if (!cfg.agents.list.find((agent) => agent.id === 'main')) cfg.agents.list.push({ id: 'main', default: true });
writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
NODE

node scripts/spike-model.mjs >"$evidence_dir/spike-model.log" 2>&1 &
model_pid=$!
sleep 1

openclaw config validate >/dev/null 2>&1 || true

set +e
openclaw agent --agent main --session-id phase-3-turn --message "Describe available filesystem tools." --json >"$evidence_dir/agent-turn.json" 2>"$evidence_dir/agent-turn.err"
status=$?
set -e

if [ -f "$state_dir/os/model-tools.jsonl" ]; then
  cp "$state_dir/os/model-tools.jsonl" "$evidence_dir/model-tools.jsonl"
fi

if [ -f "$state_dir/os/audit-log.jsonl" ]; then
  cp "$state_dir/os/audit-log.jsonl" "$evidence_dir/audit-log.jsonl"
fi

node -e "const fs=require('fs');console.log(JSON.stringify({session:'phase-3-turn',modelLogExists:fs.existsSync(process.argv[1]+'/model-tools.jsonl'),agentExitStatus:parseInt(process.argv[2],10)},null,2));" "$state_dir" "$status" > "$evidence_dir/model-summary.json"

exit "$status"
