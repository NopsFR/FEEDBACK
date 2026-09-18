import { useEffect, useState, type ReactNode } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { library } from "@/services/library";
import { call } from "@/services/ipc";
import { isTauri } from "@/services/platform";
import { useLoad } from "@/lib/useLoad";
import { relativeDay, plural } from "@/lib/format";
import { useLibrary } from "@/state/library";
import { useNav } from "@/state/nav";
import { useSettings, type IntroMode, type ReplayGainMode } from "@/state/settings";
import { showShortcuts } from "@/app/ShortcutsSheet";
import { Developer } from "./Developer";
import { toastError } from "@/state/ui";
import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import { Icon } from "@/components/Icon";
import { Segmented } from "@/components/Segmented";
import { Slider } from "@/components/Slider";
import { confirmAction } from "@/components/Dialog";
import { Wordmark } from "@/components/Wordmark";
import { EQ_FREQS, EQ_PRESETS } from "@/features/player/engine";
import { Page, PageHead } from "@/features/library/Page";
import { chooseMusicFiles, chooseMusicFolder } from "@/features/library/importMusic";
import { Devices } from "./Devices";
import { getToken as _gt, setToken } from "@/services/platform";
import s from "./Settings.module.css";

function Group({ id, n, title, children }: { id: string; n: string; title: string; children: ReactNode }) {
  return (
    <section id={`settings-${id}`} className={s.group}>
      <h2 className={s.groupTitle}>
        <span className="mono">{n}</span> {title}
      </h2>
      <div className={s.rows}>{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className={s.row}>
      <div className={s.rowText}>
        <div className={s.rowLabel}>{label}</div>
        {hint && <div className={s.rowHint}>{hint}</div>}
      </div>
      <div className={s.rowControl}>{children}</div>
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} className={`${s.toggle} ${on ? s.toggleOn : ""}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

function Folders() {
  const { data, reload } = useLoad(() => library.folders(), []);
  const scan = useLibrary((l) => l.scan);
  const scanning = scan && scan.phase !== "done";
  useEffect(() => {
    if (scan?.phase === "done") reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan?.phase]);
  return (
    <div className={s.folders}>
      {data?.map((f) => (
        <div key={f.id} className={`${s.folder} ${f.available ? "" : s.unavailable}`}>
          <Icon name="folder" size={18} />
          <div className={s.folderText}>
            <div className={`truncate ${s.folderPath}`}>{f.path}</div>
            <div className="mono">
              {f.available ? `${plural(f.trackCount, "track")} · scanned ${relativeDay(f.lastScanAt)}` : "Not available — is the drive connected?"}
            </div>
          </div>
          {isTauri && <IconButton icon="reveal" label="Open folder" size={16} onClick={() => void revealItemInDir(f.path).catch(toastError)} />}
          <IconButton
            icon="close"
            label="Remove folder"
            size={16}
            onClick={async () => {
              const ok = await confirmAction("Remove folder", `Stop watching “${f.path}”? Its tracks leave your library (playlists lose them). Files on disk aren't touched.`, "Remove", true);
              if (!ok) return;
              try {
                await library.removeFolder(f.id);
                reload();
              } catch (e) {
                toastError(e);
              }
            }}
          />
        </div>
      ))}
      {data && !data.length && <p className={s.muted}>No folders yet.</p>}
      <MissingFiles />
      <div className={s.folderActions}>
        <Button icon="folder" onClick={() => chooseMusicFolder().then(reload)}>
          Add folder
        </Button>
        <Button icon="import" variant="secondary" onClick={chooseMusicFiles}>
          Import files
        </Button>
        <Button variant="quiet" icon="history" disabled={!!scanning || !data?.length} onClick={() => library.rescan()}>
          {scanning ? `Scanning… ${scan.done}/${scan.total}` : "Rescan now"}
        </Button>
      </div>
    </div>
  );
}

/** Files the last scan couldn't find. Quiet when there are none. */
function MissingFiles() {
  const missing = useLibrary((l) => l.overview?.missing ?? 0);
  const go = useNav((n) => n.go);
  if (!missing) return null;
  return (
    <Row label="Missing files" hint="These tracks were in the library but their files weren't at the old paths — an unplugged drive, a rename or a move. Nothing is removed for you.">
      <Button variant="secondary" onClick={() => go({ name: "smart", which: "missing" })}>
        Review {missing.toLocaleString()}
      </Button>
    </Row>
  );
}

function DownloadLink() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauri) return;
    let un: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<{ fileName: string; received: number; total: number | null; state: string; message: string | null }>("download-progress", (e) => {
        const p = e.payload;
        if (p.state === "error") setStatus(p.message ?? "Download failed.");
        else if (p.state === "done") setStatus(`Saved “${p.fileName}” — it'll appear after the scan.`);
        else setStatus(`${p.fileName}: ${p.total ? Math.round((p.received / p.total) * 100) + "%" : `${(p.received / 1048576).toFixed(1)} MB`}`);
      }).then((f) => (un = f)),
    );
    return () => un?.();
  }, []);
  return (
    <Row label="Download from a link" hint={status ?? "Paste a direct link to an audio or video file you're entitled to (a band's own download, a purchase link). Streaming sites and web pages aren't supported."}>
      <form
        className={s.dl}
        onSubmit={(e) => {
          e.preventDefault();
          if (!url.trim()) return;
          setStatus("Starting…");
          call<string>("download_url", { url: url.trim() })
            .then(() => setUrl(""))
            .catch((err) => setStatus(err instanceof Error ? err.message : "Download failed."));
        }}
      >
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/track.flac" spellCheck={false} />
        <Button type="submit" variant="secondary" disabled={!url.trim()}>
          Download
        </Button>
      </form>
    </Row>
  );
}

function Equaliser() {
  const { eqEnabled, eqBands, eqPreset, set } = useSettings();
  return (
    <div className={s.eq}>
      <div className={s.eqTop}>
        <Toggle on={eqEnabled} onChange={(v) => set("eqEnabled", v)} label="Equaliser" />
        <select
          className={s.select}
          aria-label="Equaliser preset"
          value={EQ_PRESETS[eqPreset] ? eqPreset : "custom"}
          onChange={(e) => {
            const p = e.target.value;
            if (EQ_PRESETS[p]) {
              set("eqPreset", p);
              set("eqBands", EQ_PRESETS[p]);
              set("eqEnabled", true);
            }
          }}
        >
          {Object.keys(EQ_PRESETS).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          <option value="custom" disabled>
            custom
          </option>
        </select>
      </div>
      <div className={`${s.bands} ${eqEnabled ? "" : s.bandsOff}`}>
        {EQ_FREQS.map((f, i) => (
          <div key={f} className={s.band}>
            <input
              type="range"
              min={-12}
              max={12}
              step={0.5}
              value={eqBands[i] ?? 0}
              aria-label={`${f} Hz`}
              onChange={(e) => {
                const next = [...eqBands];
                next[i] = parseFloat(e.target.value);
                set("eqBands", next);
                set("eqPreset", "custom");
                if (!eqEnabled) set("eqEnabled", true);
              }}
              onDoubleClick={() => {
                const next = [...eqBands];
                next[i] = 0;
                set("eqBands", next);
              }}
            />
            <span className="mono">{f >= 1000 ? `${f / 1000}k` : f}</span>
            <span className={`mono ${s.db}`}>{(eqBands[i] ?? 0) > 0 ? "+" : ""}{eqBands[i] ?? 0}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Settings({ section }: { section?: string }) {
  const st = useSettings();
  const [info, setInfo] = useState<{ version: string; dataDir: string | null } | null>(null);
  useEffect(() => {
    if (isTauri) void call<{ version: string; dataDir: string | null }>("app_info").then(setInfo);
  }, []);
  useEffect(() => {
    if (section) document.getElementById(`settings-${section}`)?.scrollIntoView({ block: "start" });
  }, [section]);

  return (
    <Page>
      <PageHead label="FEEDBACK" title="Settings" />
      <div className={s.layout}>
        {!isTauri && (
          <Group id="phone" n="00" title="This phone">
            <Row label="Paired with your computer" hint="Browsing and streaming need the same Wi-Fi as the computer. Saved albums play anywhere.">
              <Button variant="secondary" onClick={() => { setToken(null); location.reload(); }} disabled={!_gt()}>
                Unpair
              </Button>
            </Row>
          </Group>
        )}
        {isTauri && <Group id="library" n="01" title="Library">
          <Folders />
          <DownloadLink />
          <Row label="Drag and drop" hint="Drop folders onto the window to add them. Drop files and they're copied into a “FEEDBACK Imports” folder in Music.">
            <span className={s.muted}>Always on</span>
          </Row>
          <Row label="Look up artwork online" hint="Lets “Find artwork online…” ask MusicBrainz and the Cover Art Archive about an album you choose. It sends that album's title and artist, nothing else — no account, no tracking, and no music comes from those services.">
            <Toggle on={st.onlineLookups} onChange={(v) => st.set("onlineLookups", v)} label="Look up artwork online" />
          </Row>
        </Group>}
        {isTauri && (
          <Group id="devices" n="02" title="Devices">
            <Devices />
          </Group>
        )}

        <Group id="playback" n="03" title="Playback">
          <Row label="Volume levelling" hint="Uses ReplayGain tags when files have them. Album mode keeps quiet songs quiet.">
            <Segmented<ReplayGainMode> label="ReplayGain" value={st.replayGain} onChange={(v) => st.set("replayGain", v)} options={[{ value: "off", label: "Off" }, { value: "track", label: "Track" }, { value: "album", label: "Album" }]} />
          </Row>
          <Row label="Gapless" hint="Loads the next track in advance so live albums and mixes run straight through.">
            <Toggle on={st.gapless} onChange={(v) => st.set("gapless", v)} label="Gapless" />
          </Row>
          <Row label="Crossfade" hint={st.crossfadeSec ? `${st.crossfadeSec} seconds between tracks` : "Off"}>
            <div className={s.slider}>
              <Slider label="Crossfade seconds" variant="volume" value={st.crossfadeSec / 12} onChange={(v) => st.set("crossfadeSec", Math.round(v * 12))} valueText={`${st.crossfadeSec} seconds`} step={1 / 12} />
            </div>
          </Row>
          <Row label="Resume on launch" hint="Start playing where you left off when FEEDBACK opens. Off means the queue is restored, paused.">
            <Toggle on={st.resumeOnLaunch} onChange={(v) => st.set("resumeOnLaunch", v)} label="Resume on launch" />
          </Row>
        </Group>

        <Group id="audio" n="04" title="Equaliser">
          <Equaliser />
        </Group>

        <Group id="appearance" n="05" title="Look & feel">
          <Row label="Colour from artwork" hint="Let the album cover tint Now Playing and album pages.">
            <Toggle on={st.ambientArtwork} onChange={(v) => st.set("ambientArtwork", v)} label="Colour from artwork" />
          </Row>
          <Row label="Visualiser" hint="The signal line under Now Playing.">
            <Toggle on={st.visualiser} onChange={(v) => st.set("visualiser", v)} label="Visualiser" />
          </Row>
        </Group>

        <Group id="startup" n="06" title="Startup">
          <Row label="Intro" hint="Full plays the sequence, fast is a quick flash of the mark, off goes straight in. The app loads underneath either way.">
            <Segmented<IntroMode> label="Intro" value={st.intro} onChange={(v) => st.set("intro", v)} options={[{ value: "full", label: "Full" }, { value: "fast", label: "Fast" }, { value: "off", label: "Off" }]} />
          </Row>
          <Row label="Intro sound" hint="A short amp hum and cable click. Quiet.">
            <Toggle on={st.introSound} onChange={(v) => st.set("introSound", v)} label="Intro sound" />
          </Row>
        </Group>

        <Group id="about" n="07" title="About">
          <div className={s.about}>
            <Wordmark className={s.aboutMark} />
            <p className={`hand ${s.aboutLine}`}>music people repeat.</p>
            <dl className={s.aboutList}>
              <div>
                <dt>Version</dt>
                <dd className="mono">{info?.version ?? "web"}</dd>
              </div>
              {info?.dataDir && (
                <div>
                  <dt>Library data</dt>
                  <dd className="mono">
                    <button className={s.link} onClick={() => void revealItemInDir(info.dataDir!).catch(toastError)}>
                      {info.dataDir}
                    </button>
                  </dd>
                </div>
              )}
              <div>
                <dt>Privacy</dt>
                <dd>No account. No ads. No telemetry. Your library never leaves this device unless you sync it yourself.</dd>
              </div>
              <div>
                <dt>Developer panel</dt>
                <dd>
                  <Toggle on={st.developerPanel} onChange={(v) => st.set("developerPanel", v)} label="Developer panel" />
                  <span className={s.muted}> Provider health, cache and a search debugger.</span>
                </dd>
              </div>
              <div>
                <dt>Keyboard</dt>
                <dd>
                  <button className={s.link} onClick={showShortcuts}>Show the shortcuts</button> — or press {navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl"} /
                </dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>Archivo, Inter, IBM Plex Mono, Covered By Your Grace — SIL Open Font License.</dd>
              </div>
            </dl>
          </div>
        </Group>
        {isTauri && (st.developerPanel || import.meta.env.DEV) && (
          <Group id="developer" n="08" title="Developer">
            <Developer />
          </Group>
        )}
      </div>
    </Page>
  );
}
