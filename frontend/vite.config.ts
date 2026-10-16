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
      // Warn when any individual chunk exceeds 500 kB (uncompressed).
      // The CI size-gate uses gzip budgets defined in package.json bundlesize.
      chunkSizeWarningLimit: 500,
      rollupOptions: {
        output: {
          /**
           * Manual chunk splitting keeps heavy third-party libraries out of the
           * main entry chunk so the critical path loads fast and each vendor
           * chunk is cached independently.
           *
           * Chunk budget targets (gzip) — enforced in CI via bundlesize:
           *   main          ≤ 150 kB
           *   vendor-charts ≤ 200 kB   (recharts + d3 transitive deps)
           *   vendor-motion ≤ 100 kB   (framer-motion)
           *   vendor-stellar ≤ 300 kB  (stellar-sdk + freighter-api)
           *   vendor-sentry  ≤ 150 kB  (@sentry/react + @sentry/core)
           *   vendor-react   ≤ 60 kB   (react + react-dom)
           */
          manualChunks(id) {
            // Recharts and its d3 transitive dependencies
            if (
              id.includes("node_modules/recharts") ||
              id.includes("node_modules/d3-") ||
              id.includes("node_modules/victory-vendor")
            ) {
              return "vendor-charts";
            }

            // Framer Motion
            if (id.includes("node_modules/framer-motion")) {
              return "vendor-motion";
            }

            // Stellar SDK and Freighter wallet API
            if (
              id.includes("node_modules/@stellar") ||
              id.includes("node_modules/stellar-sdk")
            ) {
              return "vendor-stellar";
            }

            // Sentry (keep separate so it never blocks page paint)
            if (id.includes("node_modules/@sentry")) {
              return "vendor-sentry";
            }

            // React runtime — tiny chunk, cached forever
            if (
              id.includes("node_modules/react/") ||
              id.includes("node_modules/react-dom/") ||
              id.includes("node_modules/scheduler/")
            ) {
              return "vendor-react";
            }
          },
        },
      },
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
