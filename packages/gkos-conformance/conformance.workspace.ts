import { defineWorkspace } from "vitest/config";
import { fileURLToPath } from "node:url";
import { testIds } from "./src/runner.js";

const selected = process.env.GKOS_CONFORMANCE_ONLY?.split(",") ?? [...testIds];
if (!selected.length || selected.some(id => !testIds.some(known => known === id))) throw new Error("CONFORMANCE_INVALID_SELECTION");
export default defineWorkspace([{
  test: {
    name: "live-conformance", root: fileURLToPath(new URL(".", import.meta.url)),
    include: selected.map(id => `src/tests/${id}.test.ts`),
    testTimeout: 120_000, hookTimeout: 120_000, fileParallelism: false, passWithNoTests: false,
  },
}]);
