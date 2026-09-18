/**
 * A small client for FEEDBACK's account backend — enough for auth, table reads and signed audio
 * links, without pulling in an SDK. The publishable key below is meant to be public: it grants
 * nothing on its own, because every table is guarded by row-level security tied to the session.
 */
const BASE = "https://hufbbkfjdhxtjmfhqtvq.supabase.co";
const KEY = "sb_publishable_je_Yqlll1iDGYd8NKK_Zsw_xqBB0Kwf";
const SESSION_KEY = "feedback.cloud.session";

export interface CloudSession {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds. */
  expiresAt: number;
  userId: string;
  email: string;
}

let session: CloudSession | null = null;
try {
  session = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
} catch {
  session = null;
}

export function currentSession(): CloudSession | null {
  return session;
}

function store(next: CloudSession | null) {
  session = next;
  try {
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode: the session simply won't outlive this tab */
  }
  window.dispatchEvent(new Event("feedback:cloud-session"));
}

function sessionFrom(body: Record<string, unknown>, fallbackEmail: string): CloudSession {
  const user = (body.user ?? {}) as { id?: string; email?: string };
  return {
    accessToken: String(body.access_token ?? ""),
    refreshToken: String(body.refresh_token ?? ""),
    expiresAt: Math.floor(Date.now() / 1000) + Number(body.expires_in ?? 3600),
    userId: user.id ?? "",
    email: user.email ?? fallbackEmail,
  };
}

async function auth(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(json.msg ?? json.message ?? json.error_description ?? "That didn't work."));
  return json as Record<string, unknown>;
}

export async function signIn(email: string, password: string): Promise<CloudSession> {
  const next = sessionFrom(await auth("token?grant_type=password", { email: email.trim(), password }), email);
  store(next);
  return next;
}

export async function signUp(email: string, password: string): Promise<CloudSession | null> {
  const body = await auth("signup", { email: email.trim(), password });
  if (!body.access_token) return null; // the address has to be confirmed first
  const next = sessionFrom(body, email);
  store(next);
  return next;
}

export async function resetPassword(email: string): Promise<void> {
  await auth("recover", { email: email.trim() });
}

export function signOut() {
  store(null);
}

/** A usable token, refreshed when it's close to lapsing. Offline never signs you out. */
async function token(): Promise<string> {
  if (!session) throw new Error("signed-out");
  if (session.expiresAt - 60 > Math.floor(Date.now() / 1000)) return session.accessToken;
  try {
    const next = sessionFrom(await auth("token?grant_type=refresh_token", { refresh_token: session.refreshToken }), session.email);
    store(next);
    return next.accessToken;
  } catch (e) {
    if (e instanceof TypeError) return session.accessToken; // network down: keep what we have
    store(null);
    throw new Error("signed-out");
  }
}

/** A PostgREST read. `path` is everything after /rest/v1/. */
export async function select<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${await token()}` } });
  if (!res.ok) throw new Error(`Your account answered with ${res.status}.`);
  return (await res.json()) as T;
}

export async function write(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown, prefer = "return=representation,resolution=merge-duplicates"): Promise<unknown> {
  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    method,
    headers: { apikey: KEY, Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Your account answered with ${res.status}.`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/**
 * A short-lived link to one of your own uploads. Signed URLs expire, so these are kept in memory
 * only and re-requested when they age — never written to storage.
 */
const signed = new Map<string, { url: string; expiresAt: number }>();

/** Drop a link we know has stopped working, so the next request signs a fresh one. */
export function forgetSignedUrl(objectPath: string): void {
  signed.delete(objectPath);
}

export async function signedUrl(objectPath: string): Promise<string> {
  const cached = signed.get(objectPath);
  if (cached && cached.expiresAt > Date.now() / 1000 + 120) return cached.url;
  const res = await fetch(`${BASE}/storage/v1/object/sign/music/${objectPath}`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 7200 }),
  });
  if (!res.ok) throw new Error("That track's link couldn't be created.");
  const body = (await res.json()) as { signedURL?: string; signedUrl?: string };
  const path = body.signedURL ?? body.signedUrl;
  if (!path) throw new Error("That track has no cloud copy.");
  const url = `${BASE}/storage/v1${path}`;
  signed.set(objectPath, { url, expiresAt: Date.now() / 1000 + 7200 - 120 });
  return url;
}
