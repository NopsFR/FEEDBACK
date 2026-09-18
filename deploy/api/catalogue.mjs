// Catalogue search for the phone.
//
// The desktop app asks MusicBrainz through its own Rust lane; a browser can't: it cannot set a
// contactable User-Agent, and thirty phones typing would each hammer a service that asks for one
// request a second. So the phone asks this function instead — one identified caller, paced, and
// cached at the edge so a repeated query costs MusicBrainz nothing.
//
// What comes back is metadata. MusicBrainz describes recordings; it grants no audio, so every row
// leaves here as `metadataOnly` and the app decides playability from sources it actually has.
const UA = "FEEDBACK/0.1.0 ( https://github.com/NopsFR/FEEDBACK )";
const MB = "https://musicbrainz.org/ws/2";

const clean = (s) => (s ?? "").trim();

function escape(term) {
  return term.replace(/([+\-!(){}\[\]^"~*?:\\/])/g, "\\$1");
}

function mapRecording(rec) {
  const credit = (rec["artist-credit"] ?? []).map((c) => c.name + (c.joinphrase ?? "")).join("");
  const release = (rec.releases ?? [])[0];
  return {
    canonicalId: `mb:${rec.id}`,
    title: clean(rec.title),
    artist: clean(credit) || "Unknown artist",
    album: release ? clean(release.title) : null,
    durationMs: typeof rec.length === "number" ? rec.length : null,
    trackNo: null,
    discNo: null,
    releaseDate: release?.date ?? rec["first-release-date"] ?? null,
    releaseKind: release?.["release-group"]?.["primary-type"] ?? null,
    ids: {
      recordingMbid: rec.id,
      releaseMbid: release?.id ?? null,
      releaseGroupMbid: release?.["release-group"]?.id ?? null,
      artistMbid: (rec["artist-credit"] ?? [])[0]?.artist?.id ?? null,
      isrc: (rec.isrcs ?? [])[0] ?? null,
      other: {},
    },
    tags: [],
    artwork: { hash: null, remote: release?.id ? `https://coverartarchive.org/release/${release.id}/front-250` : null },
    // Nothing here grants audio. The client decides what it can play.
    sources: [],
    metadataSources: ["musicbrainz"],
    localTrackId: null,
    playbackType: "unavailable",
  };
}

/** One recording per identity: same MBID, or same ISRC, or the same artist/title/album/length. */
function dedupe(rows) {
  const seen = new Map();
  for (const row of rows) {
    const keys = [row.ids.recordingMbid && `mbid:${row.ids.recordingMbid}`, row.ids.isrc && `isrc:${row.ids.isrc}`, `meta:${row.artist}|${row.album}|${row.title}|${Math.round((row.durationMs ?? 0) / 1000)}`.toLowerCase()].filter(Boolean);
    const hit = keys.map((k) => seen.get(k)).find(Boolean);
    if (hit) {
      if (!hit.album && row.album) hit.album = row.album;
      for (const k of keys) seen.set(k, hit);
      continue;
    }
    for (const k of keys) seen.set(k, row);
  }
  return [...new Set(seen.values())];
}

const words = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** The band you typed comes first, then songs that carry the words, then everything else. */
function rank(rows, query) {
  const wanted = words(query);
  const covers = (text) => {
    const has = words(text);
    return wanted.every((w) => has.includes(w));
  };
  return rows
    .map((row) => {
      let score = 0;
      if (covers(row.artist)) score += 100;
      if (covers(row.title)) score += 30;
      if (row.album) score += 5;
      if (row.releaseKind === "Album") score += 4;
      if (/(cover|karaoke|tribute|made popular)/i.test(`${row.artist} ${row.title}`)) score -= 60;
      return { row, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((s) => s.row);
}

export default async function handler(req, res) {
  const query = clean(new URL(req.url, "https://x").searchParams.get("q"));
  if (query.length < 2) return res.status(400).json({ error: "A search needs at least two characters." });

  const term = escape(query);
  // Search the artist field as well as the title: typing a band's name should bring back their
  // songs, not every song with their name in it.
  const url = `${MB}/recording?query=${encodeURIComponent(`artist:"${term}"^5 OR artistname:"${term}"^5 OR recording:"${term}"^2 OR (${term})`)}&limit=40&fmt=json`;
  const started = Date.now();
  let answered = false;
  let tracks = [];
  let why = null;
  for (let attempt = 0; attempt < 3 && !answered; attempt++) {
    try {
      const upstream = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (upstream.ok) {
        const body = await upstream.json();
        tracks = rank(dedupe((body.recordings ?? []).map(mapRecording)), query).slice(0, 25);
        answered = true;
      } else if (upstream.status === 503 || upstream.status === 429) {
        why = `upstream ${upstream.status}`;
        // MusicBrainz asks everyone to back off together; wait the moment it asks for, once.
        await new Promise((r) => setTimeout(r, Math.min(2000, Number(upstream.headers.get("retry-after") ?? 1) * 1000)));
      } else {
        why = `upstream ${upstream.status}`;
        break;
      }
    } catch (error) {
      why = `unreachable: ${error?.message ?? error}`;
      break; /* the catalogue not answering is a normal state, not a failure of the app */
    }
  }

  // Cached at the edge: the same search from any phone costs MusicBrainz one request a day.
  res.setHeader("Cache-Control", answered ? "public, s-maxage=86400, stale-while-revalidate=604800" : "public, s-maxage=30");
  res.status(200).json({
    tracks,
    releases: [],
    artists: [],
    remoteAnswered: answered,
    debug: { query, providers: [{ provider: "musicbrainz", results: tracks.length, ms: Date.now() - started, cache: "miss", error: answered ? null : why ?? "no answer" }], incoming: tracks.length, unique: tracks.length, duplicatesRemoved: 0, totalMs: Date.now() - started },
  });
}
