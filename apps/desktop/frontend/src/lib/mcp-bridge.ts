/**
 * Lets the Wails MCP test tools (`go build -tags mcp`) work inside WebKit.
 * The page is a secure context on wails://localhost, so WebKit refuses the
 * plain-http POST the MCP eval script makes to 127.0.0.1:<port>/eval-result.
 * This rewrites that one URL onto the page's own origin, where proxy.go
 * forwards /__mcp/* to the MCP server. It is a no-op for every other request.
 */
const MCP_CALLBACK = /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/eval-result$/;

export function installMcpBridge(): void {
  const original = window.fetch.bind(window);
  const bridged = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return original(MCP_CALLBACK.test(url) ? "/__mcp/eval-result" : input, init);
  };
  window.fetch = bridged as typeof fetch;
}
