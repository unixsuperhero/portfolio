import { useEffect, useState } from "react";
import { listDirectories } from "../api.ts";

/** One clickable segment of the current path, e.g. /Users/me/proj -> [Users, me, proj]. */
function Breadcrumb({ path, onNavigate }: { path: string; onNavigate: (path: string) => void }) {
  const parts = path.split("/").filter(Boolean);
  let acc = "";
  return (
    <div className="browse-breadcrumb">
      <button type="button" className="browse-crumb" onClick={() => onNavigate("/")}>/</button>
      {parts.map((part, index) => {
        acc += `/${part}`;
        const segment = acc;
        return (
          <span key={segment}>
            <button type="button" className="browse-crumb" onClick={() => onNavigate(segment)}>{part}</button>
            {index < parts.length - 1 ? <span className="browse-crumb-sep">/</span> : null}
          </span>
        );
      })}
    </div>
  );
}

/**
 * The browser-mode fallback for PathField: browses GET /api/directories. Shows the current
 * path as an editable breadcrumb, subdirectories (and files when kind is "file"), a parent
 * button, and a footer to confirm or cancel.
 */
export function BrowsePicker({
  kind,
  start,
  onPick,
  onClose,
}: {
  kind: "file" | "dir";
  start?: string;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [path, setPath] = useState<string | undefined>(start);
  const [selected, setSelected] = useState<string | null>(null);
  const [dirs, setDirs] = useState<{ path: string; parent: string | null; directories: { name: string; path: string }[]; files?: { name: string; path: string }[] }>(
    { path: "", parent: null, directories: [], files: [] },
  );

  useEffect(() => { listDirectories(path, kind === "file").then(setDirs).catch(() => {}); }, [path]);

  const goto = (next: string) => { setSelected(null); setPath(next); };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel browse-picker" onClick={event => event.stopPropagation()}>
        <div className="page-header"><h2 style={{ margin: 0 }}>{kind === "dir" ? "Choose a directory" : "Choose a file"}</h2></div>
        <Breadcrumb path={dirs.path} onNavigate={goto} />
        <div className="browse-list">
          {dirs.parent ? (
            <button type="button" className="browse-row browse-parent" onClick={() => goto(dirs.parent!)}>.. (parent)</button>
          ) : null}
          {dirs.directories.map(d => (
            <button
              type="button"
              key={d.path}
              className="browse-row"
              onDoubleClick={() => goto(d.path)}
              onClick={() => (kind === "dir" ? setSelected(d.path) : goto(d.path))}
            >
              📁 {d.name}
            </button>
          ))}
          {kind === "file" ? (dirs.files ?? []).map(f => (
            <button
              type="button"
              key={f.path}
              className={`browse-row ${selected === f.path ? "selected" : ""}`}
              onClick={() => setSelected(f.path)}
            >
              📄 {f.name}
            </button>
          )) : null}
        </div>
        <div className="browse-footer">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="primary"
            disabled={kind === "file" && !selected}
            onClick={() => onPick(kind === "dir" ? (selected ?? dirs.path) : selected!)}
          >
            Choose {kind === "dir" ? (selected ?? dirs.path) : (selected ?? "")}
          </button>
        </div>
      </div>
    </div>
  );
}
