const ACCESS_CODE_HASH =
  "4a1c33367c51b50488ef25a30719ee7d5a2781cb7b67ccdcc06d49e6be844e67";

const ACCESS_STORAGE_KEY = "ourHeartAccessGrantedAt";
const ACCESS_DURATION = 24 * 60 * 60 * 1000;

const mainApp = document.getElementById("mainApp");
const userSelector = document.getElementById("userSelector");

function hasValidAccess() {
  const timestamp = Number(localStorage.getItem(ACCESS_STORAGE_KEY));

  if (!timestamp) return false;

  const valid = Date.now() - timestamp < ACCESS_DURATION;

  if (!valid) {
    localStorage.removeItem(ACCESS_STORAGE_KEY);
  }

  return valid;
}

function showAppShell() {
  document.getElementById("accessGate")?.remove();

  if (userSelector) {
    userSelector.style.display = "block";
  }

  if (mainApp) {
    mainApp.style.display =
      localStorage.getItem("currentUser") ? "block" : "none";
  }

  import("./app.js?v=3.2");
}

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

      <p id="accessError" class="accessError" hidden>
        Incorrect access code.
      </p>
    </div>
  `;

  document.body.appendChild(gate);

  const input = document.getElementById("accessCodeInput");
  const button = document.getElementById("accessSubmit");
  const error = document.getElementById("accessError");

  async function submitCode() {
    const code = input.value.trim();

    if (!code) return;

    const hash = await sha256(code);

    if (hash === ACCESS_CODE_HASH) {
      localStorage.setItem(
        ACCESS_STORAGE_KEY,
        String(Date.now())
      );

      showAppShell();
      return;
    }

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
  }

  button.addEventListener("click", submitCode);

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      submitCode();
    }
  });
}

if (hasValidAccess()) {
  showAppShell();
} else {
  createAccessGate();
}