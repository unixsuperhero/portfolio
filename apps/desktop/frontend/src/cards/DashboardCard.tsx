import type { ReactNode } from "react";
import type { PortfolioCardResult } from "../types.ts";
import { QueryCard } from "./QueryCard.tsx";
import { RemindersCard } from "./RemindersCard.tsx";
import { PortsCard } from "./PortsCard.tsx";
import { ClockCard } from "./ClockCard.tsx";
import { NoteCard } from "./NoteCard.tsx";
import { ServicesCard } from "./ServicesCard.tsx";
import { PrsCard } from "./PrsCard.tsx";
import { TasksCard } from "./TasksCard.tsx";

/** Renders any card by kind and passes the portfolio's linked-item scope to data widgets. */
export function DashboardCard({ card, footer, onChanged, scopeActive, scopeItemIds }: { card: PortfolioCardResult; footer?: ReactNode; onChanged: () => void; scopeActive: boolean; scopeItemIds: number[] }) {
  if (card.kind === "query") return <QueryCard card={card} footer={footer} />;

  const config = card.config ?? {};
  let body: ReactNode;
  switch (card.kind) {
    case "tasks":
      body = <TasksCard scopeActive={scopeActive} scopeItemIds={scopeItemIds} />;
      break;
    case "reminders":
      body = <RemindersCard scope={(config.scope as "today" | "all") ?? "today"} scopeActive={scopeActive} scopeItemIds={scopeItemIds} />;
      break;
    case "ports":
      body = <PortsCard projectId={config.project_id as number | undefined} scopeActive={scopeActive} scopeItemIds={scopeItemIds} />;
      break;
    case "clock":
      body = <ClockCard format={(config.format as "24h" | "12h") ?? "24h"} />;
      break;
    case "note":
      body = <NoteCard cardId={card.id} title={card.title} text={(config.text as string) ?? ""} onSaved={onChanged} />;
      break;
    case "services":
      body = config.project_id ? <ServicesCard projectId={config.project_id as number} scopeActive={scopeActive} scopeItemIds={scopeItemIds} /> : <div className="empty"><strong>No project configured.</strong></div>;
      break;
    case "prs":
      body = <PrsCard query={typeof config.query === "string" ? config.query : ""} scopeActive={scopeActive} scopeItemIds={scopeItemIds} />;
      break;
    default: {
      const _exhaustive: never = card.kind;
      body = <div className="empty"><strong>Unknown card kind: {_exhaustive}</strong></div>;
    }
  }
  return (
    <section className="rail-section portfolio-card">
      <header><h2>{card.title}</h2></header>
      <div className="card-body">{body}</div>
      {footer}
    </section>
  );
}
