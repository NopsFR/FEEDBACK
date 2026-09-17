import { describe, expect, it } from "vitest";
import { activeLine, parseLyrics } from "@/lib/lrc";

describe("lrc", () => {
  it("parses timestamps, multi-stamps and offset", () => {
    const l = parseLyrics("[ti:x]\n[offset:500]\n[00:01.00][00:10.50]hello\n[00:05.2]world", true);
    expect(l.map((x) => x.time)).toEqual([500, 4700, 10000]);
    expect(l[1].text).toBe("world");
    expect(activeLine(l, 0)).toBe(-1);
    expect(activeLine(l, 5000)).toBe(1);
    expect(activeLine(l, 99999)).toBe(2);
  });
  it("plain text is unsynced", () => {
    expect(parseLyrics("a\nb", false).every((x) => x.time === -1)).toBe(true);
  });
});
