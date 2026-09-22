import { createRoot } from "react-dom/client";
import { useState } from "react";
import { runCard } from "@portfolio/core";
import type { CardSpec } from "@portfolio/core";
import { CardEditor, CardForm, ItemList, PortfolioCard, PortfolioGrid, RailSection } from "../src/index.ts";
import { CARDS, ITEMS } from "./sample.ts";

function Demo() {
  const [cards, setCards] = useState(CARDS);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  document.documentElement.dataset.theme = theme;
  const withItems = cards.map(card => ({ ...card, ...runCard(card, ITEMS) }));
  const update = (id: number, spec: CardSpec) => setCards(current => current.map(card => card.id === id ? { ...card, ...spec } : card));
  const move = (id: number, direction: "left" | "right") => setCards(current => {
    const index = current.findIndex(card => card.id === id);
    const target = direction === "left" ? index - 1 : index + 1;
    if (target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  return (
    <main style={{ width: "min(1480px, calc(100vw - 2rem))", margin: "0 auto", padding: "2rem 0 6rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "end", borderBottom: "1px solid var(--border)", paddingBottom: "1.5rem" }}>
        <div><h1 style={{ margin: 0, letterSpacing: "-.04em" }}>@portfolio/ui</h1><p style={{ color: "var(--text2)", margin: ".4rem 0 0" }}>PortfolioCard, PortfolioGrid, CardForm, RailSection, ItemList. Edit a card below; the query runs in the browser with runCard().</p></div>
        <button type="button" className="tag" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "Light" : "Dark"} theme</button>
      </header>
      <h2>PortfolioGrid</h2>
      <PortfolioGrid
        cards={withItems}
        tagHrefFor={tag => `#tag-${tag}`}
        footerFor={card => <CardEditor value={card} onSubmit={spec => update(card.id, spec)} onMove={direction => move(card.id, direction)} onDelete={() => setCards(current => current.filter(c => c.id !== card.id))} />}
        trailing={<RailSection className="portfolio-card" title="+ Add card"><CardEditor summary="New card" open onSubmit={spec => setCards(current => [...current, { ...spec, id: Date.now(), portfolio_id: 1, position: current.length + 1 }])} submitLabel="Add card" /></RailSection>}
      />
      <h2 style={{ marginTop: "3rem" }}>A single PortfolioCard, capped</h2>
      <div style={{ maxWidth: "26rem" }}><PortfolioCard card={{ ...withItems[0], max_items: 2 }} items={withItems[0].items.slice(0, 2)} total={withItems[0].total} /></div>
      <h2 style={{ marginTop: "3rem" }}>RailSection (the library's side rails)</h2>
      <div style={{ maxWidth: "18rem" }}><RailSection title="Links" count={2} items={ITEMS.filter(item => item.type === "link")} onAdd={() => alert("add a link")} /></div>
      <h2 style={{ marginTop: "3rem" }}>ItemList (the library rows)</h2>
      <ItemList items={ITEMS.slice(0, 4)} tagHrefFor={tag => `#tag-${tag}`} onToggle={(item, field) => alert(`${field} ${item.title}`)} editHref={item => `#edit-${item.id}`} />
      <h2 style={{ marginTop: "3rem" }}>CardForm on its own</h2>
      <div style={{ maxWidth: "32rem", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)" }}><CardForm onSubmit={spec => alert(JSON.stringify(spec, null, 2))} submitLabel="Show spec" /></div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Demo />);
