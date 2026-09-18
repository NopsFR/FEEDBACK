import { useState } from "react";
import { Wordmark } from "@/components/Wordmark";
import { Button } from "@/components/Button";
import { resetPassword, signIn, signUp } from "@/services/supabase";
import { isIOS } from "@/services/platform";
import s from "./PairScreen.module.css";

/**
 * First run away from home: sign in to the account that holds your library. Pairing with the
 * computer stays available for streaming everything on it over your own Wi-Fi.
 */
export function SignInScreen({ onSignedIn, onPair }: { onSignedIn: () => void; onPair: () => void }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone;

  const submit = async () => {
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      if (mode === "up") {
        const session = await signUp(email, password);
        if (!session) {
          setNote("Check your email and confirm the address, then sign in.");
          setMode("in");
          return;
        }
      } else {
        await signIn(email, password);
      }
      onSignedIn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.wrap}>
      <Wordmark className={s.mark} />
      <p className={`hand ${s.line}`}>music people repeat.</p>
      <h1 className={s.title}>{mode === "in" ? "Sign in" : "Create an account"}</h1>
      <p className={s.body}>Your playlists, favourites and uploaded music follow the account — on Wi-Fi or mobile data, with your computer switched off.</p>
      <form
        className={s.form}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input className={s.code} type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email" aria-label="Email" autoFocus />
        <input className={s.code} type="password" autoComplete={mode === "in" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" aria-label="Password" />
        <Button type="submit" disabled={busy || !email.includes("@") || password.length < 8}>
          {busy ? "…" : mode === "in" ? "Sign in" : "Create account"}
        </Button>
      </form>
      {note && <p className={s.tip}>{note}</p>}
      {err && <p className={s.err}>{err}</p>}
      <p className={s.tip}>
        <button className={s.linkish} onClick={() => setMode(mode === "in" ? "up" : "in")}>{mode === "in" ? "Create an account" : "I already have an account"}</button>
        {mode === "in" && email.includes("@") && (
          <>
            {" · "}
            <button className={s.linkish} onClick={() => void resetPassword(email).then(() => setNote("Password reset sent.")).catch(() => setErr("Couldn't send that reset."))}>Forgot password</button>
          </>
        )}
        {" · "}
        <button className={s.linkish} onClick={onPair}>Pair with my computer instead</button>
      </p>
      {!standalone && isIOS && (
        <p className={s.tip}>
          Tip: tap <b>Share → Add to Home Screen</b> first, so FEEDBACK opens full screen and keeps playing when the phone locks.
        </p>
      )}
    </div>
  );
}
