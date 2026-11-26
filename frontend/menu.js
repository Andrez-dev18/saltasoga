// --- Elementos de Navegación y Vistas ---
const openMenuBtn = document.getElementById('openMenuBtn');
const closeMenuBtn = document.getElementById('closeMenuBtn');
const menuOverlay = document.getElementById('menuOverlay');
const sideMenu = document.getElementById('sideMenu');

const viewWorkout = document.getElementById('view-workout');
const viewHistory = document.getElementById('view-history');
const viewCalibration = document.getElementById('view-calibration');
const currentViewTitle = document.getElementById('currentViewTitle');

const navWorkoutBtn = document.getElementById('navWorkoutBtn');
const navHistoryBtn = document.getElementById('navHistoryBtn');
const navCalibrationBtn = document.getElementById('navCalibrationBtn');
const refreshHistoryBtn = document.getElementById('refreshHistoryBtn');

// Referencias a los inputs de filtro
const filterFrom = document.getElementById('filterFrom');
const filterTo = document.getElementById('filterTo');
const applyFilterBtn = document.getElementById('applyFilterBtn');

// Establecer valores por defecto (últimos 7 días)
function setDefaultFilterDates() {
  const hoy = new Date();
  const hace7Dias = new Date();
  hace7Dias.setDate(hoy.getDate() - 7);

  // Formato YYYY-MM-DD
  if (filterTo) filterTo.value = hoy.toISOString().split('T')[0];
  if (filterFrom) filterFrom.value = hace7Dias.toISOString().split('T')[0];
}

// Escuchar el clic del botón filtrar
if (applyFilterBtn) {
  applyFilterBtn.addEventListener('click', () => {
    cargarHistorialSesiones(filterFrom.value, filterTo.value);
  });
}

// Restablecer a los últimos 7 días
if (refreshHistoryBtn) {
  refreshHistoryBtn.addEventListener('click', () => {
    setDefaultFilterDates();
    cargarHistorialSesiones();
  });
}

// Control de apertura y cierre del menú lateral
function toggleDrawer(open) {
  if (open) {
    menuOverlay.classList.remove('hidden');
    setTimeout(() => {
      menuOverlay.classList.remove('opacity-0');
      sideMenu.classList.remove('-translate-x-full');
    }, 10);
  } else {
    menuOverlay.classList.add('opacity-0');
    sideMenu.classList.add('-translate-x-full');
    setTimeout(() => {
      menuOverlay.classList.add('hidden');
    }, 300);
  }
}

// Estilos de botones de navegación
const NAV_ACTIVE_CLASS = "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 transition";
const NAV_INACTIVE_CLASS = "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition";

// Alternar entre las pantallas
function switchView(viewName) {
  toggleDrawer(false);

  // Detener cámaras y temporizadores de vistas previas (conservando sesión activa en pausa)
  if (viewName !== 'workout') {
    if (typeof window.pauseWorkoutOnLeave === 'function') {
      window.pauseWorkoutOnLeave();
    } else {
      if (typeof stopCamera === 'function') stopCamera();
      if (typeof timerInterval !== 'undefined') clearInterval(timerInterval);
    }
  }
  if (viewName !== 'calibration') {
    if (typeof window.stopCalibrationCamera === 'function') window.stopCalibrationCamera();
  }

  // Ocultar todas las vistas primero
  if (viewWorkout) {
    viewWorkout.style.display = 'none';
    viewWorkout.classList.add('hidden');
  }
  if (viewHistory) {
    viewHistory.style.display = 'none';
    viewHistory.classList.add('hidden');
  }
  if (viewCalibration) {
    viewCalibration.style.display = 'none';
    viewCalibration.classList.add('hidden');
  }

  // Restablecer estilos de botones del menú
  if (navWorkoutBtn) navWorkoutBtn.className = NAV_INACTIVE_CLASS;
  if (navHistoryBtn) navHistoryBtn.className = NAV_INACTIVE_CLASS;
  if (navCalibrationBtn) navCalibrationBtn.className = NAV_INACTIVE_CLASS;

  // Activar la vista seleccionada
  if (viewName === 'workout') {
    if (viewWorkout) {
      viewWorkout.style.display = 'flex';
      viewWorkout.classList.remove('hidden');
    }
    if (currentViewTitle) currentViewTitle.textContent = 'Saltar Soga';
    if (navWorkoutBtn) navWorkoutBtn.className = NAV_ACTIVE_CLASS;

    // Recargar configuración y reactivar cámara en vivo si había un entrenamiento en curso
    if (typeof window.resumeWorkoutView === 'function') {
      window.resumeWorkoutView();
    } else if (typeof window.reloadWorkoutConfig === 'function') {
      window.reloadWorkoutConfig();
    }
  } else if (viewName === 'calibration') {
    if (viewCalibration) {
      viewCalibration.style.display = 'flex';
      viewCalibration.classList.remove('hidden');
    }
    if (currentViewTitle) currentViewTitle.textContent = 'Calibración & Modos';
    if (navCalibrationBtn) navCalibrationBtn.className = NAV_ACTIVE_CLASS;

    // Iniciar cámara de calibración
    if (typeof window.startCalibration === 'function') {
      window.startCalibration();
    }
  } else if (viewName === 'history') {
    if (viewHistory) {
      viewHistory.style.display = 'flex';
      viewHistory.classList.remove('hidden');
    }
    if (currentViewTitle) currentViewTitle.textContent = 'Historial de Sesiones';
    if (navHistoryBtn) navHistoryBtn.className = NAV_ACTIVE_CLASS;

    cargarMetricasUsuario();
    cargarHistorialSesiones();
  }
}

// Exportar globalmente
window.switchView = switchView;

// Listeners de navegación
if (openMenuBtn) openMenuBtn.addEventListener('click', () => toggleDrawer(true));
if (closeMenuBtn) closeMenuBtn.addEventListener('click', () => toggleDrawer(false));
if (menuOverlay) menuOverlay.addEventListener('click', () => toggleDrawer(false));

if (navWorkoutBtn) navWorkoutBtn.addEventListener('click', () => switchView('workout'));
if (navCalibrationBtn) navCalibrationBtn.addEventListener('click', () => switchView('calibration'));
if (navHistoryBtn) navHistoryBtn.addEventListener('click', () => switchView('history'));
if (refreshHistoryBtn) refreshHistoryBtn.addEventListener('click', () => {
  setDefaultFilterDates();
  cargarHistorialSesiones();
});

// Helpers para sesiones locales en Modo Invitado
function getGuestSessionsLocal() {
  const key = window.GUEST_SESSIONS_KEY || 'saltasoga_guest_sessions';
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch (e) {
    return [];
  }
}

function setGuestSessionsLocal(sessions) {
  const key = window.GUEST_SESSIONS_KEY || 'saltasoga_guest_sessions';
  localStorage.setItem(key, JSON.stringify(sessions));
}

function renderStatsCards(stats) {
  const elJumps = document.getElementById('statTotalJumps');
  const elSessions = document.getElementById('statTotalSessions');
  const elBest = document.getElementById('statBestJumps');
  const elKcal = document.getElementById('statTotalCalories');

  if (elJumps) elJumps.textContent = (stats.total_jumps ?? 0).toLocaleString('es-ES');
  if (elSessions) elSessions.textContent = stats.total_sessions ?? 0;
  if (elBest) elBest.textContent = stats.best_session_jumps ?? 0;
  if (elKcal) elKcal.textContent = Math.round(stats.total_calories ?? 0);
}

// Cargar métricas personales del usuario (API autenticada o local en Modo Invitado)
async function cargarMetricasUsuario() {
  if (typeof window.isAuthenticated === 'function' && window.isAuthenticated()) {
    try {
      const res = await window.apiFetch('/stats');
      if (res.ok) {
        const json = await res.json();
        if (json.data) renderStatsCards(json.data);
        return;
      }
    } catch (err) {
      console.warn('No se pudieron cargar métricas del servidor:', err);
    }
  }

  const localSessions = getGuestSessionsLocal();
  const stats = localSessions.reduce((acc, s) => {
    const jumps = Number(s.total_jumps) || 0;
    acc.total_sessions += 1;
    acc.total_jumps += jumps;
    acc.total_calories += Number(s.calories) || 0;
    if (jumps > acc.best_session_jumps) acc.best_session_jumps = jumps;
    return acc;
  }, { total_sessions: 0, total_jumps: 0, best_session_jumps: 0, total_calories: 0 });

  renderStatsCards(stats);
}

async function eliminarSesion(id, isLocal) {
  if (isLocal) {
    const updated = getGuestSessionsLocal().filter(s => String(s.id) !== String(id));
    setGuestSessionsLocal(updated);
    cargarMetricasUsuario();
    cargarHistorialSesiones(filterFrom?.value || null, filterTo?.value || null);
    return;
  }

  try {
    const res = await window.apiFetch(`/sessions/${id}`, { method: 'DELETE' });
    if (res.ok) {
      cargarMetricasUsuario();
      cargarHistorialSesiones(filterFrom?.value || null, filterTo?.value || null);
    }
  } catch (err) {
    console.error('Error al eliminar sesión:', err);
  }
}

window.eliminarSesion = eliminarSesion;

// Recargar historial y métricas si cambia el usuario autenticado / invitado
window.onAuthStateChanged = function () {
  if (viewHistory && !viewHistory.classList.contains('hidden')) {
    cargarMetricasUsuario();
    cargarHistorialSesiones();
  }
};

// Cargar historial de sesiones desde backend (o localStorage en Modo Invitado)
async function cargarHistorialSesiones(from = null, to = null) {
  const container = document.getElementById('sessionsList');
  if (!container) return;

  container.innerHTML = `<div class="text-center text-sm text-gray-500 py-8">Cargando entrenamientos...</div>`;

  try {
    let data = [];
    let range = null;

    if (typeof window.isAuthenticated === 'function' && window.isAuthenticated()) {
      let endpoint = '/sessions';
      const params = new URLSearchParams();

      if (from && to) {
        params.append('from', from);
        params.append('to', to);
        endpoint += `?${params.toString()}`;
      }

      const res = await window.apiFetch(endpoint);
      const json = await res.json();
      data = json.data || [];
      range = json.range || null;
    } else {
      // Modo Invitado: leer y filtrar sesiones guardadas localmente
      const allLocal = getGuestSessionsLocal();
      const today = new Date();
      const defaultFrom = new Date();
      defaultFrom.setDate(today.getDate() - 7);

      const fromStr = from || defaultFrom.toISOString().split('T')[0];
      const toStr = to || today.toISOString().split('T')[0];
      range = { from: fromStr, to: toStr };

      const fromMs = new Date(`${fromStr}T00:00:00`).getTime();
      const toMs = new Date(`${toStr}T23:59:59`).getTime();

      data = allLocal.filter(item => {
        const t = new Date(item.completed_at || Date.now()).getTime();
        return t >= fromMs && t <= toMs;
      });
    }

    // Sincronizar los inputs con el rango aplicado
    if (range && filterFrom && filterTo && !from) {
      filterFrom.value = range.from;
      filterTo.value = range.to;
    }

    if (data.length === 0) {
      container.innerHTML = `
        <div class="text-center py-10 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6">
          <p class="text-gray-400 text-sm font-medium">No se encontraron sesiones en este rango de fechas.</p>
          <span class="text-xs text-gray-500 block mt-1">Prueba ampliando el rango o realiza un nuevo entrenamiento.</span>
        </div>
      `;
      return;
    }

    container.innerHTML = data.map(item => {
      const rawDate = item.completed_at || item.created_at;
      let fechaFormateada = "Fecha no disponible";
      if (rawDate) {
        const fecha = new Date(rawDate.replace(' ', 'T'));
        fechaFormateada = !isNaN(fecha) ? fecha.toLocaleDateString('es-ES', {
          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
        }) : rawDate;
      }

      const totalSegs = parseInt(item.duration_seconds, 10) || 0;
      const mins = Math.floor(totalSegs / 60);
      const segs = String(totalSegs % 60).padStart(2, '0');
      const localBadge = item.is_local
        ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 font-semibold">Local</span>`
        : '';

      return `
        <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 shadow-xs hover:border-emerald-500/50 transition">
          <div class="flex justify-between items-center mb-2 gap-2">
            <span class="text-base font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
              ${item.total_jumps ?? 0} saltos
              ${localBadge}
            </span>
            <div class="flex items-center gap-2">
              <span class="text-xs text-gray-400">${fechaFormateada}</span>
              <button type="button" onclick="window.eliminarSesion('${item.id}', ${Boolean(item.is_local)})"
                title="Eliminar sesión"
                class="p-1 rounded-lg text-gray-400 hover:text-rose-500 hover:bg-rose-500/10 transition">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>

          <div class="grid grid-cols-3 gap-2 text-center text-xs pt-2 border-t border-gray-100 dark:border-gray-800">
            <div>
              <span class="text-gray-400 text-[10px] block uppercase font-medium">Tiempo</span>
              <span class="font-bold text-gray-800 dark:text-gray-200 text-sm">${mins}:${segs}</span>
            </div>
            <div>
              <span class="text-gray-400 text-[10px] block uppercase font-medium">Ritmo</span>
              <span class="font-bold text-violet-500 text-sm">${item.avg_spm ?? 0} SPM</span>
            </div>
            <div>
              <span class="text-gray-400 text-[10px] block uppercase font-medium">Calorías</span>
              <span class="font-bold text-amber-500 text-sm">${item.calories ?? '0.00'} kcal</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('Error cargando historial:', err);
    container.innerHTML = `
      <div class="text-center py-8 text-rose-500 text-xs bg-rose-500/10 rounded-xl border border-rose-500/20">
        Error al procesar los datos de las sesiones.
      </div>
    `;
  }
}
