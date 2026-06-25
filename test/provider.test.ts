// Exercises the bundled WebsocketProvider against a real server: it must
// connect (regression test for the ws null/undefined connect bug) and sync
// document state between two providers.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as Y from "yjs";
import crossws from "crossws/adapters/node";
import WS from "ws";
import { createHandler, WebsocketProvider } from "../src/index.ts";

const WSPoly = WS as unknown as typeof WebSocket;

describe("WebsocketProvider", () => {
  let server: Server;
  let baseUrl: string;
  const providers: WebsocketProvider[] = [];

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.statusCode = 426;
      res.end("");
    });
    const ws = crossws(createHandler());
    server.on("upgrade", ws.handleUpgrade);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `ws://localhost:${port}`;
  });

  afterEach(() => {
    for (const provider of providers) provider.destroy();
    providers.length = 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function connect(room: string, doc: Y.Doc) {
    const provider = new WebsocketProvider(baseUrl, room, doc, {
      disableBc: true,
      WebSocketPolyfill: WSPoly,
    });
    providers.push(provider);
    return provider;
  }

  const waitFor = (fn: () => unknown) =>
    vi.waitFor(() => expect(fn()).toBeTruthy(), {
      timeout: 5000,
      interval: 50,
    });

  it("connects and syncs document state between two providers", async () => {
    const docA = new Y.Doc();
    const a = connect("prov", docA);
    const docB = new Y.Doc();
    const b = connect("prov", docB);

    await waitFor(() => a.wsconnected && b.wsconnected);

    docA.getText("t").insert(0, "via provider");
    await waitFor(() => docB.getText("t").toString() === "via provider");
  });
});
