// ===================================================================
// AUTH MODULE (Principio de Responsabilidad Única)
// Gestiona autenticación Sanctum (Bearer Token), Modo Invitado local y apiFetch
// ===================================================================

const AUTH_TOKEN_KEY = 'saltasoga_auth_token';
const AUTH_USER_KEY = 'saltasoga_auth_user';
const GUEST_MODE_KEY = 'saltasoga_guest_mode';
const GUEST_SESSIONS_KEY = 'saltasoga_guest_sessions';

const AUTH_API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://127.0.0.1:8000/api'
  : 'https://api-saltasoga.devandre.com/api';

// Reemplazar con el Client ID de Google Cloud (termina en .apps.googleusercontent.com)
const GOOGLE_CLIENT_ID = '894690355798-kk2qo95aqc6a5ktmph5op8aliq1993ql.apps.googleusercontent.com';

function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function getAuthUser() {
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function isAuthenticated() {
  return Boolean(getAuthToken());
}

function isGuestMode() {
  return !isAuthenticated() && localStorage.getItem(GUEST_MODE_KEY) === 'true';
}

function saveAuthSession(token, user) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  localStorage.removeItem(GUEST_MODE_KEY);
}

function clearAuthSession() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
}

// Fetch centralizado con Bearer Token y manejo de 401
async function apiFetch(endpoint, options = {}) {
  const token = getAuthToken();
  const headers = {
    'Accept': 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${AUTH_API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (response.status === 401 && token) {
    clearAuthSession();
    updateAuthDrawerUI();
    openAuthModal('login', 'Tu sesión expiró. Inicia sesión nuevamente.');
  }

  return response;
}

// --- Referencias DOM del Modal de Autenticación y Drawer ---
const authModal = document.getElementById('authModal');
const authTabLoginBtn = document.getElementById('authTabLoginBtn');
const authTabRegisterBtn = document.getElementById('authTabRegisterBtn');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const authErrorBox = document.getElementById('authErrorBox');
const authCloseBtn = document.getElementById('authCloseBtn');
const guestModeBtn = document.getElementById('guestModeBtn');
const googleSignInContainer = document.getElementById('googleSignInContainer');

const drawerUserAvatar = document.getElementById('drawerUserAvatar');
const drawerUserName = document.getElementById('drawerUserName');
const drawerUserEmail = document.getElementById('drawerUserEmail');
const drawerLoginBtn = document.getElementById('drawerLoginBtn');
const drawerLogoutBtn = document.getElementById('drawerLogoutBtn');

const authLoader = document.getElementById('authLoader');
const authLoaderCard = document.getElementById('authLoaderCard');
const authLoaderRing = document.getElementById('authLoaderRing');
const authLoaderCheck = document.getElementById('authLoaderCheck');
const authLoaderTitle = document.getElementById('authLoaderTitle');
const authLoaderSubtitle = document.getElementById('authLoaderSubtitle');

function showAuthError(msg) {
  if (!authErrorBox) return;
  if (!msg) {
    authErrorBox.classList.add('hidden');
    authErrorBox.textContent = '';
  } else {
    authErrorBox.textContent = msg;
    authErrorBox.classList.remove('hidden');
  }
}

function switchAuthTab(tab) {
  showAuthError('');
  const activeTabClass = 'flex-1 py-2 rounded-lg text-xs font-bold transition bg-emerald-500 text-black shadow-xs';
  const inactiveTabClass = 'flex-1 py-2 rounded-lg text-xs font-bold transition text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white';

  if (tab === 'register') {
    if (authTabRegisterBtn) authTabRegisterBtn.className = activeTabClass;
    if (authTabLoginBtn) authTabLoginBtn.className = inactiveTabClass;
    if (loginForm) loginForm.classList.add('hidden');
    if (registerForm) registerForm.classList.remove('hidden');
  } else {
    if (authTabLoginBtn) authTabLoginBtn.className = activeTabClass;
    if (authTabRegisterBtn) authTabRegisterBtn.className = inactiveTabClass;
    if (registerForm) registerForm.classList.add('hidden');
    if (loginForm) loginForm.classList.remove('hidden');
  }
}

function openAuthModal(tab = 'login', initialMessage = '') {
  if (!authModal) return;
  switchAuthTab(tab);
  resetPasswordVisibility(loginForm);
  resetPasswordVisibility(registerForm);
  if (initialMessage) showAuthError(initialMessage);
  authModal.classList.remove('hidden');
  setTimeout(() => authModal.classList.remove('opacity-0'), 10);
  googleSignInAttempts = 0;
  setTimeout(initGoogleSignIn, 50);
}

let googleSignInInitialized = false;
let googleSignInAttempts = 0;

function initGoogleSignIn() {
  const section = document.getElementById('googleSignInSection');
  if (!section || !googleSignInContainer) return;

  if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.indexOf('TU_CLIENT_ID') === 0) {
    section.classList.add('hidden');
    return;
  }

  if (googleSignInInitialized) {
    renderGoogleSignInButton();
    return;
  }

  if (!window.google || !window.google.accounts || !window.google.accounts.id) {
    if (googleSignInAttempts >= 50) {
      section.classList.add('hidden');
      return;
    }
    googleSignInAttempts += 1;
    setTimeout(initGoogleSignIn, 200);
    return;
  }

  googleSignInInitialized = true;

  window.google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleCredential,
    auto_select: false,
    cancel_on_tap_outside: true,
  });

  renderGoogleSignInButton();
}

function renderGoogleSignInButton() {
  if (!googleSignInContainer || googleSignInContainer.dataset.rendered === 'true') return;

  window.google.accounts.id.renderButton(googleSignInContainer, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'continue_with',
    shape: 'pill',
    logo_alignment: 'left',
    locale: 'es',
    width: 300,
  });

  googleSignInContainer.dataset.rendered = 'true';
}

async function handleGoogleCredential(response) {
  if (!response || !response.credential || isAuthTransitioning) return;

  showAuthError('');
  isAuthTransitioning = true;

  if (googleSignInContainer) {
    googleSignInContainer.classList.add('opacity-60', 'pointer-events-none');
  }

  showAuthLoader('Conectando con Google...', 'Verificando tu cuenta');

  try {
    const res = await fetch(`${AUTH_API_BASE}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ credential: response.credential }),
    });

    let json = {};
    try {
      json = await res.json();
    } catch (e) {}

    if (res.ok && json.token && json.user) {
      saveAuthSession(json.token, json.user);
      updateAuthDrawerUI();
      closeAuthModal();
      if (loginForm) loginForm.reset();
      if (registerForm) registerForm.reset();
      await completeAuthLoader(welcomeTitle(json.user), 'Entrando a SaltaSoga');
      if (typeof window.onAuthStateChanged === 'function') window.onAuthStateChanged();
    } else {
      hideAuthLoader();
      showAuthError(extractLaravelError(json, 'No se pudo iniciar sesión con Google.'));
    }
  } catch (err) {
    hideAuthLoader();
    showAuthError('No se pudo conectar con el servidor.');
  } finally {
    isAuthTransitioning = false;
    if (googleSignInContainer) {
      googleSignInContainer.classList.remove('opacity-60', 'pointer-events-none');
    }
  }
}

function closeAuthModal() {
  if (!authModal) return;
  authModal.classList.add('opacity-0');
  setTimeout(() => authModal.classList.add('hidden'), 200);
}

function updateAuthDrawerUI() {
  const user = getAuthUser();
  const loggedIn = isAuthenticated() && user;

  if (loggedIn) {
    const initial = (user.name || user.email || 'U').trim().charAt(0).toUpperCase();
    if (drawerUserAvatar) {
      drawerUserAvatar.textContent = initial;
      drawerUserAvatar.className = 'w-10 h-10 rounded-full bg-emerald-500 text-black font-black flex items-center justify-center shrink-0';
    }
    if (drawerUserName) drawerUserName.textContent = user.name || 'Usuario';
    if (drawerUserEmail) drawerUserEmail.textContent = user.email || '';
    if (drawerLoginBtn) drawerLoginBtn.classList.add('hidden');
    if (drawerLogoutBtn) drawerLogoutBtn.classList.remove('hidden');
  } else {
    if (drawerUserAvatar) {
      drawerUserAvatar.textContent = '👤';
      drawerUserAvatar.className = 'w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-bold flex items-center justify-center shrink-0';
    }
    if (drawerUserName) drawerUserName.textContent = 'Modo Invitado';
    if (drawerUserEmail) drawerUserEmail.textContent = 'Guardado solo en este dispositivo';
    if (drawerLoginBtn) drawerLoginBtn.classList.remove('hidden');
    if (drawerLogoutBtn) drawerLogoutBtn.classList.add('hidden');
  }
}

// Extraer mensaje legible de errores Laravel (422 / 401 / etc.)
function extractLaravelError(json, fallback) {
  if (json && json.errors) {
    const firstKey = Object.keys(json.errors)[0];
    if (firstKey && json.errors[firstKey]?.[0]) {
      return json.errors[firstKey][0];
    }
  }
  return (json && json.message) ? json.message : fallback;
}

// --- Componentes de carga de autenticación ---
const AUTH_LOADER_MIN_MS = 350;
const AUTH_LOADER_SUCCESS_MS = 850;
let authLoaderStartedAt = 0;
let authLoaderHideTimer = null;
let authLoaderFrame = null;
let isAuthTransitioning = false;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function welcomeTitle(user) {
  const name = user && user.name ? String(user.name).trim() : '';
  return name ? `¡Bienvenido, ${name.split(/\s+/)[0]}!` : '¡Bienvenido!';
}

function setAuthInputsDisabled(disabled) {
  if (!authModal) return;
  authModal.querySelectorAll('input').forEach(input => {
    input.disabled = disabled;
  });
}

function resetPasswordVisibility(form) {
  if (!form) return;

  form.querySelectorAll('.toggle-password-btn').forEach(btn => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;

    input.type = 'password';
    btn.querySelector('.icon-eye')?.classList.add('hidden');
    btn.querySelector('.icon-eye-off')?.classList.remove('hidden');
  });
}

function setButtonLoading(button, loading, loadingText = '') {
  if (!button) return;

  if (loading) {
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = `
      <span class="inline-flex items-center justify-center gap-2">
        <svg class="w-4 h-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
        </svg>
        <span>${loadingText}</span>
      </span>`;
    return;
  }

  button.disabled = false;
  button.removeAttribute('aria-busy');

  if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
  }
}

function showAuthLoader(title, subtitle = '') {
  if (!authLoader) return;

  clearTimeout(authLoaderHideTimer);
  authLoaderStartedAt = Date.now();

  if (authLoaderTitle) authLoaderTitle.textContent = title;
  if (authLoaderSubtitle) authLoaderSubtitle.textContent = subtitle;

  if (authLoaderRing) authLoaderRing.classList.remove('hidden');
  if (authLoaderCheck) {
    authLoaderCheck.classList.add('hidden');
    authLoaderCheck.classList.remove('flex', 'auth-check-pop');
  }

  authLoader.classList.remove('hidden');
  authLoader.setAttribute('aria-hidden', 'false');

  if (authLoaderCard) {
    authLoaderCard.classList.remove('scale-100');
    authLoaderCard.classList.add('scale-95');
  }

  cancelAnimationFrame(authLoaderFrame);
  authLoaderFrame = requestAnimationFrame(() => {
    authLoader.classList.remove('opacity-0');
    if (authLoaderCard) {
      authLoaderCard.classList.remove('scale-95');
      authLoaderCard.classList.add('scale-100');
    }
  });
}

function showAuthLoaderSuccess(title, subtitle = '') {
  if (!authLoader) return;

  if (authLoaderTitle) authLoaderTitle.textContent = title;
  if (authLoaderSubtitle) authLoaderSubtitle.textContent = subtitle;

  if (authLoaderRing) authLoaderRing.classList.add('hidden');

  if (authLoaderCheck) {
    authLoaderCheck.classList.remove('hidden');
    authLoaderCheck.classList.add('flex');
    void authLoaderCheck.offsetWidth;
    authLoaderCheck.classList.add('auth-check-pop');
  }
}

function hideAuthLoader() {
  if (!authLoader) return;

  clearTimeout(authLoaderHideTimer);
  cancelAnimationFrame(authLoaderFrame);
  authLoader.classList.add('opacity-0');
  authLoader.setAttribute('aria-hidden', 'true');

  if (authLoaderCard) {
    authLoaderCard.classList.remove('scale-100');
    authLoaderCard.classList.add('scale-95');
  }

  authLoaderHideTimer = setTimeout(() => {
    authLoader.classList.add('hidden');
  }, 220);
}

async function completeAuthLoader(title, subtitle = '') {
  const elapsed = Date.now() - authLoaderStartedAt;

  if (elapsed < AUTH_LOADER_MIN_MS) {
    await wait(AUTH_LOADER_MIN_MS - elapsed);
  }

  showAuthLoaderSuccess(title, subtitle);
  await wait(AUTH_LOADER_SUCCESS_MS);
  hideAuthLoader();
}

if (authTabLoginBtn) authTabLoginBtn.addEventListener('click', () => switchAuthTab('login'));
if (authTabRegisterBtn) authTabRegisterBtn.addEventListener('click', () => switchAuthTab('register'));

// --- Toggle ver/ocultar contraseña ---
if (authModal) {
  authModal.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-password-btn');
    if (!btn) return;
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    const wasPassword = input.type === 'password';
    input.type = wasPassword ? 'text' : 'password';
    const isHidden = input.type === 'password';
    btn.querySelector('.icon-eye')?.classList.toggle('hidden', isHidden);
    btn.querySelector('.icon-eye-off')?.classList.toggle('hidden', !isHidden);
  });
}

if (authCloseBtn) {
  authCloseBtn.addEventListener('click', () => {
    if (!isAuthenticated()) {
      localStorage.setItem(GUEST_MODE_KEY, 'true');
      updateAuthDrawerUI();
    }
    closeAuthModal();
  });
}

if (guestModeBtn) {
  guestModeBtn.addEventListener('click', () => {
    localStorage.setItem(GUEST_MODE_KEY, 'true');
    updateAuthDrawerUI();
    closeAuthModal();
  });
}

if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isAuthTransitioning) return;

    showAuthError('');

    const email = document.getElementById('loginEmail')?.value.trim();
    const password = document.getElementById('loginPassword')?.value || '';
    const submitBtn = document.getElementById('loginSubmitBtn');

    isAuthTransitioning = true;
    setAuthInputsDisabled(true);
    setButtonLoading(submitBtn, true, 'Ingresando...');
    showAuthLoader('Iniciando sesión...', 'Validando tus credenciales');

    try {
      const res = await fetch(`${AUTH_API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();

      if (res.ok && json.token && json.user) {
        saveAuthSession(json.token, json.user);
        updateAuthDrawerUI();
        closeAuthModal();
        loginForm.reset();
        await completeAuthLoader(welcomeTitle(json.user), 'Entrando a SaltaSoga');
        if (typeof window.onAuthStateChanged === 'function') window.onAuthStateChanged();
      } else {
        hideAuthLoader();
        showAuthError(extractLaravelError(json, 'Correo o contraseña incorrectos.'));
      }
    } catch (err) {
      hideAuthLoader();
      showAuthError('No se pudo conectar con el servidor.');
    } finally {
      isAuthTransitioning = false;
      setButtonLoading(submitBtn, false);
      setAuthInputsDisabled(false);
    }
  });
}

if (registerForm) {
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isAuthTransitioning) return;

    showAuthError('');

    const name = document.getElementById('regName')?.value.trim();
    const email = document.getElementById('regEmail')?.value.trim();
    const password = document.getElementById('regPassword')?.value || '';
    const password_confirmation = document.getElementById('regPasswordConfirm')?.value || '';
    const submitBtn = document.getElementById('registerSubmitBtn');

    if (password !== password_confirmation) {
      showAuthError('Las contraseñas no coinciden.');
      return;
    }

    isAuthTransitioning = true;
    setAuthInputsDisabled(true);
    setButtonLoading(submitBtn, true, 'Creando cuenta...');
    showAuthLoader('Creando tu cuenta...', 'Preparando tu perfil');

    try {
      const res = await fetch(`${AUTH_API_BASE}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ name, email, password, password_confirmation }),
      });
      const json = await res.json();

      if (res.ok && json.token && json.user) {
        saveAuthSession(json.token, json.user);
        updateAuthDrawerUI();
        closeAuthModal();
        registerForm.reset();
        await completeAuthLoader(welcomeTitle(json.user), 'Tu cuenta está lista');
        if (typeof window.onAuthStateChanged === 'function') window.onAuthStateChanged();
      } else {
        hideAuthLoader();
        showAuthError(extractLaravelError(json, 'No se pudo completar el registro.'));
      }
    } catch (err) {
      hideAuthLoader();
      showAuthError('No se pudo conectar con el servidor.');
    } finally {
      isAuthTransitioning = false;
      setButtonLoading(submitBtn, false);
      setAuthInputsDisabled(false);
    }
  });
}

if (drawerLoginBtn) {
  drawerLoginBtn.addEventListener('click', () => {
    if (typeof toggleDrawer === 'function') toggleDrawer(false);
    openAuthModal('login');
  });
}

if (drawerLogoutBtn) {
  drawerLogoutBtn.addEventListener('click', async () => {
    if (isAuthTransitioning) return;

    isAuthTransitioning = true;

    const wasAuthenticated = isAuthenticated();
    const token = getAuthToken();

    setButtonLoading(drawerLogoutBtn, true, 'Cerrando sesión...');
    showAuthLoader('Cerrando sesión...', 'Revocando tu acceso');

    try {
      if (wasAuthenticated && token) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        try {
          await fetch(`${AUTH_API_BASE}/logout`, {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` },
            signal: controller.signal,
          });
        } catch (e) {
          // Si la red falla o tarda, igual cerramos la sesión local.
        } finally {
          clearTimeout(timeoutId);
        }
      }
    } finally {
      clearAuthSession();
      localStorage.setItem(GUEST_MODE_KEY, 'true');
      updateAuthDrawerUI();
      if (typeof toggleDrawer === 'function') toggleDrawer(false);
    }

    await completeAuthLoader('Sesión cerrada', 'Ahora navegas como invitado');

    isAuthTransitioning = false;
    setButtonLoading(drawerLogoutBtn, false);
    if (typeof window.onAuthStateChanged === 'function') window.onAuthStateChanged();
  });
}

// Inicialización al cargar la app
async function initAuth() {
  updateAuthDrawerUI();

  if (isAuthenticated()) {
    // Validar token silenciosamente en segundo plano
    try {
      const res = await apiFetch('/user');
      if (res.ok) {
        const json = await res.json();
        if (json.user) {
          localStorage.setItem(AUTH_USER_KEY, JSON.stringify(json.user));
          updateAuthDrawerUI();
        }
      }
    } catch (e) {
      // Sin conexión: mantener sesión local hasta que vuelva la red
    }
  } else if (!isGuestMode()) {
    openAuthModal('login');
  }
}

window.apiFetch = apiFetch;
window.isAuthenticated = isAuthenticated;
window.isGuestMode = isGuestMode;
window.getAuthUser = getAuthUser;
window.openAuthModal = openAuthModal;
window.GUEST_SESSIONS_KEY = GUEST_SESSIONS_KEY;

initAuth();
