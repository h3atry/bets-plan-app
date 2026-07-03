const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;
const MIN_SUBMIT_DELAY_MS = 400;
const AUTH_VERSION = 3;

let unlockKey = null;
let authSubmitting = false;
let authConfig = null;

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function passphraseInput() {
  return document.getElementById("passphrase-input");
}

function showLogin(message = "") {
  const screen = document.getElementById("login-screen");
  const content = document.getElementById("app-content");
  if (screen) {
    screen.classList.add("is-visible");
    screen.style.display = "flex";
  }
  if (content) content.classList.add("is-hidden");
  const err = document.getElementById("login-error");
  if (err) err.textContent = message;
  const input = passphraseInput();
  if (input) {
    input.value = "";
    input.disabled = false;
  }
  document.getElementById("login-form")?.classList.remove("error");
  input?.focus();
}

function hideLogin() {
  const screen = document.getElementById("login-screen");
  const content = document.getElementById("app-content");
  if (screen) {
    screen.classList.remove("is-visible");
    screen.style.display = "none";
  }
  if (content) content.classList.remove("is-hidden");
}

function lockoutStore() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function clearLegacySession() {
  try {
    window.localStorage.removeItem("bets_plan_dk");
    window.localStorage.removeItem("bets_plan_salt");
    window.sessionStorage.removeItem("bets_plan_dk");
    window.sessionStorage.removeItem("bets_plan_salt");
  } catch {
    /* ignore */
  }
}

function getLockout() {
  const store = lockoutStore();
  if (!store) return null;
  try {
    return JSON.parse(store.getItem("bets_plan_lock") || "null");
  } catch {
    return null;
  }
}

function setLockout(data) {
  const store = lockoutStore();
  if (!store) return;
  if (data) store.setItem("bets_plan_lock", JSON.stringify(data));
  else store.removeItem("bets_plan_lock");
}

function checkLockout() {
  const lock = getLockout();
  if (!lock?.until) return null;
  const left = lock.until - Date.now();
  if (left > 0) {
    const sec = Math.ceil(left / 1000);
    return `Muitas tentativas. Aguarde ${sec}s.`;
  }
  setLockout(null);
  return null;
}

function recordFailedAttempt() {
  const lock = getLockout() || { count: 0, until: 0 };
  lock.count = (lock.count || 0) + 1;
  if (lock.count >= MAX_ATTEMPTS) {
    lock.until = Date.now() + LOCKOUT_MS;
    lock.count = 0;
  }
  setLockout(lock);
}

function resetAttempts() {
  setLockout(null);
}

async function loadAuthConfig() {
  const r = await fetch(`./auth.json?_=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("auth_missing");
  const data = await r.json();
  if (Number(data.v) < AUTH_VERSION || !data.salt || !data.verifier) {
    throw new Error("auth_invalid");
  }
  authConfig = data;
  const label = document.getElementById("pass-label");
  const minLen = Number(data.min_length) || 12;
  if (label) label.textContent = `Senha de acesso (${minLen}+ caracteres)`;
  const input = passphraseInput();
  if (input) input.minLength = minLen;
  return data;
}

async function deriveKeyBytes(passphrase, saltB64) {
  const enc = new TextEncoder();
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const iterations = authConfig?.iterations || 100_000;
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return new Uint8Array(bits);
}

async function deriveKey(passphrase, saltB64) {
  const enc = new TextEncoder();
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const iterations = authConfig?.iterations || 100_000;
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
}

async function verifyPassphrase(passphrase) {
  const cfg = await loadAuthConfig();
  const started = performance.now();
  const raw = await deriveKeyBytes(passphrase, cfg.salt);
  const expected = Uint8Array.from(atob(cfg.verifier), (c) => c.charCodeAt(0));
  const elapsed = performance.now() - started;
  if (elapsed < MIN_SUBMIT_DELAY_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_SUBMIT_DELAY_MS - elapsed));
  }
  if (!timingSafeEqual(raw, expected)) {
    recordFailedAttempt();
    return null;
  }
  resetAttempts();
  return deriveKey(passphrase, cfg.salt);
}

function clearSession() {
  unlockKey = null;
  clearLegacySession();
}

window.invalidateSession = function invalidateSession(message = "") {
  clearSession();
  showLogin(message);
};

async function decryptPayload(enc) {
  if (!enc?.enc) {
    const err = new Error("locked");
    err.code = "decrypt_failed";
    throw err;
  }
  if (!unlockKey) throw new Error("locked");
  try {
    const iv = Uint8Array.from(atob(enc.iv), (c) => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(enc.data), (c) => c.charCodeAt(0));
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, unlockKey, ct);
    const data = JSON.parse(new TextDecoder().decode(pt));
    assertNoBankroll(data);
    return data;
  } catch (err) {
    err.code = "decrypt_failed";
    throw err;
  }
}

const BANKROLL_KEYS = new Set([
  "saldo_brl",
  "saldo_betano_brl",
  "saldo_superbet_brl",
  "em_aberto_betano_brl",
  "em_aberto_superbet_brl",
  "patrimonio_brl",
  "stop_limite_brl",
]);

function assertNoBankroll(obj, path = "") {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => assertNoBankroll(item, `${path}[${i}]`));
    return;
  }
  for (const [key, value] of Object.entries(obj)) {
    if (BANKROLL_KEYS.has(key) && typeof value === "number") {
      throw new Error(`bankroll_leak:${key}`);
    }
    assertNoBankroll(value, path ? `${path}.${key}` : key);
  }
}

window.fetchAppData = async function fetchAppData() {
  const r = await fetch(`./data/latest.json?_=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`latest.json ${r.status}`);
  const raw = await r.json();
  return decryptPayload(raw);
};

async function submitPassphrase(event) {
  event?.preventDefault();
  if (authSubmitting) return;

  const lockMsg = checkLockout();
  if (lockMsg) {
    document.getElementById("login-error").textContent = lockMsg;
    document.getElementById("login-form")?.classList.add("error");
    return;
  }

  const input = passphraseInput();
  const passphrase = input?.value || "";
  const minLen = Number(authConfig?.min_length) || 12;
  if (passphrase.length < minLen) {
    document.getElementById("login-error").textContent = `Minimo ${minLen} caracteres.`;
    document.getElementById("login-form")?.classList.add("error");
    return;
  }

  authSubmitting = true;
  document.getElementById("login-error").textContent = "";
  if (input) input.disabled = true;

  try {
    const key = await verifyPassphrase(passphrase);
    if (!key) {
      clearSession();
      document.getElementById("login-form")?.classList.add("error");
      const again = checkLockout();
      document.getElementById("login-error").textContent = again || "Senha incorreta.";
      if (input) {
        input.value = "";
        input.disabled = false;
        input.focus();
      }
      return;
    }
    unlockKey = key;
    if (input) input.value = "";
    hideLogin();
    if (typeof window.startBetsApp === "function") window.startBetsApp();
  } catch (err) {
    console.error(err);
    document.getElementById("login-form")?.classList.add("error");
    document.getElementById("login-error").textContent = "Falha ao verificar senha.";
    if (input) {
      input.value = "";
      input.disabled = false;
      input.focus();
    }
  } finally {
    authSubmitting = false;
  }
}

function logout() {
  clearSession();
  showLogin();
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register("./sw.js?v=20");
    reg.addEventListener("updatefound", () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          worker.postMessage({ type: "SKIP_WAITING" });
        }
      });
    });
    await reg.update();
    if (!window.__betsSwReloadHook) {
      window.__betsSwReloadHook = true;
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        clearSession();
        window.location.reload();
      });
    }
    setInterval(() => reg.update(), 15 * 60 * 1000);
  } catch (err) {
    console.warn("SW:", err);
  }
}

async function initAuth() {
  clearLegacySession();
  unlockKey = null;
  await registerServiceWorker();
  authConfig = null;
  try {
    await loadAuthConfig();
    document.getElementById("login-form")?.addEventListener("submit", submitPassphrase);
    document.getElementById("btn-logout")?.addEventListener("click", logout);

    const lockMsg = checkLockout();
    if (lockMsg) {
      showLogin(lockMsg);
      return;
    }

    showLogin();
  } catch (err) {
    console.error(err);
    showLogin("Erro ao iniciar. Recarregue a pagina.");
  }
}

window.initBetsAuth = initAuth;
