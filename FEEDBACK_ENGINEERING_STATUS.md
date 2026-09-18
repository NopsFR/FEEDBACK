# FEEDBACK — catalogue providers

FEEDBACK is local-first. Your files play with no network, no account and no service. The catalogue
adds a second, clearly separate thing: knowing what music *exists*, so search isn't limited to what
you have already imported.

**Metadata is not audio.** A catalogue result carries identity, artwork and lyrics. It becomes
playable only when something supplies a playback source — today that means a local file. FEEDBACK
never presents a metadata row as if it could be streamed.

Everything below is opt-in: Settings → Library → *Look up artwork online* gates all outbound
catalogue traffic, and the Rust commands check that setting themselves rather than trusting the UI.

## In use

### MusicBrainz — identity
- **Why:** canonical ids (recording, release, release-group, artist MBIDs, ISRCs) that let FEEDBACK
  recognise the same recording across providers, plus titles, credits, dates, labels and formats.
- **Auth:** none.
- **Rate limits:** ~1 request/second per IP; a contactable `User-Agent` is required (blank or generic
  agents are throttled harder). Over the limit the service answers 503 for *all* requests from that
  IP until the rate drops, so the lane in `catalogue/net.rs` enforces a 1.1s gap, honours
  `Retry-After`, and opens a circuit breaker after repeated failures.
- **Caching:** encouraged (the docs ask clients not to poll). Searches cached 6h, identity 30d.
- **Attribution:** data is CC0 / CC BY-NC-SA depending on the field; FEEDBACK shows results as
  "from MusicBrainz" in the catalogue section and stores only what a user's own searches touched.
- **Playback:** none. Metadata only.
- **Fallback:** cached answers, then the local library alone.

### Cover Art Archive — sleeves
- **Why:** artwork for a release when the files have none, keyed by MusicBrainz ids.
- **Auth:** none. **Rate limits:** none published; FEEDBACK still paces itself (250ms) because the
  images are large.
- **Sizes:** 250 / 500 / 1200 thumbnails plus the original. FEEDBACK previews at 250 and stores
  1200 (falling back to 500), so phones never pull full-resolution scans.
- **Caching:** artwork mappings cached 60d; the chosen image is copied into FEEDBACK's own art cache.
- **Attribution:** images are supplied by the archive under the uploader's terms; FEEDBACK uses them
  as local album art and does not redistribute them.
- **Playback:** none.
- **Fallback:** the release-group cover, then the generated sleeve FEEDBACK draws itself.

### LRCLIB — lyrics
- **Why:** plain and time-synced lyrics for tracks with no `.lrc` beside them.
- **Auth:** none. **Rate limits:** none published; FEEDBACK paces at 600ms and identifies itself.
- **Matching:** `/api/get` takes track, artist, album and duration — the duration is what stops a
  different recording's words being shown. `/api/search` is the fallback, and a candidate is only
  used when its length is within four seconds of ours.
- **Caching:** lyrics 30d, "nothing found" 7d (someone may contribute them later).
- **Answers FEEDBACK distinguishes:** synced, plain, instrumental, not found, provider error, offline.
  An instrumental is not an empty result and a provider outage is not "no lyrics".
- **Your own files always win:** a `.lrc`, `.txt` or embedded lyric is used before anything online,
  and FEEDBACK never writes provider lyrics into your files.

## Next (foundation exists, provider not yet wired)

| Provider | For | Status |
| --- | --- | --- |
| ListenBrainz | recommendations, listening stats, similar recordings | After lyrics. Read endpoints are open; 1 request/second with `X-RateLimit-*` headers to respect. A user token stays optional — FEEDBACK must work without an account. |
| Jamendo | independent music that is actually streamable | After that. Needs a developer client id, so it ships disabled until the user supplies one. This is the first provider that can return a real `PlaybackSource`. |

## Considered, not used yet — and why

- **Last.fm** (tags, similar artists): useful enrichment, but the API terms are non-commercial only,
  require attribution and a "powered by AudioScrobbler" link, cap stored data at 100MB and forbid
  sub-licensing. It also needs an API key, which means a user-supplied key and a proxy. Worth doing
  later as an optional, key-per-user provider; not needed for identity, which MusicBrainz covers.
- **Discogs**: strong on pressings, labels and catalogue numbers. Only worth it if FEEDBACK grows a
  physical-collection feature; MusicBrainz already answers "what is this release".
- **TheAudioDB**: artist images and biographies. Free tier is limited and the terms on redistribution
  are unclear; revisit if artist pages need pictures that MusicBrainz can't supply.
- **YouTube**: only as an external link, through official embeds, never as a FEEDBACK-owned stream.
  Quota-managed and needs a key. Parked.
- **Spotify / Apple Music**: optional external linking at most. Neither may become FEEDBACK's
  catalogue, neither may be required to use the app, and current developer restrictions need
  checking before anything is built. Parked.
- **Anything that "provides" mainstream audio for free**: rejected on sight. FEEDBACK does not rip,
  unlock, proxy or re-host copyrighted audio.

## How it's built

```
UI  →  catalogue_search command
        ↓
    search::Orchestrator
        ├── local library (query::search)  ← instant, offline, playable
        └── providers (MetadataProvider)   ← through cache, then scheduler
        ↓
    resolve::dedupe  (ids → ISRC → normalised title/artist + version + duration)
        ↓
    ranking (exact matches, playability, canonical identity, completeness)
```

- `catalogue/net.rs` — one lane per provider: minimum interval, timeout, `Retry-After`, circuit
  breaker with jittered backoff, latency and error counts. Nothing calls a provider directly.
- `catalogue/cache.rs` — SQLite-backed, versioned (`SCHEMA`), TTL per kind, stale-while-revalidate,
  pruned by expiry and row cap. Stores normalised FEEDBACK models, never raw provider payloads.
- `catalogue/resolve.rs` — normalisation that keeps version markers (live, acoustic, demo, remix,
  radio edit, instrumental, remaster) so different recordings are never collapsed, plus confidence
  scoring for enrichment: High = shared MBID/ISRC, Medium = artist+title+album+duration,
  Low = artist+title only.
- `catalogue/providers/` — one adapter per service, parsing separated from fetching so the mapping
  is unit-tested against fixtures with no network.

## Rules for adding a provider

1. Check the current docs and terms; record them here before writing code.
2. One adapter, one lane, one cache kind. No direct HTTP anywhere else.
3. Parse in a free function so it can be tested from a fixture.
4. Credentials never reach the browser bundle. Key-based providers ship disabled until the user
   supplies a key, and the desktop makes the call.
5. A provider that is down must degrade the result, never break search.
