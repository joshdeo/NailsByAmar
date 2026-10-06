/* Nails by Amar: shared site code. Every page loads this file. */
(() => {
  "use strict";

  /* ---------- Config ----------
     API_BASE: paste your Cloudflare Worker address here when it is deployed
     (for example https://nailsbyamar-api.yourname.workers.dev). Leave it empty
     to run in preview mode with simulated openings and no real booking. */
  const CONFIG = {
    API_BASE: "",
    DAYS_AHEAD: 28,
    LEAD_DAYS: 1,
    DEPOSIT: 20,
    DEPOSIT_HOURS: 24, // keep in step with DEPOSIT_HOLD_HOURS in api/wrangler.toml
    ETRANSFER_EMAIL: "nailsbyamar@gmail.com", // where clients send the deposit. Confirm this with Amar.
    GOOGLE_REVIEWS_URL: "", // optional. Link to her Google reviews. Shows a button on the Reviews page when filled in.
    REMOVAL_FEE: 10,
    PREVIEW_HOURS: { open: 10, close: 18, days: [2, 3, 4, 5, 6] } // Tue to Sat, preview only
  };

  const SETMORE = "https://nailsbyamar.setmore.com/book?step=time-slot&type=service&staff=163acd9d-130b-4a6c-aa18-629a5d50a377&staffSelected=true&products=";
  const TIERS = [
    { id: "tier1", tag: "Tier 1", name: "Simple", mins: 90, price: 65, deco: 1, setmore: SETMORE + "96112d01-775e-4777-9a5c-1c83bed32ed5" },
    { id: "tier2", tag: "Tier 2", name: "Minimal Nail Art", mins: 160, price: 70, deco: 2, setmore: SETMORE + "c32d14c2-823a-467a-b615-f163e7bc906f" },
    { id: "tier3", tag: "Tier 3", name: "Detailed Nail Art", mins: 180, price: 75, deco: 3, setmore: SETMORE + "87b731de-4873-4a69-9efa-65336efcdbbd" },
    { id: "tier4", tag: "Tier 4", name: "Statement Nail Art", mins: 220, price: 80, deco: 4, setmore: SETMORE + "e14aae5a-92a2-47f4-9660-da654b791136" }
  ];
  const TIER_BG = ["var(--t1)", "var(--t2)", "var(--t3)", "var(--t4)"];
  const SHADES = [
    ["Cherry", "#E0204B"], ["Bubblegum", "#FF8FB8"], ["Sky", "#7FB5FF"],
    ["Butter", "#FFD34E"], ["Mint", "#7AD9B0"], ["Lilac", "#B79CFF"],
    ["Milk", "#FFFFFF"], ["Midnight", "#1A1D4A"]
  ];
  const POLICY = [
    "$20 deposit required. The deposit is nonrefundable.",
    "Send the deposit by Interac etransfer" + (CONFIG.DEPOSIT_HOURS ? " within " + CONFIG.DEPOSIT_HOURS + " hours of booking, or your spot is released." : "."),
    "The remaining balance is paid in cash.",
    "Cancel or reschedule with at least 24 hours notice.",
    "Tell Amar if you need a removal. It is $10.",
    "No last minute design changes.",
    "Appointments may take 2+ hours.",
    "Park on the road side."
  ];
  const SHAPES = {
    almond:   "M30 3 C40 14 52 38 52 62 C52 84 43 96 30 96 C17 96 8 84 8 62 C8 38 20 14 30 3Z",
    coffin:   "M17 5 H43 L52 40 V85 Q52 96 41 96 H19 Q8 96 8 85 V40 Z",
    square:   "M11 7 H49 Q52 7 52 10 V85 Q52 96 41 96 H19 Q8 96 8 85 V10 Q8 7 11 7Z",
    round:    "M30 5 C46 5 52 22 52 40 V84 Q52 96 41 96 H19 Q8 96 8 84 V40 C8 22 14 5 30 5Z",
    stiletto: "M30 0 C34 20 52 50 52 70 C52 88 44 98 30 98 C16 98 8 88 8 70 C8 50 26 20 30 0Z"
  };
  // Quotes shown on the home and Reviews pages. The list lives in manualreviews.js so it can be edited
  // without touching this file.
  const REVIEWS = Array.isArray(window.NBA_REVIEWS) ? window.NBA_REVIEWS : [];

  const $ = (s) => document.querySelector(s);
  const pad = (n) => String(n).padStart(2, "0");

  /* ---------- Date and money helpers ---------- */
  const keyOf = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const todayKey = () => keyOf(new Date());
  const addDays = (key, n) => { const d = new Date(key + "T12:00:00"); d.setDate(d.getDate() + n); return keyOf(d); };
  const dowOf = (key) => new Date(key + "T12:00:00").getDay();
  const fmtTime = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return (h % 12 || 12) + ":" + pad(m) + " " + (h >= 12 ? "pm" : "am"); };
  const fmtDur = (mins) => { const h = Math.floor(mins / 60), m = mins % 60; return h + " hr" + (m ? " " + m + " min" : ""); };
  const dayInfo = (key) => {
    const d = new Date(key + "T12:00:00");
    return {
      wd: d.toLocaleDateString("en-US", { weekday: "short" }),
      n: d.getDate(),
      m: d.toLocaleDateString("en-US", { month: "short" }),
      long: d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    };
  };
  const hash = (s) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
  const cash = (tier, removal) => tier.price - CONFIG.DEPOSIT + (removal ? CONFIG.REMOVAL_FEE : 0);
  const tierById = (id) => TIERS.find((t) => t.id === id);

  /* ---------- Nail art ---------- */
  function deco(n) {
    if (n === 2) return '<g fill="#fff"><circle cx="30" cy="62" r="2.6"/><circle cx="22" cy="74" r="1.9"/><circle cx="38" cy="74" r="1.9"/></g><path d="M17 52 Q30 43 43 52" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>';
    if (n === 3) return '<g fill="#fff" opacity=".95"><circle cx="30" cy="54" r="5.4"/><circle cx="37" cy="59" r="5.4"/><circle cx="34.5" cy="67" r="5.4"/><circle cx="25.5" cy="67" r="5.4"/><circle cx="23" cy="59" r="5.4"/></g><circle cx="30" cy="61.5" r="3.6" fill="#FFC83D"/><path d="M30 72 C30 80 22 82 18 80 M30 74 C32 80 40 80 42 76" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>';
    if (n === 4) return '<path d="M12 44 C26 38 38 38 50 44" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".85"/><path d="M30 50 l3.4 7 7.6 1.1 -5.5 5.3 1.3 7.6 -6.8 -3.6 -6.8 3.6 1.3 -7.6 -5.5 -5.3 7.6 -1.1z" fill="#FFC83D" stroke="#1A1D4A" stroke-width="1.2" stroke-linejoin="round"/><g fill="#fff" stroke="#1A1D4A" stroke-width="1.1"><circle cx="19" cy="80" r="3.6"/><circle cx="41" cy="80" r="3.6"/><circle cx="30" cy="86" r="2.6"/></g>';
    return "";
  }
  function nailSVG(shape, d, fill) {
    return '<svg viewBox="0 0 60 100" aria-hidden="true" focusable="false"><path d="' + SHAPES[shape] + '" fill="' + (fill || "var(--nail)") + '" stroke="#1A1D4A" stroke-width="2.4" stroke-linejoin="round"/><path d="M19 36 C19 28 22 22 26 18" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" opacity=".55"/>' + deco(d || 0) + "</svg>";
  }

  /* ---------- Availability (used by the booking page and the home page) ---------- */
  const cache = {};
  function previewDays(tier) {
    const out = {};
    const start = addDays(todayKey(), CONFIG.LEAD_DAYS);
    const H = CONFIG.PREVIEW_HOURS;
    for (let i = 0; i < CONFIG.DAYS_AHEAD; i++) {
      const key = addDays(start, i);
      const slots = [];
      if (H.days.includes(dowOf(key))) {
        for (let m = H.open * 60; m + tier.mins <= H.close * 60; m += 30) {
          if (hash(key + ":" + m) % 100 < 38) continue;
          slots.push(pad(Math.floor(m / 60)) + ":" + pad(m % 60));
        }
      }
      out[key] = slots;
    }
    return out;
  }
  function loadDays(tier, fresh) {
    if (fresh) delete cache[tier.id];
    if (cache[tier.id]) return cache[tier.id];
    const p = !CONFIG.API_BASE
      ? Promise.resolve(previewDays(tier))
      : fetch(CONFIG.API_BASE + "/availability?service=" + tier.id + "&from=" + addDays(todayKey(), CONFIG.LEAD_DAYS) + "&days=" + CONFIG.DAYS_AHEAD)
          .then((r) => { if (!r.ok) throw new Error("availability"); return r.json(); })
          .then((j) => j.days);
    cache[tier.id] = p;
    p.catch(() => { delete cache[tier.id]; });
    return p;
  }

  window.NBA = { CONFIG, TIERS, tierById, $, pad, keyOf, todayKey, addDays, dowOf, fmtTime, fmtDur, dayInfo, cash, loadDays };

  /* ---------- Month in the hero ---------- */
  const mo = $("#month");
  if (mo) mo.textContent = new Date().toLocaleDateString("en-US", { month: "long" });

  /* ---------- Hero nails (home page) ---------- */
  const heroEl = $("#heroNails");
  if (heroEl) {
    const heroShapes = ["round", "coffin", "almond", "stiletto", "square"];
    const heroRot = [-14, -7, 0, 8, 15];
    const heroStart = [0, 1, 5, 2, 4];
    heroShapes.forEach((shape, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "hn";
      b.setAttribute("aria-label", "Change the shade of this nail");
      b.style.setProperty("--i", i);
      b.style.setProperty("--r", heroRot[i] + "deg");
      b.dataset.c = heroStart[i];
      b.style.setProperty("--nail", SHADES[heroStart[i]][1]);
      b.innerHTML = nailSVG(shape);
      b.addEventListener("click", () => {
        const next = (Number(b.dataset.c) + 1) % SHADES.length;
        b.dataset.c = next;
        b.style.setProperty("--nail", SHADES[next][1]);
      });
      heroEl.appendChild(b);
    });
  }

  /* ---------- Shade picker and tier cards (home and services pages) ---------- */
  const tiersEl = $("#tiers");
  if (tiersEl) {
    tiersEl.innerHTML = TIERS.map((t, i) =>
      '<article class="tier" style="--bg-t:' + TIER_BG[i] + '">' +
        '<div class="art">' + nailSVG("almond", t.deco) + "</div>" +
        '<div class="tag">' + t.tag + "</div>" +
        '<div class="name">' + t.name + "</div>" +
        '<div class="meta"><span class="price">$' + t.price + '</span><span class="dur">' + fmtDur(t.mins) + "</span></div>" +
        '<a class="btn" href="book.html?tier=' + t.id + '">Choose ' + t.tag + "</a>" +
      "</article>"
    ).join("");
  }
  const shadesEl = $("#shades");
  if (shadesEl && tiersEl) {
    SHADES.forEach(([name, hex], i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "shade";
      b.style.setProperty("--c", hex);
      b.setAttribute("aria-label", name);
      b.setAttribute("aria-pressed", i === 0 ? "true" : "false");
      b.addEventListener("click", () => {
        shadesEl.querySelectorAll(".shade").forEach((s) => s.setAttribute("aria-pressed", "false"));
        b.setAttribute("aria-pressed", "true");
        tiersEl.style.setProperty("--nail", hex);
      });
      shadesEl.appendChild(b);
    });
  }

  /* ---------- Policy page ---------- */
  const policyEl = $("#policyList");
  if (policyEl) {
    const heart = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-8-5.2-8-11a4.6 4.6 0 0 1 8-3 4.6 4.6 0 0 1 8 3c0 5.8-8 11-8 11z" fill="var(--cherry)" stroke="var(--ink)" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    policyEl.innerHTML = POLICY.map((p) => "<li>" + heart + "<span>" + p + "</span></li>").join("");
  }

  /* ---------- Copy email (find page) ---------- */
  const copyBtn = $("#copyEmail");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const text = $("#emailText").textContent;
      try { await navigator.clipboard.writeText(text); copyBtn.textContent = "Copied"; }
      catch (_) {
        const r = document.createRange(); r.selectNodeContents($("#emailText"));
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        copyBtn.textContent = "Press copy";
      }
      setTimeout(() => { copyBtn.textContent = "Copy email"; }, 2000);
    });
  }

  /* ---------- Next opening pill (home page) ---------- */
  const nextPill = $("#nextPill");
  if (nextPill) {
    loadDays(TIERS[0]).then((days) => {
      const key = Object.keys(days).sort().find((k) => days[k].length);
      if (!key) return;
      const i = dayInfo(key);
      nextPill.textContent = "Next opening " + i.wd + " " + i.m + " " + i.n + ", " + fmtTime(days[key][0]);
      nextPill.hidden = false;
    }).catch(() => {});
  }

  /* ---------- Reviews page ----------
     Shows the quotes listed in manualreviews.js. Ratings and live reviews stay on Google. */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function reviewCard(r) {
    const f = el("figure", "rv");
    const head = el("div", "rv-head");
    head.appendChild(el("span", "rv-av rv-init", (r.author || "?").trim().charAt(0).toUpperCase()));
    const who = el("div", "rv-who");
    who.appendChild(el("b", "rv-name", r.author));
    if (r.when) who.appendChild(el("small", "muted", r.when));
    head.appendChild(who);
    f.appendChild(head);
    f.appendChild(el("blockquote", "rv-text", r.text));
    f.appendChild(el("figcaption", "rv-foot")).appendChild(el("span", "rv-badge", r.from || "Client review"));
    return f;
  }
  const listRev = $("#revList");
  const none = () => el("p", "muted", "Reviews will show up here soon.");
  if (listRev) {
    listRev.textContent = "";
    if (REVIEWS.length) REVIEWS.forEach((r) => listRev.appendChild(reviewCard(r)));
    else listRev.appendChild(none());
    const links = $("#revLinks");
    if (links && CONFIG.GOOGLE_REVIEWS_URL) {
      const a = el("a", "btn ghost", "See more reviews on Google");
      a.href = CONFIG.GOOGLE_REVIEWS_URL; a.target = "_blank"; a.rel = "noopener noreferrer";
      links.appendChild(a);
    }
  }
})();
