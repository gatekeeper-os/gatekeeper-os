import { defineConfig } from "vitest/config";
export default defineConfig({ test: { name: "@clawkeepers/gatekeeper-mcp", include: ["src/**/*.test.ts"] } });
