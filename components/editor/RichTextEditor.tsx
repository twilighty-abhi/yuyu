"use client";

import { useEffect, useState, type ReactNode } from "react";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import FormatClearIcon from "@mui/icons-material/FormatClear";
import FormatItalicIcon from "@mui/icons-material/FormatItalic";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import FormatQuoteIcon from "@mui/icons-material/FormatQuote";
import TitleIcon from "@mui/icons-material/Title";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

type Props = { name: string; label: string; defaultValue?: string; helperText?: string; minHeight?: number };

export function RichTextEditor({ name, label, defaultValue = "", helperText, minHeight = 120 }: Props) {
  const [html, setHtml] = useState(defaultValue);
  const editor = useEditor({ extensions: [StarterKit.configure({ codeBlock: false, heading: { levels: [2, 3] } })], content: defaultValue, immediatelyRender: false, onUpdate: ({ editor: currentEditor }) => setHtml(currentEditor.getHTML()) });
  useEffect(() => { if (editor && editor.getHTML() !== defaultValue) editor.commands.setContent(defaultValue); }, [defaultValue, editor]);
  const button = (label: string, active: boolean, action: () => void, icon: ReactNode) => <Button aria-label={label} aria-pressed={active} size="small" variant={active ? "contained" : "text"} onClick={action} sx={{ minWidth: 36, px: 0.75 }}>{icon}</Button>;
  return <Stack spacing={0.75}><Typography component="label" variant="body2" sx={{ fontWeight: 600 }}>{label}</Typography><input type="hidden" name={name} value={html} readOnly />
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden", "& .ProseMirror": { minHeight, p: 1.5, outline: "none", "& p": { my: 0.5 }, "& ul, & ol": { pl: 3 }, "& blockquote": { borderLeft: 3, borderColor: "divider", pl: 1.5, ml: 0 } } }}>
      <Stack direction="row" spacing={0.25} sx={{ p: 0.5, borderBottom: 1, borderColor: "divider", flexWrap: "wrap" }}>{button("Heading", editor?.isActive("heading") ?? false, () => editor?.chain().focus().toggleHeading({ level: 2 }).run(), <TitleIcon fontSize="small" />)}{button("Bold", editor?.isActive("bold") ?? false, () => editor?.chain().focus().toggleBold().run(), <FormatBoldIcon fontSize="small" />)}{button("Italic", editor?.isActive("italic") ?? false, () => editor?.chain().focus().toggleItalic().run(), <FormatItalicIcon fontSize="small" />)}{button("Bulleted list", editor?.isActive("bulletList") ?? false, () => editor?.chain().focus().toggleBulletList().run(), <FormatListBulletedIcon fontSize="small" />)}{button("Numbered list", editor?.isActive("orderedList") ?? false, () => editor?.chain().focus().toggleOrderedList().run(), <FormatListNumberedIcon fontSize="small" />)}{button("Quote", editor?.isActive("blockquote") ?? false, () => editor?.chain().focus().toggleBlockquote().run(), <FormatQuoteIcon fontSize="small" />)}{button("Clear formatting", false, () => editor?.chain().focus().clearNodes().unsetAllMarks().run(), <FormatClearIcon fontSize="small" />)}</Stack>
      <EditorContent editor={editor} />
    </Box>{helperText ? <Typography variant="caption" color="text.secondary">{helperText}</Typography> : null}
  </Stack>;
}
