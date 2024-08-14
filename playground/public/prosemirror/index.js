import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { exampleSetup } from "prosemirror-example-setup";
import { keymap } from "prosemirror-keymap";
import {
  ySyncPlugin,
  yCursorPlugin,
  yUndoPlugin,
  undo,
  redo,
} from "y-prosemirror";
import { schema } from "./schema.js";

const ydoc = new Y.Doc();

const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
const wsUrl = `${wsProto}//${window.location.host}/_ws`;

const provider = new WebsocketProvider(wsUrl, "prosemirror", ydoc);

const type = ydoc.getXmlFragment("prosemirror");

const editor = document.querySelector("#editor");

editor.innerHTML = "";

const prosemirrorView = new EditorView(editor, {
  state: EditorState.create({
    schema: schema,
    plugins: [
      ySyncPlugin(type),
      yCursorPlugin(provider.awareness),
      yUndoPlugin(),
      keymap({
        "Mod-z": undo,
        "Mod-y": redo,
        "Mod-Shift-z": redo,
      }),
      ...exampleSetup({ schema }),
    ],
  }),
});

console.log(exampleSetup({ schema }));

window.example = { provider, ydoc, type, prosemirrorView };
