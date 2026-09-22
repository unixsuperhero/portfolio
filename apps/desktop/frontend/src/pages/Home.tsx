import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { PortfolioSummary, PortfolioView } from "../types.ts";
import { getHome, listPortfolios, patchSettings } from "../api.ts";
import { PortfolioBoard } from "../components/PortfolioBoard.tsx";

export default function Home() {
  const [portfolio, setPortfolio] = useState<PortfolioView | null | undefined>(undefined);
  const [portfolios, setPortfolios] = useState<PortfolioSummary[]>([]);

  const load = () => {
    getHome()
      .then(({ portfolio }) => setPortfolio(portfolio))
      .catch(() => setPortfolio(null));
  };

  useEffect(load, []);

  useEffect(() => {
    if (portfolio === null) listPortfolios().then(({ portfolios }) => setPortfolios(portfolios)).catch(() => {});
  }, [portfolio]);

  if (portfolio === undefined) return <p>Loading…</p>;

  if (portfolio === null) {
    return (
      <div>
        <div className="page-header"><h1>Set a homepage</h1></div>
        <p>Pick a portfolio to show here.</p>
        {portfolios.length ? (
          <table className="data-table">
            <thead><tr><th>Name</th><th>Description</th><th></th></tr></thead>
            <tbody>
              {portfolios.map(p => (
                <tr key={p.id}>
                  <td><Link to={`/portfolios/${p.id}`}>{p.name}</Link></td>
                  <td>{p.description}</td>
                  <td><button type="button" className="secondary" onClick={() => patchSettings({ home_portfolio_id: p.id }).then(load)}>Set as homepage</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p>No portfolios yet. <Link to="/portfolios">Create one</Link>.</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="page-header"><h1>{portfolio.name}</h1></div>
      <PortfolioBoard portfolio={portfolio} reload={load} />
    </div>
  );
}
