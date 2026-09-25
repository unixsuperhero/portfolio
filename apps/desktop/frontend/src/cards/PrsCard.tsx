import type { PrList } from "../types.ts";
import { PrRow } from "../components/PrRow.tsx";
import { usePrData } from "../hooks/usePrData.tsx";
import { useConfirm } from "../components/ConfirmDialog.tsx";

/** The `prs` card kind: renders one of the three PR search lists (config.list) inside a
 * portfolio, using the same PrRow as the /prs page. */
export function PrsCard({ list }: { list: PrList }) {
  const { data, loading, reload } = usePrData();
  const { confirm, dialog } = useConfirm();
  const prs = data[list] ?? [];

  if (loading) return <div className="empty"><strong>Loading…</strong></div>;
  if (!prs.length) return <div className="empty"><strong>No pull requests.</strong></div>;
  return (
    <div className="pr-list">
      {prs.map(pr => <PrRow key={pr.id} pr={pr} onChanged={() => void reload().catch(() => {})} confirm={confirm} />)}
      {dialog}
    </div>
  );
}
