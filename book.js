/* Nails by Amar: booking page. Needs site.js loaded first. */
(() => {
  "use strict";
  const { CONFIG, TIERS, tierById, $, fmtTime, fmtDur, dayInfo, cash, loadDays } = window.NBA;
  const state = { tier: null, date: null, time: null, days: null };

  const msg = (text, kind) => { const m = $("#msg"); m.textContent = text || ""; m.className = "msg" + (kind ? " " + kind : ""); };

  /* ---------- Tier options ---------- */
  $("#tierOpts").innerHTML = TIERS.map((t) =>
    '<div class="opt"><input type="radio" name="tier" id="o-' + t.id + '" value="' + t.id + '">' +
    '<label for="o-' + t.id + '"><span>' + t.tag + " " + t.name + "<small>" + fmtDur(t.mins) + "</small></span><b>$" + t.price + "</b></label></div>"
  ).join("");
  $("#tierOpts").addEventListener("change", (e) => { if (e.target.name === "tier") selectTier(e.target.value); });

  function selectTier(id) {
    state.tier = tierById(id);
    state.date = null;
    state.time = null;
    state.days = null;
    msg("");
    document.querySelectorAll("#tierOpts input").forEach((r) => { r.checked = r.value === id; });
    $("#setmoreLink").href = state.tier.setmore;
    renderDates(true);
    renderTimes();
    renderSummary();
    loadDays(state.tier).then((days) => {
      if (!state.tier || state.tier.id !== id) return;
      state.days = days;
      renderDates(false);
    }).catch(() => {
      $("#dates").innerHTML = '<div class="empty">Could not load openings. Try again, or <a href="' + state.tier.setmore + '" target="_blank" rel="noopener">book through Setmore</a>.</div>';
    });
  }

  /* ---------- Days ---------- */
  function renderDates(loading) {
    const el = $("#dates");
    if (!state.tier) { el.innerHTML = '<div class="empty">Choose a tier to see open days.</div>'; return; }
    if (loading || !state.days) { el.innerHTML = '<div class="empty">Loading openings…</div>'; return; }
    const keys = Object.keys(state.days).sort();
    if (!keys.some((k) => state.days[k].length)) { el.innerHTML = '<div class="empty">No openings in the next four weeks. Message @nailsby_amar on Instagram.</div>'; return; }
    el.innerHTML = keys.map((k) => {
      const i = dayInfo(k), n = state.days[k].length;
      return '<button type="button" class="day" data-date="' + k + '"' + (n ? "" : " disabled") + ' aria-pressed="' + (state.date === k) + '" aria-label="' + i.long + (n ? "" : ", full") + '">' +
        i.wd + "<b>" + i.n + "</b><small>" + (n ? i.m : "Full") + "</small></button>";
    }).join("");
  }
  $("#dates").addEventListener("click", (e) => {
    const b = e.target.closest(".day");
    if (!b || b.disabled) return;
    state.date = b.dataset.date;
    state.time = null;
    renderDates(false);
    renderTimes();
    renderSummary();
  });

  /* ---------- Times ---------- */
  function renderTimes() {
    const el = $("#times");
    if (!state.tier || !state.date || !state.days) { el.innerHTML = '<div class="empty">Pick a day to see open times.</div>'; return; }
    const slots = state.days[state.date] || [];
    el.innerHTML = slots.length
      ? '<div class="times">' + slots.map((t) => '<button type="button" class="time" data-time="' + t + '" aria-pressed="' + (state.time === t) + '">' + fmtTime(t) + "</button>").join("") + "</div>"
      : '<div class="empty">Nothing open that day. Try another one.</div>';
  }
  $("#times").addEventListener("click", (e) => {
    const b = e.target.closest(".time");
    if (!b) return;
    state.time = b.dataset.time;
    renderTimes();
    renderSummary();
  });

  /* ---------- Summary ---------- */
  function renderSummary() {
    const t = state.tier, rem = $("#f-removal").checked;
    $("#sTier").textContent = t ? t.tag + " " + t.name : "Not chosen";
    $("#sLen").textContent = t ? fmtDur(t.mins) : "Not chosen";
    $("#sWhen").textContent = state.date && state.time ? dayInfo(state.date).long + ", " + fmtTime(state.time) : "Not chosen";
    $("#sRem").textContent = rem ? "Yes, $" + CONFIG.REMOVAL_FEE : "None";
    $("#sDep").textContent = "$" + CONFIG.DEPOSIT;
    $("#sCash").textContent = t ? "$" + cash(t, rem) : "Not chosen";
  }
  $("#f-removal").addEventListener("change", renderSummary);

  /* ---------- Submit ---------- */
  const form = $("#bookForm"), btn = $("#submitBtn");
  const resetBtn = () => { btn.disabled = false; btn.textContent = "Reserve my spot"; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const toTop = () => $("#bookCard").scrollIntoView();

  // A calendar file the client can open to save the appointment. Uses the clock time as written,
  // with no time zone, so it lands at the same hour on the client's calendar.
  function calendarHref(t, rem) {
    const [y, m, d] = state.date.split("-");
    const [hh, mm] = state.time.split(":").map(Number);
    const endMin = hh * 60 + mm + t.mins;
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:Nails by Amar booking", "BEGIN:VEVENT",
      "UID:" + stamp + "." + Math.random().toString(36).slice(2) + "@nailsbyamar",
      "DTSTAMP:" + stamp,
      "DTSTART:" + y + m + d + "T" + pad2(hh) + pad2(mm) + "00",
      "DTEND:" + y + m + d + "T" + pad2(Math.floor(endMin / 60)) + pad2(endMin % 60) + "00",
      "SUMMARY:Nails by Amar (" + t.tag + ")",
      "LOCATION:Airport Rd & Countryside Dr\\, Brampton\\, Ontario L6P 0V3",
      "DESCRIPTION:Bring $" + cash(t, rem) + " in cash. Deposit of $" + CONFIG.DEPOSIT + " goes by Interac etransfer to " + CONFIG.ETRANSFER_EMAIL + ". Appointments may take 2+ hours. Park on the road side.",
      "END:VEVENT", "END:VCALENDAR"
    ];
    return "data:text/calendar;charset=utf-8," + encodeURIComponent(lines.join("\r\n"));
  }
  const pad2 = (n) => String(n).padStart(2, "0");

  function showDone(opts) {
    const t = state.tier, rem = $("#f-removal").checked;
    const hours = opts.holdHours != null ? opts.holdHours : CONFIG.DEPOSIT_HOURS;
    form.hidden = true;
    $("#done").hidden = false;
    $("#doneTitle").textContent = opts.preview ? "Preview complete." : "Your spot is reserved.";
    $("#doneWhen").textContent = t.tag + " " + t.name + " on " + dayInfo(state.date).long + " at " + fmtTime(state.time) + ".";
    $("#doneAmt").textContent = CONFIG.DEPOSIT;
    $("#doneBy").textContent = hours ? " within " + hours + " hours, or your spot is released to someone else." : ".";
    $("#doneEmail").textContent = CONFIG.ETRANSFER_EMAIL;
    $("#doneCash").textContent = "$" + cash(t, rem);
    $("#doneNote").textContent = opts.preview
      ? "This site is in preview mode. Nothing was booked and nothing was sent to a calendar."
      : "Amar will confirm once your etransfer arrives.";
    $("#icsLink").href = calendarHref(t, rem);
    toTop();
  }

  $("#copyPay").addEventListener("click", async (e) => {
    const b = e.currentTarget;
    try { await navigator.clipboard.writeText(CONFIG.ETRANSFER_EMAIL); b.textContent = "Copied"; }
    catch (_) {
      const r = document.createRange(); r.selectNodeContents($("#doneEmail"));
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      b.textContent = "Press copy";
    }
    setTimeout(() => { b.textContent = "Copy email"; }, 2000);
  });

  function refreshAfterConflict() {
    const keep = state.date;
    loadDays(state.tier, true).then((days) => {
      state.days = days;
      state.date = keep && days[keep] && days[keep].length ? keep : null;
      renderDates(false); renderTimes(); renderSummary();
    }).catch(() => {});
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg("");
    if (!state.tier) return msg("Choose a tier first.", "err");
    if (!state.date || !state.time) return msg("Pick a day and a time.", "err");
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const payload = {
      service: state.tier.id, date: state.date, time: state.time,
      name: $("#f-name").value.trim(), phone: $("#f-phone").value.trim(), email: $("#f-email").value.trim(),
      notes: $("#f-notes").value.trim(), removal: $("#f-removal").checked, agree: true
    };
    btn.disabled = true;
    btn.textContent = "Booking…";
    if (!CONFIG.API_BASE) { await sleep(600); showDone({ preview: true }); return; }
    try {
      const r = await fetch(CONFIG.API_BASE + "/book", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409) {
        state.time = null;
        refreshAfterConflict();
        resetBtn();
        return msg("That time was just taken. Pick another time.", "err");
      }
      if (!r.ok) {
        const e = new Error(j.error || "Something went wrong.");
        e.plain = r.status < 500 && !!j.error; // a clear message from the server, shown as is
        throw e;
      }
      showDone({ holdHours: j.holdHours });
    } catch (err) {
      resetBtn();
      const text = err && err.message ? err.message : "Could not book.";
      msg(err && err.plain ? text : text + " Try again, or use the Setmore link below.", "err");
    }
  });
  $("#againBtn").addEventListener("click", () => {
    form.reset(); form.hidden = false; $("#done").hidden = true; resetBtn();
    state.date = null; state.time = null;
    if (state.tier) selectTier(state.tier.id); else { renderDates(); renderTimes(); renderSummary(); }
  });

  /* ---------- Start: preselect a tier from the link, for example book.html?tier=tier2 ---------- */
  const wanted = new URLSearchParams(location.search).get("tier");
  if (wanted && tierById(wanted)) selectTier(wanted); else renderSummary();
})();
