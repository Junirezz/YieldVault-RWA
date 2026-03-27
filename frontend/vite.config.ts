/// <reference types="vitest" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    resolve: {
      alias: {
        "es-toolkit/compat/sortBy": "/src/shims/esToolkitSortBy.ts",
      },
    },
    build: {
      sourcemap: true,
    },
    plugins: [
      react(),
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
    },
  };
});
