import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";
import { ToastProvider } from "./context/ToastContext.tsx";
import { VaultProvider } from "./context/VaultContext.tsx";
import { queryClient } from "./lib/queryClient.ts";
import { QueryClientProvider } from "@tanstack/react-query";

import { initSentry } from "./config/sentry.ts";
import { setupLogging } from "./lib/logger.ts";

// Initialize sentry
initSentry();

// Activate structured JSON logging via the telemetry bus
setupLogging();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <VaultProvider>
            <App />
          </VaultProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
