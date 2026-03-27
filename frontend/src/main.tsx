import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";
import { ThemeProvider } from "./context/ThemeContext.tsx";
import { ToastProvider } from "./context/ToastContext.tsx";
import { VaultProvider } from "./context/VaultContext.tsx";

import { initSentry } from "./config/sentry.ts";
import { setupLogging } from "./lib/logger.ts";

// Initialize sentry
initSentry();

// Activate structured JSON logging via the telemetry bus
setupLogging();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <VaultProvider>
            <App />
          </VaultProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
