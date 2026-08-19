import { useState, useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import UnderlineExt from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table/kit";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  IndentDecrease,
  IndentIncrease,
  Link2,
  Link2Off,
  ImageIcon,
  Table2,
  Undo2,
  Redo2,
  Code2,
  Quote,
  Rows3,
  Columns3,
  Trash2,
  Plus,
  Minus,
  Baseline,
  Highlighter,
} from "lucide-react";

const BTN_BASE =
  "inline-flex items-center justify-center w-7 h-7 rounded text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const BTN_ACTIVE = "bg-primary text-primary-foreground";
const BTN_IDLE = "hover:bg-muted text-muted-foreground hover:text-foreground";

function ToolBtn({
  icon: Icon,
  title,
  active,
  disabled,
  onClick,
}: {
  icon: React.ElementType;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`${BTN_BASE} ${active ? BTN_ACTIVE : BTN_IDLE}`}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}

function Divider() {
  return <span className="w-px h-5 bg-border mx-0.5 shrink-0" />;
}

const HIGHLIGHT_COLORS = [
  { label: "Amarelo", value: "#fef08a" },
  { label: "Verde", value: "#bbf7d0" },
  { label: "Azul", value: "#bfdbfe" },
  { label: "Rosa", value: "#fbcfe8" },
  { label: "Laranja", value: "#fed7aa" },
];

function ColorPickerBtn({
  editor,
}: {
  editor: ReturnType<typeof useEditor>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const currentColor: string = (editor?.getAttributes("textStyle").color as string) ?? "#000000";

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (!editor) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        title="Cor do texto"
        onClick={() => setOpen((v) => !v)}
        className={`${BTN_BASE} ${BTN_IDLE} flex-col gap-0 px-1`}
        style={{ position: "relative" }}
      >
        <Baseline className="w-3.5 h-3.5" />
        <span
          className="absolute bottom-0.5 left-1 right-1 h-1 rounded-full"
          style={{ background: currentColor }}
        />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-background border border-border rounded-md shadow-lg p-2 flex flex-col gap-1.5 min-w-[140px]">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide px-1">
            Cor do texto
          </label>
          <div className="flex items-center gap-1.5 px-1">
            <input
              type="color"
              title="Escolher cor"
              value={currentColor}
              onChange={(e) => {
                editor.chain().focus().setColor(e.target.value).run();
              }}
              className="w-6 h-6 rounded cursor-pointer border border-border bg-transparent p-0"
            />
            <span className="text-xs text-muted-foreground">Personalizada</span>
          </div>
          <div className="w-full h-px bg-border my-0.5" />
          <button
            type="button"
            onClick={() => {
              editor.chain().focus().unsetColor().run();
              setOpen(false);
            }}
            className="text-xs text-left px-1 py-0.5 rounded hover:bg-muted text-muted-foreground"
          >
            Remover cor
          </button>
        </div>
      )}
    </div>
  );
}

function HighlightPickerBtn({
  editor,
}: {
  editor: ReturnType<typeof useEditor>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (!editor) return null;

  const isActive = editor.isActive("highlight");

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        title="Realce"
        onClick={() => setOpen((v) => !v)}
        className={`${BTN_BASE} ${isActive ? BTN_ACTIVE : BTN_IDLE}`}
      >
        <Highlighter className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-background border border-border rounded-md shadow-lg p-2 flex flex-col gap-1.5 min-w-[140px]">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide px-1">
            Cor de realce
          </label>
          <div className="flex items-center gap-1 px-1">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                title={c.label}
                style={{ background: c.value }}
                onClick={() => {
                  editor.chain().focus().setHighlight({ color: c.value }).run();
                  setOpen(false);
                }}
                className="w-5 h-5 rounded border border-border hover:scale-110 transition-transform"
              />
            ))}
          </div>
          <div className="w-full h-px bg-border my-0.5" />
          <button
            type="button"
            onClick={() => {
              editor.chain().focus().unsetHighlight().run();
              setOpen(false);
            }}
            className="text-xs text-left px-1 py-0.5 rounded hover:bg-muted text-muted-foreground"
          >
            Remover realce
          </button>
        </div>
      )}
    </div>
  );
}

type DialogMode = "none" | "link" | "image";

export function TiptapEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [mode, setMode] = useState<"visual" | "html">("visual");
  const [htmlValue, setHtmlValue] = useState(value ?? "");
  const [dialog, setDialog] = useState<DialogMode>("none");
  const [linkUrl, setLinkUrl] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const dialogInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      UnderlineExt,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Link.configure({ openOnClick: false, autolink: true }),
      Image.configure({ inline: false }),
      Placeholder.configure({ placeholder: "Descreva a viagem, inclua itinerário, o que está incluso, dicas..." }),
      TableKit,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
    ],
    content: value,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      setHtmlValue(html);
      onChange(html);
    },
  });

  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (current !== value && value !== undefined) {
      editor.commands.setContent(value ?? "");
      setHtmlValue(value ?? "");
    }
  }, [value, editor]);

  useEffect(() => {
    if (mode === "visual" && editor && htmlValue !== editor.getHTML()) {
      editor.commands.setContent(htmlValue);
    }
  }, [mode]);

  useEffect(() => {
    if (dialog !== "none") {
      if (dialog === "link") {
        setLinkUrl(editor?.getAttributes("link").href ?? "");
      } else {
        setImageUrl("");
      }
      setTimeout(() => dialogInputRef.current?.focus(), 50);
    }
  }, [dialog]);

  if (!editor) return null;

  function applyLink() {
    if (!editor) return;
    const url = linkUrl.trim();
    if (!url) {
      editor.chain().focus().unsetLink().run();
    } else {
      const href = url.match(/^https?:\/\//) ? url : `https://${url}`;
      editor.chain().focus().setLink({ href, target: "_blank" }).run();
    }
    setDialog("none");
    setLinkUrl("");
  }

  function applyImage() {
    if (!editor) return;
    const url = imageUrl.trim();
    if (url) {
      const src = url.match(/^https?:\/\//) ? url : `https://${url}`;
      editor.chain().focus().setImage({ src }).run();
    }
    setDialog("none");
    setImageUrl("");
  }

  const paragraphType = editor.isActive("heading", { level: 1 })
    ? "h1"
    : editor.isActive("heading", { level: 2 })
    ? "h2"
    : editor.isActive("heading", { level: 3 })
    ? "h3"
    : editor.isActive("blockquote")
    ? "blockquote"
    : "paragraph";

  function setParagraphType(v: string) {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (v === "h1") chain.toggleHeading({ level: 1 }).run();
    else if (v === "h2") chain.toggleHeading({ level: 2 }).run();
    else if (v === "h3") chain.toggleHeading({ level: 3 }).run();
    else if (v === "blockquote") chain.toggleBlockquote().run();
    else chain.setParagraph().run();
  }

  const isInList = editor.isActive("bulletList") || editor.isActive("orderedList");
  const isInTable = editor.isActive("table");

  return (
    <div className="border rounded-md overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 px-1.5 py-1">
        {/* History */}
        <ToolBtn icon={Undo2} title="Desfazer (Ctrl+Z)" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} />
        <ToolBtn icon={Redo2} title="Refazer (Ctrl+Y)" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} />

        <Divider />

        {/* Paragraph type dropdown */}
        <select
          value={paragraphType}
          onChange={(e) => setParagraphType(e.target.value)}
          className="h-7 rounded border border-border bg-background text-xs px-1.5 cursor-pointer hover:bg-muted transition-colors focus:outline-none"
          title="Tipo de parágrafo"
        >
          <option value="paragraph">Parágrafo</option>
          <option value="h1">Título 1</option>
          <option value="h2">Título 2</option>
          <option value="h3">Título 3</option>
          <option value="blockquote">Citação</option>
        </select>

        <Divider />

        {/* Inline formatting */}
        <ToolBtn icon={Bold} title="Negrito (Ctrl+B)" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} />
        <ToolBtn icon={Italic} title="Itálico (Ctrl+I)" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} />
        <ToolBtn icon={Underline} title="Sublinhado (Ctrl+U)" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} />
        <ToolBtn icon={Strikethrough} title="Tachado" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} />
        <ToolBtn icon={Code2} title="Código inline" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} />

        <Divider />

        {/* Text color & highlight */}
        <ColorPickerBtn editor={editor} />
        <HighlightPickerBtn editor={editor} />

        <Divider />

        {/* Alignment */}
        <ToolBtn icon={AlignLeft} title="Alinhar à esquerda" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} />
        <ToolBtn icon={AlignCenter} title="Centralizar" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} />
        <ToolBtn icon={AlignRight} title="Alinhar à direita" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} />
        <ToolBtn icon={AlignJustify} title="Justificar" active={editor.isActive({ textAlign: "justify" })} onClick={() => editor.chain().focus().setTextAlign("justify").run()} />

        <Divider />

        {/* Lists + indent/outdent */}
        <ToolBtn icon={List} title="Lista com marcadores" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} />
        <ToolBtn icon={ListOrdered} title="Lista numerada" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
        <ToolBtn icon={IndentIncrease} title="Aumentar recuo (Tab)" disabled={!isInList} onClick={() => editor.chain().focus().sinkListItem("listItem").run()} />
        <ToolBtn icon={IndentDecrease} title="Diminuir recuo (Shift+Tab)" disabled={!isInList} onClick={() => editor.chain().focus().liftListItem("listItem").run()} />

        <Divider />

        {/* Link */}
        <ToolBtn
          icon={Link2}
          title="Inserir/editar link"
          active={editor.isActive("link") || dialog === "link"}
          onClick={() => setDialog(dialog === "link" ? "none" : "link")}
        />
        <ToolBtn
          icon={Link2Off}
          title="Remover link"
          disabled={!editor.isActive("link")}
          onClick={() => editor.chain().focus().unsetLink().run()}
        />

        <Divider />

        {/* Image */}
        <ToolBtn
          icon={ImageIcon}
          title="Inserir imagem (URL)"
          active={dialog === "image"}
          onClick={() => setDialog(dialog === "image" ? "none" : "image")}
        />

        <Divider />

        {/* Table */}
        <ToolBtn
          icon={Table2}
          title="Inserir tabela (3×3)"
          onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        />
        <ToolBtn
          icon={Rows3}
          title="Adicionar linha abaixo"
          disabled={!isInTable}
          onClick={() => editor.chain().focus().addRowAfter().run()}
        />
        <ToolBtn
          icon={Minus}
          title="Remover linha atual"
          disabled={!isInTable}
          onClick={() => editor.chain().focus().deleteRow().run()}
        />
        <ToolBtn
          icon={Columns3}
          title="Adicionar coluna à direita"
          disabled={!isInTable}
          onClick={() => editor.chain().focus().addColumnAfter().run()}
        />
        <ToolBtn
          icon={Plus}
          title="Remover coluna atual"
          disabled={!isInTable}
          onClick={() => editor.chain().focus().deleteColumn().run()}
        />
        <ToolBtn
          icon={Trash2}
          title="Remover tabela"
          disabled={!isInTable}
          onClick={() => editor.chain().focus().deleteTable().run()}
        />

        <Divider />

        {/* Quote & HR */}
        <ToolBtn icon={Quote} title="Citação em bloco" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} />

        {/* Visual/HTML toggle — push to right */}
        <span className="flex-1" />
        <div className="flex border border-border rounded overflow-hidden">
          <button
            type="button"
            onClick={() => setMode("visual")}
            className={`px-2.5 py-0.5 text-xs font-medium transition-colors ${mode === "visual" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
          >
            Visual
          </button>
          <button
            type="button"
            onClick={() => setMode("html")}
            className={`px-2.5 py-0.5 text-xs font-medium transition-colors ${mode === "html" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
          >
            HTML
          </button>
        </div>
      </div>

      {/* Link dialog */}
      {dialog === "link" && (
        <div className="flex items-center gap-2 border-b bg-muted/20 px-3 py-2">
          <Link2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            ref={dialogInputRef}
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); applyLink(); }
              if (e.key === "Escape") setDialog("none");
            }}
            placeholder="https://exemplo.com"
            className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground/60"
          />
          <button type="button" onClick={applyLink} className="text-xs font-medium text-primary hover:underline">Aplicar</button>
          <button type="button" onClick={() => setDialog("none")} className="text-xs text-muted-foreground hover:text-foreground">Cancelar</button>
        </div>
      )}

      {/* Image dialog */}
      {dialog === "image" && (
        <div className="flex items-center gap-2 border-b bg-muted/20 px-3 py-2">
          <ImageIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            ref={dialog === "image" ? dialogInputRef : undefined}
            type="url"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); applyImage(); }
              if (e.key === "Escape") setDialog("none");
            }}
            placeholder="https://exemplo.com/imagem.jpg"
            className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground/60"
          />
          <button type="button" onClick={applyImage} className="text-xs font-medium text-primary hover:underline">Inserir</button>
          <button type="button" onClick={() => setDialog("none")} className="text-xs text-muted-foreground hover:text-foreground">Cancelar</button>
        </div>
      )}

      {/* Editor area */}
      {mode === "visual" ? (
        <EditorContent
          editor={editor}
          className={[
            "prose prose-sm max-w-none p-4 min-h-[200px] max-h-[520px] overflow-y-auto focus-within:outline-none",
            "[&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[180px]",
            "[&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
            "[&_.ProseMirror_p.is-editor-empty:first-child::before]:text-muted-foreground/50",
            "[&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left",
            "[&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none",
            "[&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0",
            "[&_table]:border-collapse [&_table]:w-full",
            "[&_td]:border [&_td]:border-border [&_td]:p-2 [&_td]:align-top",
            "[&_th]:border [&_th]:border-border [&_th]:p-2 [&_th]:bg-muted [&_th]:font-semibold [&_th]:text-left",
            "[&_.tableWrapper]:overflow-x-auto",
            "[&_img]:max-w-full [&_img]:rounded-md [&_img]:my-2",
          ].join(" ")}
        />
      ) : (
        <textarea
          value={htmlValue}
          onChange={(e) => {
            setHtmlValue(e.target.value);
            onChange(e.target.value);
          }}
          spellCheck={false}
          className="w-full min-h-[200px] p-4 font-mono text-xs bg-muted/20 resize-y outline-none text-foreground"
          placeholder="<p>HTML da descrição...</p>"
        />
      )}
    </div>
  );
}
