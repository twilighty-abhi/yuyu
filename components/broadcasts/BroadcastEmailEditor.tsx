"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Bold, Braces, Heading, Italic, Link2, Link2Off, List, ListOrdered, Quote, Redo2, RemoveFormatting, RectangleHorizontal, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { BROADCAST_PLACEHOLDERS, BROADCAST_URL_PLACEHOLDERS } from "@/lib/broadcastTemplate";

const URL_PLACEHOLDER = new RegExp(`^\\{\\{\\s*(${BROADCAST_URL_PLACEHOLDERS.join("|")})\\s*\\}\\}$`);

function isAcceptableHref(href: string) {
  if (URL_PLACEHOLDER.test(href)) return true;
  try {
    const protocol = href.startsWith("mailto:") ? "mailto:" : new URL(href).protocol;
    return ["http:", "https:", "mailto:"].includes(protocol);
  } catch {
    return false;
  }
}

/** Links carry an optional `cta` class so a paragraph link can render as a button in the email. */
const EmailLink = Link.extend({
  // Tiptap makes links inclusive whenever autolink is on, so text typed after
  // an inserted link or button would silently join it.
  inclusive() {
    return false;
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      class: {
        default: null,
        parseHTML: (element) => element.getAttribute("class"),
        renderHTML: (attributes) => (attributes.class ? { class: attributes.class } : {}),
      },
    };
  },
}).configure({
  openOnClick: false,
  autolink: true,
  linkOnPaste: true,
  defaultProtocol: "https",
  isAllowedUri: (url, context) => URL_PLACEHOLDER.test(url) || context.defaultValidate(url),
});

const BUTTON_PRESETS = [
  { label: "View your ticket", href: "{{ticketLink}}" },
  { label: "Open the event page", href: "{{eventUrl}}" },
  { label: "Share your feedback", href: "{{feedbackUrl}}" },
] as const;

export function BroadcastEmailEditor(props: { value: string; onChange: (html: string) => void; disabled?: boolean }) {
  const { value, onChange, disabled = false } = props;
  const [linkDialog, setLinkDialog] = useState<{ mode: "link" | "button"; text: string; href: string; error: string } | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false, code: false, heading: { levels: [2, 3] }, link: false, horizontalRule: false }),
      EmailLink,
    ],
    content: value,
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "yy-prose min-h-[280px] px-4 py-3.5 text-ink focus:outline-none",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Message",
      },
    },
    onUpdate: ({ editor: current }) => onChange(current.getHTML()),
  });

  // Keep the editor in sync when a template, a previous email, or a saved
  // draft is loaded. Loading is not an edit, so it emits no update: the
  // editor's normalised HTML would otherwise count as an unsaved change.
  useEffect(() => {
    if (editor && value !== editor.getHTML()) editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);
  // Toggling editability is not an edit either (Tiptap emits an update by default).
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);

  const button = (label: string, active: boolean, action: () => void, icon: ReactNode) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={action}
      disabled={disabled}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-md text-ink-secondary transition-colors duration-[180ms] ease-yy hover:bg-muted hover:text-ink disabled:pointer-events-none disabled:text-ink-disabled [&_svg]:size-[18px]",
        active && "bg-primary text-on-primary hover:bg-primary hover:text-on-primary",
      )}
    >
      {icon}
    </button>
  );
  const toolbarMenuButton = "inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-semibold text-ink-secondary transition-colors hover:bg-muted hover:text-ink disabled:pointer-events-none disabled:text-ink-disabled [&_svg]:size-4";

  const insertPlaceholder = (token: string) => {
    editor?.chain().focus().insertContent({ type: "text", text: token }).run();
  };

  const insertButton = (text: string, href: string) => {
    editor?.chain().focus().insertContent({
      type: "paragraph",
      content: [{ type: "text", text, marks: [{ type: "link", attrs: { href, class: "cta" } }] }],
    }).run();
  };

  const openLinkDialog = (mode: "link" | "button") => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    setLinkDialog({
      mode,
      text: editor.state.doc.textBetween(from, to, " "),
      href: mode === "link" ? (editor.getAttributes("link").href ?? "") : "",
      error: "",
    });
  };

  const applyLinkDialog = () => {
    if (!editor || !linkDialog) return;
    const href = linkDialog.href.trim();
    if (!isAcceptableHref(href)) {
      setLinkDialog({ ...linkDialog, error: "Enter an http(s) URL, a mailto: address, or one of the link placeholders." });
      return;
    }
    if (linkDialog.mode === "button") {
      if (!linkDialog.text.trim()) {
        setLinkDialog({ ...linkDialog, error: "Enter the button text." });
        return;
      }
      insertButton(linkDialog.text.trim(), href);
    } else if (editor.state.selection.empty) {
      if (!linkDialog.text.trim()) {
        setLinkDialog({ ...linkDialog, error: "Enter the text to display for this link." });
        return;
      }
      editor.chain().focus().insertContent({ type: "text", text: linkDialog.text.trim(), marks: [{ type: "link", attrs: { href } }] }).run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    setLinkDialog(null);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          "overflow-hidden rounded-md border border-line-strong bg-canvas transition-colors focus-within:border-[var(--yy-focus)]",
          disabled && "opacity-70",
          "[&_.ProseMirror_a]:cursor-text [&_.ProseMirror_blockquote]:rounded-r-md [&_.ProseMirror_blockquote]:border-primary [&_.ProseMirror_blockquote]:bg-subtle [&_.ProseMirror_blockquote]:py-1",
          "[&_.ProseMirror_a.cta]:inline-block [&_.ProseMirror_a.cta]:rounded-full [&_.ProseMirror_a.cta]:bg-primary [&_.ProseMirror_a.cta]:px-5 [&_.ProseMirror_a.cta]:py-2 [&_.ProseMirror_a.cta]:font-semibold [&_.ProseMirror_a.cta]:text-on-primary [&_.ProseMirror_a.cta]:no-underline",
        )}
      >
        <div role="toolbar" aria-label="Message formatting" className="flex flex-wrap items-center gap-0.5 border-b border-line bg-subtle p-1">
          {button("Bold", editor?.isActive("bold") ?? false, () => editor?.chain().focus().toggleBold().run(), <Bold />)}
          {button("Italic", editor?.isActive("italic") ?? false, () => editor?.chain().focus().toggleItalic().run(), <Italic />)}
          {button("Heading", editor?.isActive("heading") ?? false, () => editor?.chain().focus().toggleHeading({ level: 2 }).run(), <Heading />)}
          {button("Bulleted list", editor?.isActive("bulletList") ?? false, () => editor?.chain().focus().toggleBulletList().run(), <List />)}
          {button("Numbered list", editor?.isActive("orderedList") ?? false, () => editor?.chain().focus().toggleOrderedList().run(), <ListOrdered />)}
          {button("Quote", editor?.isActive("blockquote") ?? false, () => editor?.chain().focus().toggleBlockquote().run(), <Quote />)}
          <span aria-hidden className="mx-1 h-6 w-px bg-line" />
          {button("Add or edit link", editor?.isActive("link") ?? false, () => openLinkDialog("link"), <Link2 />)}
          {button("Remove link", false, () => editor?.chain().focus().unsetLink().run(), <Link2Off />)}
          <Menu modal={false}>
            <MenuTrigger asChild disabled={disabled}>
              <button type="button" className={toolbarMenuButton}>
                <RectangleHorizontal aria-hidden />
                Button
              </button>
            </MenuTrigger>
            <MenuContent align="start" onCloseAutoFocus={(event) => event.preventDefault()}>
              {BUTTON_PRESETS.map((preset) => (
                <MenuItem key={preset.href} description={preset.href} onSelect={() => insertButton(preset.label, preset.href)}>
                  {preset.label}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem description="Your own text and link" onSelect={() => openLinkDialog("button")}>
                Custom button…
              </MenuItem>
            </MenuContent>
          </Menu>
          <Menu modal={false}>
            <MenuTrigger asChild disabled={disabled}>
              <button type="button" className={toolbarMenuButton}>
                <Braces aria-hidden />
                Placeholder
              </button>
            </MenuTrigger>
            <MenuContent align="start" onCloseAutoFocus={(event) => event.preventDefault()} className="max-h-[360px] overflow-y-auto">
              {BROADCAST_PLACEHOLDERS.map((placeholder) => (
                <MenuItem key={placeholder.token} description={<span className="font-mono">{placeholder.token}</span>} onSelect={() => insertPlaceholder(placeholder.token)}>
                  {placeholder.label}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
          <span className="flex-1" />
          {button("Undo", false, () => editor?.chain().focus().undo().run(), <Undo2 />)}
          {button("Redo", false, () => editor?.chain().focus().redo().run(), <Redo2 />)}
          {button("Clear formatting", false, () => editor?.chain().focus().clearNodes().unsetAllMarks().run(), <RemoveFormatting />)}
        </div>
        <EditorContent editor={editor} />
      </div>
      <p className="text-caption text-ink-muted">
        Formatting, links, and buttons are kept in the email. Placeholders are filled in for each recipient.
      </p>

      <Dialog open={Boolean(linkDialog)} onOpenChange={(open) => { if (!open) setLinkDialog(null); }}>
        <DialogContent size="sm">
          <DialogHeader title={linkDialog?.mode === "button" ? "Add button" : "Add link"} />
          <DialogBody className="flex flex-col gap-4">
            {linkDialog?.error ? <Callout tone="danger" role="alert">{linkDialog.error}</Callout> : null}
            {linkDialog?.mode === "button" || editor?.state.selection.empty ? (
              <Field label={linkDialog?.mode === "button" ? "Button text" : "Link text"}>
                <Input value={linkDialog?.text ?? ""} onChange={(event) => setLinkDialog((current) => current && { ...current, text: event.target.value })} autoFocus />
              </Field>
            ) : null}
            <Field label="URL or placeholder" helperText="HTTP(S), mailto:, {{ticketLink}}, {{eventUrl}}, or {{feedbackUrl}}.">
              <Input
                value={linkDialog?.href ?? ""}
                onChange={(event) => setLinkDialog((current) => current && { ...current, href: event.target.value })}
                placeholder="https://example.com or {{ticketLink}}"
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setLinkDialog(null)}>Cancel</Button>
            <Button variant="primary" onClick={applyLinkDialog}>{linkDialog?.mode === "button" ? "Add button" : "Add link"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
