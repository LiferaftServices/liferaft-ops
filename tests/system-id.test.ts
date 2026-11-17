import { describe, expect, it } from "vitest";
import { SYSTEM_ID_PATTERN, newSystemId, normalizeSystemId } from "../src/lib/system-id";

describe("system IDs", () => {
  it("generates IDs in the label format without look-alike letters", () => {
    for (let i = 0; i < 500; i++) {
      const id = newSystemId();
      expect(id).toMatch(SYSTEM_ID_PATTERN);
      expect(id.slice(4)).not.toMatch(/[ILOU]/);
    }
  });

  it("does not repeat across a large batch", () => {
    const ids = new Set(Array.from({ length: 20000 }, newSystemId));
    expect(ids.size).toBe(20000);
  });

  it("cleans up a hand-typed ID", () => {
    expect(normalizeSystemId(" lrs-4b79ltmqh8 ")).toBe("LRS-4B791TMQH8");
    expect(normalizeSystemId("4B79 1TMQ H8")).toBe("LRS-4B791TMQH8");
    expect(normalizeSystemId("LRS4B7O1TMQH8")).toBe("LRS-4B701TMQH8");
  });

  it("rejects anything that is not an ID", () => {
    expect(normalizeSystemId("hello")).toBeNull();
    expect(normalizeSystemId("LRS-123")).toBeNull();
  });
});
