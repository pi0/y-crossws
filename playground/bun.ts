import crossws from "crossws/adapters/bun";
import { createHandler } from "../src/index.ts";

const ws = crossws(createHandler());

const server = Bun.serve({
  port: process.env.PORT || 3000,
  websocket: ws.websocket,
  async fetch(request, server) {
    // Websocket
    if (request.headers.get("upgrade") === "websocket") {
      await ws.handleUpgrade(request, server);
      return;
    }

    // Static
    const url = new URL(request.url);
    for (const path of [
      `public${url.pathname}`,
      `public${url.pathname}/index.html`,
    ]) {
      const file = Bun.file(new URL(path, import.meta.url));
      if (await file.exists()) {
        return new Response(file);
      }
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Server running at ${server.url}`);
