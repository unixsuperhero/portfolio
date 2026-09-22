import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { normalizeCard, runCard } from "@portfolio/core";
import { CardEditor, CardForm, CardQuery, ItemList, ItemRow, KindBadge, PortfolioCard, PortfolioGrid, RailSection, Tag, TagList } from "../src/index.ts";
import { toHtml } from "../src/server.ts";
import { CARDS, ITEMS } from "../demo/sample.ts";

const html = (element: React.ReactElement) => renderToStaticMarkup(element);

describe("badges", () => {
  test("kind and tags", () => {
    expect(html(<KindBadge type="pr" />)).toBe('<span class="kind">PR</span>');
    expect(html(<Tag name="yt" href="/tags/1" />)).toBe('<a class="tag" href="/tags/1">yt</a>');
    expect(html(<Tag name="yt" onClick={() => {}} />)).toContain("<button");
    expect(html(<TagList tags={[]} />)).toBe("");
    expect(html(<TagList tags={["a", "b"]} />)).toContain('<span class="tag">b</span>');
  });
});

describe("PortfolioCard", () => {
  const card = CARDS[0];
  const result = runCard(card, ITEMS);
  test("header, count, query line, sorted items, external links", () => {
    const out = html(<PortfolioCard card={card} items={result.items} total={result.total} tagHrefFor={tag => `/t/${tag}`} />);
    expect(out).toContain('<section class="rail-section portfolio-card">');
    expect(out).toContain("<h2>YouTube pipeline</h2>");
    expect(out).toContain(`<span>${result.total}</span>`);
    expect(out).toContain('<a class="tag" href="/t/yt">yt</a>');
    expect(out).toContain('<span class="card-sort">Title ↑</span>');
    const titles = [...out.matchAll(/class="rail-item[^"]*"[^>]*><a href="[^"]+"[^>]*>([^<]+)<\/a>/g)].map(m => m[1]);
    expect(titles).toEqual(["Procedural thinking: complete master list", "remotion.dev/docs", "Slides: data-first design", "Video intro beats"]);
    expect(out).toContain('target="_blank" rel="noreferrer">remotion.dev/docs</a>');
    expect(out).toContain('<article class="rail-item is-pinned"');
  });
  test("capped count, empty state, updated_at date, footer", () => {
    const capped = html(<PortfolioCard card={{ ...card, max_items: 2 }} items={result.items.slice(0, 2)} total={result.total} footer={<p>foot</p>} />);
    expect(capped).toContain(`<span>2 of ${result.total}</span>`);
    expect(capped).toContain("<p>foot</p>");
    const empty = html(<PortfolioCard card={CARDS[3]} items={[]} total={0} />);
    expect(empty).toContain('<div class="rail-empty">Nothing matches this card yet.</div>');
    expect(empty).toContain('<span class="tag">future-tag</span>');
    const byUpdated = html(<PortfolioCard card={CARDS[1]} items={runCard(CARDS[1], ITEMS).items} />);
    expect(byUpdated).toContain('<time dateTime="2026-09-22 10:00:00">2026-09-22</time>');
    expect(html(<CardQuery card={normalizeCard({})} />)).toContain("<span>everything</span>");
  });
  test("grid renders every card plus the trailing cell", () => {
    const out = html(<PortfolioGrid cards={CARDS.map(c => ({ ...c, ...runCard(c, ITEMS) }))} trailing={<div id="add" />} footerFor={c => <i>{c.id}</i>} />);
    expect(out.match(/portfolio-card/g)).toHaveLength(4);
    expect(out).toContain('<div id="add"></div>');
    expect(out).toContain("<i>3</i>");
  });
});

describe("forms and lists", () => {
  test("CardForm reflects its value; CardEditor wraps it in details", () => {
    const out = html(<CardForm value={CARDS[0]} onSubmit={() => {}} submitLabel="Go" />);
    expect(out).toContain('value="YouTube pipeline"');
    expect(out).toContain('value="yt, slides"');
    expect(out).toContain('<option value="title" selected="">Title</option>');
    expect(out).toContain('<button class="primary" type="submit">Go</button>');
    const editor = html(<CardEditor value={CARDS[0]} onSubmit={() => {}} onMove={() => {}} onDelete={() => {}} open />);
    expect(editor).toContain('<details class="card-edit" open="">');
    expect(editor).toContain('class="danger"');
  });
  test("ItemRow and ItemList", () => {
    const row = html(<ItemRow item={ITEMS[0]} tagHrefFor={tag => `/t/${tag}`} editHref={item => `/e/${item.id}`} onToggle={() => {}} />);
    expect(row).toContain('<article class="item is-pinned" data-item="1">');
    expect(row).toContain('<span class="kind">DOC</span>');
    expect(row).toContain('href="/t/yt"');
    expect(row).toContain('href="/e/1"');
    expect(html(<ItemList items={[]} />)).toContain("<strong>Nothing here.</strong>");
    expect(html(<RailSection title="Links" count={2} items={[]} onAdd={() => {}} />)).toContain('class="rail-add"');
  });
  test("toHtml helper", () => {
    expect(toHtml(KindBadge, { type: "dir" })).toBe('<span class="kind">DIR</span>');
  });
});
