import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { PortfolioSummary } from "../types.ts";
import { createPortfolio, listPortfolios, patchSettings } from "../api.ts";

export default function Portfolios() {
  const [portfolios, setPortfolios] = useState<PortfolioSummary[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const load = () => listPortfolios().then(({ portfolios }) => setPortfolios(portfolios)).catch(() => {});
  useEffect(() => { load(); }, []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    createPortfolio(name.trim(), description.trim()).then(() => { setName(""); setDescription(""); load(); }).catch(() => {});
  };

  return (
    <div>
      <div className="page-header"><h1>Portfolios</h1></div>
      <form className="field-row" onSubmit={submit}>
        <label>Name<input value={name} onChange={event => setName(event.target.value)} required /></label>
        <label>Description<input value={description} onChange={event => setDescription(event.target.value)} /></label>
        <button className="primary" type="submit">Create</button>
      </form>
      <table className="data-table">
        <thead><tr><th>Name</th><th>Description</th><th></th></tr></thead>
        <tbody>
          {portfolios.map(p => (
            <tr key={p.id}>
              <td><Link to={`/portfolios/${p.id}`}>{p.name}</Link></td>
              <td>{p.description}</td>
              <td><button type="button" className="secondary" onClick={() => patchSettings({ home_portfolio_id: p.id })}>Set as homepage</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
