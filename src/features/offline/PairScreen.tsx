import { useState } from "react";
import { Wordmark } from "@/components/Wordmark";
import { Button } from "@/components/Button";
import { pair } from "@/services/remote";
import { setToken, isIOS } from "@/services/platform";
import s from "./PairScreen.module.css";

/** First run on a phone: pair with the computer using the code shown in FEEDBACK → Settings → Devices. */
export function PairScreen({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone;

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const name = isIOS ? "iPhone" : /Android/.test(navigator.userAgent) ? "Android phone" : "Browser";
      const token = await pair(code.replace(/\D/g, ""), name);
      setToken(token);
      onPaired();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Pairing failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.wrap}>
      <Wordmark className={s.mark} />
      <p className={`hand ${s.line}`}>music people repeat.</p>
      <h1 className={s.title}>Pair this phone</h1>
      <p className={s.body}>
        On your computer open FEEDBACK → <b>Settings → Devices</b>, turn on phone access and tap <b>New code</b>. Type the six digits here.
      </p>
      <form
        className={s.form}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          className={s.code}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
          placeholder="000000"
          aria-label="Pairing code"
          autoFocus
        />
        <Button type="submit" disabled={busy || code.replace(/\D/g, "").length !== 6}>
          {busy ? "Pairing…" : "Pair"}
        </Button>
      </form>
      {err && <p className={s.err}>{err}</p>}
      {!standalone && isIOS && (
        <p className={s.tip}>
          Tip: tap <b>Share → Add to Home Screen</b> first. FEEDBACK then opens full screen and can keep albums on the phone.
        </p>
      )}
    </div>
  );
}
