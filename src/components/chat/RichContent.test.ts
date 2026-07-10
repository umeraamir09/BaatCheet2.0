import { describe, expect, it } from "vitest";
import { isEmojiOnlyText } from "./RichContent";

describe("isEmojiOnlyText", () => {
  it("accepts one or more known emoji graphemes with whitespace", () => {
    expect(isEmojiOnlyText("😊")).toBe(true);
    expect(isEmojiOnlyText("😊 👍🏽\n🎉")).toBe(true);
  });

  it("rejects text, links, and empty messages", () => {
    expect(isEmojiOnlyText("hello 😊")).toBe(false);
    expect(isEmojiOnlyText("https://example.com 😊")).toBe(false);
    expect(isEmojiOnlyText("   ")).toBe(false);
  });
});
