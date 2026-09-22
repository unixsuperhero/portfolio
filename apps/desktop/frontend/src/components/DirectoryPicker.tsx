import { useEffect, useState } from "react";
import { listDirectories } from "../api.ts";

export function DirectoryPicker({ onPick, onClose }: { onPick: (path: string) => void; onClose: () => void }) {
  const [path, setPath] = useState<string | undefined>(undefined);
  const [dirs, setDirs] = useState<{ path: string; parent: string | null; directories: { name: string; path: string }[] }>({ path: "", parent: null, directories: [] });

  useEffect(() => { listDirectories(path).then(setDirs).catch(() => {}); }, [path]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={event => event.stopPropagation()}>
        <div className="page-header"><h2 style={{ margin: 0 }}>Choose a directory</h2></div>
        <p><code>{dirs.path}</code></p>
        <div className="page-actions" style={{ marginBottom: "0.6rem" }}>
          {dirs.parent ? <button type="button" className="secondary" onClick={() => setPath(dirs.parent!)}>Up</button> : null}
          <button type="button" className="primary" onClick={() => onPick(dirs.path)}>Use this directory</button>
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
        </div>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {dirs.directories.map(d => (
            <li key={d.path}><button type="button" className="secondary" style={{ width: "100%", textAlign: "left" }} onClick={() => setPath(d.path)}>{d.name}</button></li>
          ))}
        </ul>
      </div>
    </div>
  );
}
