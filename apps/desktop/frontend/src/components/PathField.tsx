import { useState } from "react";
import { isWails } from "../lib/wails.ts";
import { home, pickDirectory, pickFile } from "../native.ts";
import { BrowsePicker } from "./BrowsePicker.tsx";

/**
 * A read-mostly text input plus a "Choose…" button for any file/dir path field. Inside the
 * Wails webview the button opens the native OS picker; in a plain browser, directories fall
 * back to BrowsePicker (a modal browsing GET /api/directories) and files fall back to typing
 * the path directly (browsers can't hand back a real filesystem path from an <input type=file>).
 */
export function PathField({
  value,
  onChange,
  kind,
  label,
  placeholder,
}: {
  value: string;
  onChange: (path: string) => void;
  kind: "file" | "dir";
  label?: string;
  placeholder?: string;
}) {
  const [browsing, setBrowsing] = useState(false);

  const choose = async () => {
    if (isWails()) {
      const start = value || (await home());
      const title = kind === "dir" ? "Choose a directory" : "Choose a file";
      const picked = kind === "dir" ? await pickDirectory(title, start) : await pickFile(title, start);
      if (picked) onChange(picked);
      return;
    }
    if (kind === "dir") {
      setBrowsing(true);
      return;
    }
    // No browser API can return a real filesystem path for a file input outside Wails; the
    // text input stays editable.
  };

  const input = (
    <div className="path-field">
      <input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} />
      <button type="button" className="secondary" onClick={choose}>Choose…</button>
    </div>
  );

  return (
    <>
      {label ? <label className="path-field-label">{label}{input}</label> : input}
      {browsing ? (
        <BrowsePicker
          kind={kind}
          start={value || undefined}
          onClose={() => setBrowsing(false)}
          onPick={path => { onChange(path); setBrowsing(false); }}
        />
      ) : null}
    </>
  );
}
