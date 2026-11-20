import { describe, expect, it } from "vitest";
import { linkSelection } from "./link-paste";
import { splitThreadRefsForDisplay } from "./thread-refs";

const URL_A = "https://example.com/a?x=1&y=2";

describe("linkSelection", () => {
  it("wraps the selected words in a link to the pasted address and parks the caret after it", () => {
    const text = "see docs here";
    expect(linkSelection(text, 4, 8, URL_A)).toEqual({ text: `see [docs](${URL_A}) here`, insert: `[docs](${URL_A})`, caret: `see [docs](${URL_A})`.length });
  });

  it("accepts http, and an address with the newline a copy often adds", () => {
    expect(linkSelection("go now", 3, 6, "http://example.com\n")?.text).toBe("go [now](http://example.com)");
  });

  it("escapes the label, so brackets and backslashes in the selection stay words", () => {
    expect(linkSelection("a[1]\\b", 0, 6, URL_A)?.text).toBe(`[a\\[1\\]\\\\b](${URL_A})`);
  });

  it("escapes parentheses in the address so the destination cannot close early", () => {
    expect(linkSelection("wiki", 0, 4, "https://en.wikipedia.org/wiki/Foo_(bar)")?.text)
      .toBe("[wiki](https://en.wikipedia.org/wiki/Foo_%28bar%29)");
  });

  it("keeps the spaces around the selected words outside the link", () => {
    expect(linkSelection("a  docs  b", 1, 8, URL_A)?.text).toBe(`a  [docs](${URL_A})  b`);
  });

  it("keeps a multi-line selection's line breaks inside the label, and leaves a blank-line selection to ordinary paste", () => {
    expect(linkSelection("one\ntwo", 0, 7, URL_A)?.text).toBe(`[one\ntwo](${URL_A})`);
    expect(linkSelection("one\n\ntwo", 0, 8, URL_A)).toBeNull();
  });

  it("leaves an empty or blank selection to the ordinary paste", () => {
    expect(linkSelection("see docs", 4, 4, URL_A)).toBeNull();
    expect(linkSelection("a   b", 1, 4, URL_A)).toBeNull();
  });

  it.each([
    ["words", "hello there"],
    ["two addresses", `${URL_A} ${URL_A}`],
    ["an address with words after it", `${URL_A} please`],
    ["a script address", "javascript:alert(1)"],
    ["a file address", "file:///C:/secret.txt"],
    ["an ftp address", "ftp://example.com/x"],
    ["an address with a password", "https://user:secret@example.com/"],
    ["an address with no host", "https:///nothing"],
    ["a thread address", "openmausbot://thread/abc"],
    ["an address with a backslash", "https://example.com/a\\b"],
    ["an address with angle brackets", "https://example.com/<b>"],
    ["an empty paste", ""],
  ])("leaves %s to the ordinary paste", (_name, pasted) => {
    expect(linkSelection("see docs here", 4, 8, pasted)).toBeNull();
  });

  it("leaves a selection right after a bang or a lone backslash to the ordinary paste, where the link would not be one", () => {
    expect(linkSelection("a !docs b", 3, 7, URL_A)).toBeNull();
    expect(linkSelection("a \\docs b", 3, 7, URL_A)).toBeNull();
  });

  it("links after an escaped backslash or an escaped bang, and after a bang that is not touching", () => {
    expect(linkSelection("a \\\\docs b", 4, 8, URL_A)?.text).toBe(`a \\\\[docs](${URL_A}) b`);
    expect(linkSelection("a \\!docs b", 4, 8, URL_A)?.text).toBe(`a \\![docs](${URL_A}) b`);
    expect(linkSelection("wow! docs", 5, 9, URL_A)?.text).toBe(`wow! [docs](${URL_A})`);
  });

  it("leaves a paste long enough to become an attachment to the ordinary path", () => {
    expect(linkSelection("see docs here", 4, 8, `https://example.com/${"a".repeat(900)}`)).toBeNull();
  });

  it("writes a link the sent-message renderer reads back to the same label and address", () => {
    const written = linkSelection("see [x] here", 4, 7, URL_A)!.text;
    expect(splitThreadRefsForDisplay(written, [])).toEqual([
      { text: "see " },
      { text: "[x]", href: URL_A },
      { text: " here" },
    ]);
  });
});
