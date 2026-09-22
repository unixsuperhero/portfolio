import { useState } from "react";
import type { Pr, PrCheckStatus, PrChecksSummary } from "../types.ts";

function icon(status: PrCheckStatus | PrChecksSummary): string {
  if (status === "success") return "✓";
  if (status === "failure") return "✗";
  if (status === "pending") return "●";
  return "–";
}

/** Checks pill (✓/✗/● with the count of non-ignored checks) that shows the full check list,
 * with ignored checks struck through, on hover or click. */
export function PrChecks({ pr }: { pr: Pr }) {
  const [open, setOpen] = useState(false);
  if (!pr.checks.length) return null;
  const nonIgnored = pr.checks.filter(check => !check.ignored);

  return (
    <span className="pr-checks" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className={`pr-checks-pill pr-checks-${pr.checks_summary}`} onClick={() => setOpen(value => !value)}>
        {icon(pr.checks_summary)} {nonIgnored.length}
      </button>
      {open ? (
        <ul className="pr-checks-list">
          {pr.checks.map(check => (
            <li key={check.name} className={check.ignored ? "pr-check-ignored" : ""}>
              <a href={check.url || undefined} data-url={check.url || undefined}>{icon(check.status)} {check.name}</a>
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}
