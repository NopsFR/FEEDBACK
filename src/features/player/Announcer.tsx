import { usePlayer } from "./store";

/**
 * One polite live region for playback, so a screen reader hears what started without
 * hunting for the transport. Track changes only — not every pause and resume.
 */
export function Announcer() {
  const track = usePlayer((p) => p.current);
  return (
    <div className="sr-only" role="status" aria-live="polite">
      {track ? `Playing ${track.title} by ${track.artist}` : ""}
    </div>
  );
}
