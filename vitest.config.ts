import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    // Mirror the "@/*" path alias from tsconfig.json so tests can import the
    // same way application code does.
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
  },
});
