# Getting music into FEEDBACK

## Ways in
1. **Library folders** (Settings → Library → Add folder, or the empty-state button). Scanned recursively, watched for
   changes, files stay where they are.
2. **Drag and drop** onto the window. Folders become library folders. Loose files are copied into
   `Music\FEEDBACK Imports` (never moved or modified); same-name + same-size files are skipped.
3. **Import files** button — same as dropping files.
4. **External drives** — add a folder on the drive. If the drive is unplugged, its tracks are marked missing (hidden,
   greyed in playlists) rather than deleted, so favourites, play counts and playlists survive.

## Formats
Audio: MP3, FLAC, WAV, AAC, M4A (AAC/ALAC), OGG (Vorbis), OPUS, AIFF, WavPack*, APE*, MPC*.
Video: MP4, M4V, WEBM, MKV*, MOV*.
`*` indexed, but playback depends on the platform decoder; FEEDBACK skips with a clear message if it can't play.
ALAC and AIFF are decoded by FEEDBACK itself (symphonia) on Windows because WebView2 can't.

## Metadata
Read with lofty: title, artist, album, album artist, track/disc numbers and totals, year/date, genre, embedded cover,
lyrics, ReplayGain. Fallbacks: filename (`03 - Title`), parent folder = album, grandparent = artist.
Artwork: embedded front cover → `cover|folder|front|album|artwork.jpg/png/webp` in the folder → printed placeholder.
Lyrics: `Track.lrc` (synced) or `Track.txt` next to the file, or embedded `LYRICS`/`USLT`.
Videos: `Artist - Title.mp4` links the video to the artist.

## Duplicates
A path is indexed once. Re-scans compare size + modified time and only re-read changed files.

## Not supported, on purpose
No ripping or downloading from streaming services, no DRM removal, no scraping lyrics from websites.
A direct-URL downloader for files you're entitled to is planned (validated URL/MIME/size) — see MASTER_PLAN.
