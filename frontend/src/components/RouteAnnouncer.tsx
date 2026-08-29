import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

function pageTitleFromDocument(): string {
  const heading =
    document.querySelector<HTMLElement>("[data-page-heading]") ??
    document.querySelector<HTMLElement>("h1");
  const text = heading?.textContent?.replace(/\s+/g, " ").trim();
  return text || document.title || "page";
}

/**
 * Announces route changes to assistive technology via an aria-live region.
 */
export default function RouteAnnouncer() {
  const location = useLocation();
  const [message, setMessage] = useState("");

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setMessage(`Navigated to ${pageTitleFromDocument()}`);
    });
    return () => cancelAnimationFrame(frame);
  }, [location.pathname]);

  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}
