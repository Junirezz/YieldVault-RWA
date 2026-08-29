/// <reference types="vitest" />
import { defineConfig, loadEnv } from "vite";
import path from "path";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { visualizer } from "rollup-plugin-visualizer";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    resolve: {
      alias: {
        "@yieldvault/api-schemas": path.resolve(__dirname, "../packages/api-schemas/src/index.ts"),
        "zod": path.resolve(__dirname, "node_modules/zod/index.js"),
        "es-toolkit/compat/sortBy": path.resolve(__dirname, "src/shims/esToolkitSortBy.ts"),
      },
    },
    build: {
      sourcemap: true,
    },
    server: {
      watch: {
        ignored: [
          "**/cypress/downloads/**",
          "**/cypress/screenshots/**",
          "**/cypress/videos/**",
        ],
      },
    },
    plugins: [
      react(),
      visualizer({
        filename: "bundle-stats.html",
        open: false,
        gzipSize: true,
        brotliSize: true,
      }),
      sentryVitePlugin({
        authToken: env.SENTRY_AUTH_TOKEN,
        org: "bumblecode-softwares",
        project: "featuer-add-sentry-issue-100",
      }),
    ],
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: "./src/tests/setup.ts",
      css: true,
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
      exclude: ["e2e/**", "node_modules/**", "dist/**"],
      // Fork isolation prevents vi.mock leakage between Portfolio / VaultDashboard suites.
      pool: "forks",
      isolate: true,
      coverage: {
        provider: "v8",
        reporter: ["text", "json", "html", "lcov", "json-summary"],
        thresholds: {
          lines: 70,
          functions: 70,
          branches: 70,
          statements: 70,
        },
      },
    },
  };
});
