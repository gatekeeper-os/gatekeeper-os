# Troubleshooting

TODO(phase-1..7): grow this from real failures seen in VM runs. Seed entries: gateway not ready (`journalctl --user -u
openclaw-gateway`), port in use (`OPENCLAW_GATEWAY_PORT`), perms (600/700), plugin metadata stale (restart), Docker sandbox
missing (`openclaw sandbox explain`), OAuth callback unreachable on loopback (use device flow or `gateway.bind: tailnet`).
