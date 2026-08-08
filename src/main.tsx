import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerServiceWorker } from "./pwa/registerServiceWorker";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  tracesSampleRate: 0.1,
  // No-op when VITE_SENTRY_DSN is not set
});

createRoot(document.getElementById("root")!).render(<App />);

// Fire-and-forget: installability is a progressive enhancement, so a failed or
// unsupported registration must never block the app from rendering. It is still
// reported — the worker is a prerequisite for phone capture, and a silent
// failure would mean share-to-app breaks in production with no signal.
void registerServiceWorker().then((result) => {
  if (result.status === "failed") {
    Sentry.captureException(result.error, {
      tags: { area: "pwa-service-worker" },
    });
  }
});
