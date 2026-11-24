import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Page tests take several steps, each allowed 5 s (asyncUtilTimeout in setup.ts). On a busy
    // CI runner the first test in a file also pays for the first render, and whole tests went past
    // the default 5 s limit although every step finished. 15 s leaves room for that.
    testTimeout: 15000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
