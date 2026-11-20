import { fromMarkdown } from "mdast-util-from-markdown";

export interface ThreadRefCandidate {
  botId: string;
  botName: string;
  threadId: string;
  title: string;
  activeAt?: number;
}

export interface ResolvedThreadRef {
  botId: string;
  botName: string;
  threadId: string;
  title: string;
  ambiguous: boolean;
}

export interface ThreadRefSpan {
  text: string;
  ref?: ResolvedThreadRef;
}

interface TitleGroup {
  lower: string;
  candidates: ThreadRefCandidate[];
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const NOT_WORD_START = /[\p{L}\p{N}_#&]/u;

export function threadTokenSpacing(text: string, start: number, end: number): { lead: string; trail: string } {
  return {
    lead: start > 0 && NOT_WORD_START.test(text[start - 1] ?? "") ? " " : "",
    trail: end < text.length && WORD_CHAR.test(text[end] ?? "") ? " " : "",
  };
}

function linkable(title: string): boolean {
  return title.length > 0 && !/^\d+$/.test(title);
}

function groupTitles(threads: ThreadRefCandidate[]): TitleGroup[] {
  const groups = new Map<string, TitleGroup>();
  const seen = new Set<string>();
  for (const thread of threads) {
    const title = thread.title.trim();
    const key = `${thread.botId}/${thread.threadId}`;
    if (!linkable(title) || seen.has(key)) continue;
    seen.add(key);
    const lower = title.toLowerCase();
    const group = groups.get(lower);
    if (group) group.candidates.push({ ...thread, title });
    else groups.set(lower, { lower, candidates: [{ ...thread, title }] });
  }
  return [...groups.values()].sort((a, b) => b.lower.length - a.lower.length);
}

function pick(candidates: ThreadRefCandidate[], currentBotId: string | undefined): ResolvedThreadRef {
  const resolved = (thread: ThreadRefCandidate, ambiguous: boolean): ResolvedThreadRef => ({
    botId: thread.botId, botName: thread.botName, threadId: thread.threadId, title: thread.title, ambiguous,
  });
  if (candidates.length === 1) return resolved(candidates[0], false);
  const own = candidates.filter((thread) => thread.botId === currentBotId);
  if (own.length === 1) return resolved(own[0], false);
  const pool = own.length > 1 ? own : candidates;
  const stamps = pool.map((thread) => thread.activeAt);
  if (stamps.every((stamp) => typeof stamp === "number")) {
    const newest = Math.max(...stamps);
    const latest = pool.filter((thread) => thread.activeAt === newest);
    if (latest.length === 1) return resolved(latest[0], false);
  }
  return resolved(pool[0], true);
}

export function resolveThreadRefs(text: string, threads: ThreadRefCandidate[], currentBotId?: string): ThreadRefSpan[] {
  const groups = groupTitles(threads);
  if (!groups.length || !text.includes("#")) return [{ text }];
  const spans: ThreadRefSpan[] = [];
  let last = 0;
  let at = text.indexOf("#");
  while (at !== -1) {
    const before = at > 0 ? text[at - 1] : "";
    const start = at + 1;
    let matched: { end: number; ref: ResolvedThreadRef } | null = null;
    if (!before || !NOT_WORD_START.test(before)) {
      for (const group of groups) {
        const end = start + group.lower.length;
        if (text.slice(start, end).toLowerCase() !== group.lower) continue;
        const after = text[end] ?? "";
        if (after && WORD_CHAR.test(after)) continue;
        matched = { end, ref: pick(group.candidates, currentBotId) };
        break;
      }
    }
    if (matched) {
      if (at > last) spans.push({ text: text.slice(last, at) });
      spans.push({ text: text.slice(at, matched.end), ref: matched.ref });
      last = matched.end;
      at = text.indexOf("#", matched.end);
    } else {
      at = text.indexOf("#", at + 1);
    }
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans.length ? spans : [{ text }];
}

export interface ThreadRefAddress {
  threadId: string;
  botId?: string;
}

const THREAD_URL_PREFIX = "openmausbot://thread/";
const BOT_URL_PREFIX = "openmausbot://bot/";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_LIMIT = 256;

const plainId = (value: string): string | null => {
  // oxlint-disable-next-line no-control-regex -- a thread id never carries control characters
  if (!value || value.length > ID_LIMIT || /[\u0000-\u001f]/.test(value)) return null;
  return value;
};

export function threadRefUrl(ref: { botId: string; threadId: string }): string {
  return THREAD_URL_PREFIX + encodeURIComponent(ref.threadId) + "?bot=" + encodeURIComponent(ref.botId);
}

export function threadWebRefUrl(ref: { botId: string; threadId: string }, base: string): string | null {
  try {
    const url = new URL(base);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    url.search = "";
    url.hash = "";
    url.searchParams.set("thread", ref.threadId);
    url.searchParams.set("bot", ref.botId);
    return url.href;
  } catch {
    return null;
  }
}

/** `?thread=<threadId>&bot=<botId>` on the web app's address: a chat link that works outside the app. */
export function takeThreadLinkFromLocation(): string | null {
  const location = window.location;
  if (!location) return null;
  const params = new URLSearchParams(location.search);
  const thread = params.get("thread");
  if (thread === null) return null;
  const bot = params.get("bot");
  params.delete("thread");
  params.delete("bot");
  const search = params.toString();
  window.history.replaceState(null, "", location.pathname + (search ? `?${search}` : "") + location.hash);
  return THREAD_URL_PREFIX + encodeURIComponent(thread) + (bot === null ? "" : "?bot=" + encodeURIComponent(bot));
}

export function parseThreadRefUrl(value: string): ThreadRefAddress | null {
  const raw = value.trim();
  if (!raw.toLowerCase().startsWith(THREAD_URL_PREFIX)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password || url.port || url.hash) return null;
  if (url.hostname.toLowerCase() !== "thread") return null;
  let threadId: string;
  try {
    threadId = decodeURIComponent(url.pathname.slice(1));
  } catch {
    return null;
  }
  if (!threadId || threadId.includes("/") || url.pathname.slice(1) !== encodeURIComponent(threadId)) return null;
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => key !== "bot")) return null;
  const bot = url.searchParams.get("bot");
  if (keys.length > 1 || (bot !== null && !bot)) return null;
  const thread = plainId(threadId);
  const owner = bot === null ? undefined : plainId(bot);
  if (!thread || owner === null) return null;
  return owner ? { threadId: thread, botId: owner } : { threadId: thread };
}

export function parseBotRefUrl(value: string): { botId: string } | null {
  const raw = value.trim();
  if (!raw.toLowerCase().startsWith(BOT_URL_PREFIX)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password || url.port || url.hash) return null;
  if (url.hostname.toLowerCase() !== "bot") return null;
  if ([...url.searchParams.keys()].length) return null;
  let botId: string;
  try {
    botId = decodeURIComponent(url.pathname.slice(1));
  } catch {
    return null;
  }
  if (!botId || botId.includes("/") || url.pathname.slice(1) !== encodeURIComponent(botId)) return null;
  const bot = plainId(botId);
  return bot ? { botId: bot } : null;
}

/** Even a link that fails strict parsing must never reach the shell as an external link. */
export function looksLikeThreadRefUrl(value: string): boolean {
  return value.trim().toLowerCase().startsWith(THREAD_URL_PREFIX);
}

export function isThreadUuid(value: string): boolean {
  return UUID.test(value.trim());
}

export function resolveThreadRefAddress(
  threads: ThreadRefCandidate[],
  address: ThreadRefAddress,
  currentBotId?: string,
): ResolvedThreadRef | null {
  const candidates = threads.filter((thread) => thread.threadId === address.threadId);
  if (!candidates.length) return null;
  const pinned = address.botId ? candidates.filter((thread) => thread.botId === address.botId) : [];
  if (pinned.length === 1) return { ...pinned[0], title: pinned[0].title.trim(), ambiguous: false };
  if (pinned.length > 1) return pick(pinned, currentBotId);
  // A pinned owner missing from the visible threads is a dead reference; never fall through to another bot's thread.
  if (address.botId) return null;
  return pick(candidates, currentBotId);
}

export const escapeThreadLabel = (title: string): string =>
  title.replace(/[[\]\\]/g, "\\$&");
const unescapeThreadLabel = (label: string): string => label.replace(/\\(.)/g, "$1");
const unescapeLinkLabel = (label: string): string => label.replace(/\\([!-/:-@[-`{-~])/g, "$1");

/** The address of an HTTP(S) link, as written, or null. Never a script or file address, one with a password, or one
 * that would end its own destination early. */
export function httpLinkDestination(value: string): string | null {
  if (!/^https?:\/\/(?![/?#])\S+$/i.test(value) || /[<>\\\p{Cc}]/u.test(value)) return null;
  try {
    const url = new URL(value);
    return url.username || url.password || !url.hostname ? null : value;
  } catch {
    return null;
  }
}

export function threadRefMarkdown(ref: ResolvedThreadRef): string {
  return "[" + escapeThreadLabel(ref.title) + "](" + threadRefUrl(ref) + ")";
}

interface MarkdownLinkSpan {
  raw: string;
  link?: { label: string; address: ThreadRefAddress | null; destination: string };
  code?: boolean;
}

interface ParsedMdNode {
  type: string;
  url?: string;
  children?: ParsedMdNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

const oddBackslashesEnd = (text: string): boolean => (/\\*$/.exec(text)?.[0].length ?? 0) % 2 === 1;

/** True for a `[` that opens an image (`![`) or was escaped (`\[`), so what follows is not a link. */
export function bracketIsLiteral(text: string, at: number): boolean {
  const before = text.slice(0, at);
  return oddBackslashesEnd(before) || (before.endsWith("!") && !oddBackslashesEnd(before.slice(0, -1)));
}

const MAY_HAVE_MARKDOWN_LINK_OR_CODE = /\]\(|`|~| {4}|\t/;

function hasImageNode(node: ParsedMdNode): boolean {
  if (node.type === "image" || node.type === "imageReference") return true;
  return Boolean(node.children?.some(hasImageNode));
}

function inlineLinkLabelEnd(text: string, start: number, end: number, node: ParsedMdNode): number {
  const after = node.children?.at(-1)?.position?.end.offset ?? start + 1;
  const close = text.indexOf("](", after);
  return close !== -1 && close < end ? close : -1;
}

function splitThreadLinkMarkdown(text: string): MarkdownLinkSpan[] {
  if (!MAY_HAVE_MARKDOWN_LINK_OR_CODE.test(text)) return [{ raw: text }];
  const spans: MarkdownLinkSpan[] = [];
  let cursor = 0;
  const pushPlain = (to: number) => {
    if (to > cursor) spans.push({ raw: text.slice(cursor, to) });
    cursor = to;
  };
  const visit = (node: ParsedMdNode) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (node.type === "code" || node.type === "inlineCode" || node.type === "image") {
      if (start !== undefined && end !== undefined && start >= cursor) {
        pushPlain(start);
        spans.push({ raw: text.slice(start, end), code: true });
        cursor = end;
      }
      return;
    }
    if (node.type === "link") {
      if (start !== undefined && end !== undefined && start >= cursor) {
        pushPlain(start);
        const raw = text.slice(start, end);
        if (text[start] === "[" && !hasImageNode(node)) {
          const labelEnd = inlineLinkLabelEnd(text, start, end, node);
          if (labelEnd !== -1) {
            const destination = node.url ?? "";
            spans.push({
              raw,
              link: { label: text.slice(start + 1, labelEnd), address: parseThreadRefUrl(destination), destination },
            });
            cursor = end;
            return;
          }
        }
        spans.push({ raw, code: true });
        cursor = end;
      }
      return;
    }
    if (node.children) {
      for (const child of node.children) visit(child);
    }
  };
  visit(fromMarkdown(text) as ParsedMdNode);
  pushPlain(text.length);
  return spans.length ? spans : [{ raw: text }];
}


export function serializeThreadRefs(text: string, threads: ThreadRefCandidate[], currentBotId?: string): string {
  if (!groupTitles(threads).length) return text;
  return splitThreadLinkMarkdown(text)
    .map((span) => (span.link || span.code) ? span.raw : resolveThreadRefs(span.raw, threads, currentBotId)
      .map((run) => run.ref ? threadRefMarkdown(run.ref) : run.text)
      .join(""))
    .join("");
}

export interface ThreadRefDisplaySpan {
  text: string;
  ref?: ResolvedThreadRef;
  href?: string;
}

export function splitThreadRefsForDisplay(text: string, threads: ThreadRefCandidate[], currentBotId?: string): ThreadRefDisplaySpan[] {
  const spans: ThreadRefDisplaySpan[] = [];
  for (const span of splitThreadLinkMarkdown(text)) {
    if (span.link) {
      const ref = span.link.address ? resolveThreadRefAddress(threads, span.link.address, currentBotId) : null;
      const href = ref || !span.link.label.trim() ? null : httpLinkDestination(span.link.destination);
      spans.push(ref ? { text: unescapeThreadLabel(span.link.label), ref }
        : href ? { text: unescapeLinkLabel(span.link.label), href } : { text: span.raw });
    } else if (span.code) {
      spans.push({ text: span.raw });
    } else {
      spans.push(...resolveThreadRefs(span.raw, threads, currentBotId));
    }
  }
  return spans.length ? spans : [{ text }];
}

export function threadTokenFromPaste(
  pasted: string,
  threads: ThreadRefCandidate[],
  currentBotId?: string,
): { token: string; ref: ResolvedThreadRef } | null {
  const trimmed = pasted.trim();
  if (!trimmed) return null;
  const wrapped = /^\[((?:\\.|[^\\\]])*)\]\((openmausbot:\/\/thread\/[^()\s]*)\)$/.exec(trimmed);
  const address = wrapped
    ? parseThreadRefUrl(wrapped[2])
    : parseThreadRefUrl(trimmed) ?? (isThreadUuid(trimmed) ? { threadId: trimmed } : null);
  if (!address) return null;
  const ref = resolveThreadRefAddress(threads, address, currentBotId);
  if (!ref) return null;
  const title = ref.title.trim();
  const token = linkable(title) && !title.startsWith("#") ? `#${title}` : threadRefMarkdown(ref);
  return { token, ref };
}

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: Record<string, unknown>;
}

const OPAQUE = new Set(["link", "linkReference", "image", "imageReference", "definition", "html", "mention"]);

export const THREAD_REF_NODE = "threadRef";

function linkNode(text: string, ref: ResolvedThreadRef): MdNode {
  return {
    type: THREAD_REF_NODE,
    data: {
      hName: "span",
      hProperties: {
        "data-thread-bot": ref.botId,
        "data-thread-bot-name": ref.botName,
        "data-thread-id": ref.threadId,
        "data-thread-title": ref.title,
        "data-thread-ambiguous": ref.ambiguous ? "true" : "false",
      },
    },
    children: [{ type: "text", value: text }],
  };
}

export function remarkThreadRefs(threads: ThreadRefCandidate[], currentBotId?: string) {
  return () => (tree: MdNode) => {
    if (!threads.length) return;
    const visit = (node: MdNode) => {
      if (!node.children || OPAQUE.has(node.type)) return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text" || typeof child.value !== "string") {
          visit(child);
          return [child];
        }
        const spans = resolveThreadRefs(child.value, threads, currentBotId);
        if (!spans.some((span) => span.ref)) return [child];
        return spans.map((span) => (span.ref ? linkNode(span.text, span.ref) : { type: "text", value: span.text }));
      });
    };
    visit(tree);
  };
}
