/**
 * Catalogue search from a browser.
 *
 * The desktop app has the whole provider stack in Rust. A phone has none of it, so it asks the
 * deployment's own endpoint, which speaks to MusicBrainz on everyone's behalf with a contactable
 * user agent and edge caching. What comes back is metadata: descriptions of recordings, never a
 * claim that FEEDBACK can play them.
 */
import type { CatalogueOutcome } from "./types";
import { isTauri } from "./platform";
import { call } from "./ipc";
import { library } from "./library";

const key = (artist: string, title: string) => `${artist} ${title}`.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function searchCatalogue(query: string, signal: AbortSignal): Promise<CatalogueOutcome> {
  if (isTauri) return call<CatalogueOutcome>("catalogue_search", { query, scope: "everywhere" });

  const response = await fetch(`/api/catalogue?q=${encodeURIComponent(query)}`, { signal });
  if (!response.ok) throw new Error("The catalogue didn't answer.");
  const outcome = (await response.json()) as CatalogueOutcome;

  // Anything the account already holds is shown by the library results above, and a copy you own
  // is playable — so it belongs there, not in a list of things FEEDBACK can only describe.
  const mine = new Set((await library.tracks().catch(() => [])).map((t) => key(t.artist, t.title)));
  outcome.tracks = outcome.tracks.filter((t) => !mine.has(key(t.artist, t.title)));
  return outcome;
}
