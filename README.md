# y-crossws

<!-- automd:badges color=yellow -->

[![npm version](https://img.shields.io/npm/v/y-crossws?color=yellow)](https://npmjs.com/package/y-crossws)
[![npm downloads](https://img.shields.io/npm/dm/y-crossws?color=yellow)](https://npm.chart.dev/y-crossws)

<!-- /automd -->

[yjs](https://docs.yjs.dev/) websocket server powered by [crossws](https://crossws.unjs.io/), works with Node.js, Deno, Bun, Cloudflare Workers and more without any framework dependency and compatible with unmodified [y-websocket](https://github.com/yjs/y-websocket) client provider.

> [!IMPORTANT]
> 🚧 This is still a work in progress. Feedback and contributions are welcome!

## 🍿 Demo

[tiptap](https://tiptap.dev/) editor with collaborative editing deployed on Cloudflare workers with durable objects.

- [online deployment](https://y-crossws.pi0.workers.dev/tiptap/)
- [source code](./playground/)

## Usage

We first need to initiate universal cross-hooks:

```js
import { createHandler } from "y-crossws";

const crosswsHandler = createHandler();
```

Depending on your server choice, use any of the [crossws supported adapters](https://crossws.unjs.io/adapters).

### Node.js

```js
import { createServer } from "node:http";
import { createHandler } from "y-crossws";
import crossws from "crossws/adapters/node";

const server = createServer((req, res) => {
  res.statusCode = 426;
  res.end("");
});

const ws = crossws(createHandler());

server.on("upgrade", ws.handleUpgrade);

server.listen(3000);
```

> [!NOTE]
> Read more about Node.js adapter in [crossws docs](https://crossws.unjs.io/adapters/node).

### Bun

```js
import { createHandler } from "y-crossws";
import crossws from "crossws/adapters/bun";

const ws = crossws(createHandler());

Bun.serve({
  port: 3000,
  websocket: ws.websocket,
  fetch(req, server) {
    if (request.headers.get("upgrade") === "websocket") {
      return ws.handleUpgrade(request, server);
    }
    return new Response("", { status: 426 });
  },
});
```

> [!NOTE]
> Read more about Bun adapter in [crossws docs](https://crossws.unjs.io/adapters/bun).

### Deno

```js
import { createHandler } from "y-crossws";
import crossws from "crossws/adapters/deno";

const ws = crossws(createHandler());

Deno.serve({ port: 3000 }, (request, info) => {
  if (request.headers.get("upgrade") === "websocket") {
    return ws.handleUpgrade(request, server);
  }
  return new Response("", { status: 426 });
});
```

> [!NOTE]
> Read more about Deno adapter in [crossws docs](https://crossws.unjs.io/adapters/deno).

### Cloudflare (with durable objects)

```js
import { createHandler } from "y-crossws";
import { DurableObject } from "cloudflare:workers";
import crossws from "crossws/adapters/cloudflare-durable";

const ws = crossws(createHandler());

export default {
  async fetch(request, env, context) {
    if (request.headers.get("upgrade") === "websocket") {
      return ws.handleUpgrade(request, env, context);
    }
    return new Response("", { status: 426 });
  },
};

export class $DurableObject extends DurableObject {
  fetch(request) {
    return ws.handleDurableUpgrade(this, request);
  }
  webSocketMessage(client, message) {
    return ws.handleDurableMessage(this, client, message);
  }
  webSocketClose(client, code, reason, wasClean) {
    return ws.handleDurableClose(this, client, code, reason, wasClean);
  }
}
```

Update your `wrangler.toml` config to specify Durable object:

```toml
durable_objects.bindings = [
  { name = "$DurableObject", class_name = "$DurableObject" }
]

migrations = [
  { tag = "v1", new_classes = ["$DurableObject"] }
]
```

> [!NOTE]
> Read more about Cloudflare adapter in [crossws docs](https://crossws.unjs.io/adapters/cloudflare#durable-objects).

## Websocket provider

You can use `WebsocketProvider` from legacy [y-websocket](https://github.com/yjs/y-websocket) or a native one from `y-crossws`. Both are almost identical in terms of API at the moment, however, the y-crossws version has better typescript refactors and might introduce more enhancements in sync with the server provider in the future.

```js
import * as Y from "yjs";
import { WebsocketProvider } from "y-crossws/provider";

const ydoc = new Y.Doc();
const roomName = "default";

const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
const wsUrl = `${wsProto}://${window.location.host}/_ws`;

const provider = new WebsocketProvider(wsURL, roomName, ydoc, {
  /* options */
});
```

### Provider options

- `params`: URL parameters to append.
- `protocols`: Specify websocket protocols.
- `WebSocketPolyfill`: WebSocket polyfill.
- `maxBackoffTime`: Maximum amount of time to wait before trying to reconnect (we try to reconnect using exponential (default `2500`).
- `resyncInterval`: Request server state every `resyncInterval` milliseconds (default `-1`).
- `connect`: Whether to connect to other peers or not (default: `true`).
- `awareness`: Awareness instance.
- `disableBc`: Disable cross-tab BroadcastChannel communication (default: `false`).

## Development

<details>

<summary>local development</summary>

- Clone this repository
- Install the latest LTS version of [Node.js](https://nodejs.org/en/)
- Enable [Corepack](https://github.com/nodejs/corepack) using `corepack enable`
- Install dependencies using `pnpm install`
- Build in stub mode using `pnpm build --stub`
- Run playgrounds with `pnpm dev:*` commands.

</details>

## License

💛 Published under the [MIT](https://github.com/pi0/y-crossws/blob/main/LICENSE) license.
