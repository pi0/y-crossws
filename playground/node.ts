import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { createHandler } from "y-crossws";
import crossws from "crossws/adapters/node";

const mimes = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  for (const path of [
    `public${url.pathname}`,
    `public${url.pathname}/index.html`,
  ]) {
    const fullPath = new URL(path, import.meta.url);
    const contents = await readFile(fullPath).catch(() => undefined);
    if (contents) {
      const mime =
        mimes[extname(fullPath.pathname) as keyof typeof mimes] || "text/plain";
      res.setHeader("content-type", mime);
      return res.end(contents);
    }
  }
  res.end("");
});

// @ts-expect-error TODO
const ws = crossws(createHandler());

server.on("upgrade", ws.handleUpgrade);

server.listen(process.env.PORT || 3000, () => {
  const addr = server.address() as { port: number };
  console.log(`Server running at http://localhost:${addr.port}`);
});
