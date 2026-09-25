import type { ReactNode } from "react";
import { isExternal } from "@portfolio/core/items";
import type { ItemView } from "@portfolio/core";
import { KindBadge } from "./badges.tsx";

export interface RailItemProps {
  item: ItemView;
  /** Which date to show; cards use their sort key. */
  dateKey?: "created_at" | "updated_at";
  showKind?: boolean;
  hrefFor?: (item: ItemView) => string;
  onOpen?: (item: ItemView) => void;
}

/** One compact row: title link, clamped description, then a mono line with kind, date, and flags. */
export function RailItem({ item, dateKey = "created_at", showKind = false, hrefFor, onOpen }: RailItemProps) {
  const href = hrefFor?.(item) ?? item.href;
  const external = isExternal(item.type);
  const className = `rail-item${item.pinned ? " is-pinned" : ""}${item.starred ? " is-starred" : ""}`;
  return (
    <article className={className} data-item={item.id}>
      <a href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined} onClick={onOpen ? event => { event.preventDefault(); onOpen(item); } : undefined}>{item.title}</a>
      {item.description ? <p>{item.description}</p> : null}
      <div>
        {showKind ? <KindBadge type={item.type} /> : null}
        <time dateTime={item[dateKey]}>{item[dateKey].slice(0, 10)}</time>
        {item.pinned ? <span>Pinned</span> : null}
        {item.starred ? <span>Starred</span> : null}
      </div>
    </article>
  );
}

export interface RailSectionProps {
  title: ReactNode;
  count?: ReactNode;
  items?: ItemView[];
  emptyText?: string;
  onAdd?: () => void;
  addLabel?: string;
  className?: string;
  /** Rendered between the header and the items (the card query line lives here). */
  subheader?: ReactNode;
  /** Rendered after the items (the edit panel lives here). */
  footer?: ReactNode;
  itemProps?: Omit<RailItemProps, "item">;
  children?: ReactNode;
}

/** A bordered panel with a header, an optional count and add button, and a scrolling list. The library's side rails and every portfolio card are one of these. */
export function RailSection({ title, count, items, emptyText = "Nothing here yet.", onAdd, addLabel = "Add", className = "", subheader, footer, itemProps, children }: RailSectionProps) {
  return (
    <section className={`rail-section ${className}`.trim()}>
      <header>
        <h2>{title}</h2>
        <div className="rail-heading-actions">
          {count !== undefined ? <span>{count}</span> : null}
          {onAdd ? <button type="button" className="rail-add" onClick={onAdd} aria-label={addLabel} title={addLabel}>+</button> : null}
        </div>
      </header>
      {subheader}
      {items ? <div className="rail-items">{items.length ? items.map(item => <RailItem key={item.id} item={item} {...itemProps} />) : <div className="rail-empty">{emptyText}</div>}</div> : null}
      {children}
      {footer}
    </section>
  );
}
