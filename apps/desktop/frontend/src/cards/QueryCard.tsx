import type { ReactNode } from "react";
import { PortfolioCard } from "@portfolio/ui";
import type { PortfolioCardResult } from "../types.ts";
import { TilesCard } from "./TilesCard.tsx";

/** A "query" kind card: the saved search, rendered as a list (PortfolioCard) or a tile grid. */
export function QueryCard({ card, footer }: { card: PortfolioCardResult; footer?: ReactNode }) {
  if (card.config?.view === "tiles") {
    return (
      <section className="rail-section portfolio-card">
        <header>
          <h2>{card.title}</h2>
          <div className="rail-heading-actions"><span>{card.total}</span></div>
        </header>
        <div className="card-body"><TilesCard items={card.items} /></div>
        {footer}
      </section>
    );
  }
  return <PortfolioCard card={card} items={card.items} total={card.total} footer={footer} />;
}
