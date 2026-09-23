import { useEffect, useRef, useState } from "react";

/** Counts renders after `value` changes, ignoring the first render, so a badge can animate
 * only when its number actually moved in front of the user. */
function useBump(value: number): number {
  const previous = useRef(value);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setBump(current => current + 1);
  }, [value]);
  return bump;
}

const FlameMark = () => (
  <svg className="streak-mark" viewBox="0 0 12 14" width="11" height="13" aria-hidden="true" focusable="false">
    <path d="M6 1.2c.3 2.6 3.4 3.9 3.4 7.2a3.4 3.4 0 0 1-6.8 0c0-1.4.6-2.3 1.3-3.1.4.9.8 1.4 1.5 1.6C5.6 5.4 5.3 3.4 6 1.2Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

/** A run of consecutive daily completions. Shown from the second day, when a count means a run.
 * Ticks upward once when the number advances, so completing today reads as counted. */
export function StreakBadge({ streak, recurrence = "daily", compact = false }: { streak: number; recurrence?: string; compact?: boolean }) {
  const bump = useBump(streak);
  if (recurrence !== "daily" || streak < 2) return null;
  const label = `${streak}-day streak`;
  const className = `streak${compact ? " streak-compact" : ""}${bump ? " streak-tick" : ""}`;
  return compact
    ? <span key={bump} className={className} title={label} aria-label={label}><FlameMark />{streak}</span>
    : <small key={bump} className={className}><FlameMark />{label}</small>;
}

/** Shown once every listed thing is checked. One line, in the product's own words. */
export function AllDone({ children = "All done today." }: { children?: string }) {
  return (
    <p className="all-done" role="status">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path className="all-done-check" d="M4.8 8.3l2.1 2.1 4.3-4.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {children}
    </p>
  );
}
