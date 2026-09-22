import type { ReactNode } from "react";
import { CARD_SORT_LABELS } from "@portfolio/core";
import type { CardSpec, ItemView } from "@portfolio/core";
import { KindBadge, Tag } from "./badges.tsx";
import { RailSection } from "./rail.tsx";

/** The line under a card header that says what the card matches: tag pills, type badges, and the sort. */
export function CardQuery({ card, tagHrefFor }: { card: CardSpec; tagHrefFor?: (tag: string) => string }) {
  const empty = !card.tags.length && !card.types.length;
  return (
    <div className="card-query">
      {card.tags.map(tag => <Tag key={tag} name={tag} href={tagHrefFor?.(tag)} />)}
      {card.types.map(type => <KindBadge key={type} type={type} />)}
      {empty ? <span>everything</span> : null}
      <span className="card-sort">{CARD_SORT_LABELS[card.sort_key]} {card.sort_dir === "asc" ? "↑" : "↓"}</span>
    </div>
  );
}

export interface PortfolioCardProps {
  card: CardSpec & { id?: number };
  items: ItemView[];
  /** How many items match before the cap; the header shows `shown of total` when capped. */
  total?: number;
  hrefFor?: (item: ItemView) => string;
  tagHrefFor?: (tag: string) => string;
  onOpen?: (item: ItemView) => void;
  emptyText?: string;
  /** Anything to render under the list, usually a CardEditor or a details panel. */
  footer?: ReactNode;
  className?: string;
}

/**
 * One portfolio card: a saved query and what it matched right now.
 * Header: title and count. Query line: tags, types, sort. Body: rail items
 * showing the date the card sorts by. Footer: whatever the caller passes.
 */
export function PortfolioCard({ card, items, total = items.length, hrefFor, tagHrefFor, onOpen, emptyText = "Nothing matches this card yet.", footer, className = "" }: PortfolioCardProps) {
  const count = total > items.length ? `${items.length} of ${total}` : String(total);
  return (
    <RailSection
      className={`portfolio-card ${className}`.trim()}
      title={card.title}
      count={count}
      items={items}
      emptyText={emptyText}
      subheader={<CardQuery card={card} tagHrefFor={tagHrefFor} />}
      itemProps={{ showKind: true, dateKey: card.sort_key === "updated_at" ? "updated_at" : "created_at", hrefFor, onOpen }}
      footer={footer}
    />
  );
}

export interface PortfolioGridProps<T extends CardSpec & { id: number }> {
  cards: (T & { items: ItemView[]; total: number })[];
  hrefFor?: (item: ItemView) => string;
  tagHrefFor?: (tag: string) => string;
  onOpen?: (item: ItemView) => void;
  /** Per-card footer, e.g. an edit panel. */
  footerFor?: (card: T) => ReactNode;
  /** A trailing cell, e.g. the "+ Add card" panel. */
  trailing?: ReactNode;
}

/** Three cards per row (two, then one, as the viewport narrows). */
export function PortfolioGrid<T extends CardSpec & { id: number }>({ cards, hrefFor, tagHrefFor, onOpen, footerFor, trailing }: PortfolioGridProps<T>) {
  return (
    <div className="portfolio-grid">
      {cards.map(card => <PortfolioCard key={card.id} card={card} items={card.items} total={card.total} hrefFor={hrefFor} tagHrefFor={tagHrefFor} onOpen={onOpen} footer={footerFor?.(card)} />)}
      {trailing}
    </div>
  );
}
