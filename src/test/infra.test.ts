import { describe, it, expect } from "vitest";

describe("test infrastructure", () => {
  it("vitest + jsdom boots correctly", () => {
    expect(1 + 1).toBe(2);
  });

  it("jsdom provides DOM APIs", () => {
    const el = document.createElement("div");
    el.textContent = "hello";
    expect(el.textContent).toBe("hello");
  });
});
