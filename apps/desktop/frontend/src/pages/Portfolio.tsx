import { useEffect, useState } from "react";
import { useParams } from "react-router";
import type { PortfolioView } from "../types.ts";
import { getPortfolio } from "../api.ts";
import { PortfolioBoard } from "../components/PortfolioBoard.tsx";

export default function Portfolio() {
  const { id } = useParams();
  const [portfolio, setPortfolio] = useState<PortfolioView | null>(null);

  const load = () => { if (id) getPortfolio(Number(id)).then(setPortfolio).catch(() => setPortfolio(null)); };
  useEffect(load, [id]);

  if (!portfolio) return <p>Loading…</p>;
  return (
    <div>
      <div className="page-header"><h1>{portfolio.name}</h1></div>
      {portfolio.description ? <p style={{ color: "var(--text2)" }}>{portfolio.description}</p> : null}
      <PortfolioBoard portfolio={portfolio} reload={load} />
    </div>
  );
}
