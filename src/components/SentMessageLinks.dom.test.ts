// @vitest-environment happy-dom
// A sent [label](address) is a clickable link in a one-to-one chat and in a room, where it was literal brackets.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, InstanceInfo, Message } from "@/state/store";

vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => true, useReactor: () => "user" }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));

const { ChatView } = await import("./ChatView");
const { RoomTextMessage } = await import("./RoomTextMessage");
const { BotEditorStore, initialState } = await import("@/state/store");

const LINK = "https://example.com/a?x=1&y=2";
const SENT = `read [the docs](${LINK}) then [a\\[1\\]](https://example.org/) ok\n\nand [bad](javascript:alert(1))`;
const message: Message = { id: "u1", role: "user", kind: "text", text: SENT, at: 1 };
const bot: Bot = {
  id: "pepper", threadId: "pepper-thread", name: "pepper", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [message], activeLeafId: "u1", modelSelection: { instanceId: "test", model: "m" },
  tasks: [{ threadId: "pepper-thread", title: "Thread", createdAt: 1, busy: false, activity: "idle", modelSelection: { instanceId: "test", model: "m" }, approvalMode: "ask" }],
};

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function draw(child: ReturnType<typeof createElement>) {
  const state: AppState = {
    ...initialState, connected: true, selectedId: "pepper", bots: [bot],
    instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test", snapshot: { state: "available" } } as InstanceInfo],
    config: { features: {} } as AppState["config"],
  };
  const value = { state, dispatch: vi.fn(), flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  flushSync(() => root.render(createElement(BotEditorStore, { value, children: child })));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function bubble(): HTMLElement {
  const found = container.querySelector<HTMLElement>("[data-citation-source='u1']");
  if (!found) throw new Error("the sent message was not drawn");
  return found;
}

function expectClickableLabels() {
  const links = [...bubble().querySelectorAll("a")];
  expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
    ["the docs", LINK],
    ["a[1]", "https://example.org/"],
  ]);
  for (const a of links) {
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noreferrer");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    a.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
  }
  const text = bubble().textContent ?? "";
  expect(text).toBe("read the docs then a[1] ok\n\nand [bad](javascript:alert(1))");
}

describe("a sent link", () => {
  it("is clickable in a one-to-one chat, and a script address stays the words it was", async () => {
    await draw(createElement(ChatView, { bot }));
    expectClickableLabels();
  });

  it("is clickable in a room, in a direct room message too", async () => {
    for (const dm of [false, true]) {
      flushSync(() => root.render(createElement("div")));
      await draw(createElement(RoomTextMessage, {
        groupId: "room", threadId: "room-thread", dm, pinned: false, working: false, message, members: [bot],
        emerging: false, eager: false, onReply: vi.fn(), canReact: false, phone: false, locale: "en", localVoice: false,
      }));
      expectClickableLabels();
    }
  });
});
