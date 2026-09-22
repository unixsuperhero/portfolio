// Serves the demo page, bundling demo.tsx on every request so edits show on reload.
import { join } from "node:path";

const dir = import.meta.dir;
const port = Number(process.env.PORT ?? 4390);
const css = (name: string) => new Response(Bun.file(join(dir, "..", "src", name)), { headers: { "content-type": "text/css" } });

Bun.serve({
  port,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/tokens.css" || pathname === "/cards.css") return css(pathname.slice(1));
    if (pathname === "/demo.js") {
      const build = await Bun.build({ entrypoints: [join(dir, "demo.tsx")], target: "browser", define: { "process.env.NODE_ENV": '"development"' } });
      if (!build.success) return new Response(build.logs.map(String).join("\n"), { status: 500 });
      return new Response(await build.outputs[0].text(), { headers: { "content-type": "text/javascript" } });
    }
    return new Response(Bun.file(join(dir, "index.html")), { headers: { "content-type": "text/html" } });
  },
});
console.log(`@portfolio/ui demo: http://localhost:${port}`);
if (process.env.OPEN !== "0") Bun.spawn(["open", `http://localhost:${port}`]);
