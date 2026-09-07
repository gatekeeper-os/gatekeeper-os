#!/usr/bin/env node
import("../dist/index.js").then((m) => m.main(process.argv.slice(2))).catch((e) => { console.error(e?.message ?? e); process.exit(1); });
