import { describe, expect, test } from "bun:test";
import { externalLinkUrl, systemBrowserUrl } from "../src/lib/navigation";

describe("main-screen navigation boundary", () => {
  test("hash-router links stay inside the current app document", () => {
    expect(externalLinkUrl("#/prs?draft=true", "wails://localhost/#/library")).toBeNull();
    expect(externalLinkUrl("#/settings", "http://localhost:4388/app/#/prs")).toBeNull();
    expect(externalLinkUrl("#details", "http://localhost:9246/#/items/1")).toBeNull();
  });

  test("same-origin content is external even though its host matches the app", () => {
    expect(externalLinkUrl("/api/items/7/html", "http://localhost:4388/app/#/library")).toBe("http://localhost:4388/api/items/7/html");
    expect(externalLinkUrl("/preview", "http://localhost:9246/#/prs")).toBe("http://localhost:9246/preview");
    expect(externalLinkUrl("https://github.com/acme/repo/pull/1", "wails://localhost/#/prs")).toBe("https://github.com/acme/repo/pull/1");
  });

  test("native content addresses resolve to browser-accessible sidecar URLs", () => {
    expect(externalLinkUrl("/api/items/7/html?mode=read#section", "wails://localhost/#/library")).toBe("http://127.0.0.1:4388/api/items/7/html?mode=read#section");
    expect(externalLinkUrl("/api/items/8/html", "http://wails.localhost/#/library")).toBe("http://127.0.0.1:4388/api/items/8/html");
    expect(systemBrowserUrl("wails://localhost/#/prs?draft=true")).toBe("http://127.0.0.1:4388/app/#/prs?draft=true");
    expect(externalLinkUrl("//github.com/acme/repo", "wails://localhost/#/prs")).toBe("https://github.com/acme/repo");
  });

  test("unsupported destinations are rejected rather than navigating the main webview", () => {
    expect(() => externalLinkUrl("javascript:location.href='https://example.com'", "wails://localhost/#/prs")).toThrow("Unsupported link protocol");
    expect(() => externalLinkUrl("data:text/html,external", "http://localhost:9246/#/prs")).toThrow("Unsupported link protocol");
    expect(() => externalLinkUrl("wails://other-host/", "wails://localhost/#/prs")).toThrow("Unknown app URL");
  });

  test("mail and telephone links use their system handlers", () => {
    expect(externalLinkUrl("mailto:person@example.com", "wails://localhost/#/prs")).toBe("mailto:person@example.com");
    expect(externalLinkUrl("tel:+15551234567", "wails://localhost/#/prs")).toBe("tel:+15551234567");
  });
});
