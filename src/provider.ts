import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as authProtocol from "y-protocols/auth";
import * as awarenessProtocol from "y-protocols/awareness";
import * as bc from "lib0/broadcastchannel";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { ObservableV2 } from "lib0/observable";

type Fn = (...args: any[]) => any;

export interface WebsocketProviderOptions {
  /**
   * URL parameters
   * @default {}
   */
  params?: Record<string, string>;
  /**
   * Specify websocket protocols
   * @default []
   */
  protocols?: Array<string>;
  /**
   * WebSocket polyfill
   * @default WebSocket
   */
  WebSocketPolyfill?: typeof WebSocket;
  /**
   * Maximum amount of time to wait before trying to reconnect (we try to reconnect using exponential.
   * @default 2500
   */
  maxBackoffTime?: number;
  /**
   * Request server state every `resyncInterval` milliseconds
   * @default -1
   */
  resyncInterval?: number;
  /**
   * Whether to connect to other peers or not
   * @default true
   */
  connect?: boolean;
  /**
   * Awareness instance
   */
  awareness?: awarenessProtocol.Awareness;
  /**
   * Disable cross-tab BroadcastChannel communication
   * @default false
   */
  disableBc?: boolean;
}

// TODO: this should depend on awareness.outdatedTime
const messageReconnectTimeout = 30_000;

// encoder, decoder, provider, emitSynced, messageType
type MessageHandler = (
  encoder: encoding.Encoder,
  decoder: decoding.Decoder,
  provider: WebsocketProvider,
  emitSynced: boolean,
  messageType: number,
) => void;

const messageSync = 0;
const messageAwareness = 1;
// const messageAuth = 2;
const messageQueryAwareness = 3;

const messageHandlers: [
  MessageHandler,
  MessageHandler,
  MessageHandler,
  MessageHandler,
] = [
  // 0: messageSync
  (encoder, decoder, provider, emitSynced, _messageType) => {
    encoding.writeVarUint(encoder, messageSync);
    const syncMessageType = syncProtocol.readSyncMessage(
      decoder,
      encoder,
      provider.doc,
      provider,
    );
    if (
      emitSynced &&
      syncMessageType === syncProtocol.messageYjsSyncStep2 &&
      !provider.synced
    ) {
      provider.synced = true;
    }
  },
  // 1: messageAwareness
  (encoder, decoder, provider, _emitSynced, _messageType) => {
    awarenessProtocol.applyAwarenessUpdate(
      provider.awareness,
      decoding.readVarUint8Array(decoder),
      provider,
    );
  },
  // 2: messageAuth
  (_encoder, decoder, provider, _emitSynced, _messageType) => {
    authProtocol.readAuthMessage(decoder, provider.doc, (_ydoc, reason) => {
      console.warn(
        `[y-crossws-provider] Permission denied to access ${provider.url}.\n${reason}`,
      );
    });
  },
  // 3: messageQueryAwareness
  (encoder, _decoder, provider, _emitSynced, _messageType) => {
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(provider.awareness, [
        ...provider.awareness.getStates().keys(),
      ]),
    );
  },
];

/**
 * Websocket Provider for Yjs. Creates a websocket connection to sync the shared document.
 * The document name is attached to the provided url. I.e. the following example
 * creates a websocket connection to http://localhost:1234/my-document-name
 *
 * @example
 *   import * as Y from 'yjs'
 *   import { WebsocketProvider } from 'y-crossws'
 *   const doc = new Y.Doc()
 *   const provider = new WebsocketProvider('http://localhost:1234', 'my-document-name', doc)
 */
export class WebsocketProvider extends ObservableV2<any> {
  serverUrl: string;
  bcChannel: string;
  maxBackoffTime: number;
  params: Record<string, string>;
  protocols: string[];
  roomname: string;
  disableBc: boolean;
  shouldConnect: boolean;

  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;

  ws?: WebSocket;
  wsconnected: boolean = false;
  wsconnecting: boolean = false;
  wsUnsuccessfulReconnects: number = 0;
  wsLastMessageReceived: number = 0;
  bcconnected: boolean = false;
  messageHandlers: Array<Fn>;

  _WS: typeof WebSocket;
  _synced: boolean = false;
  _resyncInterval: number | ReturnType<typeof setInterval> = 0;
  _checkInterval?: ReturnType<typeof setInterval>;
  _bcSubscriber: (data: ArrayBuffer, origin: any) => void;
  _updateHandler: (update: Uint8Array, origin: any) => void;
  _awarenessUpdateHandler: (update: any, origin: any) => void;
  _exitHandler: () => void;

  constructor(
    serverUrl: string,
    roomname: string,
    doc: Y.Doc,
    {
      connect = true,
      awareness = new awarenessProtocol.Awareness(doc),
      params = {},
      protocols = [],
      WebSocketPolyfill = WebSocket,
      resyncInterval = -1,
      maxBackoffTime = 2500,
      disableBc = false,
    }: WebsocketProviderOptions = {},
  ) {
    super();

    this.serverUrl = serverUrl.replace(/\/$/, "");
    this.bcChannel = this.serverUrl + "/" + roomname;
    this.maxBackoffTime = maxBackoffTime;
    this.params = params;
    this.protocols = protocols;
    this.roomname = roomname;
    this.doc = doc;
    this._WS = WebSocketPolyfill;
    this.awareness = awareness;
    this.disableBc = disableBc;
    this.shouldConnect = connect;
    this.messageHandlers = [...messageHandlers];

    if (resyncInterval > 0) {
      this._resyncInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          // Resend sync step 1
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, messageSync);
          syncProtocol.writeSyncStep1(encoder, doc);
          this.ws.send(encoding.toUint8Array(encoder));
        }
      }, resyncInterval);
    }

    this._bcSubscriber = (data, origin) => {
      if (origin !== this) {
        const encoder = readMessage(this, new Uint8Array(data), false);
        if (encoding.length(encoder) > 1) {
          bc.publish(this.bcChannel, encoding.toUint8Array(encoder), this);
        }
      }
    };

    this._updateHandler = (update, origin) => {
      if (origin !== this) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.writeUpdate(encoder, update);
        broadcastMessage(this, encoding.toUint8Array(encoder));
      }
    };

    this.doc.on("update", this._updateHandler);

    this._awarenessUpdateHandler = ({ added, updated, removed }, _origin) => {
      // eslint-disable-next-line unicorn/prefer-spread
      const changedClients = added.concat(updated).concat(removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients),
      );
      broadcastMessage(this, encoding.toUint8Array(encoder));
    };

    this._exitHandler = () => {
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        [doc.clientID],
        "app closed",
      );
    };

    if (typeof globalThis.process?.on === "function") {
      globalThis.process.on("exit", this._exitHandler);
    }

    awareness.on("update", this._awarenessUpdateHandler);

    this._checkInterval = setInterval(() => {
      if (
        this.wsconnected &&
        messageReconnectTimeout < Date.now() - this.wsLastMessageReceived
      ) {
        // no message received in a long time - not even your own awareness
        // updates (which are updated every 15 seconds)
        this.ws?.close();
      }
    }, messageReconnectTimeout / 10);

    if (connect) {
      this.connect();
    }
  }

  get url() {
    const encodedParams =
      Object.keys(this.params).length > 0
        ? `?${new URLSearchParams(this.params).toString()}`
        : "";
    return this.serverUrl + "/" + this.roomname + encodedParams;
  }

  get synced(): boolean {
    return this._synced;
  }

  set synced(state: boolean) {
    if (this._synced !== state) {
      this._synced = state;
      this.emit("synced", [state]);
      this.emit("sync", [state]);
    }
  }

  destroy() {
    if (this._resyncInterval !== 0) {
      clearInterval(this._resyncInterval);
    }
    clearInterval(this._checkInterval);
    this.disconnect();
    if (typeof globalThis.process?.on === "function") {
      process.off("exit", this._exitHandler);
    }
    this.awareness.off("update", this._awarenessUpdateHandler);
    this.doc.off("update", this._updateHandler);
    super.destroy();
  }

  connectBc() {
    if (this.disableBc) {
      return;
    }
    if (!this.bcconnected) {
      bc.subscribe(this.bcChannel, this._bcSubscriber);
      this.bcconnected = true;
    }
    // Send sync step1 to bc
    // Write sync step 1
    const encoderSync = encoding.createEncoder();
    encoding.writeVarUint(encoderSync, messageSync);
    syncProtocol.writeSyncStep1(encoderSync, this.doc);
    bc.publish(this.bcChannel, encoding.toUint8Array(encoderSync), this);
    // Broadcast local state
    const encoderState = encoding.createEncoder();
    encoding.writeVarUint(encoderState, messageSync);
    syncProtocol.writeSyncStep2(encoderState, this.doc);
    bc.publish(this.bcChannel, encoding.toUint8Array(encoderState), this);
    // Write queryAwareness
    const encoderAwarenessQuery = encoding.createEncoder();
    encoding.writeVarUint(encoderAwarenessQuery, messageQueryAwareness);
    bc.publish(
      this.bcChannel,
      encoding.toUint8Array(encoderAwarenessQuery),
      this,
    );
    // Broadcast local awareness state
    const encoderAwarenessState = encoding.createEncoder();
    encoding.writeVarUint(encoderAwarenessState, messageAwareness);
    encoding.writeVarUint8Array(
      encoderAwarenessState,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
        this.doc.clientID,
      ]),
    );
    bc.publish(
      this.bcChannel,
      encoding.toUint8Array(encoderAwarenessState),
      this,
    );
  }

  disconnectBc() {
    // Broadcast message with local awareness state set to null (indicating disconnect)
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(
        this.awareness,
        [this.doc.clientID],
        new Map(),
      ),
    );
    broadcastMessage(this, encoding.toUint8Array(encoder));
    if (this.bcconnected) {
      bc.unsubscribe(this.bcChannel, this._bcSubscriber);
      this.bcconnected = false;
    }
  }

  disconnect() {
    this.shouldConnect = false;
    this.disconnectBc();
    if (this.ws !== null) {
      this.ws?.close();
    }
  }

  connect() {
    this.shouldConnect = true;
    if (!this.wsconnected && this.ws === null) {
      setupWS(this);
      this.connectBc();
    }
  }
}

function setupWS(provider: WebsocketProvider) {
  if (provider.shouldConnect && provider.ws === null) {
    const _WebSocket = provider._WS || globalThis.WebSocket;
    const websocket = new _WebSocket(provider.url, provider.protocols);
    websocket.binaryType = "arraybuffer";

    provider.ws = websocket;
    provider.wsconnecting = true;
    provider.wsconnected = false;
    provider.synced = false;

    websocket.addEventListener("message", (event) => {
      provider.wsLastMessageReceived = Date.now();
      const encoder = readMessage(provider, new Uint8Array(event.data), true);
      if (encoding.length(encoder) > 1) {
        websocket.send(encoding.toUint8Array(encoder));
      }
    });

    websocket.addEventListener("error", (event) => {
      provider.emit("connection-error", [event, provider]);
    });

    websocket.addEventListener("close", (event) => {
      provider.emit("connection-close", [event, provider]);
      provider.ws = undefined;
      provider.wsconnecting = false;
      if (provider.wsconnected) {
        provider.wsconnected = false;
        provider.synced = false;
        // Update awareness (all users except local left)
        awarenessProtocol.removeAwarenessStates(
          provider.awareness,
          [...provider.awareness.getStates().keys()].filter(
            (client) => client !== provider.doc.clientID,
          ),
          provider,
        );
        provider.emit("status", [{ status: "disconnected" }]);
      } else {
        provider.wsUnsuccessfulReconnects++;
      }
      // Start with no reconnect timeout and increase timeout by
      // using exponential backoff starting with 100ms
      setTimeout(
        setupWS,
        Math.min(
          Math.pow(2, provider.wsUnsuccessfulReconnects) * 100,
          provider.maxBackoffTime,
        ),
        provider,
      );
    });

    websocket.addEventListener("open", () => {
      provider.wsLastMessageReceived = Date.now();
      provider.wsconnecting = false;
      provider.wsconnected = true;
      provider.wsUnsuccessfulReconnects = 0;
      provider.emit("status", [{ status: "connected" }]);
      // Always send sync step 1 when connected
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeSyncStep1(encoder, provider.doc);
      websocket.send(encoding.toUint8Array(encoder));
      // Broadcast local awareness state
      if (provider.awareness.getLocalState() !== null) {
        const encoderAwarenessState = encoding.createEncoder();
        encoding.writeVarUint(encoderAwarenessState, messageAwareness);
        encoding.writeVarUint8Array(
          encoderAwarenessState,
          awarenessProtocol.encodeAwarenessUpdate(provider.awareness, [
            provider.doc.clientID,
          ]),
        );
        websocket.send(encoding.toUint8Array(encoderAwarenessState));
      }
    });

    provider.emit("status", [{ status: "connecting" }]);
  }
}

function broadcastMessage(provider: WebsocketProvider, buf: ArrayBuffer) {
  if (!provider.wsconnected) {
    return;
  }
  const ws = provider.ws;
  if (ws && ws?.readyState === ws.OPEN) {
    ws.send(buf);
  }
  bc.publish(provider.bcChannel, buf, provider);
}

function readMessage(
  provider: WebsocketProvider,
  buf: Uint8Array,
  emitSynced: boolean,
): encoding.Encoder {
  const decoder = decoding.createDecoder(buf);
  const encoder = encoding.createEncoder();
  const messageType = decoding.readVarUint(decoder);
  const messageHandler = provider.messageHandlers[messageType];
  if (messageHandler) {
    messageHandler(encoder, decoder, provider, emitSynced, messageType);
  } else {
    console.error("[y-crossws-provider] Unable to compute message");
  }
  return encoder;
}
