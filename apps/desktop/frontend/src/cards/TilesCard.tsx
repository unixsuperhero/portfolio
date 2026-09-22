import type { ItemView } from "@portfolio/core";
import { KindBadge } from "@portfolio/ui";

/** App-launcher style grid of large clickable tiles (Homarr-like), used when a query card's config.view is "tiles". */
export function TilesCard({ items, hrefFor }: { items: ItemView[]; hrefFor?: (item: ItemView) => string }) {
  if (!items.length) return <div className="empty"><strong>Nothing matches this card yet.</strong></div>;
  return (
    <div className="tiles-grid">
      {items.map(item => (
        <a key={item.id} className="tile" href={hrefFor?.(item) ?? item.href} data-item={item.id} data-pinned={item.pinned ? "1" : "0"} data-starred={item.starred ? "1" : "0"} data-url={/^https?:\/\//.test(item.href) ? item.href : undefined}>
          <KindBadge type={item.type} />
          <span className="tile-title">{item.title}</span>
        </a>
      ))}
    </div>
  );
}
