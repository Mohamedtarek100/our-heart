/* ============================================================
   Our Heart — Cinematic Opening Experience (controller)
   ------------------------------------------------------------
   Self-contained, dependency-free ES module.

   Public API:
     showRomanticIntro({ force })  -> Promise<void>
       - Renders a temporary full-screen overlay ABOVE the chat.
       - Runs a multi-scene cinematic timeline.
       - Resolves once it finishes naturally or is skipped.
       - On resolve the overlay + every timer / rAF / listener /
         injected stylesheet are torn down. Nothing keeps running.

     resetIntroForSession()  -> void
       - Clears the "already shown this session" flag.

   Architecture:
     - The *visual* timeline is driven by CSS animations triggered
       by scene classes on the root (stays on the compositor:
       transform / opacity / filter only).
     - ONE requestAnimationFrame loop owns the particle canvas AND
       the pointer interaction. There is never a second loop.
     - Particle counts are adaptive and hard-capped.
     - Interaction: subtle pointer parallax (desktop) + tap burst
       (touch) — both drawn on the same canvas, no DOM churn.
   ============================================================ */

const INTRO_STYLESHEET_ID = "romanticIntroStyles";
const INTRO_STYLESHEET_HREF = "intro.css?v=4";

/* Timeline (ms from scene-1 start). Total ~21s — under the 30s
   ceiling, and never padded with dead time. */
const TIMELINE = {
  atmosphere: 0,        // Scene 1 — darkness + ambient particles
  heart: 2600,          // Scene 2 — heart draws in + heartbeat begins
  gather: 6200,         // Scene 3 — particles drift toward the heart
  revealEyebrow: 8600,  // Scene 4 — "OUR HEART"
  revealLine1: 9700,    //           "I Love You"
  revealLine2: 10800,   //           "Yomna"
  finalMessage: 12600,  // Scene 5 — "Every moment ..."
  settle: 16500,        // Scene 5 — calm romantic state
  exit: 19800,          // Scene 6 — intensity drops, fade out
  done: 21200
};

/* Session flag: once shown (and finished / skipped) in this
   authenticated session we do not auto-replay on refresh. */
const INTRO_SESSION_KEY = "ourHeartIntroShown";

/* ------------------------------------------------------------------ */

function prefersReducedMotion() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function hasShownIntroThisSession() {
  try {
    return sessionStorage.getItem(INTRO_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function markIntroShownThisSession() {
  try {
    sessionStorage.setItem(INTRO_SESSION_KEY, "1");
  } catch {
    /* storage unavailable — intro may replay; acceptable */
  }
}

/* Loads intro.css and resolves only once it is actually applied.
   This is critical: if the overlay mounts before its stylesheet is
   parsed, the browser paints the fully-composed (unstyled) screen for
   a frame and every entrance transition is skipped — the intro then
   LOOKS static. We therefore wait for the style to be ready first. */
function loadStylesheet() {
  const existing = document.getElementById(INTRO_STYLESHEET_ID);

  // Verify the EXISTING link actually points at the current version.
  // If it is a stale href from an older build (which is what makes a
  // replay render the old, already-settled screen), drop it and load
  // the current URL fresh instead of trusting it.
  if (existing) {
    const isCurrent = existing.getAttribute("href") === INTRO_STYLESHEET_HREF;
    if (isCurrent && existing.sheet) return Promise.resolve();
    if (!isCurrent) existing.remove();
  }

  const stillThere = document.getElementById(INTRO_STYLESHEET_ID);

  return new Promise((resolve) => {
    if (stillThere) {
      // Right version, but the sheet is not parsed yet — wait for it.
      stillThere.addEventListener("load", () => resolve(), { once: true });
      stillThere.addEventListener("error", () => resolve(), { once: true });
      // Safety net in case load already fired but .sheet was false.
      setTimeout(resolve, 400);
      return;
    }

    const link = document.createElement("link");
    link.id = INTRO_STYLESHEET_ID;
    link.rel = "stylesheet";
    link.href = INTRO_STYLESHEET_HREF;
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => resolve(), { once: true });
    document.head.appendChild(link);

    // Hard safety net so a hung/failed load never blocks the intro.
    setTimeout(resolve, 1500);
  });
}

/* A rough capability probe used to decide whether to enable the
   optional pointer parallax and how big the particle field is. */
function deviceProfile() {
  const cores =
    typeof navigator.hardwareConcurrency === "number"
      ? navigator.hardwareConcurrency
      : 4;
  const area = window.innerWidth * window.innerHeight;
  const smallest = Math.min(window.innerWidth, window.innerHeight);
  const finePointer =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  return {
    cores,
    area,
    smallest,
    finePointer,
    // Parallax is a desktop nicety; skip it on low-core or touch devices.
    allowParallax: finePointer && cores > 2 && area > 260000
  };
}

/* Particle budget: scales with viewport area but always capped. */
function computeParticleBudget(profile) {
  let target = Math.round(profile.area / 13000);
  target = Math.min(target, 54);

  if (profile.smallest < 500) target = Math.min(target, 30);
  if (profile.cores <= 4) target = Math.min(target, 40);
  if (profile.cores <= 2) target = Math.min(target, 22);

  return Math.max(12, target);
}

/* ------------------------------------------------------------------ */

function buildIntroMarkup() {
  return `
    <div class="intro-bg" aria-hidden="true"></div>
    <div class="intro-glow" aria-hidden="true"></div>
    <canvas class="intro-particles" aria-hidden="true"></canvas>
    <div class="intro-rays" aria-hidden="true"></div>

    <button class="intro-skip" type="button" aria-label="Skip opening animation">
      <span>Skip</span> <span class="intro-skip-arrow" aria-hidden="true">✕</span>
    </button>

    <div class="intro-stage" role="img" aria-label="I love you Yomna">
      <div class="intro-parallax" data-depth="tight">
        <div class="intro-heart" aria-hidden="true">
          <span class="intro-ring"></span>
          <span class="intro-ring intro-ring--b"></span>
          <span class="intro-ring intro-ring--c"></span>
          <span class="intro-heart-halo"></span>
          <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="introHeartGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%"  stop-color="#ff9dc0"></stop>
                <stop offset="52%" stop-color="#ff5f96"></stop>
                <stop offset="100%" stop-color="#e03c78"></stop>
              </linearGradient>
            </defs>
            <path class="heart-fill" d="M50 88
              C 22 68, 6 50, 6 32
              C 6 17, 18 8, 31 8
              C 40 8, 47 13, 50 20
              C 53 13, 60 8, 69 8
              C 82 8, 94 17, 94 32
              C 94 50, 78 68, 50 88 Z"></path>
            <path class="heart-stroke" d="M50 88
              C 22 68, 6 50, 6 32
              C 6 17, 18 8, 31 8
              C 40 8, 47 13, 50 20
              C 53 13, 60 8, 69 8
              C 82 8, 94 17, 94 32
              C 94 50, 78 68, 50 88 Z"></path>
          </svg>
        </div>
      </div>

      <div class="intro-copy intro-parallax" data-depth="loose">
        <span class="intro-eyebrow">Our Heart</span>
        <h1 class="intro-title">
          <span class="intro-line intro-line--1">I Love You</span>
          <span class="intro-line intro-line--2"><span class="intro-name">Yomna</span></span>
        </h1>
        <span class="intro-divider" aria-hidden="true"></span>
        <p class="intro-subtitle">Every moment with you feels like home.</p>
      </div>
    </div>

    <div class="intro-vignette" aria-hidden="true"></div>
    <span class="intro-visually-hidden">Opening animation. Activate Skip to continue to the chat.</span>
  `;
}

/* ------------------------------------------------------------------ */

export function showRomanticIntro(options = {}) {
  const { force = false } = options;
  const reduced = prefersReducedMotion();

  // Diagnostic breadcrumb: confirms in DevTools which build is running
  // (helps spot a stale cached intro.js / intro.css instantly).
  try {
    console.info(
      "[Our Heart] intro build: " + INTRO_STYLESHEET_HREF + " | force=" + force
    );
  } catch {
    /* ignore */
  }

  // Session semantics: an automatic call only plays once per session.
  // A manual "Love Intro" replay passes force: true and always plays.
  if (!force && hasShownIntroThisSession()) {
    return Promise.resolve();
  }

  // Never allow two overlays to stack.
  if (document.getElementById("romanticIntro")) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    // Make the executor async: we must not mount the overlay until its
    // stylesheet is applied, otherwise the first paint is the fully
    // composed screen and the entrance transitions never run.
    (async () => {
    await loadStylesheet();

    // A second guard: if another call mounted while CSS was loading,
    // bail out instead of creating a duplicate overlay.
    if (document.getElementById("romanticIntro")) {
      resolve();
      return;
    }

    const profile = deviceProfile();

    let finished = false;
    let rafId = 0;
    let masterTimerId = 0;
    const sceneTimers = [];
    let skipHandler = null;
    let keyHandler = null;
    let resizeHandler = null;
    let pointerMoveHandler = null;
    let pointerDownHandler = null;
    let fadeFallbackId = 0;
    let canvas = null;
    let ctx = null;
    let ambient = [];
    let sparks = [];
    let dpr = 1;
    let running = false;
    let lastFrameTime = 0;

    /* Pointer-driven state (subtle parallax + tap bursts). */
    const pointer = { targetX: 0, targetY: 0, x: 0, y: 0 };
    const MAX_SPARKS = 90; // hard cap — bounded pool

    const root = document.createElement("div");
    root.id = "romanticIntro";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Opening animation");
    root.innerHTML = buildIntroMarkup();

    // Lock background scroll without shifting layout.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    document.body.appendChild(root);

    // Keep the underlying app inert so the chat is not interactable
    // underneath the overlay (progressive enhancement; harmless if
    // `inert` is unsupported).
    const mainApp = document.getElementById("mainApp");
    const userSelector = document.getElementById("userSelector");
    const changeAccountBtn = document.getElementById("changeAccountButton");
    const appWasInert = mainApp?.inert === true;
    try {
      if (mainApp) mainApp.inert = true;
      if (userSelector) userSelector.inert = true;
      if (changeAccountBtn) changeAccountBtn.inert = true;
    } catch {
      /* inert unsupported */
    }

    /* ---------------- Particles ---------------- */

    canvas = root.querySelector(".intro-particles");
    if (canvas && canvas.getContext) {
      ctx = canvas.getContext("2d", { alpha: true });
    }

    function centerPoint() {
      // Stable focal point near the heart; layout-independent and cheap.
      return { x: window.innerWidth / 2, y: window.innerHeight * 0.42 };
    }

    function sizeCanvas() {
      if (!canvas) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function spawnAmbient() {
      if (reduced) {
        ambient = [];
        return;
      }
      const count = computeParticleBudget(profile);
      const w = window.innerWidth;
      const h = window.innerHeight;
      ambient = [];
      for (let i = 0; i < count; i += 1) {
        ambient.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: 0.6 + Math.random() * 1.7,
          vx: (Math.random() - 0.5) * 0.12,
          vy: -0.06 - Math.random() * 0.24,
          a: 0.1 + Math.random() * 0.45,
          tw: Math.random() * Math.PI * 2,
          tws: 0.008 + Math.random() * 0.02,
          // Small horizontal wander so the field reads as "alive"
          // even before the gather scene kicks in.
          drift: Math.random() < 0.5 ? -1 : 1,
          depth: 0.35 + Math.random() * 0.65 // parallax depth
        });
      }
    }

    /* Tap burst — a small ring of sparks that fade out. Bounded pool. */
    function emitBurst(cx, cy) {
      if (reduced || !ctx) return;
      const count = profile.smallest < 500 ? 12 : 18;
      for (let i = 0; i < count; i += 1) {
        if (sparks.length >= MAX_SPARKS) break;
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
        const speed = 0.9 + Math.random() * 1.9;
        sparks.push({
          x: cx,
          y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          r: 0.8 + Math.random() * 1.6,
          life: 1,
          decay: 0.014 + Math.random() * 0.02
        });
      }
    }

    /* ---------------- Scene scheduler ---------------- */

    function scheduleScenes() {
      if (reduced) {
        // Reduced motion: show the final calm composition immediately.
        root.classList.add("is-running", "scene-heart", "scene-final", "scene-settled");
        running = true;
        return;
      }

      root.classList.add("is-running");
      running = true;

      const add = (cls, at) => {
        sceneTimers.push(
          setTimeout(() => {
            if (finished) return;
            root.classList.add(cls);
          }, at)
        );
      };

      add("scene-atmosphere", TIMELINE.atmosphere);
      add("scene-heart", TIMELINE.heart);
      add("scene-gather", TIMELINE.gather);
      add("scene-eyebrow", TIMELINE.revealEyebrow);
      add("scene-line1", TIMELINE.revealLine1);
      add("scene-line2", TIMELINE.revealLine2);
      add("scene-final", TIMELINE.finalMessage);
      add("scene-settled", TIMELINE.settle);
      add("scene-exit", TIMELINE.exit);
    }

    /* ---------------- Render loop (single rAF) ---------------- */

    function drawFrame(now) {
      if (!running || !ctx) return;

      const w = window.innerWidth;
      const h = window.innerHeight;
      const focal = centerPoint();

      // Ease the pointer toward its target for a silky parallax.
      pointer.x += (pointer.targetX - pointer.x) * 0.06;
      pointer.y += (pointer.targetY - pointer.y) * 0.06;

      const gathering = root.classList.contains("scene-gather");
      const settled = root.classList.contains("scene-settled");

      ctx.clearRect(0, 0, w, h);

      // ---- ambient field ----
      for (let i = 0; i < ambient.length; i += 1) {
        const p = ambient[i];

        // Baseline drift: gentle but CONTINUOUS so the field is
        // always visibly alive (not frozen between scenes).
        p.x += p.vx + p.drift * 0.15;
        p.y += p.vy;
        p.tw += p.tws;

        // Scene 3: particles visibly accelerate toward the heart, then
        // are released again at scene 5 (settle).
        if (gathering && !settled) {
          p.x += (focal.x - p.x) * 0.012;
          p.y += (focal.y - p.y) * 0.012;
        } else if (settled) {
          // Gently push back out so the field disperses again.
          p.x -= (focal.x - p.x) * 0.0016;
          p.y -= (focal.y - p.y) * 0.0016;
        }

        // Wrap so the field never thins out.
        if (p.y < -10) {
          p.y = h + 10;
          p.x = Math.random() * w;
        }
        if (p.x < -10) p.x = w + 10;
        else if (p.x > w + 10) p.x = -10;

        const px = p.x + pointer.x * p.depth * 16;
        const py = p.y + pointer.y * p.depth * 16;
        const alpha = p.a * (0.5 + 0.5 * Math.sin(p.tw));
        const radius = p.r * (gathering && !settled ? 1.25 : 1);

        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 214, 232, " + alpha.toFixed(3) + ")";
        ctx.fill();
      }

      // ---- sparks (tap bursts) ----
      for (let i = sparks.length - 1; i >= 0; i -= 1) {
        const s = sparks[i];
        s.x += s.vx;
        s.y += s.vy;
        s.vx *= 0.985;
        s.vy *= 0.985;
        s.life -= s.decay;

        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }

        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * s.life, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 190, 216, " + (s.life * 0.8).toFixed(3) + ")";
        ctx.fill();
      }

      if (profile.allowParallax) {
        applyParallax(pointer.x, pointer.y);
      }

      rafId = requestAnimationFrame(drawFrame);
    }

    /* Parallax: one transform write per layer per changed frame. */
    const parallaxEls = Array.prototype.slice.call(
      root.querySelectorAll(".intro-parallax")
    );
    let lastParallaxX = 999;
    let lastParallaxY = 999;

    function applyParallax(nx, ny) {
      if (
        Math.abs(nx - lastParallaxX) < 0.002 &&
        Math.abs(ny - lastParallaxY) < 0.002
      ) {
        return;
      }
      lastParallaxX = nx;
      lastParallaxY = ny;

      for (let i = 0; i < parallaxEls.length; i += 1) {
        const el = parallaxEls[i];
        const depth = el.dataset.depth === "tight" ? 9 : 16;
        el.style.transform =
          "translate3d(" +
          (nx * depth).toFixed(2) +
          "px, " +
          (ny * depth).toFixed(2) +
          "px, 0)";
      }
    }

    /* ---------------- Lifecycle ---------------- */

    function clearAllTimers() {
      if (masterTimerId) clearTimeout(masterTimerId);
      masterTimerId = 0;
      while (sceneTimers.length) clearTimeout(sceneTimers.pop());
    }

    function cleanup() {
      if (finished) return;
      finished = true;
      running = false;

      // Cancel the frame loop.
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;

      // Cancel every timer.
      clearAllTimers();
      if (fadeFallbackId) clearTimeout(fadeFallbackId);
      fadeFallbackId = 0;

      // Remove listeners.
      if (skipHandler && skipBtn) skipBtn.removeEventListener("click", skipHandler);
      if (keyHandler) document.removeEventListener("keydown", keyHandler);
      if (resizeHandler) window.removeEventListener("resize", resizeHandler);
      if (pointerMoveHandler) window.removeEventListener("pointermove", pointerMoveHandler);
      if (pointerDownHandler) root.removeEventListener("pointerdown", pointerDownHandler);

      // Restore interaction locks.
      document.body.style.overflow = previousOverflow;

      try {
        if (mainApp) mainApp.inert = appWasInert;
        if (userSelector) userSelector.inert = false;
        if (changeAccountBtn) changeAccountBtn.inert = false;
      } catch {
        /* inert unsupported */
      }

      // Free canvas memory + pools.
      ambient = [];
      sparks = [];
      if (canvas) {
        canvas.width = 1;
        canvas.height = 1;
      }
      ctx = null;

      // Remove the overlay from the DOM entirely.
      root.remove();
    }

    function finish() {
      if (finished) return;

      // Scene 6: drop intensity and fade the whole layer out.
      root.classList.add("scene-exit", "is-leaving");

      // Stop the render loop immediately; the fade is CSS-only.
      running = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      // Stop scene timers too — nothing should fire during the fade.
      clearAllTimers();

      const finalize = () => {
        cleanup();
        markIntroShownThisSession();
        resolve();
      };

      // transitionend is the fast path; the timeout is the guarantee.
      fadeFallbackId = setTimeout(finalize, 1200);
      root.addEventListener(
        "transitionend",
        (event) => {
          if (event.target !== root) return;
          if (fadeFallbackId) clearTimeout(fadeFallbackId);
          fadeFallbackId = 0;
          finalize();
        },
        { once: true }
      );
    }

    const skipBtn = root.querySelector(".intro-skip");

    skipHandler = (event) => {
      event.preventDefault();
      finish();
    };
    skipBtn?.addEventListener("click", skipHandler);

    // Keyboard skip: Escape / Enter / Space.
    keyHandler = (event) => {
      if (
        event.key === "Escape" ||
        event.key === "Enter" ||
        event.key === "Spacebar" ||
        event.code === "Space"
      ) {
        event.preventDefault();
        finish();
      }
    };
    document.addEventListener("keydown", keyHandler);

    // Re-size + re-budget on resize / orientation change, throttled
    // to a single rAF to avoid layout thrash.
    let resizePending = false;
    resizeHandler = () => {
      if (resizePending || finished) return;
      resizePending = true;
      requestAnimationFrame(() => {
        resizePending = false;
        if (finished) return;
        sizeCanvas();
        spawnAmbient();
      });
    };
    window.addEventListener("resize", resizeHandler);

    // Pointer parallax (desktop only).
    if (profile.allowParallax) {
      pointerMoveHandler = (event) => {
        const nx = (event.clientX / window.innerWidth) * 2 - 1;
        const ny = (event.clientY / window.innerHeight) * 2 - 1;
        pointer.targetX = Math.max(-1, Math.min(1, nx));
        pointer.targetY = Math.max(-1, Math.min(1, ny));
      };
      window.addEventListener("pointermove", pointerMoveHandler, { passive: true });
    }

    // Tap burst (touch-friendly, also fires for mouse clicks).
    pointerDownHandler = (event) => {
      const target = event.target;
      if (target && target.closest && target.closest(".intro-skip")) return;
      if (reduced) return;

      let cx = event.clientX;
      let cy = event.clientY;
      if ((typeof cx !== "number" || typeof cy !== "number") && event.touches && event.touches[0]) {
        cx = event.touches[0].clientX;
        cy = event.touches[0].clientY;
      }
      if (typeof cx !== "number" || typeof cy !== "number") return;

      emitBurst(cx, cy);
    };
    root.addEventListener("pointerdown", pointerDownHandler, { passive: true });

    /* ---------------- Boot ---------------- */

    sizeCanvas();
    spawnAmbient();
    lastFrameTime = performance.now ? performance.now() : Date.now();

    // Start the particle loop right away so the field is alive during
    // the atmosphere scene.
    if (ambient.length) {
      rafId = requestAnimationFrame(drawFrame);
    }

    // CRITICAL: give the browser one paint with the initial hidden
    // state (everything opacity:0) BEFORE adding the first scene
    // class. Without this gap the "enter" transitions are applied in
    // the same style-recalc as the initial state and are skipped,
    // which is what makes the intro look static.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (finished) return;
        scheduleScenes();
        // Guaranteed completion (scheduled from the real start).
        masterTimerId = setTimeout(finish, TIMELINE.done);
      });
    });
    })();
  });
}

/* ------------------------------------------------------------------ */

export function resetIntroForSession() {
  try {
    sessionStorage.removeItem(INTRO_SESSION_KEY);
  } catch {
    /* ignore */
  }
}
