import { useState, type FormEvent } from "react";
import { BLANK_CARD, normalizeCard } from "@portfolio/core/cards";
import { CARD_SORT_LABELS, ITEM_TYPES } from "@portfolio/core/constants";
import type { CardSpec, ItemType } from "@portfolio/core";

export interface CardFormProps {
  value?: CardSpec;
  onSubmit: (card: CardSpec) => void;
  submitLabel?: string;
  tagOptions?: string[];
  /** Rendered under the submit button, e.g. move and delete buttons. */
  actions?: React.ReactNode;
}

/**
 * Controlled editor for a card's query. Emits a normalized CardSpec: tags
 * de-duplicated, every-type-checked collapsed to "any", max clamped 1..1000.
 */
export function CardForm({ value = BLANK_CARD, onSubmit, submitLabel = "Save card", tagOptions, actions }: CardFormProps) {
  const [title, setTitle] = useState(value.title);
  const [tags, setTags] = useState(value.tags);
  const [tagSearch, setTagSearch] = useState("");
  const [types, setTypes] = useState<ItemType[]>(value.types);
  const [sortKey, setSortKey] = useState(value.sort_key);
  const [sortDir, setSortDir] = useState(value.sort_dir);
  const [max, setMax] = useState(String(value.max_items));
  const matchingTags = (tagOptions ?? []).filter(tag => !tags.some(selected => selected.toLocaleLowerCase() === tag.toLocaleLowerCase()) && tag.toLocaleLowerCase().includes(tagSearch.trim().toLocaleLowerCase())).slice(0, 30);
  const toggleTag = (tag: string) => setTags(current => current.some(value => value.toLocaleLowerCase() === tag.toLocaleLowerCase()) ? current.filter(value => value.toLocaleLowerCase() !== tag.toLocaleLowerCase()) : [...current, tag]);
  const toggleType = (type: ItemType) => setTypes(current => current.includes(type) ? current.filter(t => t !== type) : [...current, type]);
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit(normalizeCard({ title, tags, types, sort_key: sortKey, sort_dir: sortDir, max_items: max })); };
  return (
    <form className="card-form" onSubmit={submit}>
      <label>Title<input name="title" required value={title} onChange={event => setTitle(event.target.value)} /></label>
      {tagOptions ? <fieldset className="card-tag-picker"><legend>Tags — matches any; combined with portfolio scope</legend>
        <input type="search" aria-label="Search available tags" placeholder="Find tags…" value={tagSearch} onChange={event => setTagSearch(event.target.value)} />
        <div className="card-tag-selected">{tags.length ? tags.map(tag => <span className="tag" key={tag}>{tag}<button type="button" aria-label={`Remove ${tag}`} onClick={() => toggleTag(tag)}>×</button></span>) : <span>Any tag</span>}</div>
        <div className="card-tag-options">{matchingTags.map(tag => <button type="button" key={tag} onClick={() => toggleTag(tag)}>{tag}</button>)}</div>
      </fieldset> : <label>Tags — matches any<input name="tags" value={tags.join(", ")} placeholder="yt, slides" onChange={event => setTags(event.target.value.split(",").map(tag => tag.trim()).filter(Boolean))} /></label>}
      <div className="card-types">
        <span>Types — none checked means every type</span>
        {ITEM_TYPES.map(type => <label key={type}><input type="checkbox" name="types" value={type} checked={types.includes(type)} onChange={() => toggleType(type)} /> {type}</label>)}
      </div>
      <div className="card-form-row">
        <label>Sort by<select name="sort_key" value={sortKey} onChange={event => setSortKey(event.target.value as CardSpec["sort_key"])}>{Object.entries(CARD_SORT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Direction<select name="sort_dir" value={sortDir} onChange={event => setSortDir(event.target.value as CardSpec["sort_dir"])}><option value="desc">Descending</option><option value="asc">Ascending</option></select></label>
        <label>Max items<input name="max_items" inputMode="numeric" value={max} onChange={event => setMax(event.target.value)} /></label>
      </div>
      <button className="primary" type="submit">{submitLabel}</button>
      {actions}
    </form>
  );
}

export interface CardEditorProps extends CardFormProps {
  summary?: string;
  open?: boolean;
  onMove?: (direction: "left" | "right") => void;
  onDelete?: () => void;
}

/** The collapsed "Edit card" panel that sits under a PortfolioCard. */
export function CardEditor({ summary = "Edit card", open, onMove, onDelete, ...form }: CardEditorProps) {
  const actions = onMove || onDelete ? (
    <div className="card-actions">
      <div>{onMove ? <><button type="button" title="Move earlier" onClick={() => onMove("left")}>←</button><button type="button" title="Move later" onClick={() => onMove("right")}>→</button></> : null}</div>
      <div>{onDelete ? <button type="button" className="danger" onClick={onDelete}>Delete card</button> : null}</div>
    </div>
  ) : null;
  return <details className="card-edit" open={open}><summary>{summary}</summary><CardForm {...form} actions={actions} /></details>;
}
