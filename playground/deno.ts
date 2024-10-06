import crossws from "crossws/adapters/deno";
import { createHandler } from "../src/index.ts";

// @ts-expect-error TODO
const ws = crossws(createHandler());

const mimes = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

Deno.serve(
  {
    port: Number.parseInt(Deno.env.get("PORT") || "3000"),
    onListen: ({ port }) => {
      console.log(`Server running at http://localhost:${port}`);
    },
  },
  async (request, info) => {
    // Websocket
    if (request.headers.get("upgrade") === "websocket") {
      return ws.handleUpgrade(request, info as any);
    }
    // Static
    const url = new URL(request.url);
    for (const path of [
      `public${url.pathname}`,
      `public${url.pathname}/index.html`,
    ]) {
      const contents = await Deno.readTextFile(
        new URL(path, import.meta.url),
      ).catch(() => undefined);
      if (contents) {
        const extname = path.match(/\.\w+$/)?.[0] as
          | keyof typeof mimes
          | undefined;
        return new Response(contents, {
          headers: {
            "content-type": extname ? mimes[extname] : "text/plain",
          },
        });
      }
    }
    return new Response("Not found", { status: 404 });
  },
);
