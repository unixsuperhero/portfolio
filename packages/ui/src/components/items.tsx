import type { ReactNode } from "react";
import { isExternal } from "@portfolio/core/items";
import type { ItemView } from "@portfolio/core";
import { EmptyState, KindBadge, TagList } from "./badges.tsx";

export interface ItemRowProps {
  item: ItemView;
  hrefFor?: (item: ItemView) => string;
  tagHrefFor?: (tag: string) => string;
  onToggle?: (item: ItemView, field: "pinned" | "starred") => void;
  editHref?: (item: ItemView) => string;
  leading?: ReactNode;
  actions?: ReactNode;
}

/** The library row: date column, kind badge and title, description, tags, and pin/star/edit actions. */
export function ItemRow({ item, hrefFor, tagHrefFor, onToggle, editHref, leading, actions }: ItemRowProps) {
  const external = isExternal(item.type);
  return (
    <article className={`item${item.pinned ? " is-pinned" : ""}`} data-item={item.id}>
      {leading}
      <div className="item-date">{item.created_at.slice(0, 10)}</div>
      <div className="item-main">
        <div className="item-line"><KindBadge type={item.type} /><a href={hrefFor?.(item) ?? item.href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>{item.title}</a></div>
        {item.description ? <p>{item.description}</p> : null}
        <TagList tags={item.tags} hrefFor={tagHrefFor} />
      </div>
      <div className="item-actions">
        {onToggle ? <button type="button" className={`icon-button${item.pinned ? " active" : ""}`} title={item.pinned ? "Unpin" : "Pin"} onClick={() => onToggle(item, "pinned")}>Pin</button> : null}
        {onToggle ? <button type="button" className={`icon-button${item.starred ? " active star" : ""}`} title={item.starred ? "Unstar" : "Star"} onClick={() => onToggle(item, "starred")}>★</button> : null}
        {editHref ? <a className="icon-button" href={editHref(item)}>Edit</a> : null}
        {actions}
      </div>
    </article>
  );
}

export interface ItemListProps extends Omit<ItemRowProps, "item"> { items: ItemView[]; emptyTitle?: string; emptyHint?: string }

export function ItemList({ items, emptyTitle = "Nothing here.", emptyHint = "Change the filters or add an item.", ...row }: ItemListProps) {
  if (!items.length) return <EmptyState title={emptyTitle} hint={emptyHint} />;
  return <div className="items">{items.map(item => <ItemRow key={item.id} item={item} {...row} />)}</div>;
}
