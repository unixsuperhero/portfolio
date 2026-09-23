import type { ReactNode } from "react";
import type { CardKind } from "@portfolio/core";
import type { PortfolioCardResult } from "../types.ts";
import type { PrList } from "../types.ts";
import { QueryCard } from "./QueryCard.tsx";
import { RemindersCard } from "./RemindersCard.tsx";
import { PortsCard } from "./PortsCard.tsx";
import { ClockCard } from "./ClockCard.tsx";
import { NoteCard } from "./NoteCard.tsx";
import { ServicesCard } from "./ServicesCard.tsx";
import { PrsCard } from "./PrsCard.tsx";
import { TasksCard } from "./TasksCard.tsx";

/** Renders any card by its kind. Non-query kinds get a plain RailSection shell; query cards
 * render through QueryCard (which itself may switch to a tile grid). */
export function DashboardCard({ card, footer, onChanged }: { card: PortfolioCardResult; footer?: ReactNode; onChanged: () => void }) {
  if (card.kind === "query") return <QueryCard card={card} footer={footer} />;

  const config = card.config ?? {};
  let body: ReactNode;
  // "prs" isn't in @portfolio/core's CARD_KINDS yet (the backend agent is adding it); cast so
  // this switches on it ahead of that landing.
  switch (card.kind as CardKind | "prs") {
    case "tasks":
      body = <TasksCard />;
      break;
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
    case "prs":
      body = <PrsCard list={(config.list as PrList) ?? "mine"} />;
      break;
    default:
      body = <div className="empty"><strong>Unknown card kind.</strong></div>;
  }

  return (
    <section className="rail-section portfolio-card">
      <header><h2>{card.title}</h2></header>
      <div className="card-body">{body}</div>
      {footer}
    </section>
  );
}
