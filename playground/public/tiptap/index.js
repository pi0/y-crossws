// Source: https://github.com/ueberdosis/tiptap/blob/main/demos/src/Demos/CollaborationSplitPane/React/index.jsx

import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import Editor from "./editor.js";
import React from "react";
import { createRoot } from "react-dom/client";

const h = React.createElement;

const wsEndpoint = `ws://${window.location.host}`;

const room = `room-${new Date().toISOString().split("T")[0].replace(/-/g, ".")}`;

// ydoc and provider for Editor A
const ydocA = new Y.Doc();

const providerA = new WebsocketProvider(wsEndpoint, "tiptap", ydocA);

// ydoc and provider for Editor B
const ydocB = new Y.Doc();
const providerB = new WebsocketProvider(wsEndpoint, "tiptap", ydocB);

const App = () => {
  return h(
    "div",
    { className: "col-group" },
    h(Editor, {
      provider: providerA,
      ydoc: ydocA,
      room: room,
    }),
    h(Editor, {
      provider: providerB,
      ydoc: ydocB,
      room: room,
    }),
  );
};

const root = createRoot(document.querySelector("#editor"));
root.render(App());
