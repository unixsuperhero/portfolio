import { useEffect, useState } from "react";
import type { Pr, PrList } from "../types.ts";
import { getPrs } from "../api.ts";
import { PrRow } from "../components/PrRow.tsx";
import { useConfirm } from "../components/ConfirmDialog.tsx";

/** The `prs` card kind: renders one of the three PR search lists (config.list) inside a
 * portfolio, using the same PrRow as the /prs page. */
export function PrsCard({ list }: { list: PrList }) {
  const [prs, setPrs] = useState<Pr[] | null>(null);
  const { confirm, dialog } = useConfirm();

  const load = () => {
    getPrs()
      .then(result => setPrs(result[list] ?? []))
      .catch(() => setPrs([]));
  };
  useEffect(() => { load(); }, [list]);

  if (prs === null) return <div className="empty"><strong>Loading…</strong></div>;
  if (!prs.length) return <div className="empty"><strong>No pull requests.</strong></div>;
  return (
    <div className="pr-list">
      {prs.map(pr => <PrRow key={pr.id} pr={pr} onChanged={load} confirm={confirm} />)}
      {dialog}
    </div>
  );
}
