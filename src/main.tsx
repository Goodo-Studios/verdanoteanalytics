import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  tracesSampleRate: 0.1,
  // No-op when VITE_SENTRY_DSN is not set
  sendDefaultPii: false,
  // Defense in depth: strip Authorization headers and bearer tokens from any
  // event before it leaves the browser, so a captured request/breadcrumb never
  // ships the user's Supabase JWT to Sentry.
  beforeSend(event) {
    const scrubHeaders = (headers?: Record<string, unknown>) => {
      if (!headers) return;
      for (const key of Object.keys(headers)) {
        if (/authorization|apikey|token|cookie/i.test(key)) headers[key] = "[redacted]";
      }
    };
    scrubHeaders(event.request?.headers as Record<string, unknown> | undefined);
    if (event.exception?.values) {
      for (const ex of event.exception.values) {
        if (ex.value) ex.value = ex.value.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]");
      }
    }
    return event;
  },
  beforeBreadcrumb(breadcrumb) {
    if (breadcrumb.data && typeof breadcrumb.data === "object") {
      scrubBreadcrumbData(breadcrumb.data as Record<string, unknown>);
    }
    return breadcrumb;
  },
});

function scrubBreadcrumbData(data: Record<string, unknown>) {
  for (const key of Object.keys(data)) {
    if (/authorization|apikey|token|cookie/i.test(key)) data[key] = "[redacted]";
  }
}

createRoot(document.getElementById("root")!).render(<App />);
