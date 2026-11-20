import { isLongPaste } from "./composer-attachments";
import { bracketIsLiteral, escapeThreadLabel, httpLinkDestination } from "./thread-refs";

/** Types over the focused field's selection as a browser edit, which keeps its own Undo (Chromium drops the history
 * when script sets `value`); false where the browser cannot. */
export function typeOverSelection(insert: string): boolean {
  return typeof document.execCommand === "function" && document.execCommand("insertText", false, insert);
}

/** The text with an HTTP(S) address pasted over the selected words written as `[words](address)`, the part of it that
 * replaces the selection, and where the caret goes. */
export function linkSelection(text: string, start: number, end: number, pasted: string): { text: string; insert: string; caret: number } | null {
  if (start >= end || isLongPaste(pasted)) return null;
  const destination = httpLinkDestination(pasted.trim());
  const words = /^(\s*)([\s\S]*?)(\s*)$/.exec(text.slice(start, end));
  if (!destination || !words?.[2] || /\r?\n[ \t]*\r?\n/.test(words[2]) || bracketIsLiteral(text, start + words[1].length)) return null;
  const link = `[${escapeThreadLabel(words[2])}](${destination.replace(/[()]/g, (paren) => (paren === "(" ? "%28" : "%29"))})`;
  const insert = words[1] + link + words[3];
  return { text: text.slice(0, start) + insert + text.slice(end), insert, caret: start + insert.length };
}
