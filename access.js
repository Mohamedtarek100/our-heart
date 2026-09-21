const ACCESS_CODE_HASH =
  "4a1c33367c51b50488ef25a30719ee7d5a2781cb7b67ccdcc06d49e6be844e67";

const ACCESS_STORAGE_KEY = "ourHeartAccessGrantedAt";
const ACCESS_DURATION = 24 * 60 * 60 * 1000;
const ACCESS_VERSION = "4.8";
const INTRO_VERSION = "6";

const mainApp = document.getElementById("mainApp");
const userSelector = document.getElementById("userSelector");

// Guards the manual "Love Intro" replay so a second click cannot
// stack a second overlay or add a second set of listeners.
let loveIntroReplayActive = false;

function hasValidAccess() {
  const rawTimestamp = localStorage.getItem(ACCESS_STORAGE_KEY);
  const timestamp = Number(rawTimestamp);

  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    localStorage.removeItem(ACCESS_STORAGE_KEY);
    return false;
  }

  const age = Date.now() - timestamp;
  const valid = age >= 0 && age < ACCESS_DURATION;

  if (!valid) {
    localStorage.removeItem(ACCESS_STORAGE_KEY);
  }

  return valid;
}

async function showAppShell(options = {}) {
  const { playIntro = false, forceIntro = false } = options;

  document.getElementById("accessGate")?.remove();

  if (userSelector) {
    userSelector.style.display = "block";
  }

  if (mainApp) {
    mainApp.style.display =
      localStorage.getItem("currentUser") ? "block" : "none";
  }

  // Start the chat application immediately so it initializes in
  // parallel (presence, listeners, sync) and never feels blocked by
  // the opening animation. The intro overlay is painted on top and
  // keeps the chat non-interactable until it ends.
  import(`./app.js?v=${ACCESS_VERSION}`);

  if (!playIntro) return;

  try {
    const introModule = await import(`./intro.js?v=${INTRO_VERSION}`);
    await introModule.showRomanticIntro({ force: forceIntro });
  } catch (introError) {
    // The intro is a non-critical enhancement. If it fails to load,
    // never block the chat — just log and continue.
    console.error("Opening animation failed, continuing to chat:", introError);
  }
}

/* Manual replay — triggered by the "❤️ Love Intro" button.
   - Never requires the access code again.
   - Does not reload the page, change the user, or touch chat state.
   - Always plays from scene 1 (force: true), reusing the one engine.
   - Safe if the chat is scrolled, a reply is selected, a reaction
     picker is open, or fullscreen is active: the overlay simply
     paints on top and restores interaction on completion/skip. */
async function replayLoveIntro() {
  if (loveIntroReplayActive) return;
  if (document.getElementById("romanticIntro")) return;

  const button = document.getElementById("loveIntroButton");
  loveIntroReplayActive = true;
  if (button) button.disabled = true;

  try {
    const introModule = await import(`./intro.js?v=${INTRO_VERSION}`);
    await introModule.showRomanticIntro({ force: true });
  } catch (introError) {
    console.error("Love Intro replay failed:", introError);
  } finally {
    loveIntroReplayActive = false;
    if (button) button.disabled = false;
  }
}

// Exposed for the inline onclick on #loveIntroButton (same pattern as
// the existing window.changeUser from app.js).
window.replayLoveIntro = replayLoveIntro;

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);

  return [...new Uint8Array(hashBuffer)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createAccessGate() {
  userSelector.style.display = "none";
  mainApp.style.display = "none";

  const gate = document.createElement("div");

  gate.id = "accessGate";

  gate.innerHTML = `
    <div class="accessCard">
      <div class="accessHeart">❤️</div>

      <h1>Our Heart</h1>

      <p class="accessSubtitle">
        This is a private space.
      </p>

      <div class="accessInputWrap">
        <input
          id="accessCodeInput"
          type="password"
          inputmode="text"
          autocomplete="off"
          placeholder="Access code"
          aria-label="Access code"
        >
      </div>

      <button id="accessSubmit" type="button">
        Enter ❤️
      </button>

      <p id="accessError" class="accessError" aria-live="polite" hidden>
        Incorrect access code.
      </p>
    </div>
  `;

  document.body.appendChild(gate);

  const input = document.getElementById("accessCodeInput");
  const button = document.getElementById("accessSubmit");
  const error = document.getElementById("accessError");

  async function submitCode() {
    if (button.disabled) return;
    const code = input.value.trim();

    if (!code) return;

    button.disabled = true;
    button.classList.add("is-loading");
    error.hidden = true;

    try {
      const hash = await sha256(code);

      if (hash === ACCESS_CODE_HASH) {
        localStorage.setItem(
          ACCESS_STORAGE_KEY,
          String(Date.now())
        );

        // A fresh unlock always plays the cinematic opening.
        showAppShell({ playIntro: true, forceIntro: true });
        return;
      }

      error.textContent = "Incorrect access code.";
      error.hidden = false;
      input.value = "";
      input.focus();

      gate
        .querySelector(".accessCard")
        ?.classList.remove("access-shake");

      requestAnimationFrame(() => {
        gate
          .querySelector(".accessCard")
          ?.classList.add("access-shake");
      });
    } catch (submitError) {
      console.error("Access verification failed:", submitError);
      error.textContent = "Unable to verify access. Try again.";
      error.hidden = false;
    } finally {
      button.disabled = false;
      button.classList.remove("is-loading");
    }
  }

  button.addEventListener("click", submitCode);

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      submitCode();
    }
  });
}

if (hasValidAccess()) {
  // Valid session: play the intro only if it has not already been
  // shown during this authenticated session (intro.js tracks that).
  showAppShell({ playIntro: true, forceIntro: false });
} else {
  createAccessGate();
}