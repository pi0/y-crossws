import crossws from "crossws/adapters/bun";
import { createHandler } from "../src/index.ts";

// @ts-expect-error TODO
const ws = crossws(createHandler());

declare global {
  const Bun: {
    serve(options: {
      port: number | string;
      websocket: any;
      fetch(request: Request, server: any): Promise<Response | undefined>;
    }): { url: string };
    file(url: URL): BodyInit & { exists(): Promise<boolean> };
  };
}

const server = Bun.serve({
  port: process.env.PORT || 3000,
  websocket: ws.websocket,
  async fetch(request, server) {
    // Websocket
    if (request.headers.get("upgrade") === "websocket") {
      return ws.handleUpgrade(request, server);
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
