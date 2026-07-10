import { describe, expect, it } from "vitest";
import { findEmojiByNative } from "./emoji";

describe("findEmojiByNative", () => {
  it("uses the same Emoji Mart grid coordinates as the picker", () => {
    expect(findEmojiByNative("😄")).toMatchObject({ sheetX: 32, sheetY: 25 });
    expect(findEmojiByNative("👋🏽")).toMatchObject({ sheetX: 12, sheetY: 42 });
  });
});
