import { snippetFromHtml } from "./snippet";

describe("snippetFromHtml", () => {
  it("strips HTML tags, keeping the text", () => {
    expect(snippetFromHtml("<p>Should this say <strong>TLS 1.3</strong>?</p>")).toBe(
      "Should this say TLS 1.3?",
    );
  });

  it("inserts a space between adjacent block tags so words don't glue", () => {
    expect(snippetFromHtml("<p>line one</p><p>line two</p>")).toBe("line one line two");
  });

  it("decodes the named entities the sanitizer emits", () => {
    expect(snippetFromHtml("Tom &amp; Jerry &lt;3 &gt;_&gt; &quot;hi&quot; it&apos;s")).toBe(
      'Tom & Jerry <3 >_> "hi" it\'s',
    );
  });

  it("decodes &nbsp; to a space that then collapses", () => {
    expect(snippetFromHtml("a&nbsp;&nbsp;b")).toBe("a b");
  });

  it("decodes numeric entities (decimal and hex)", () => {
    expect(snippetFromHtml("it&#39;s &#x2764; ok")).toBe("it's ❤ ok");
  });

  it("collapses newlines and runs of whitespace to single spaces", () => {
    expect(snippetFromHtml("<p>a</p>\n\n  <p>b   c</p>")).toBe("a b c");
  });

  it("returns empty string for empty or whitespace-only/tag-only input", () => {
    expect(snippetFromHtml("")).toBe("");
    expect(snippetFromHtml("   \n  ")).toBe("");
    expect(snippetFromHtml("<p></p>")).toBe("");
  });

  it("leaves text at or under the limit unchanged (no ellipsis)", () => {
    expect(snippetFromHtml("x".repeat(200))).toBe("x".repeat(200));
    expect(snippetFromHtml("short")).toBe("short");
  });

  it("truncates over-limit text to max graphemes and appends an ellipsis", () => {
    const out = snippetFromHtml("a".repeat(250));
    expect(out).toBe(`${"a".repeat(200)}…`);
  });

  it("never splits a multi-codepoint grapheme and emits no replacement char", () => {
    // "👨‍👩‍👧" is one grapheme made of 5 code points joined by ZWJ. Truncating
    // 210 of them must keep exactly 200 intact families plus the ellipsis — no
    // mid-grapheme cut (which would surface as a replacement character).
    const out = snippetFromHtml("👨‍👩‍👧".repeat(210), 200);
    expect(out).toBe(`${"👨‍👩‍👧".repeat(200)}…`);
  });
});
