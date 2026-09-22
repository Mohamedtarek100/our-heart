/* ============================================================
   Our Heart — Relationship Lock experience
   ------------------------------------------------------------
   Exported:
     mountRelationshipLock(mountEl, { state })

   All data is SERVER-AUTHORITATIVE:
     - countdown deadline + server time come from the backend
     - today's question/ownership comes from the backend
     - answers are saved server-side and only then reflected
     - journey + historical days come from the backend

   Nothing here is a security boundary. The backend enforces every
   rule (ownership, one-answer-per-day, no future answers, lock).
   ============================================================ */

const API_BASE = "https://ourheartfunctions2026.azurewebsites.net/api";

/* --------------------------- the exact message ---------------------------
   Preserved verbatim from the specification (the split below only groups
   it for the staggered reveal; the text itself is unchanged). */
const MAIN_MESSAGE =
  "تم ايقاف الويب يا روحي انتي , بحبك يا حياتي, هيظرهلك سؤال هتدخلي تجاوبي عليه كل يوم يا صغننه " +
  "وانا هيبقي عندي سؤال هدخل اجاوب عليه كل يوم يا قلبي انا وبالنسبه هنقول لبعض تصبح علي خير ازاي " +
  "هتبقي نوت علي الانستا يا صغننه قبل ما ننام";

/* Smaller, softer line that settles in just under the main message. */
const MAIN_SUBTITLE = "بموت فيكي يا نونتي مليش غيرك";

/* The private note revealed by the "ملاحظة" control. Verbatim. */
const NOTE_TEXT =
  "علفكره انا علطول كنت بحس انك بتحبيني احنا ملناش غير بعض يا عمري انا";

/* The second, separate surprise ("مفاجأة صغيرة"). Verbatim. */
const SURPRISE_TEXT = "انتي اعظم واجمل واحلي فنانه في حياتي";

/* Split the message into natural phrases for a staggered reveal.
   This does NOT alter the wording: we split on sentence terminators while
   KEEPING the whitespace that follows, so join("") reconstructs
   MAIN_MESSAGE byte-for-byte. A safety assertion below falls back to a
   single phrase if that ever stops being true. */
const MESSAGE_PHRASES = MAIN_MESSAGE
  .split(/(?<=\.\s)(?=\S)/)
  .filter((part) => part.length > 0);

// Safety: if the split ever loses or alters a character, render the raw
// message as one phrase rather than showing something changed.
if (MESSAGE_PHRASES.join("") !== MAIN_MESSAGE) {
  MESSAGE_PHRASES.length = 0;
  MESSAGE_PHRASES.push(MAIN_MESSAGE);
}

const MONTH_NAMES_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"
];

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function prefersReducedMotion() {
  return typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* Time offset between server clock and device clock (ms). Applied so a
   tampered device clock cannot shift the deadline: we always measure
   against the SERVER's notion of "now". */
let serverOffsetMs = 0;

function serverNow() {
  return Date.now() + serverOffsetMs;
}

function syncServerTime(serverTime) {
  const value = Number(serverTime);
  if (Number.isFinite(value) && value > 0) {
    serverOffsetMs = value - Date.now();
  }
}

async function apiGet(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`${path} -> ${response.status}`);
  return response.json();
}

async function apiPost(path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, payload };
}

function formatDateAr(dateIso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateIso || ""));
  if (!match) return dateIso;
  const day = Number(match[3]);
  const month = MONTH_NAMES_AR[Number(match[2]) - 1] || "";
  const year = match[1];
  return `${day} ${month} ${year}`;
}

/* ------------------------------------------------------------------ */
/* Countdown — absolute deadline vs SERVER time                        */
/* ------------------------------------------------------------------ */

let deadlineMs = 0;
let countdownTimer = 0;
let lastRendered = { months: null, days: null, hours: null, minutes: null, seconds: null };

/* Remaining time to the absolute server deadline, split into FIVE units.

   MONTHS are CALENDAR months (not a fixed 30-day block): we walk forward
   month-by-month from "now" while the deadline is still reachable, then the
   remainder in days/hours/minutes/seconds is derived from the exact
   millisecond difference. Everything is DERIVED from the deadline on every
   tick, so a changed device clock cannot shift it and it cannot drift.

   The result is monotonic decreasing: each month step consumes a real
   calendar month, and the leftover days are always < the length of the
   next calendar month. */
function computeRemaining(deadline, now) {
  let diff = deadline - now;
  if (!Number.isFinite(diff) || diff < 0) diff = 0;

  // Count whole calendar months between now and the deadline.
  let months = 0;
  const cursor = new Date(now);
  while (true) {
    const next = new Date(cursor);
    next.setMonth(next.getMonth() + 1); // calendar-aware (handles 28/30/31)
    if (next.getTime() <= deadline) {
      months += 1;
      cursor.setTime(next.getTime());
      // Safety bound: the deadline is ~2027; never loop indefinitely.
      if (months > 600) break;
    } else {
      break;
    }
  }

  // Exact remainder after the whole months were consumed.
  const remainderMs = Math.max(0, deadline - cursor.getTime());
  const totalSeconds = Math.floor(remainderMs / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  const hours = totalHours % 24;
  const days = Math.floor(totalHours / 24);

  return { months, days, hours, minutes, seconds };
}

function renderCountdown(root) {
  const grid = root.querySelector(".lock-countdown");
  const doneEl = root.querySelector(".lock-count-done");
  if (!grid) return;

  const render = () => {
    if (!deadlineMs) return;
    const remaining = computeRemaining(deadlineMs, serverNow());
    const totalRemaining =
      remaining.months * 30 * 86400 +
      remaining.days * 86400 +
      remaining.hours * 3600 +
      remaining.minutes * 60 +
      remaining.seconds;

    if (totalRemaining <= 0) {
      grid.classList.add("is-finished");
      if (doneEl) doneEl.hidden = false;
      if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = 0; }
      return;
    }

    const values = {
      months: remaining.months,
      days: remaining.days,
      hours: remaining.hours,
      minutes: remaining.minutes,
      seconds: remaining.seconds
    };

    Object.entries(values).forEach(([key, value]) => {
      const cell = grid.querySelector(`[data-count="${key}"]`);
      if (!cell) return;
      const valueEl = cell.querySelector(".lock-count-value");
      if (!valueEl) return;
      const text = String(value).padStart(2, "0");
      if (valueEl.textContent !== text) {
        valueEl.textContent = text;
        if (lastRendered[key] !== null && !prefersReducedMotion()) {
          valueEl.classList.remove("is-ticking");
          // Force reflow so the tick animation restarts reliably.
          void valueEl.offsetWidth;
          valueEl.classList.add("is-ticking");
        }
        lastRendered[key] = value;
      }
    });
  };

  render();
  // Recompute every second from the ABSOLUTE deadline — never decrement.
  // Using serverNow() also means browser throttling / backgrounding /
  // device-clock changes cannot make it drift.
  countdownTimer = setInterval(render, 1000);

  // Recompute immediately when the tab becomes visible again.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) render();
  });
}

function stopCountdown() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = 0; }
}

/* ------------------------------------------------------------------ */
/* Ambient particles                                                   */
/* ------------------------------------------------------------------ */

let particleRaf = 0;

function startAmbientParticles(root) {
  const canvas = root.querySelector(".lock-particles");
  if (!canvas || !canvas.getContext) return;
  const reduced = prefersReducedMotion();
  const ctx = canvas.getContext("2d", { alpha: true });

  let dpr = 1;
  let particles = [];
  let running = true;

  const profile = {
    small: Math.min(window.innerWidth, window.innerHeight) < 500,
    cores: navigator.hardwareConcurrency || 4
  };

  function budget() {
    let target = Math.round((window.innerWidth * window.innerHeight) / 16000);
    target = Math.min(target, 48);
    if (profile.small) target = Math.min(target, 26);
    if (profile.cores <= 2) target = Math.min(target, 18);
    return Math.max(10, target);
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
    canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawn() {
    const count = reduced ? 0 : budget();
    particles = [];
    for (let i = 0; i < count; i += 1) {
      particles.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        r: 0.6 + Math.random() * 1.6,
        vx: (Math.random() - 0.5) * 0.14,
        vy: -0.05 - Math.random() * 0.22,
        a: 0.1 + Math.random() * 0.4,
        tw: Math.random() * Math.PI * 2,
        tws: 0.008 + Math.random() * 0.02
      });
    }
  }

  function frame() {
    if (!running) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);

    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.tw += p.tws;

      if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
      if (p.x < -10) p.x = w + 10;
      else if (p.x > w + 10) p.x = -10;

      const alpha = p.a * (0.5 + 0.5 * Math.sin(p.tw));
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 214, 232, " + alpha.toFixed(3) + ")";
      ctx.fill();
    }

    particleRaf = requestAnimationFrame(frame);
  }

  resize();
  spawn();
  if (particles.length) particleRaf = requestAnimationFrame(frame);

  const onResize = () => { resize(); spawn(); };
  window.addEventListener("resize", onResize);

  // Expose a teardown so logout can stop the loop.
  root._teardownParticles = () => {
    running = false;
    if (particleRaf) cancelAnimationFrame(particleRaf);
    particleRaf = 0;
    window.removeEventListener("resize", onResize);
    particles = [];
    canvas.width = 1;
    canvas.height = 1;
  };
}

/* ------------------------------------------------------------------ */
/* Celebration — cinematic fireworks + hearts                          */
/* ------------------------------------------------------------------ */

function runCelebration(root) {
  const canvas = root.querySelector(".lock-fireworks");
  if (!canvas || !canvas.getContext) return;

  const reduced = prefersReducedMotion();
  const ctx = canvas.getContext("2d", { alpha: true });
  const small = Math.min(window.innerWidth, window.innerHeight) < 500;

  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  canvas.classList.add("is-active");

  const particles = [];
  const hearts = [];
  let rafId = 0;
  let startTime = performance.now();
  const DURATION = reduced ? 1400 : small ? 2800 : 3600;

  function spawnBurst(cx, cy, count, power) {
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.25;
      const speed = (1.4 + Math.random() * 2.6) * power;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: 1 + Math.random() * 1.9,
        life: 1,
        decay: 0.008 + Math.random() * 0.012,
        hue: Math.random() < 0.5 ? "255, 150, 190" : "247, 197, 140"
      });
    }
  }

  function spawnHearts(cx, cy, count) {
    for (let i = 0; i < count; i += 1) {
      hearts.push({
        x: cx + (Math.random() - 0.5) * 120,
        y: cy + (Math.random() - 0.5) * 60,
        vy: -0.6 - Math.random() * 0.9,
        vx: (Math.random() - 0.5) * 0.5,
        size: 9 + Math.random() * 16,
        life: 1,
        decay: 0.006 + Math.random() * 0.008,
        glyph: Math.random() < 0.5 ? "♥" : "♡"
      });
    }
  }

  const cx = window.innerWidth / 2;
  const cy = window.innerHeight * 0.42;

  if (!reduced) {
    spawnBurst(cx, cy, small ? 34 : 64, 1);
    spawnHearts(cx, cy, small ? 6 : 12);
    setTimeout(() => spawnBurst(cx * 0.72, cy * 0.82, small ? 24 : 42, 0.85), 420);
    setTimeout(() => spawnBurst(cx * 1.28, cy * 0.7, small ? 22 : 40, 0.9), 760);
    setTimeout(() => spawnHearts(cx, cy * 0.8, small ? 5 : 10), 980);
    setTimeout(() => spawnBurst(cx, cy * 0.62, small ? 20 : 36, 0.75), 1280);
  } else {
    spawnHearts(cx, cy, 8);
  }

  function frame(now) {
    const elapsed = now - startTime;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);

    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.014;        // gentle gravity
      p.vx *= 0.988;
      p.vy *= 0.988;
      p.life -= p.decay;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(" + p.hue + ", " + (p.life * 0.9).toFixed(3) + ")";
      ctx.fill();
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = hearts.length - 1; i >= 0; i -= 1) {
      const hrt = hearts[i];
      hrt.x += hrt.vx;
      hrt.y += hrt.vy;
      hrt.vx += Math.sin((now / 600) + i) * 0.01;
      hrt.life -= hrt.decay;
      if (hrt.life <= 0) { hearts.splice(i, 1); continue; }
      ctx.font = hrt.size + "px serif";
      ctx.fillStyle = "rgba(255, 170, 205, " + (hrt.life * 0.85).toFixed(3) + ")";
      ctx.fillText(hrt.glyph, hrt.x, hrt.y);
    }

    if (elapsed < DURATION || particles.length || hearts.length) {
      rafId = requestAnimationFrame(frame);
    } else {
      canvas.classList.remove("is-active");
      ctx.clearRect(0, 0, w, h);
    }
  }

  rafId = requestAnimationFrame(frame);

  root._teardownFireworks = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    canvas.classList.remove("is-active");
  };
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function buildShell() {
  const phrasesHtml = MESSAGE_PHRASES
    .map((phrase) => `<span class="lock-phrase">${escapeHtml(phrase)}</span>`)
    .join("");

  return `
    <div class="lock-bg" aria-hidden="true"></div>
    <div class="lock-glow" aria-hidden="true"></div>
    <canvas class="lock-particles" aria-hidden="true"></canvas>
    <div class="lock-vignette" aria-hidden="true"></div>
    <canvas class="lock-fireworks" aria-hidden="true"></canvas>

    <div class="lock-content">

      <!-- 1. HEART / AMBIENT HEADER + MAIN MESSAGE + SUBTITLE + NOTES -->
      <section class="lock-message" aria-label="رسالة">
        <span class="lock-heart-mark"><span>❤️</span></span>
        <p class="lock-message-text">${phrasesHtml}</p>
        <p class="lock-subtitle">${escapeHtml(MAIN_SUBTITLE)}</p>

        <div class="lock-notes">
          <button type="button" class="lock-note-btn" data-note="main" aria-label="افتحي الملاحظة">
            <span class="lock-note-icon" aria-hidden="true">♡</span>
            <span class="lock-note-label">ملاحظة</span>
            <span class="lock-note-hint">اضغطي هنا شطورتي</span>
          </button>
          <button type="button" class="lock-note-btn lock-note-btn--alt" data-note="surprise" aria-label="افتحي المفاجأة">
            <span class="lock-note-icon" aria-hidden="true">✦</span>
            <span class="lock-note-label">مفاجأة صغيرة</span>
          </button>
        </div>
      </section>

      <!-- PRESENCE STRIP (real server data) -->
      <section class="lock-presence" aria-label="الحالة">
        <span class="lock-presence-item" data-user="Mohamed">
          <span class="lock-presence-dot" aria-hidden="true"></span>
          <span class="lock-presence-user">Mohamed</span>
          <span class="lock-presence-text">…</span>
        </span>
        <span class="lock-presence-item" data-user="Yomna">
          <span class="lock-presence-dot" aria-hidden="true"></span>
          <span class="lock-presence-user">Yomna</span>
          <span class="lock-presence-text">…</span>
        </span>
      </section>

      <!-- 2. COUNTDOWN -->
      <section class="lock-section lock-countdown-section" aria-label="الوقت المتبقي">
        <h2 class="lock-section-title">الوقت المتبقي</h2>
        <div class="lock-countdown">
          <div class="lock-count-cell" data-count="months">
            <span class="lock-count-value">00</span>
            <span class="lock-count-label">MONTHS</span>
          </div>
          <div class="lock-count-cell" data-count="days">
            <span class="lock-count-value">00</span>
            <span class="lock-count-label">DAYS</span>
          </div>
          <div class="lock-count-cell" data-count="hours">
            <span class="lock-count-value">00</span>
            <span class="lock-count-label">HOURS</span>
          </div>
          <div class="lock-count-cell" data-count="minutes">
            <span class="lock-count-value">00</span>
            <span class="lock-count-label">MINUTES</span>
          </div>
          <div class="lock-count-cell is-final" data-count="seconds">
            <span class="lock-count-value">00</span>
            <span class="lock-count-label">SECONDS</span>
          </div>
        </div>
        <p class="lock-count-target">
          <span class="lock-count-until">UNTIL</span>
          <span class="lock-count-date">25/07/2027</span>
        </p>
        <p class="lock-count-done" hidden>وصلنا ❤️</p>
      </section>

      <!-- 3. DAILY QUESTION (always has a heading; never a silent hole) -->
      <section class="lock-section lock-questions-section" aria-label="اختبار اليوم">
        <h2 class="lock-section-title">اختبار اليوم</h2>
        <div class="lock-questions" aria-live="polite">
          <p class="lock-questions-loading">جارٍ تحميل سؤال اليوم…</p>
        </div>
      </section>

      <!-- 4. TODAY STATUS -->
      <section class="lock-section" aria-label="حالة اليوم">
        <h2 class="lock-section-title">حالة اليوم</h2>
        <div class="lock-today"></div>
      </section>

      <!-- 5. JOURNEY -->
      <section class="lock-section lock-journey" aria-label="رحلة الأيام">
        <h2 class="lock-section-title">رحلة الأيام</h2>
        <div class="lock-progress"></div>
        <div class="lock-months"></div>
      </section>

      <!-- CONTROLS -->
      <div class="lock-footer">
        <button type="button" class="lock-intro-btn" onclick="replayLoveIntro()">❤️ Love Intro</button>
        <button type="button" class="lock-account-btn" onclick="changeUser()">🔄 change account</button>
      </div>
      <p class="lock-footnote">مساحة خاصة لقلبين فقط ❤️</p>
    </div>

    <!-- PRIVATE NOTE PANELS (two distinct surprises) -->
    <div class="lock-note-backdrop"></div>
    <div class="lock-note-panel" data-note-panel="main" role="dialog" aria-modal="true" aria-label="ملاحظة خاصة" aria-hidden="true">
      <button type="button" class="lock-note-close" aria-label="إغلاق الملاحظة">×</button>
      <div class="lock-note-inner">
        <span class="lock-note-heart" aria-hidden="true">♥</span>
        <p class="lock-note-text">${escapeHtml(NOTE_TEXT)}</p>
      </div>
    </div>
    <div class="lock-note-panel lock-note-panel--surprise" data-note-panel="surprise" role="dialog" aria-modal="true" aria-label="مفاجأة" aria-hidden="true">
      <button type="button" class="lock-note-close" aria-label="إغلاق">×</button>
      <div class="lock-note-inner">
        <span class="lock-note-heart lock-note-sparkle" aria-hidden="true">✦</span>
        <p class="lock-note-text lock-note-text--surprise">${escapeHtml(SURPRISE_TEXT)}</p>
      </div>
    </div>

    <div class="lock-day-backdrop"></div>
    <div class="lock-day-panel" role="dialog" aria-modal="true" aria-label="تفاصيل اليوم" aria-hidden="true">
      <div class="lock-day-panel-head">
        <div>
          <span class="lock-day-panel-title">تفاصيل اليوم</span>
          <span class="lock-day-panel-date"></span>
        </div>
        <button type="button" class="lock-day-panel-close" aria-label="إغلاق">×</button>
      </div>
      <div class="lock-day-entries"></div>
    </div>
  `;
}

/* ---- today's question ---- */

/* Renders the CURRENT user's assigned question. Robustness rules:
   - Never leave a silent empty hole: if the server did not supply a
     question (or the fetch failed) we show an explicit, styled notice.
   - The heading is on the section in the shell, so the block is always
     anchored in the composition.
   - Ownership text ("سؤالك اليوم") comes from the SERVER-provided prompt;
     the client never decides ownership. */
/* Renders a deliberate section state (loading / error / empty) with an
   optional Retry action. Used so no section is ever a silent blank hole.
   The retry re-fetches over the EXISTING session — it never reloads the
   page and never fabricates content. */
function renderSectionState(container, kind, message, onRetry) {
  if (!container) return;
  container.replaceChildren();

  const wrap = document.createElement("div");
  wrap.className = `lock-state lock-state--${kind}`;

  if (kind === "loading") {
    wrap.innerHTML = `
      <span class="lock-state-spinner" aria-hidden="true"></span>
      <span class="lock-state-text">${escapeHtml(message)}</span>
    `;
  } else {
    wrap.innerHTML = `<span class="lock-state-text">${escapeHtml(message)}</span>`;
    if (typeof onRetry === "function") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lock-state-retry";
      btn.textContent = "حاولي تاني";
      btn.addEventListener("click", onRetry);
      wrap.appendChild(btn);
    }
  }

  container.appendChild(wrap);
}

/* Structured, non-sensitive diagnostics (no tokens, no cookies, no codes). */
function logApiIssue(code, detail) {
  console.warn(`[Our Heart] ${code}`, detail || "");
}

function renderQuestions(root, today, onAnswered, options = {}) {
  const { failed = false, errorCode = "QUESTION_UNAVAILABLE" } = options;
  const container = root.querySelector(".lock-questions");
  if (!container) return;

  // Do NOT tear down a card the user has already answered while a background
  // refresh is in flight (that would discard its confirmed state).
  if (options.skipQuestionRender) return;

  if (!today || !today.myQuestion || !Array.isArray(today.myQuestion.options)) {
    if (failed) {
      logApiIssue(errorCode);
      renderSectionState(
        container,
        "error",
        "تعذر تحميل سؤال اليوم. تأكدي من الاتصال وحاولي تاني.",
        () => refreshToday(root).then(() => root._refreshJourney?.())
      );
    } else {
      renderSectionState(container, "empty", "لسه مفيش سؤال متاح ليكي النهاردة.");
    }
    return;
  }

  container.replaceChildren();

  const mine = today.myQuestion;
  const myAnswer = today.myAnswer || { answered: false };

  const card = document.createElement("div");
  card.className = "lock-question";

  const answered = !!myAnswer.answered;
  if (answered) card.classList.add("is-locked-question");

  const optionsHtml = mine.options.map((option, index) => {
    const isChosen = answered && myAnswer.answerId === option.id;
    const disabled = answered ? "disabled" : "";
    return `
      <button
        type="button"
        class="lock-option${isChosen ? " is-chosen" : ""}"
        data-answer="${escapeHtml(option.id)}"
        style="--option-index:${index}"
        ${disabled}
      >
        <span class="lock-option-check" aria-hidden="true">✓</span>
        <span>${escapeHtml(option.label)}</span>
      </button>
    `;
  }).join("");

  card.innerHTML = `
    <div class="lock-question-head">
      <span class="lock-question-owner">
        <span class="lock-owner-dot" aria-hidden="true"></span>
        سؤالك اليوم
      </span>
    </div>
    <p class="lock-question-hint">
      ${answered
      ? "سُجّلت إجابتك لهذا اليوم ❤️"
      : "اختار إجابتك النهاردة — يوم واحد بس لكل يوم."}
    </p>
    <div class="lock-options">${optionsHtml}</div>
    <p class="lock-question-status${answered ? " is-confirmed" : ""}" aria-live="polite">
      ${answered ? "تم الحفظ ✓" : ""}
    </p>
    ${answered ? `<p class="lock-next-checkin">أشوفك بكرة تاني هنا ❤️</p>` : ""}
  `;

  container.appendChild(card);

  if (answered) return;

  const statusEl = card.querySelector(".lock-question-status");
  const optionButtons = [...card.querySelectorAll(".lock-option")];
  let submitting = false;

  optionButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      if (submitting) return;
      const answerId = button.dataset.answer;
      if (!answerId) return;

      submitting = true;
      optionButtons.forEach((other) => { other.disabled = true; });
      // Optimistic SELECTION styling only — never a claim of success.
      button.classList.add("is-selected");
      if (statusEl) {
        statusEl.textContent = "جارٍ الحفظ…";
        statusEl.className = "lock-question-status is-pending";
      }

      try {
        const { ok, status, payload } = await apiPost("/relationship/answer", { answerId });

        if (ok && payload && payload.confirmed) {
          // Backend confirmed — NOW we finalize the UI.
          if (statusEl) {
            statusEl.textContent = "تم الحفظ ✓";
            statusEl.className = "lock-question-status is-confirmed";
          }
          optionButtons.forEach((other) => {
            other.classList.remove("is-selected");
            other.classList.toggle("is-chosen", other === button);
            other.classList.add("is-disabled");
          });
          card.classList.add("is-locked-question");

          // Add the gentle "see you tomorrow" line now that the answer is
          // confirmed by the server (it never shows before that).
          if (!card.querySelector(".lock-next-checkin")) {
            const next = document.createElement("p");
            next.className = "lock-next-checkin";
            next.textContent = "أشوفك بكرة تاني هنا ❤️";
            card.appendChild(next);
          }

          // Celebrate ONLY after backend confirmation, and only when the
          // SERVER decided this answer is positive.
          if (payload.celebration) runCelebration(root);

          // Update today's status + journey from server-authoritative data.
          syncServerTime(payload.serverTime);
          if (typeof onAnswered === "function") {
            onAnswered(payload);
          }
          return;
        }

        if (status === 409) {
          if (statusEl) {
            statusEl.textContent = "لقد أجبتم اليوم بالفعل ❤️";
            statusEl.className = "lock-question-status is-confirmed";
          }
          if (typeof onAnswered === "function") onAnswered(null);
          return;
        }

        // Any other failure: revert, stay unanswered, allow retry.
        throw new Error((payload && payload.error) || `answer ${status}`);
      } catch (error) {
        console.error("Answer submission failed:", error);
        button.classList.remove("is-selected");
        optionButtons.forEach((other) => { other.disabled = false; });
        submitting = false;
        if (statusEl) {
          statusEl.textContent = "تعذّر الحفظ. حاولي مرة أخرى.";
          statusEl.className = "lock-question-status is-error";
        }
      }
    });
  });
}

/* ---- today's status ---- */

/* Formats a server presence entry into an elegant line. The online flag is
   decided by the SERVER (heartbeat freshness); dayOffset is also computed
   on the server in the app timezone, so the device clock cannot skew it. */
function formatPresence(entry) {
  if (!entry) return { text: "", online: false };
  if (entry.online) return { text: "Online", online: true };

  const lastSeen = Number(entry.lastSeen) || 0;
  if (!lastSeen) return { text: "Offline", online: false };

  const time = new Date(lastSeen).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (entry.dayOffset === 0) return { text: `Last seen today at ${time}`, online: false };
  if (entry.dayOffset === 1) return { text: `Last seen yesterday at ${time}`, online: false };

  const d = new Date(lastSeen);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return { text: `Last seen ${dd}/${mm}/${yyyy} at ${time}`, online: false };
}

/* Paints the server summary into the lock's presence strip. */
function renderPresenceStatus(summary) {
  if (!summary) return;
  ["Mohamed", "Yomna"].forEach((user) => {
    const item = document.querySelector(`.lock-presence-item[data-user="${user}"]`);
    if (!item) return;
    const state = formatPresence(summary[user]);
    item.classList.toggle("is-online", state.online);
    const textEl = item.querySelector(".lock-presence-text");
    if (textEl && textEl.textContent !== state.text) textEl.textContent = state.text;
  });
}

function renderTodayStatus(root, today) {
  const container = root.querySelector(".lock-today");
  if (!container) return;
  if (!today) {
    renderSectionState(
      container,
      "error",
      "تعذر تحميل حالة اليوم. حاولي تاني.",
      () => refreshToday(root, { skipQuestionRender: true })
    );
    return;
  }
  container.replaceChildren();

  const myAnswer = today.myAnswer || { answered: false };
  const partnerAnswer = today.partner || { answered: false };

  const people = [
    {
      name: today.currentUser || "أنا",
      answered: !!myAnswer.answered,
      label: myAnswer.answerLabel
    },
    {
      name: today.partner?.user || "الطرف الآخر",
      answered: !!partnerAnswer.answered,
      label: partnerAnswer.answerLabel
    }
  ];

  people.forEach((person) => {
    const el = document.createElement("div");
    el.className = "lock-today-person" + (person.answered ? " is-answered" : "");
    el.innerHTML = `
      <span class="lock-today-name">${escapeHtml(person.name)}</span>
      <span class="lock-today-state">${person.answered ? "✓ Answered" : "○ Waiting"}</span>
      ${person.answered && person.label
        ? `<span class="lock-today-answer">"${escapeHtml(person.label)}"</span>`
        : ""}
    `;
    container.appendChild(el);
  });
}

/* ------------------------------------------------------------------ */
/* Private note panel                                                  */
/* ------------------------------------------------------------------ */

/* Cinematic "open a private note" interaction for the TWO notes. Each
   button opens only its own panel; the texts are fixed (NOTE_TEXT /
   SURPRISE_TEXT) and revealed blur-to-sharp. Closable by the button, the
   × , the backdrop, or Escape. */
function initNotePanel(root) {
  const backdrop = root.querySelector(".lock-note-backdrop");
  if (!backdrop) return;

  const buttons = [...root.querySelectorAll(".lock-note-btn")];
  const panels = [...root.querySelectorAll(".lock-note-panel")];
  if (!buttons.length || !panels.length) return;

  const panelFor = (name) => panels.find((p) => p.dataset.notePanel === name) || null;
  let active = null;

  const close = (restoreFocus = true) => {
    if (!active) return false;
    const { panel, button, textEl } = active;
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
    backdrop.classList.remove("is-open");
    button?.classList.remove("is-active");
    if (textEl) textEl.classList.remove("is-shown");
    active = null;
    if (restoreFocus) button?.focus?.();
    return true;
  };

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const panel = panelFor(button.dataset.note);
      if (!panel) return;

      // Only one panel at a time.
      close(false);

      const textEl = panel.querySelector(".lock-note-text");
      button.classList.add("is-active");
      panel.classList.add("is-open");
      panel.setAttribute("aria-hidden", "false");
      backdrop.classList.add("is-open");
      active = { panel, button, textEl };

      // Re-trigger the blur-to-sharp reveal every time it opens.
      if (textEl) {
        textEl.classList.remove("is-shown");
        void textEl.offsetWidth;
        requestAnimationFrame(() => textEl.classList.add("is-shown"));
      }
      panel.querySelector(".lock-note-close")?.focus?.();
    });
  });

  panels.forEach((panel) => {
    panel.querySelector(".lock-note-close")?.addEventListener("click", () => close());
  });
  backdrop.addEventListener("click", () => close());

  // Shared hooks used by the ESC handler in the mount.
  root._closeNote = () => close();
  root._noteIsOpen = () => !!active;
}

/* ---- journey ---- */

function renderProgress(root, progress) {
  const container = root.querySelector(".lock-progress");
  if (!container || !progress) return;
  container.innerHTML = `
    <div class="lock-progress-item"><b>${progress.completedDays}</b><span>أيامنا المكتملة</span></div>
    <div class="lock-progress-item"><b>${progress.elapsedDays}</b><span>أيام الانتظار</span></div>
  `;
}

function renderJourney(root, journey, onOpenDay) {
  const container = root.querySelector(".lock-months");
  if (!container || !journey) return;
  container.replaceChildren();

  (journey.months || []).forEach((month) => {
    const [year, monthNum] = String(month.key).split("-");
    const monthName = MONTH_NAMES_AR[Number(monthNum) - 1] || monthNum;

    const section = document.createElement("div");
    section.className = "lock-month";
    // Open the month containing today by default.
    const hasToday = month.days.some((day) => day.isToday);

    section.innerHTML = `
      <button type="button" class="lock-month-head" aria-expanded="false">
        <span>${escapeHtml(monthName)} ${escapeHtml(year)}</span>
        <span class="lock-month-meta">
          <span>${month.days.length} يوم</span>
          <span class="lock-month-caret" aria-hidden="true">›</span>
        </span>
      </button>
      <div class="lock-month-days"></div>
    `;

    const head = section.querySelector(".lock-month-head");
    const daysWrap = section.querySelector(".lock-month-days");

    const openMonth = (isOpen) => {
      section.classList.toggle("is-open", isOpen);
      head.setAttribute("aria-expanded", String(isOpen));
    };

    head.addEventListener("click", () => {
      openMonth(!section.classList.contains("is-open"));
    });

    // Lazy render the day markers only when the month is first opened.
    let rendered = false;
    const renderDays = () => {
      if (rendered) return;
      rendered = true;
      const line = document.createElement("div");
      line.className = "lock-line-wrap";

      month.days.forEach((day) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "lock-day";
        button.dataset.date = day.date;
        button.textContent = String(day.date).slice(8, 10);

        if (day.isFuture) button.classList.add("is-future");
        else if (day.state === "complete") button.classList.add("is-complete");
        else if (day.state === "partial") button.classList.add("is-partial");
        else button.classList.add("is-unanswered");

        if (day.isToday) button.classList.add("is-today");

        button.setAttribute(
          "aria-label",
          `${formatDateAr(day.date)} — ${day.isFuture ? "قادم" : day.state}`
        );

        if (!day.isFuture) {
          button.addEventListener("click", () => onOpenDay(day.date, button));
        } else {
          button.disabled = true;
        }

        line.appendChild(button);

        if (day.isToday) {
          line.dataset.todayDate = day.date;
        }
      });

      daysWrap.appendChild(line);
    };

    if (hasToday) {
      openMonth(true);
      renderDays();
    }

    // Render on first open too.
    head.addEventListener("click", renderDays);

    container.appendChild(section);
  });

  // Auto-focus today is intentionally NON-disruptive: we only bring the
  // month that contains today into view, and only if the visitor has not
  // already scrolled there themselves. We never yank the whole page away
  // from the main message the visitor is reading.
  const todayButton = container.querySelector(".lock-day.is-today");
  if (todayButton) {
    requestAnimationFrame(() => {
      const rect = todayButton.getBoundingClientRect();
      const alreadyVisible =
        rect.top >= 0 && rect.bottom <= (window.innerHeight || 0);
      if (alreadyVisible) return;

      // Scroll ONLY the journey container, never the page scroll position.
      const scroller = container;
      const targetTop =
        todayButton.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop -
        scroller.clientHeight / 2;
      scroller.scrollTo({
        top: Math.max(0, targetTop),
        behavior: prefersReducedMotion() ? "auto" : "smooth"
      });
    });
  }
}

/* ---- day detail panel ---- */

function openDayPanel(root, day, triggerEl) {
  const panel = root.querySelector(".lock-day-panel");
  const backdrop = root.querySelector(".lock-day-backdrop");
  const entries = root.querySelector(".lock-day-entries");
  const dateEl = root.querySelector(".lock-day-panel-date");
  if (!panel || !entries) return;

  if (dateEl) dateEl.textContent = formatDateAr(day.date);
  entries.replaceChildren();

  const buildEntry = (name, contribution) => {
    const el = document.createElement("div");
    el.className = "lock-day-entry";
    const answered = contribution && contribution.answered;
    el.innerHTML = `
      <span class="lock-day-entry-name">${escapeHtml(name)}</span>
      <span class="lock-day-entry-answer${answered ? "" : " is-empty"}">
        ${answered && contribution.answerLabel
        ? `"${escapeHtml(contribution.answerLabel)}"`
        : "لم تُسجّل إجابة"}
      </span>
    `;
    return el;
  };

  const yomnaEntry = buildEntry("Yomna", day.yomna);
  const mohamedEntry = buildEntry("Mohamed", day.mohamed);
  entries.append(yomnaEntry, mohamedEntry);

  panel.classList.add("is-open");
  backdrop.classList.add("is-open");
  panel.setAttribute("aria-hidden", "false");

  // Staggered reveal of the two answer entries.
  const revealDelay = prefersReducedMotion() ? 0 : 180;
  requestAnimationFrame(() => {
    yomnaEntry.classList.add("is-shown");
    setTimeout(() => mohamedEntry.classList.add("is-shown"), revealDelay);
  });

  const close = () => {
    panel.classList.remove("is-open");
    backdrop.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
    entries.replaceChildren();
    if (triggerEl) triggerEl.focus();
  };

  panel.querySelector(".lock-day-panel-close").onclick = close;
  backdrop.onclick = close;
  panel._close = close;
}

/* ------------------------------------------------------------------ */
/* Refresh today + mark the journey day complete                       */
/* ------------------------------------------------------------------ */

async function refreshToday(root, options = {}) {
  const { skipQuestionRender = false } = options;
  try {
    const today = await apiGet("/relationship/today");
    syncServerTime(today.serverTime);
    if (Number.isFinite(Number(today.deadlineMs)) && Number(today.deadlineMs) > 0) {
      deadlineMs = Number(today.deadlineMs);
    }
    today.currentUser = currentUser;
    renderQuestions(root, today, (payload) => onAnswerConfirmed(root, payload),
      { skipQuestionRender });
    renderTodayStatus(root, today);
    return today;
  } catch (error) {
    // Capture the exact status so the failure is never hidden.
    const status = Number((/->\s*(\d{3})/.exec(error?.message || "") || [])[1]) || 0;
    logApiIssue("TODAY_FETCH_FAILED", { status });
    if (!skipQuestionRender) {
      renderQuestions(root, null, null, { failed: true, errorCode: `TODAY_FETCH_${status || "FAILED"}` });
    }
    renderTodayStatus(root, null);
    return null;
  }
}

let currentUser = "";

/* ------------------------------------------------------------------ */
/* Presence — heartbeat + live status                                  */
/* ------------------------------------------------------------------ */

/* While a trusted user is on the page we send a heartbeat so the server
   keeps their "last seen" fresh. Online/offline is DECIDED BY THE SERVER
   from heartbeat freshness vs server time — the browser clock is never
   trusted and the client can never mark itself online in the data. */
const HEARTBEAT_INTERVAL_MS = 20 * 1000;   // 20s — well inside the 60s window
const PRESENCE_POLL_INTERVAL_MS = 15 * 1000; // refresh the partner's state

let heartbeatTimer = 0;
let presencePollTimer = 0;
let presenceVisibleHandler = null;

async function sendHeartbeat(online = true) {
  try {
    await apiPost("/setPresence", { online });
  } catch (error) {
    // Presence is best-effort; never surface a failure to the visitor.
    console.debug("Presence heartbeat failed:", error);
  }
}

/* Fetches the server-derived summary and paints it into whichever
   presence surfaces are currently mounted (account cards / lock header). */
async function refreshPresenceUi() {
  try {
    const data = await apiGet("/getPresenceSummary");
    renderPresenceStatus(data);
  } catch (error) {
    console.debug("Presence refresh failed:", error);
  }
}

function startPresence(root) {
  // 1) Immediate heartbeat — do NOT wait for the first interval tick.
  sendHeartbeat(true);

  heartbeatTimer = setInterval(() => {
    if (document.hidden) return; // paused in the background
    sendHeartbeat(true);
  }, HEARTBEAT_INTERVAL_MS);

  presencePollTimer = setInterval(() => {
    if (document.hidden) return;
    refreshPresenceUi();
  }, PRESENCE_POLL_INTERVAL_MS);

  // Immediate refresh + heartbeat when the tab becomes visible again.
  presenceVisibleHandler = () => {
    if (document.hidden) return;
    sendHeartbeat(true);
    refreshPresenceUi();
  };
  document.addEventListener("visibilitychange", presenceVisibleHandler);
  window.addEventListener("focus", presenceVisibleHandler);

  // Best-effort hint when leaving. The server treats this as a hint only —
  // heartbeat expiry is the authoritative offline signal.
  root._presenceLeaveHint = () => sendHeartbeat(false);
  window.addEventListener("pagehide", root._presenceLeaveHint);
  window.addEventListener("beforeunload", root._presenceLeaveHint);
}

function stopPresence(root) {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = 0; }
  if (presencePollTimer) { clearInterval(presencePollTimer); presencePollTimer = 0; }
  if (presenceVisibleHandler) {
    document.removeEventListener("visibilitychange", presenceVisibleHandler);
    window.removeEventListener("focus", presenceVisibleHandler);
    presenceVisibleHandler = null;
  }
  if (root?._presenceLeaveHint) {
    window.removeEventListener("pagehide", root._presenceLeaveHint);
    window.removeEventListener("beforeunload", root._presenceLeaveHint);
  }
}

function onAnswerConfirmed(root, payload) {
  void payload;
  // The card has ALREADY been finalized in-place after the backend
  // confirmation, so refresh today WITHOUT re-rendering the question.
  // Then animate today's journey marker into its completed state.
  refreshToday(root, { skipQuestionRender: true }).then(() => {
    markTodayComplete(root);
    loadJourney(root);
  });
}

function markTodayComplete(root) {
  const button = root.querySelector(".lock-day.is-today");
  if (!button) return;
  button.classList.remove("is-unanswered", "is-partial");
  button.classList.add("is-complete", "is-just-completed");
  setTimeout(() => button.classList.remove("is-just-completed"), 1000);
}

async function loadJourney(root) {
  const container = root.querySelector(".lock-months");
  try {
    const journey = await apiGet("/relationship/journey");
    renderProgress(root, journey.progress);
    renderJourney(root, journey, (date, trigger) => openDay(root, date, trigger));
  } catch (error) {
    const status = Number((/->\s*(\d{3})/.exec(error?.message || "") || [])[1]) || 0;
    logApiIssue("JOURNEY_FETCH_FAILED", { status });
    // Never leave a silent blank section — replace whatever state was shown
    // (loading spinner, empty, or a prior error) with a deliberate error +
    // retry. renderSectionState calls replaceChildren() internally.
    renderSectionState(
      container,
      "error",
      "تعذر تحميل رحلة الأيام. تأكدي من الاتصال وحاولي تاني.",
      () => loadJourney(root)
    );
  }
}

// Allow the Today retry to also refresh the journey without a page reload.
function wireJourneyRetry(root) {
  root._refreshJourney = () => loadJourney(root);
}

async function openDay(root, date, triggerEl) {
  try {
    const day = await apiGet(`/relationship/day?date=${encodeURIComponent(date)}`);
    if (day.isFuture) return;
    openDayPanel(root, day, triggerEl);
  } catch (error) {
    console.error("Failed to open day:", error);
  }
}

/* ------------------------------------------------------------------ */
/* Public mount                                                        */
/* ------------------------------------------------------------------ */

export async function mountRelationshipLock(mountEl, options = {}) {
  if (!mountEl) return;
  const state = options.state || {};

  stopCountdown();
  mountEl.replaceChildren();

  const root = document.createElement("div");
  root.id = "relationshipLock";
  root.innerHTML = buildShell();
  mountEl.appendChild(root);

  currentUser = state.user || "";

  // Server-authoritative deadline + time.
  syncServerTime(state.serverTime);
  deadlineMs = Number(state.deadlineMs) || 0;

  startAmbientParticles(root);
  renderCountdown(root);
  initNotePanel(root);

  // Presence: immediate heartbeat + periodic refresh of the partner's state.
  startPresence(root);

  // Reveal sequence: phrases appear one after another, then the sweep,
  // then the subtitle settles in beneath the message.
  const phrases = [...root.querySelectorAll(".lock-phrase")];
  const reduced = prefersReducedMotion();
  const step = reduced ? 260 : 420;
  const phraseEnd = 500 + phrases.length * step;

  phrases.forEach((phrase, index) => {
    setTimeout(() => phrase.classList.add("is-shown"), 500 + index * step);
  });
  setTimeout(
    () => root.querySelector(".lock-message")?.classList.add("is-swept"),
    phraseEnd + (reduced ? 100 : 300)
  );
  // Subtitle + note + countdown enter as one continuous scene.
  setTimeout(() => root.querySelector(".lock-subtitle")?.classList.add("is-shown"), phraseEnd);
  setTimeout(() => {
    root.querySelectorAll(".lock-note-btn").forEach((btn, i) =>
      setTimeout(() => btn.classList.add("is-shown"), i * 140));
  }, phraseEnd + (reduced ? 60 : 220));
  setTimeout(() => root.querySelector(".lock-countdown-section")?.classList.add("is-shown"), phraseEnd + (reduced ? 120 : 420));

  root.classList.add("is-ready");

  wireJourneyRetry(root);

  // Show deliberate loading states first so the sections are never blank
  // while the real data is in flight.
  renderSectionState(root.querySelector(".lock-questions"), "loading", "بنحمّل سؤال اليوم…");
  renderSectionState(root.querySelector(".lock-months"), "loading", "بنحمّل رحلة الأيام…");
  renderSectionState(root.querySelector(".lock-today"), "loading", "بنحمّل حالة اليوم…");

  // Load live, server-authoritative data. refreshToday renders the question
  // and today's status; loadJourney renders the journey + progress. The
  // question section then rises in as the closing beat of the scene.
  await refreshToday(root);
  await loadJourney(root);
  setTimeout(() => root.querySelector(".lock-questions-section")?.classList.add("is-shown"), reduced ? 100 : 260);

  // Deeper sections reveal as they become relevant.
  root.querySelectorAll(".lock-section").forEach((section, index) => {
    if (section.classList.contains("lock-countdown-section") ||
        section.classList.contains("lock-questions-section")) return;
    setTimeout(() => section.classList.add("is-shown"), reduced ? 200 : 600 + index * 180);
  });

  // ESC closes whichever panel is open (notes first, then day detail).
  const onKey = (event) => {
    if (event.key === "Escape") {
      if (root._noteIsOpen?.()) {
        root._closeNote?.();
        return;
      }
      root.querySelector(".lock-day-panel")?._close?.();
    }
  };
  document.addEventListener("keydown", onKey);

  // Paint the initial presence immediately (server data from the session).
  if (state.presence) renderPresenceStatus(state.presence);
  refreshPresenceUi();

  root._teardown = () => {
    stopCountdown();
    stopPresence(root);
    document.removeEventListener("keydown", onKey);
    root._teardownParticles?.();
    root._teardownFireworks?.();
  };
}