import { defineConfig } from "vitest/config";
// Ordinary workspace tests are offline; live acceptance is selected by conformance.workspace.ts only.
export default defineConfig({ test: { include: ["src/unit/**/*.test.ts"] } });
