import { expect, it } from "vitest";
import { OPS } from "@/features/playlists/SmartPlaylistEditor";

// Mirrors the (field, op) table in src-tauri/src/library/smart.rs, which has a matching Rust test.
const SUPPORTED: Record<string, string[]> = {
  genre: ["is", "contains", "not"],
  artist: ["is", "contains", "not"],
  album: ["is", "contains", "not"],
  codec: ["is"],
  year: ["eq", "gte", "lte"],
  plays: ["eq", "gte", "lte"],
  duration: ["gte", "lte"],
  added: ["within"],
  lastPlayed: ["within", "notWithin", "never"],
  favourite: ["true", "false"],
};

it("only offers rules the desktop can compile", () => {
  expect(Object.keys(OPS).sort()).toEqual(Object.keys(SUPPORTED).sort());
  for (const [field, ops] of Object.entries(OPS)) {
    expect(ops.map((o) => o.value), field).toEqual(SUPPORTED[field]);
  }
});
