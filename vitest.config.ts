import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    // Mirror the Next.js + tsconfig path alias so vitest can resolve
    // `@/lib/foo` imports. Without this, every test that touches the
    // @/-aliased imports fails with "Failed to load url @/...".
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
