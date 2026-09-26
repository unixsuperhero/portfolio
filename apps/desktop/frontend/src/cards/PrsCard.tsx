import { useMemo } from "react";
import { PrRow } from "../components/PrRow.tsx";
import { usePrData } from "../hooks/usePrData.tsx";
import { useConfirm } from "../components/ConfirmDialog.tsx";
import { filterPortfolioPrs } from "../lib/pr-collection.ts";

export function PrsCard({ query, scopeActive, scopeItemIds }: { query: string; scopeActive: boolean; scopeItemIds: number[] }) {
  const { data, loading, reload } = usePrData();
  const { confirm, dialog } = useConfirm();
  const prs = useMemo(() => {
    const all = [...new Map([...data.mine, ...data.review_requested, ...data.watched, ...data.ignored].map(pr => [pr.id, pr])).values()];
    const hidden = new Set(data.ignored.map(pr => pr.id));
    return filterPortfolioPrs(all, hidden, query, scopeActive ? scopeItemIds : null);
  }, [data, query, scopeActive, scopeItemIds]);

  if (loading) return <div className="empty"><strong>Loading…</strong></div>;
  if (!prs.length) return <div className="empty"><strong>No pull requests.</strong></div>;
  return <div className="pr-list">
    {prs.map(pr => <PrRow key={pr.id} pr={pr} onChanged={() => void reload().catch(() => {})} confirm={confirm} />)}
    {dialog}
  </div>;
}
