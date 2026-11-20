// @vitest-environment happy-dom
// Pasting an address over selected words turns them into a link, as in Slack. Every other paste goes the way it did.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { restoreComposerDraft } from "@/lib/drafts";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn() }));
const ENGINE = "claude-3f0c2b1e-9d1a-4c55-8a51-0a3a6f1e2b7c";
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, bots: [scout], instances: [{
      instanceId: ENGINE, driverKind: "claudeAgent", displayName: "Claude", capabilities: { agentsMcp: true },
    }] },
    dispatch: fixture.dispatch,
  }) };
});
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));
vi.mock("./CallView", () => ({ CallButton: () => null }));
vi.mock("./GroupCallView", () => ({ GroupCallButton: () => null }));

import { Composer } from "./Composer";

const scout: Bot = {
  id: "scout", threadId: "scout-thread", name: "Scout", title: "Support agent", description: "",
  color: "blue", notifications: false, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: ENGINE, model: "fake" },
};
const draftId = `bot:${scout.id}:${scout.threadId}`;
const URL_A = "https://example.com/a?x=1&y=2";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
  restoreComposerDraft(draftId, { text: "", attachments: [] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root.render(createElement(Composer, { bot: scout })));
});

afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
  restoreComposerDraft(draftId, { text: "", attachments: [] });
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const input = () => container.querySelector("textarea")!;
function select(text: string, start: number, end: number) {
  flushSync(() => restoreComposerDraft(draftId, { text, attachments: [] }));
  input().focus();
  input().setSelectionRange(start, end);
}
/** A synthetic clipboard: only the plain text a test hands it, never the person's own. */
function paste(plain: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  const data = {
    files: [] as File[], items: [] as unknown[], types: ["text/plain"],
    getData: (type: string) => (type === "text/plain" ? plain : ""),
  };
  Object.defineProperty(event, "clipboardData", { value: data });
  flushSync(() => { input().dispatchEvent(event); });
  return event;
}
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const sends = () => fixture.dispatch.mock.calls.map(([action]) => action).filter((action) => action.type === "send");

describe("pasting an address over selected words", () => {
  it("makes them a link, keeping the words as the label", () => {
    select("see docs here", 4, 8);
    const event = paste(URL_A);
    expect(event.defaultPrevented).toBe(true);
    expect(input().value).toBe(`see [docs](${URL_A}) here`);
  });

  it("leaves the caret after the link with the composer still focused", async () => {
    select("see docs here", 4, 8);
    paste(URL_A);
    await frame();
    const after = `see [docs](${URL_A})`.length;
    expect(document.activeElement).toBe(input());
    expect([input().selectionStart, input().selectionEnd]).toEqual([after, after]);
  });

  it("sends the link as the person's words, in one message", () => {
    select("see docs here", 4, 8);
    paste(URL_A);
    flushSync(() => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(sends()).toEqual([expect.objectContaining({ type: "send", botId: scout.id, text: `see [docs](${URL_A}) here` })]);
  });

  it("escapes the selected words and the address", () => {
    select("a[1]", 0, 4);
    paste("https://en.wikipedia.org/wiki/Foo_(bar)");
    expect(input().value).toBe("[a\\[1\\]](https://en.wikipedia.org/wiki/Foo_%28bar%29)");
  });
});

describe("the link is typed as a native edit, so the browser's own Undo keeps it", () => {
  const stubExec = (exec: (command: string, ui?: boolean, value?: string) => boolean) =>
    Object.defineProperty(document, "execCommand", { configurable: true, writable: true, value: exec });
  afterEach(() => { Reflect.deleteProperty(document, "execCommand"); });

  it("asks the browser to insert the link over the selection, and writes nothing itself", () => {
    const exec = vi.fn(() => true);
    stubExec(exec);
    select("see docs here", 4, 8);
    const event = paste(URL_A);
    expect(event.defaultPrevented).toBe(true);
    expect(exec.mock.calls).toEqual([["insertText", false, `[docs](${URL_A})`]]);
    expect(input().value).toBe("see docs here");
  });

  it("writes the link itself where the browser cannot insert text natively", () => {
    stubExec(() => false);
    select("see docs here", 4, 8);
    paste(URL_A);
    expect(input().value).toBe(`see [docs](${URL_A}) here`);
  });
});

describe("every other paste", () => {
  it.each([
    ["an address with nothing selected", "see docs here", 4, 4, URL_A],
    ["words over a selection", "see docs here", 4, 8, "other words"],
    ["a script address over a selection", "see docs here", 4, 8, "javascript:alert(1)"],
    ["an address with words, over a selection", "see docs here", 4, 8, `${URL_A} please`],
  ])("is left to the browser: %s", (_name, text, start, end, pasted) => {
    select(text, start, end);
    const event = paste(pasted);
    expect(event.defaultPrevented).toBe(false);
    expect(input().value).toBe(text);
  });
});
