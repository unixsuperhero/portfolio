import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";

export type Command = {
  id: string;
  label: string;
  hint: string;
  run: (query: string) => void;
  /** Listed whatever the query is, e.g. commands that act on the typed text itself. */
  always?: boolean;
};
export function rankCommands(commands: readonly Command[], query: string): readonly Command[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return commands;
  const byLabel = commands.filter(command => command.label.toLowerCase().includes(needle));
  const byHint = commands.filter(command => !byLabel.includes(command) && command.hint.toLowerCase().includes(needle));
  const fallback = commands.filter(command => command.always && !byLabel.includes(command) && !byHint.includes(command));
  return [...byLabel, ...byHint, ...fallback];
}


type CommandPaletteProps = {
  commands: readonly Command[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
  /** Called with the trimmed query as it changes, so the owner can offer query-dependent commands. */
  onQueryChange?: (query: string) => void;
  children?: ReactNode;
};

export function CommandPalette({ commands, open, onOpenChange, returnFocusRef, onQueryChange, children }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => rankCommands(commands, query), [commands, query]);

  useEffect(() => { onQueryChange?.(query.trim()); }, [onQueryChange, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    setActive(current => Math.min(current, Math.max(matches.length - 1, 0)));
  }, [matches.length]);

  useEffect(() => {
    if (open && matches[active]) document.getElementById(`command-${matches[active].id}`)?.scrollIntoView({ block: "nearest" });
  }, [active, matches, open]);

  const close = () => {
    onOpenChange(false);
    requestAnimationFrame(() => returnFocusRef.current?.focus());
  };

  const run = (command: Command) => {
    command.run(query.trim());
    close();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Tab") {
      event.preventDefault();
      inputRef.current?.focus();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.ctrlKey && !event.metaKey && (event.key.toLowerCase() === "n" || event.key.toLowerCase() === "p") && matches.length) {
      event.preventDefault();
      const direction = event.key.toLowerCase() === "n" ? 1 : -1;
      setActive(current => Math.max(0, Math.min(current + direction, matches.length - 1)));
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(current => Math.min(current + 1, Math.max(matches.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(current => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter" && matches[active]) {
      event.preventDefault();
      run(matches[active]);
    }
  };

  if (!open) return null;

  return (
    <div className="command-palette-backdrop" role="presentation" onMouseDown={close}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKeyDown} onMouseDown={event => event.stopPropagation()}>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Type a page or search the library…"
          role="combobox"
          aria-label="Search commands"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls="command-palette-list"
          aria-activedescendant={matches[active] ? `command-${matches[active].id}` : undefined}
        />
        <div className="command-palette-list" id="command-palette-list" role="listbox">
          {matches.map((command, index) => (
            <button
              id={`command-${command.id}`}
              key={command.id}
              type="button"
              tabIndex={-1}
              role="option"
              aria-selected={index === active}
              className={index === active ? "active" : ""}
              onMouseEnter={() => setActive(index)}
              onClick={() => run(command)}
            >
              <span>{command.label}</span>
              <small>{command.hint}</small>
            </button>
          ))}
          {matches.length === 0 ? <div className="command-palette-empty">No commands found.</div> : null}
        </div>
        {children}
      </div>
    </div>
  );
}
