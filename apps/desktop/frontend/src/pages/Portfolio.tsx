import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import type { FormEvent } from "react";
import type { PortfolioItemFilter } from "@portfolio/core";
import { ITEM_TYPES, isItemType } from "@portfolio/core/constants";
import type { CategorySummary, PortfolioView } from "../types.ts";
import { getPortfolio, listCategories, listTags, patchPortfolio } from "../api.ts";
import { PortfolioBoard } from "../components/PortfolioBoard.tsx";
import { CollectionToolbar, SelectionBar, useSelection } from "@portfolio/ui/collections";

type TagOption = { id: number; name: string; count: number };

export default function Portfolio() {
  const [params, setParams] = useSearchParams();
  const { id } = useParams();
  const [portfolio, setPortfolio] = useState<PortfolioView | null>(null);
  const [tags, setTags] = useState<TagOption[]>([]);
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [scopeTags, setScopeTags] = useState<string[]>([]);
  const [filter, setFilter] = useState<PortfolioItemFilter>({});
  const [savingScope, setSavingScope] = useState(false);
  const [scopeDirty, setScopeDirty] = useState(false);
  const [draftPortfolioId, setDraftPortfolioId] = useState<number | null>(null);
  const [scopeError, setScopeError] = useState("");
  const tagSearch = params.get("scope_tag_q") ?? "";
  const tagSort = params.get("scope_tag_sort") ?? "name";
  const tagLimit = Math.max(50, Number(params.get("scope_tag_limit")) || 50);
  const tagView = params.get("scope_tag_view") ?? "available";

  const load = () => { if (id) getPortfolio(Number(id)).then(setPortfolio).catch(() => setPortfolio(null)); };
  useEffect(load, [id]);
  useEffect(() => {
    listTags().then(result => setTags(result.tags)).catch(() => setTags([]));
    listCategories().then(result => setCategories(result.categories)).catch(() => setCategories([]));
  }, []);
  useEffect(() => {
    if (!portfolio || (scopeDirty && draftPortfolioId === portfolio.id)) return;
    setScopeTags(portfolio.tags);
    setFilter(portfolio.item_filter);
    setDraftPortfolioId(portfolio.id);
    setScopeDirty(false);
  }, [portfolio, scopeDirty, draftPortfolioId]);

  const matchingTags = useMemo(() => {
    const selected = new Set(scopeTags.map(tag => tag.toLocaleLowerCase()));
    const results = tags.filter(tag => tag.name.toLocaleLowerCase().includes(tagSearch.trim().toLocaleLowerCase()));
    const visible = results.filter(tag => tagView === "selected" ? selected.has(tag.name.toLocaleLowerCase()) : !selected.has(tag.name.toLocaleLowerCase()));
    return visible.sort((left, right) => tagSort === "count" ? right.count - left.count || left.name.localeCompare(right.name) : left.name.localeCompare(right.name));
  }, [tags, scopeTags, tagSearch, tagSort, tagView]);
  const visibleTags = matchingTags.slice(0, tagLimit);
  const tagSelection = useSelection(visibleTags.map(tag => tag.id));
  const selectedVisibleTags = visibleTags.filter(tag => tagSelection.selected.has(tag.id));
  const toggleScopeTag = (name: string) => {
    setScopeDirty(true);
    setScopeTags(current => current.some(tag => tag.toLocaleLowerCase() === name.toLocaleLowerCase())
      ? current.filter(tag => tag.toLocaleLowerCase() !== name.toLocaleLowerCase())
      : [...current, name]);
  };
  const updateFilter = <K extends keyof PortfolioItemFilter>(key: K, value: PortfolioItemFilter[K] | undefined) => {
    setScopeDirty(true);
    setFilter(current => {
      const next = { ...current };
      if (value === undefined || value === "" || value === false) delete next[key];
      else next[key] = value;
      return next;
    });
  };
  const updateTagParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  const saveScope = async (event: FormEvent) => {
    event.preventDefault();
    if (!portfolio || savingScope) return;
    setSavingScope(true);
    setScopeError("");
    try {
      await patchPortfolio(portfolio.id, { tags: scopeTags, item_filter: filter });
      setPortfolio(await getPortfolio(portfolio.id));
      setScopeDirty(false);
    } catch (error) {
      setScopeError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingScope(false);
    }
  };

  if (!portfolio) return <p>Loading…</p>;
  return (
    <div>
      <div className="page-header"><h1>{portfolio.name}</h1></div>
      {portfolio.description ? <p style={{ color: "var(--text2)" }}>{portfolio.description}</p> : null}
      <details className="portfolio-scope">
        <summary>Portfolio item scope</summary>
        <form onSubmit={saveScope}>
          <p>Cards that show linked items use this scope. Tags are ANY; card filters are AND-ed with this portfolio scope.</p>
          <div className="portfolio-scope-selected" aria-label="Selected portfolio tags">
            {scopeTags.length ? scopeTags.map(tag => <button className="tag" key={tag} type="button" aria-label={`Remove ${tag}`} onClick={() => toggleScopeTag(tag)}>{tag} ×</button>) : <span>Any tag</span>}
          </div>
          <CollectionToolbar query={tagSearch} onQueryChange={value => updateTagParam("scope_tag_q", value)} sort={tagSort} onSortChange={value => updateTagParam("scope_tag_sort", value)} sortOptions={[{ value: "name", label: "Tag name" }, { value: "count", label: "Item count" }]}>
            <label>Show<select value={tagView} onChange={event => updateTagParam("scope_tag_view", event.target.value)}><option value="available">Available tags</option><option value="selected">Selected tags</option></select></label>
          </CollectionToolbar>
          <SelectionBar count={tagSelection.selected.size} total={visibleTags.length} allSelected={tagSelection.allSelected} onToggleAll={tagSelection.toggleAll} onClear={tagSelection.clear}>
            <button type="button" onClick={() => selectedVisibleTags.forEach(tag => toggleScopeTag(tag.name))}>{tagView === "selected" ? "Remove selected tags" : "Add selected tags to scope"}</button>
          </SelectionBar>
          {visibleTags.length ? <div className="portfolio-scope-tag-options" role="group" aria-label={tagView === "selected" ? "Selected tags" : "Available tags"}>
            {visibleTags.map(tag => <label key={tag.id}><input type="checkbox" checked={tagSelection.selected.has(tag.id)} onChange={() => tagSelection.toggle(tag.id)} /> <button type="button" onClick={() => toggleScopeTag(tag.name)}>{tag.name}</button> <small>{tag.count}</small></label>)}
          </div> : <p>No matching {tagView} tags.</p>}
          {matchingTags.length > tagLimit ? <button type="button" className="secondary" onClick={() => updateTagParam("scope_tag_limit", String(tagLimit + 50))}>Show 50 more ({matchingTags.length - tagLimit} remaining)</button> : null}
          <details>
            <summary>Search and item criteria</summary>
            <div className="field-row">
              <label>Text search<input value={filter.q ?? ""} onChange={event => updateFilter("q", event.target.value)} placeholder="Title and description" /></label>
              <label><input type="checkbox" checked={filter.contents ?? false} disabled={!filter.q} onChange={event => updateFilter("contents", event.target.checked || undefined)} /> Search document contents</label>
              <label>Item type<select value={filter.type ?? ""} onChange={event => { const selected = event.currentTarget.value; updateFilter("type", isItemType(selected) ? selected : undefined); }}><option value="">Any type</option>{ITEM_TYPES.map(type => <option key={type} value={type}>{type}</option>)}</select></label>
              <label>Specific tag ID<input type="number" min={1} value={filter.tag ?? ""} onChange={event => updateFilter("tag", event.target.value ? Number(event.target.value) : undefined)} /></label>
              <label>Specific tag name<input value={filter.tagName ?? ""} onChange={event => updateFilter("tagName", event.target.value)} /></label>
              <label>Category<select value={filter.category ?? ""} onChange={event => updateFilter("category", event.target.value ? Number(event.target.value) : undefined)}><option value="">Any category</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
              <label><input type="checkbox" checked={filter.pinned ?? false} onChange={event => updateFilter("pinned", event.target.checked || undefined)} /> Pinned</label>
              <label><input type="checkbox" checked={filter.starred ?? false} onChange={event => updateFilter("starred", event.target.checked || undefined)} /> Starred</label>
            </div>
          </details>
          {scopeError ? <p role="alert">{scopeError}</p> : null}
          <button className="primary" type="submit" disabled={savingScope}>{savingScope ? "Saving…" : "Save scope"}</button>
        </form>
      </details>
      <PortfolioBoard portfolio={portfolio} reload={load} />
    </div>
  );
}
