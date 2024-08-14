import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { createHandler } from "y-crossws";
import crossws from "crossws/adapters/node";

const mimes = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  for (const path of [
    `public${url.pathname}`,
    `public${url.pathname}/index.html`,
  ]) {
    const fullPath = new URL(path, import.meta.url);
    const contents = await readFile(fullPath).catch(() => undefined);
    if (contents) {
      res.setHeader("content-type", mimes[extname(fullPath.pathname)]);
      return res.end(contents);
    }
  }
  res.end("");
});

const ws = crossws(createHandler({}));

server.on("upgrade", ws.handleUpgrade);

server.listen(3000, () => {
  console.log(`Server running at http://localhost:3000`);
});
