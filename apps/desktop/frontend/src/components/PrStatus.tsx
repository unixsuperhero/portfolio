export type PrStatusKind = "draft" | "open" | "merged" | "closed" | "approved" | "changes_requested" | "review_required" | "success" | "failure" | "pending" | "skipped" | "cancelled" | "neutral" | "none" | "watched" | "ignored";

export function PrStatusIcon({ kind }: { kind: PrStatusKind }) {
  return <svg className="pr-status-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "open" ? <><circle cx="4" cy="3" r="2" /><circle cx="4" cy="13" r="2" /><circle cx="12" cy="13" r="2" /><path d="M4 5v6M12 11V6a3 3 0 0 0-3-3H8m2-2L8 3l2 2" /></>
      : kind === "merged" ? <><circle cx="4" cy="3" r="2" /><circle cx="4" cy="13" r="2" /><circle cx="12" cy="3" r="2" /><path d="M4 5v6m8-6c0 4-8 2-8 6" /></>
      : kind === "draft" ? <><circle cx="8" cy="8" r="6" strokeDasharray="2 3" /><path d="M6 8h4" /></>
      : kind === "success" || kind === "approved" ? <><circle cx="8" cy="8" r="6" /><path d="m5 8 2 2 4-4" /></>
      : kind === "failure" || kind === "changes_requested" || kind === "closed" || kind === "cancelled" ? <><circle cx="8" cy="8" r="6" /><path d="m6 6 4 4m0-4-4 4" /></>
      : kind === "pending" ? <><circle cx="8" cy="8" r="6" /><path d="M8 4v4l3 2" /></>
      : kind === "review_required" ? <><path d="M2 3h12v8H7l-3 3v-3H2z" /><path d="M5 6h6M5 8h4" /></>
      : kind === "watched" ? <><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5Z" /><circle cx="8" cy="8" r="2" /></>
      : kind === "ignored" ? <><circle cx="8" cy="8" r="6" /><path d="m4 4 8 8" /></>
      : kind === "skipped" ? <><path d="m4 3 6 5-6 5zM12 3v10" /></>
      : <><circle cx="8" cy="8" r="6" /><path d="M5 8h6" /></>}
  </svg>;
}

export function PrStatus({ kind, label }: { kind: PrStatusKind; label: string }) {
  return <span className={`pr-badge pr-tone-${kind}`}><PrStatusIcon kind={kind} />{label}</span>;
}
