import { useCallback, useEffect, useState } from "react";
import { call } from "@/services/ipc";
import { Button } from "@/components/Button";
import { toast, toastError } from "@/state/ui";
import { listen } from "@tauri-apps/api/event";
import s from "./Account.module.css";

interface Status {
  signedIn: boolean;
  email: string | null;
  userId: string | null;
  baseUrl: string;
}

interface SyncSummary {
  tracksPushed: number;
  playlistsPushed: number;
  favouritesPushed: number;
  playsPushed: number;
  playlistsPulled: number;
  favouritesPulled: number;
}

/** Your account: what carries playlists, favourites and your own uploads to the phone. */
export function Account() {
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const refresh = useCallback(() => {
    call<Status>("cloud_status").then(setStatus).catch(() => setStatus(null));
  }, []);
  useEffect(refresh, [refresh]);

  useEffect(() => {
    const un = listen<{ done: number; total: number; name: string }>("cloud-upload-progress", (e) => setProgress(`${e.payload.done} / ${e.payload.total} · ${e.payload.name}`));
    return () => {
      void un.then((f) => f());
    };
  }, []);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
      setProgress(null);
      refresh();
    }
  };

  if (!status?.signedIn) {
    return (
      <div className={s.panel}>
        <p className={s.body}>Sign in to carry your playlists, favourites and uploaded music to your phone — over mobile data, with this computer switched off.</p>
        <form
          className={s.form}
          onSubmit={(e) => {
            e.preventDefault();
            void run("auth", async () => {
              if (mode === "up") {
                const signedIn = await call<boolean>("cloud_sign_up", { email, password });
                if (!signedIn) {
                  toast("Check your email to confirm the address, then sign in.");
                  setMode("in");
                  return;
                }
              } else {
                await call("cloud_sign_in", { email, password });
              }
              toast("Signed in.");
            });
          }}
        >
          <input className={s.input} type="email" autoComplete="email" placeholder="you@email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
          <input className={s.input} type="password" autoComplete={mode === "in" ? "current-password" : "new-password"} placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Password" />
          <Button type="submit" disabled={!!busy || !email.includes("@") || password.length < 8}>
            {busy ? "…" : mode === "in" ? "Sign in" : "Create account"}
          </Button>
        </form>
        <p className={`mono ${s.muted}`}>
          <button className={s.link} onClick={() => setMode(mode === "in" ? "up" : "in")}>{mode === "in" ? "Create an account" : "I already have one"}</button>
          {mode === "in" && email.includes("@") && (
            <>
              {" · "}
              <button className={s.link} onClick={() => void call("cloud_reset_password", { email }).then(() => toast("Password reset sent.")).catch(toastError)}>Forgot password</button>
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className={s.panel}>
      <p className={s.body}>
        Signed in as <b>{status.email}</b>.
      </p>
      <div className={s.actions}>
        <Button
          variant="secondary"
          disabled={!!busy}
          onClick={() =>
            void run("sync", async () => {
              const r = await call<SyncSummary>("cloud_sync");
              toast(`Synced ${r.tracksPushed} tracks, ${r.playlistsPushed} playlists.`);
            })
          }
        >
          {busy === "sync" ? "Syncing…" : "Sync now"}
        </Button>
        <Button
          variant="secondary"
          disabled={!!busy}
          onClick={() =>
            void run("upload", async () => {
              const r = await call<{ uploaded: number; skipped: number; failed: number; bytes: number }>("cloud_upload", { trackIds: null });
              toast(`Uploaded ${r.uploaded}, already there ${r.skipped}${r.failed ? `, failed ${r.failed}` : ""}.`);
            })
          }
        >
          {busy === "upload" ? "Uploading…" : "Upload my music"}
        </Button>
        <Button variant="quiet" disabled={!!busy} onClick={() => void run("out", async () => (await call("cloud_sign_out"), toast("Signed out.")))}>
          Sign out
        </Button>
      </div>
      {progress && <p className={`mono ${s.muted}`}>{progress}</p>}
      <p className={`mono ${s.muted}`}>Uploads are private to your account and streamed with short-lived links. Nothing is shared.</p>
    </div>
  );
}
