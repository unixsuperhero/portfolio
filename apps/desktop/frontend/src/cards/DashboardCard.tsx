import type { ReactNode } from "react";
import type { PortfolioCardResult } from "../types.ts";
import { QueryCard } from "./QueryCard.tsx";
import { RemindersCard } from "./RemindersCard.tsx";
import { PortsCard } from "./PortsCard.tsx";
import { ClockCard } from "./ClockCard.tsx";
import { NoteCard } from "./NoteCard.tsx";
import { ServicesCard } from "./ServicesCard.tsx";

/** Renders any card by its kind. Non-query kinds get a plain RailSection shell; query cards
 * render through QueryCard (which itself may switch to a tile grid). */
export function DashboardCard({ card, footer, onChanged }: { card: PortfolioCardResult; footer?: ReactNode; onChanged: () => void }) {
  if (card.kind === "query") return <QueryCard card={card} footer={footer} />;

  const config = card.config ?? {};
  let body: ReactNode;
  switch (card.kind) {
    case "reminders":
      body = <RemindersCard scope={(config.scope as "today" | "all") ?? "today"} />;
      break;
    case "ports":
      body = <PortsCard projectId={config.project_id as number | undefined} />;
      break;
    case "clock":
      body = <ClockCard format={(config.format as "24h" | "12h") ?? "24h"} />;
      break;
    case "note":
      body = <NoteCard cardId={card.id} title={card.title} text={(config.text as string) ?? ""} onSaved={onChanged} />;
      break;
    case "services":
      body = config.project_id ? <ServicesCard projectId={config.project_id as number} /> : <div className="empty"><strong>No project configured.</strong></div>;
      break;
    default:
      body = <div className="empty"><strong>Unknown card kind.</strong></div>;
  }

  return (
    <section className="rail-section portfolio-card">
      <header><h2>{card.title}</h2></header>
      {body}
      {footer}
    </section>
  );
}
