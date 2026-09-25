const isNativeAddress = (url: URL) => url.protocol === "wails:" || url.hostname === "wails.localhost";

export function systemBrowserUrl(raw: string): string {
  const url = new URL(raw);
  if (isNativeAddress(url)) {
    if (url.hostname !== "localhost" && url.hostname !== "wails.localhost") throw new Error("Unknown app URL.");
    const path = url.pathname.startsWith("/api/") ? url.pathname : `/app${url.pathname}`;
    return `http://127.0.0.1:4388${path}${url.search}${url.hash}`;
  }
  if (!["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) throw new Error(`Unsupported link protocol: ${url.protocol}`);
  return url.href;
}

/** Only navigation within the current app document belongs in the main screen. */
export function externalLinkUrl(href: string, pageHref: string): string | null {
  const page = new URL(pageHref);
  const raw = href.trim();
  const target = new URL(isNativeAddress(page) && raw.startsWith("//") ? `https:${raw}` : raw, page);
  if (target.protocol === page.protocol && target.host === page.host && target.pathname === page.pathname && target.search === page.search) return null;
  return systemBrowserUrl(target.href);
}
