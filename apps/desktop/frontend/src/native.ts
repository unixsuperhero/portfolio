// Wrappers over the Go bindings (frontend/bindings/portfolio-desktop/*.ts) that fall back to
// window.open / navigator.clipboard / console.warn when running outside the Wails webview
// (e.g. `bun run dev` in a normal browser), so the app is usable before the Go part lands and
// while developing in a browser tab.

import { isWails as inWails } from "./lib/wails.ts";
import { systemBrowserUrl } from "./lib/navigation.ts";
import { CopyText, Home, Notify, OpenPath, OpenUrl, OpenWith, PickDirectory, PickFile, Reveal } from "../bindings/portfolio-desktop/nativeservice.ts";


export async function openSystem(url: string): Promise<void> {
  const destination = systemBrowserUrl(url);
  if (inWails()) {
    await OpenUrl(destination);
    return;
  }
  window.open(destination, "_blank", "noopener,noreferrer");
}

export async function copyText(text: string): Promise<void> {
  if (inWails()) {
    await CopyText(text);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    console.warn("copyText: clipboard API unavailable", error);
  }
}

export async function reveal(path: string): Promise<void> {
  if (inWails()) {
    await Reveal(path);
    return;
  }
  console.warn(`reveal: not running in the desktop app, cannot reveal ${path}`);
}

export async function openPath(path: string): Promise<void> {
  if (inWails()) {
    await OpenPath(path);
    return;
  }
  console.warn(`openPath: not running in the desktop app, cannot open ${path}`);
}

export async function openWith(path: string, app: string): Promise<void> {
  if (inWails()) {
    await OpenWith(path, app);
    return;
  }
  console.warn(`openWith: not running in the desktop app, cannot open ${path} with ${app}`);
}

export async function notify(title: string, body: string): Promise<void> {
  if (inWails()) {
    await Notify(title, body);
    return;
  }
  if (typeof Notification !== "undefined") {
    try {
      if (Notification.permission === "granted") {
        new Notification(title, { body });
        return;
      }
      if (Notification.permission !== "denied") {
        const permission = await Notification.requestPermission();
        if (permission === "granted") {
          new Notification(title, { body });
          return;
        }
      }
    } catch (error) {
      console.warn("notify: Notification API failed", error);
    }
  }
  console.warn(`notify: ${title} — ${body}`);
}

/** $HOME, used as the default start directory for pickers. "" outside Wails. */
export async function home(): Promise<string> {
  if (inWails()) return Home();
  return "";
}

/** Native "choose a directory" dialog. Returns "" when cancelled or unavailable (not in Wails). */
export async function pickDirectory(title: string, start?: string): Promise<string> {
  if (inWails()) return PickDirectory(title, start ?? "");
  return "";
}

/** Native "choose a file" dialog. Returns "" when cancelled or unavailable (not in Wails). */
export async function pickFile(title: string, start?: string): Promise<string> {
  if (inWails()) return PickFile(title, start ?? "");
  return "";
}
