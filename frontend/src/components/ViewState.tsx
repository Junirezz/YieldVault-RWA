import type { ReactNode } from "react";

interface ViewStateProps {
  title: string;
  description: string;
  tone?: "default" | "error";
  action?: ReactNode;
}

export default function ViewState({
  title,
  description,
  tone = "default",
  action,
}: ViewStateProps) {
  return (
    <div
      className={`view-state ${tone === "error" ? "view-state-error" : ""}`}
      role={tone === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      <h2 className="view-state-title">{title}</h2>
      <p className="view-state-description">{description}</p>
      {action ? <div className="view-state-action">{action}</div> : null}
    </div>
  );
}
