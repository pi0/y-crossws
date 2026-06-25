import type * as crossws from "crossws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

export function createHandler(opts: YCrosswsOptions = {}): YCrosswsHandler {
  const yc = new YCrossws(opts);
  const hooks: Partial<crossws.Hooks> = {
    open(peer) {
      yc.onOpen(peer);
    },
    message(peer, message) {
      yc.onMessage(peer, message);
    },
    close(peer) {
      yc.onClose(peer);
    },
  };
  return {
    hooks: hooks as crossws.Hooks,
  };
}

export class YCrossws {
  opts: YCrosswsOptions;
  persistence?: Persistence;
  docs: Map<string, SharedDoc> = new Map();

  constructor(opts: YCrosswsOptions = {}) {
    this.opts = opts;
  }

  // --- crossws hooks ---

  onOpen(peer: crossws.Peer) {
    const doc = this.getDoc(peer);
    // Subscribe to the room's pub/sub channel. Relay is local to this instance;
    // it becomes cluster-wide once a crossws sync backplane is configured on the
    // adapter (https://github.com/h3js/crossws/pull/192). Note the backplane
    // relays messages, not the server-side Y.Doc state — see `onDocUpdate`.
    peer.subscribe(doc.name);
    // Send sync step 1
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, doc);
    peer.send(encoding.toUint8Array(encoder));
    const awarenessStates = doc.awareness.getStates();
    if (awarenessStates.size > 0) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(doc.awareness, [
          ...awarenessStates.keys(),
        ]),
      );
      peer.send(encoding.toUint8Array(encoder));
    }
  }

  onMessage(peer: crossws.Peer, message: crossws.Message) {
    const doc = this.getDoc(peer);
    try {
      const encoder = encoding.createEncoder();
      const data = message.uint8Array();
      const decoder = decoding.createDecoder(data);
      const messageType = decoding.readVarUint(decoder);
      switch (messageType) {
        case messageSync: {
          encoding.writeVarUint(encoder, messageSync);
          syncProtocol.readSyncMessage(decoder, encoder, doc, peer);
          // If the `encoder` only contains the type of reply message and no
          // message, there is no need to send the message. When `encoder` only
          // contains the type of reply, its length is 1.
          if (encoding.length(encoder) > 1) {
            peer.send(encoding.toUint8Array(encoder));
          }
          break;
        }
        case messageAwareness: {
          awarenessProtocol.applyAwarenessUpdate(
            doc.awareness,
            decoding.readVarUint8Array(decoder),
            peer,
          );
          break;
        }
      }
    } catch (error) {
      console.error(error);
      // @ts-expect-error
      doc.emit("error", [error]);
    }
  }

  onClose(peer: crossws.Peer) {
    const doc = this.getDoc(peer);
    peer.unsubscribe(doc.name);
    if (doc.peerIds.has(peer)) {
      const controlledIds = doc.peerIds.get(peer) || [];
      doc.peerIds.delete(peer);
      // Clear this peer's awareness states and tell the rest of the room. The
      // closing peer is the origin, so the removal is published to others (and
      // not back to the peer that is leaving).
      awarenessProtocol.removeAwarenessStates(
        doc.awareness,
        [...controlledIds],
        peer,
      );
      if (doc.peerIds.size === 0 && this.persistence) {
        // If persisted, we store state and destroy ydocument
        this.persistence.writeState(doc.name, doc).then(() => {
          doc.destroy();
        });
        this.docs.delete(doc.name);
      }
    }
    // peer.close(); // TODO
  }

  // --- yjs hooks ---

  onDocUpdate(
    update: Uint8Array,
    origin: unknown,
    doc: Y.Doc,
    _transaction: Y.Transaction,
  ) {
    // The transaction origin is the peer whose message produced this update
    // (passed to `readSyncMessage`). Publishing from it relays to every other
    // subscriber in the room — publish excludes the origin, which already has
    // the update. Updates with a non-peer origin (e.g. server-side state load)
    // are not relayed here.
    //
    // A sync backplane relays this published message to peers on other
    // instances, but it does not feed it back through the `message` hook, so
    // each instance's `Y.Doc` only reflects peers handled locally. A peer that
    // connects to a "cold" instance therefore syncs (via `writeSyncStep1` in
    // `onOpen`) against a doc that may be missing history from other instances.
    if (!isPeer(origin)) {
      return;
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    origin.publish((doc as SharedDoc).name, encoding.toUint8Array(encoder));
  }

  // --- utils ---

  getDoc(peer: crossws.Peer): SharedDoc {
    if ((peer as any)._ycdoc) {
      return (peer as any)._ycdoc;
    }
    const docName = new URL(peer.request?.url!).pathname.slice(1);
    let doc = this.docs.get(docName);
    if (!doc) {
      doc = new SharedDoc(docName, this);
      doc.gc = true;
      this.persistence?.bindState(docName, doc);
      this.docs.set(docName, doc);
    }
    if (!doc.peerIds.has(peer)) {
      doc.peerIds.set(peer, new Set());
    }
    (peer as any)._ycdoc = doc;
    return doc;
  }
}

// --------- Doc ---------

export class SharedDoc extends Y.Doc {
  name: string;
  yc: YCrossws;
  awareness: awarenessProtocol.Awareness;
  peerIds: Map<crossws.Peer, Set<number>> = new Map();

  constructor(name: string, yc: YCrossws) {
    super();
    this.name = name;
    this.yc = yc;
    this.awareness = new awarenessProtocol.Awareness(this);
    this.awareness.setLocalState(null);
    this.awareness.on("update", this.onAwarenessUpdate.bind(this));
    this.on("update", yc.onDocUpdate.bind(yc));
  }

  onAwarenessUpdate(changes: AwarenessChanges, origin: unknown) {
    // Track which awareness client ids each peer controls, so they can be
    // cleared when the peer disconnects.
    if (isPeer(origin)) {
      const peerControlledIDs = this.peerIds.get(origin);
      if (peerControlledIDs !== undefined) {
        for (const clientID of changes.added) {
          peerControlledIDs.add(clientID);
        }
        for (const clientID of changes.removed) {
          peerControlledIDs.delete(clientID);
        }
      }
    }
    // Awareness is ephemeral and never persisted. Relay it on the room channel,
    // publishing from the origin peer (excludes the sender). Changes with a
    // non-peer origin are local-only and not relayed.
    if (!isPeer(origin)) {
      return;
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
        ...changes.added,
        ...changes.updated,
        ...changes.removed,
      ]),
    );
    origin.publish(this.name, encoding.toUint8Array(encoder));
  }
}

// --------- utils ---------

function isPeer(value: unknown): value is crossws.Peer {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as crossws.Peer).publish === "function"
  );
}

// --------- constants ---------

export const messageSync = 0;
export const messageAwareness = 1;
// export const messageAuth = 2;

// --------- types ---------

export interface YCrosswsOptions {}

export interface YCrosswsHandler {
  hooks: crossws.Hooks;
}

type AwarenessChanges = {
  added: number[];
  updated: number[];
  removed: number[];
};

export interface Persistence {
  bindState: (a: string, doc: SharedDoc) => void;
  writeState: (a: string, doc: SharedDoc) => Promise<any>;
  provider: any;
}
