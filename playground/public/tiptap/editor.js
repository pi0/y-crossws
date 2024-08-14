// Source: https://github.com/ueberdosis/tiptap/blob/main/demos/src/Demos/CollaborationSplitPane/React/Editor.jsx

import CharacterCount from "@tiptap/extension-character-count";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import Highlight from "@tiptap/extension-highlight";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import {
  useEditor,
  EditorContent,
  BubbleMenu,
  FloatingMenu,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import React, { useCallback, useEffect, useState } from "react";
import { faker } from "@faker-js/faker";

const h = React.createElement;

// prettier-ignore
const colors = ["#958DF1", "#F98181", "#FBBC88", "#FAF594", "#70CFF8", "#94FADB", "#B9F18D", "#C3E2C2", "#EAECCC", "#AFC8AD", "#EEC759", "#9BB8CD", "#FF90BC", "#FFC0D9", "#DC8686", "#7ED7C1", "#F3EEEA", "#89B9AD", "#D0BFFF", "#FFF8C9", "#CBFFA9", "#9BABB8", "#E3F4F4"];

const defaultContent = `
  <p>Hi 👋, this is a collaborative document.</p>
  <p>Feel free to edit and collaborate in real-time!</p>
`;

const getInitialUser = () => {
  return {
    name: faker.name.fullName(),
    color: colors[Math.floor(Math.random() * colors.length)],
  };
};

const Editor = ({ ydoc, provider, room }) => {
  const [status, setStatus] = useState("connecting");
  const [currentUser, setCurrentUser] = useState(getInitialUser);

  const editor = useEditor({
    onCreate: ({ editor: currentEditor }) => {
      provider.on("synced", () => {
        if (currentEditor.isEmpty) {
          currentEditor.commands.setContent(defaultContent);
        }
      });
    },
    extensions: [
      StarterKit.configure({ history: false }),
      Highlight,
      TaskList,
      TaskItem,
      CharacterCount.configure({ limit: 10_000 }),
      Collaboration.configure({ document: ydoc }),
      CollaborationCursor.configure({ provider }),
    ],
  });

  useEffect(() => {
    // Update status changes
    const statusHandler = (event) => {
      setStatus(event.status);
    };
    provider.on("status", statusHandler);
    return () => {
      provider.off("status", statusHandler);
    };
  }, [provider]);

  // Save current user to localStorage and emit to editor
  useEffect(() => {
    if (editor && currentUser) {
      localStorage.setItem("currentUser", JSON.stringify(currentUser));
      editor.chain().focus().updateUser(currentUser).run();
    }
  }, [editor, currentUser]);

  const setName = useCallback(() => {
    const name = (window.prompt("Name", currentUser.name) || "")
      .trim()
      .slice(0, 32);
    if (name) {
      return setCurrentUser({
        ...currentUser,
        name,
      });
    }
  }, [currentUser]);

  if (!editor) {
    return null;
  }

  const menu = h(
    React.Fragment,
    null,
    editor &&
      h(
        BubbleMenu,
        {
          className: "bubble-menu",
          tippyOptions: {
            duration: 100,
          },
          editor: editor,
        },
        h(
          "button",
          {
            onClick: () => editor.chain().focus().toggleBold().run(),
            className: editor.isActive("bold") ? "is-active" : "",
          },
          "Bold",
        ),
        h(
          "button",
          {
            onClick: () => editor.chain().focus().toggleItalic().run(),
            className: editor.isActive("italic") ? "is-active" : "",
          },
          "Italic",
        ),
        h(
          "button",
          {
            onClick: () => editor.chain().focus().toggleStrike().run(),
            className: editor.isActive("strike") ? "is-active" : "",
          },
          "Strike",
        ),
      ),
    editor &&
      h(
        FloatingMenu,
        {
          className: "floating-menu",
          tippyOptions: {
            duration: 100,
          },
          editor: editor,
        },
        h(
          "button",
          {
            onClick: () =>
              editor
                .chain()
                .focus()
                .toggleHeading({
                  level: 1,
                })
                .run(),
            className: editor.isActive("heading", {
              level: 1,
            })
              ? "is-active"
              : "",
          },
          "H1",
        ),
        h(
          "button",
          {
            onClick: () =>
              editor
                .chain()
                .focus()
                .toggleHeading({
                  level: 2,
                })
                .run(),
            className: editor.isActive("heading", {
              level: 2,
            })
              ? "is-active"
              : "",
          },
          "H2",
        ),
        h(
          "button",
          {
            onClick: () => editor.chain().focus().toggleBulletList().run(),
            className: editor.isActive("bulletList") ? "is-active" : "",
          },
          "Bullet list",
        ),
      ),
  );

  return h(
    "div",
    { className: "column-half" },
    menu,
    h(EditorContent, {
      editor: editor,
      className: "main-group",
    }),
    h(
      "div",
      {
        className: "collab-status-group",
        "data-state": status === "connected" ? "online" : "offline",
      },
      h(
        "label",
        null,
        status === "connected"
          ? `${editor.storage.collaborationCursor.users.length} user${editor.storage.collaborationCursor.users.length === 1 ? "" : "s"} online in ${room}`
          : "offline",
      ),
      h(
        "button",
        {
          style: {
            "--color": currentUser.color,
          },
          onClick: setName,
        },
        "\u270E ",
        currentUser.name,
      ),
    ),
  );
};

export default Editor;
