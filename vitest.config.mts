import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    // Mirror the "@/*" path alias from tsconfig.json so tests can import the
    // same way application code does.
    alias: { "@": path.resolve(import.meta.dirname, ".") },
  },
  test: {
    // Two projects, one `npm test` (#289): logic and route handlers run in
    // plain Node; component tests (*.test.tsx) get a jsdom document.
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: [
            "lib/**/*.test.ts",
            "app/**/*.test.ts",
            "components/**/*.test.ts",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["components/**/*.test.tsx", "app/**/*.test.tsx"],
          setupFiles: ["./vitest.setup.dom.ts"],
        },
      },
    ],
  },
});
