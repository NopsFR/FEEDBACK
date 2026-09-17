import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { PlaylistDetail, Track } from "@/services/types";

const track = { id: 1, title: "One", favourite: false, durationMs: 1000 } as Track;
beforeEach(() => { vi.resetModules(); localStorage.clear(); localStorage.setItem("feedback.token", "test-device"); vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline"))); });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllTimers(); });

it("keeps edits through reload, preserves duplicates, and retries with the same operation id", async () => {
  vi.useFakeTimers();
  let phone = await import("@/services/phone");
  phone.cacheTracks([track]);
  const id = phone.editPlaylist(null, (d) => { d.playlist.name = "Phone mix"; phone.append(d, [1, 1]); });
  await vi.waitFor(() => expect(phone.status().notice).toContain("saved"));
  const first = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
  expect(phone.localPlaylist(id)?.entries.length).toBe(2);
  vi.resetModules();
  phone = await import("@/services/phone");
  expect(phone.playlists()[0].name).toBe("Phone mix");
  const detail = structuredClone(phone.localPlaylist(id)!) as PlaylistDetail;
  detail.playlist.id = 10;
  detail.entries.forEach((e, i) => { e.entryId = i + 100; });
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ detail })));
  await phone.flush();
  const retry = JSON.parse(vi.mocked(fetch).mock.lastCall![1]!.body as string);
  expect(retry.operationId).toBe(first.operationId);
  expect(phone.status().pending).toBe(0);
  expect(phone.localPlaylist(id)?.playlist.id).toBe(10);
  vi.useRealTimers();
});

it("keeps rejected changes pending and isolates another pairing", async () => {
  const phone = await import("@/services/phone");
  phone.cacheTracks([track]);
  phone.favourite(1, true);
  await vi.waitFor(() => expect(phone.status().notice).toContain("saved"));
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ message: "Conflict" }), { status: 409 }));
  await phone.flush();
  expect(phone.status().pending).toBe(1);
  expect(phone.overlay([track])[0].favourite).toBe(true);
  localStorage.setItem("feedback.token", "different-device");
  expect(phone.status().pending).toBe(0);
});
