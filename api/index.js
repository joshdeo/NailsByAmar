// Nails by Amar booking API, a Cloudflare Worker.
// Reads busy time from Google Calendar and writes appointments to it. Deposits are paid by etransfer.
//
// How deposits work
//   1. A booking is saved to the calendar straight away as "DEPOSIT DUE Name (T2)", which blocks the time.
//   2. The client sends the deposit by etransfer. Amar sees it arrive and removes the words DEPOSIT DUE from the title.
//   3. Every hour the Worker deletes any event still marked DEPOSIT DUE after DEPOSIT_HOLD_HOURS, freeing the time.
//
// Routes
//   GET  /health
//   GET  /availability?service=tier1&from=2026-10-06&days=28
//   POST /book        (JSON body from the website)
// Scheduled
//   hourly            (releases unpaid holds)

const SERVICES = {
  tier1: { name: "Tier 1 Simple", short: "T1", mins: 90, price: 65 },
  tier2: { name: "Tier 2 Minimal Nail Art", short: "T2", mins: 160, price: 70 },
  tier3: { name: "Tier 3 Detailed Nail Art", short: "T3", mins: 180, price: 75 },
  tier4: { name: "Tier 4 Statement Nail Art", short: "T4", mins: 220, price: 80 },
};
const REMOVAL_FEE = 10;
const UNPAID_PREFIX = "DEPOSIT DUE";

/* ---------- Config from wrangler.toml vars ---------- */
const hm = (s) => { const [h, m] = String(s).split(":").map(Number); return h * 60 + (m || 0); };
export function getConfig(env) {
  return {
    tz: env.STUDIO_TZ || "America/Toronto",
    openDays: (env.OPEN_DAYS || "2,3,4,5,6").split(",").map((n) => Number(n.trim())),
    open: hm(env.OPEN_TIME || "10:00"),
    close: hm(env.CLOSE_TIME || "18:00"),
    buffer: Number(env.BUFFER_MINS || 15),
    step: Number(env.SLOT_STEP_MINS || 30),
    leadHours: Number(env.LEAD_HOURS || 24),
    maxDays: Math.min(Number(env.MAX_DAYS || 28), 42),
    deposit: Number(env.DEPOSIT_AMOUNT || 20),
    holdHours: Number(env.DEPOSIT_HOLD_HOURS === undefined ? 24 : env.DEPOSIT_HOLD_HOURS),
    maxUnpaid: Number(env.MAX_UNPAID_PER_CLIENT || 2),
    location: env.STUDIO_LOCATION || "Airport Rd & Countryside Dr, Brampton, ON L6P 0V3",
  };
}

/* ---------- Time zone helpers (no libraries) ---------- */
const pad = (n) => String(n).padStart(2, "0");

// Offset in ms between local wall clock in tz and UTC at the given instant.
export function tzOffsetMs(utcMs, tz) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}
// Local wall time in tz to a UTC instant in ms.
export function zonedToUtcMs(key, minutes, tz) {
  const [y, m, d] = key.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  const off1 = tzOffsetMs(guess, tz);
  let utc = guess - off1;
  const off2 = tzOffsetMs(utc, tz);
  if (off2 !== off1) utc = guess - off2;
  return utc;
}
export const addDaysKey = (key, n) => {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.getUTCFullYear() + "-" + pad(dt.getUTCMonth() + 1) + "-" + pad(dt.getUTCDate());
};
const dowOf = (key) => { const [y, m, d] = key.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const hhmm = (mins) => pad(Math.floor(mins / 60)) + ":" + pad(mins % 60);

/* ---------- Slot maths (pure, easy to test) ---------- */
export function computeSlots({ busy, mins, fromKey, days, nowMs, cfg }) {
  const out = {};
  for (let i = 0; i < days; i++) {
    const key = addDaysKey(fromKey, i);
    const slots = [];
    if (cfg.openDays.includes(dowOf(key))) {
      for (let m = cfg.open; m + mins <= cfg.close; m += cfg.step) {
        const start = zonedToUtcMs(key, m, cfg.tz);
        const end = start + (mins + cfg.buffer) * 60000;
        if (start < nowMs + cfg.leadHours * 3600000) continue;
        if (busy.some(([bs, be]) => bs < end && be > start)) continue;
        slots.push(hhmm(m));
      }
    }
    out[key] = slots;
  }
  return out;
}

/* ---------- Google Calendar (service account) ---------- */
const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
let tokenCache = { value: null, exp: 0 };

async function googleToken(env) {
  if (tokenCache.value && Date.now() < tokenCache.exp) return tokenCache.value;
  const now = Math.floor(Date.now() / 1000);
  const part = (o) => b64url(enc.encode(JSON.stringify(o)));
  const data = part({ alg: "RS256", typ: "JWT" }) + "." + part({
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  });
  const pem = env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n").replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(data)));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: data + "." + b64url(sig) }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error("Google auth failed: " + (j.error_description || j.error));
  tokenCache = { value: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000 };
  return j.access_token;
}

async function gcal(env, path, init = {}) {
  const res = await fetch("https://www.googleapis.com/calendar/v3" + path, {
    ...init,
    headers: { authorization: "Bearer " + (await googleToken(env)), "content-type": "application/json", ...(init.headers || {}) },
  });
  if (res.status === 204) return {};
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("Google Calendar error " + res.status + ": " + (j.error && j.error.message));
  return j;
}
const calPath = (env) => "/calendars/" + encodeURIComponent(env.GOOGLE_CALENDAR_ID) + "/events";

async function busyBetween(env, fromMs, toMs) {
  const ids = [env.GOOGLE_CALENDAR_ID, ...(env.BUSY_CALENDAR_IDS ? env.BUSY_CALENDAR_IDS.split(",").map((s) => s.trim()).filter(Boolean) : [])];
  const j = await gcal(env, "/freeBusy", {
    method: "POST",
    body: JSON.stringify({ timeMin: new Date(fromMs).toISOString(), timeMax: new Date(toMs).toISOString(), items: ids.map((id) => ({ id })) }),
  });
  const busy = [];
  for (const id of ids) {
    const c = j.calendars && j.calendars[id];
    if (!c) continue;
    if (c.errors && c.errors.length) throw new Error("Calendar " + id + " is not shared with the service account");
    for (const b of c.busy || []) busy.push([Date.parse(b.start), Date.parse(b.end)]);
  }
  return busy;
}

async function slotsFor(env, svc, fromKey, days) {
  const cfg = getConfig(env);
  const lastKey = addDaysKey(fromKey, days);
  const busy = await busyBetween(env, zonedToUtcMs(fromKey, 0, cfg.tz), zonedToUtcMs(lastKey, 0, cfg.tz));
  return computeSlots({ busy, mins: svc.mins, fromKey, days, nowMs: Date.now(), cfg });
}

/* ---------- Unpaid holds ---------- */
async function listUnpaid(env, fromMs) {
  const params = new URLSearchParams({
    q: UNPAID_PREFIX, timeMin: new Date(fromMs).toISOString(),
    singleEvents: "true", maxResults: "250", showDeleted: "false",
  });
  const j = await gcal(env, calPath(env) + "?" + params);
  return (j.items || []).filter((ev) => String(ev.summary || "").startsWith(UNPAID_PREFIX));
}

// Deletes events still marked DEPOSIT DUE after the hold time. Google keeps deleted events in the
// calendar trash for 30 days, so one removed by mistake can be restored.
export async function releaseUnpaid(env, nowMs = Date.now()) {
  const cfg = getConfig(env);
  if (!cfg.holdHours) return 0;
  let removed = 0;
  for (const ev of await listUnpaid(env, nowMs - 6 * 3600000)) {
    if (Date.parse(ev.created) > nowMs - cfg.holdHours * 3600000) continue;
    await gcal(env, calPath(env) + "/" + ev.id, { method: "DELETE" });
    removed++;
  }
  return removed;
}

/* ---------- HTTP helpers ---------- */
function corsHeaders(env, req) {
  const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim());
  const origin = req.headers.get("origin") || "";
  const ok = allowed.includes("*") ? "*" : allowed.includes(origin) ? origin : allowed[0];
  return { "access-control-allow-origin": ok, "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type", vary: "origin" };
}
const json = (env, req, body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...corsHeaders(env, req) } });

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (s, n) => String(s || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

/* ---------- Handlers ---------- */
async function handleAvailability(env, req, url) {
  const svc = SERVICES[url.searchParams.get("service")];
  const cfg = getConfig(env);
  const from = url.searchParams.get("from") || "";
  const days = Math.max(1, Math.min(Number(url.searchParams.get("days") || cfg.maxDays), cfg.maxDays));
  if (!svc || !KEY_RE.test(from)) return json(env, req, { error: "Bad request" }, 400);
  return json(env, req, { days: await slotsFor(env, svc, from, days) });
}

export function eventBody(env, svc, b, nowMs = Date.now()) {
  const cfg = getConfig(env);
  const start = zonedToUtcMs(b.date, hm(b.time), cfg.tz);
  const end = start + svc.mins * 60000;
  const cashDue = svc.price - cfg.deposit + (b.removal ? REMOVAL_FEE : 0);
  const by = new Intl.DateTimeFormat("en-CA", { timeZone: cfg.tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    .format(new Date(nowMs + cfg.holdHours * 3600000));
  return {
    summary: UNPAID_PREFIX + " " + b.name + " (" + svc.short + ")",
    location: cfg.location,
    colorId: "5",
    start: { dateTime: new Date(start).toISOString(), timeZone: cfg.tz },
    end: { dateTime: new Date(end).toISOString(), timeZone: cfg.tz },
    description: [
      "Client: " + b.name, "Phone: " + b.phone, "Email: " + b.email,
      "Service: " + svc.name + " ($" + svc.price + ")",
      "Removal needed: " + (b.removal ? "yes (+$" + REMOVAL_FEE + ")" : "no"),
      "Cash due at appointment: $" + cashDue,
      "Notes: " + (b.notes || "none"),
      "",
      "DEPOSIT: $" + cfg.deposit + " etransfer, NOT PAID YET.",
      cfg.holdHours
        ? "When the etransfer arrives, delete the words DEPOSIT DUE from the title. If they are still there after " + by + ", this event is removed automatically."
        : "When the etransfer arrives, delete the words DEPOSIT DUE from the title.",
    ].join("\n"),
    reminders: { useDefault: true },
  };
}

async function handleBook(env, req) {
  let raw;
  try { raw = await req.json(); } catch { return json(env, req, { error: "Bad request" }, 400); }
  const svc = SERVICES[raw.service];
  const b = {
    date: String(raw.date || ""), time: String(raw.time || ""),
    name: clean(raw.name, 80), phone: clean(raw.phone, 30), email: clean(raw.email, 120),
    notes: clean(raw.notes, 500), removal: raw.removal === true,
  };
  if (!svc || !KEY_RE.test(b.date) || !TIME_RE.test(b.time) || !b.name || !b.phone || !EMAIL_RE.test(b.email) || raw.agree !== true) {
    return json(env, req, { error: "Please check your details." }, 400);
  }
  const cfg = getConfig(env);

  // Without a payment step, limit how many unpaid spots one person can hold at once.
  const mine = (await listUnpaid(env, Date.now() - 6 * 3600000))
    .filter((ev) => String(ev.description || "").toLowerCase().includes("email: " + b.email.toLowerCase()));
  if (mine.length >= cfg.maxUnpaid) {
    return json(env, req, { error: "You already have " + mine.length + " spots waiting for a deposit. Send the etransfer first, or message Amar." }, 429);
  }

  const open = (await slotsFor(env, svc, b.date, 1))[b.date] || [];
  if (!open.includes(b.time)) return json(env, req, { error: "That time is no longer open." }, 409);

  await gcal(env, calPath(env), { method: "POST", body: JSON.stringify(eventBody(env, svc, b)) });
  return json(env, req, { ok: true, holdHours: cfg.holdHours });
}

/* ---------- Entry ---------- */
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(env, req) });
    try {
      if (url.pathname === "/health") return json(env, req, { ok: true });
      if (url.pathname === "/availability" && req.method === "GET") return await handleAvailability(env, req, url);
      if (url.pathname === "/book" && req.method === "POST") return await handleBook(env, req);
      return json(env, req, { error: "Not found" }, 404);
    } catch (err) {
      console.error(err && err.stack ? err.stack : err);
      return json(env, req, { error: "Something went wrong on our side. Please try again." }, 500);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(releaseUnpaid(env).catch((err) => console.error(err && err.stack ? err.stack : err)));
  },
};
