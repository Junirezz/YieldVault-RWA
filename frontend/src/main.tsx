import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles/theme.css";
import "./styles/responsive.css";
import "./styles/accessibility.css";
import "./index.css";
import "./i18n";
import App from "./App.tsx";
import { ToastProvider } from "./context/ToastContext.tsx";
import { ThemeProvider } from "./context/ThemeContext.tsx";
import { VaultProvider } from "./context/VaultContext.tsx";
import { queryClient, setupQueryPersistence } from "./lib/queryClient.ts";
import { QueryClientProvider } from "@tanstack/react-query";

import { initSentry } from "./config/sentry.ts";
import { setupLogging } from "./lib/logger.ts";

initSentry();
setupLogging();
setupQueryPersistence(queryClient);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <ToastProvider>
            <VaultProvider>
              <App />
            </VaultProvider>
          </ToastProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
