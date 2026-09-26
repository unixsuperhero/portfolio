import type { PortEntry } from "./index.ts";

const LOCAL_HOSTS = ["*", "::", "0.0.0.0", "::1", "127.0.0.1", "localhost"];

/** http://localhost:PORT for wildcard and loopback binds, otherwise the bound host. */
export function portSiteUrl(entry: Pick<PortEntry, "host" | "port">): string {
  const host = !entry.host || LOCAL_HOSTS.includes(entry.host) ? "localhost" : entry.host;
  const target = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${target}:${entry.port}`;
}
