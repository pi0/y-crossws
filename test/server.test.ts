// Exercises the y-crossws server (createHandler) over real WebSockets using
// dependency-free raw protocol clients that speak the same y-websocket wire
// framing as the editor clients. This validates the server (and its pub/sub
// relay) independently of the bundled provider.
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
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import { readSyncMessage, writeSyncStep1, writeUpdate } from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import crossws from "crossws/adapters/node";
import WebSocket from "ws";
import { createHandler } from "../src/index.ts";

const messageSync = 0;
const messageAwareness = 1;

/** Minimal y-websocket-protocol client: Y.Doc + Awareness over a raw socket. */
class RawClient {
  doc = new Y.Doc();
  awareness = new Awareness(this.doc);
  ws: WebSocket;

  constructor(url: string, userName: string) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";

    this.ws.on("open", () => {
      // sync step 1
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, messageSync);
      writeSyncStep1(e, this.doc);
      this.ws.send(encoding.toUint8Array(e));
      // publish our awareness (the "cursor")
      this.awareness.setLocalStateField("user", { name: userName });
      const a = encoding.createEncoder();
      encoding.writeVarUint(a, messageAwareness);
      encoding.writeVarUint8Array(
        a,
        encodeAwarenessUpdate(this.awareness, [this.doc.clientID]),
      );
      this.ws.send(encoding.toUint8Array(a));
    });

    this.ws.on("message", (data: ArrayBuffer) => {
      const dec = decoding.createDecoder(new Uint8Array(data));
      const type = decoding.readVarUint(dec);
      if (type === messageSync) {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, messageSync);
        readSyncMessage(dec, enc, this.doc, this);
        if (encoding.length(enc) > 1) this.ws.send(encoding.toUint8Array(enc));
      } else if (type === messageAwareness) {
        applyAwarenessUpdate(
          this.awareness,
          decoding.readVarUint8Array(dec),
          this,
        );
      }
    });

    // local doc edits -> server (origin === this means it came FROM the server)
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === this || this.ws.readyState !== WebSocket.OPEN) return;
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, messageSync);
      writeUpdate(e, update);
      this.ws.send(encoding.toUint8Array(e));
    });

    // local awareness edits -> server
    this.awareness.on(
      "update",
      ({ added, updated, removed }: any, origin: unknown) => {
        if (origin === this || this.ws.readyState !== WebSocket.OPEN) return;
        const changed = [...added, ...updated, ...removed];
        const e = encoding.createEncoder();
        encoding.writeVarUint(e, messageAwareness);
        encoding.writeVarUint8Array(
          e,
          encodeAwarenessUpdate(this.awareness, changed),
        );
        this.ws.send(encoding.toUint8Array(e));
      },
    );
  }

  get connected() {
    return this.ws.readyState === WebSocket.OPEN;
  }
}

describe("server", () => {
  let server: Server;
  let baseUrl: string;
  const clients: RawClient[] = [];

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
    for (const client of clients) client.ws.close();
    clients.length = 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function connect(room: string, userName: string) {
    const client = new RawClient(`${baseUrl}/${room}`, userName);
    clients.push(client);
    return client;
  }

  const waitFor = (fn: () => unknown) =>
    vi.waitFor(() => expect(fn()).toBeTruthy(), {
      timeout: 5000,
      interval: 50,
    });

  it("syncs and merges document edits between two clients", async () => {
    const a = connect("doc-sync", "Alice");
    const b = connect("doc-sync", "Bob");
    await waitFor(() => a.connected && b.connected);

    // A -> B
    a.doc.getText("content").insert(0, "Hello from Alice");
    await waitFor(
      () => b.doc.getText("content").toString() === "Hello from Alice",
    );

    // Concurrent edit B -> A (CRDT merge)
    b.doc.getText("content").insert(0, "[B] ");
    await waitFor(
      () => a.doc.getText("content").toString() === "[B] Hello from Alice",
    );
  });

  it("propagates awareness/cursors both ways", async () => {
    const a = connect("awareness", "Alice");
    const b = connect("awareness", "Bob");
    await waitFor(() => a.connected && b.connected);

    await waitFor(() =>
      [...b.awareness.getStates().values()].some(
        (s: any) => s?.user?.name === "Alice",
      ),
    );
    await waitFor(() =>
      [...a.awareness.getStates().values()].some(
        (s: any) => s?.user?.name === "Bob",
      ),
    );
  });

  it("clears awareness on disconnect", async () => {
    const a = connect("disconnect", "Alice");
    const b = connect("disconnect", "Bob");
    await waitFor(() => a.connected && b.connected);
    await waitFor(() =>
      [...b.awareness.getStates().values()].some(
        (s: any) => s?.user?.name === "Alice",
      ),
    );

    // When A leaves, the server's close hook publishes A's awareness removal so
    // B drops Alice's cursor. Exercises publish from a closing peer.
    a.ws.close();
    await waitFor(
      () =>
        ![...b.awareness.getStates().values()].some(
          (s: any) => s?.user?.name === "Alice",
        ),
    );
  });
});
