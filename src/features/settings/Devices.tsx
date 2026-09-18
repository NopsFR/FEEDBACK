import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { call } from "@/services/ipc";
import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import { relativeDay } from "@/lib/format";
import { toastError } from "@/state/ui";
import s from "./Settings.module.css";

interface LanStatus {
  enabled: boolean;
  running: boolean;
  urls: string[];
  setupUrl: string;
  qrSvg: string | null;
  devices: { id: number; name: string; createdAt: number; lastSeenAt: number | null }[];
  pwaBundled: boolean;
}

/** Phone access over the local network: off by default, pair explicitly, revoke any time. */
export function Devices() {
  const [st, setSt] = useState<LanStatus | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => call<LanStatus>("lan_status").then(setSt).catch(toastError);
  useEffect(() => {
    void refresh();
    const un = listen("devices-changed", () => {
      setCode(null);
      void refresh();
    });
    return () => void un.then((f) => f());
  }, []);
  if (!st) return null;

  const toggle = async () => {
    setBusy(true);
    try {
      setSt(await call<LanStatus>("lan_set_enabled", { enabled: !st.enabled }));
      setCode(null);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.devices}>
      <div className={s.row}>
        <div>
          <div className={s.rowLabel}>Phone access on this network</div>
          <div className={s.rowHint}>
            Lets a paired phone browse this library and save albums over your Wi-Fi. Encrypted, off by default, nothing goes through the internet.
          </div>
        </div>
        <div className={s.rowControl}>
          <button role="switch" aria-checked={st.enabled} aria-label="Phone access" disabled={busy} className={`${s.toggle} ${st.enabled ? s.toggleOn : ""}`} onClick={toggle}>
            <span />
          </button>
        </div>
      </div>

      {st.running && (
        <div className={s.lan}>
          <div className={s.lanSteps}>
            <p className="label">1 — On the phone, open</p>
            <p className={`mono ${s.url}`}>{st.setupUrl}</p>
            <p className={s.rowHint}>…or scan the code. It walks through trusting this computer (once), then opens FEEDBACK.</p>
            <p className="label" style={{ marginTop: 18 }}>2 — Then use</p>
            {st.urls.map((u) => (
              <p key={u} className={`mono ${s.url}`}>
                {u}
              </p>
            ))}
            <p className="label" style={{ marginTop: 18 }}>3 — Pairing code</p>
            {code ? <p className={s.code}>{code.slice(0, 3)} {code.slice(3)}</p> : <p className={s.rowHint}>Codes last five minutes and work once.</p>}
            <Button variant="secondary" onClick={() => call<string>("lan_new_code").then(setCode).catch(toastError)}>
              New code
            </Button>
            {!st.pwaBundled && <p className={s.rowHint}>Developer build: run <code>pnpm build:pwa</code> so the phone app can be served.</p>}
          </div>
          {st.qrSvg && <div className={s.qr} role="img" dangerouslySetInnerHTML={{ __html: st.qrSvg }} aria-label={`QR code for ${st.setupUrl}`} />}
        </div>
      )}

      <div className={s.rowLabel} style={{ marginTop: 20 }}>
        Paired devices
      </div>
      {st.devices.length ? (
        st.devices.map((d) => (
          <div key={d.id} className={s.folder}>
            <span />
            <div className={s.folderText}>
              <div className={s.folderPath}>{d.name}</div>
              <div className="mono">
                paired {relativeDay(d.createdAt)} · last seen {relativeDay(d.lastSeenAt)}
              </div>
            </div>
            <span />
            <IconButton icon="close" label={`Revoke ${d.name}`} size={16} onClick={() => call<LanStatus>("lan_revoke", { id: d.id }).then(setSt).catch(toastError)} />
          </div>
        ))
      ) : (
        <p className={s.muted}>No phones paired.</p>
      )}
    </div>
  );
}
