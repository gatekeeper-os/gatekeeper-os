import { defineConfig } from "vitest/config";
export default defineConfig({ test: { name: "@gatekeeper-os/gatekeeper-mcp", include: ["src/**/*.test.ts"] } });
