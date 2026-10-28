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

  // Detener cámaras y temporizadores de vistas previas
  if (viewName !== 'workout') {
    if (typeof stopCamera === 'function') stopCamera();
    if (typeof timerInterval !== 'undefined') clearInterval(timerInterval);
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

    // Recargar configuración (por si cambió en calibración)
    if (typeof window.reloadWorkoutConfig === 'function') {
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

// Cargar historial de sesiones desde backend
async function cargarHistorialSesiones(from = null, to = null) {
  const container = document.getElementById('sessionsList');
  if (!container) return;

  container.innerHTML = `<div class="text-center text-sm text-gray-500 py-8">Cargando entrenamientos...</div>`;

  try {
    let url = `${API_BASE_URL}/sessions`;
    const params = new URLSearchParams();

    if (from && to) {
      params.append('from', from);
      params.append('to', to);
      url += `?${params.toString()}`;
    }

    const res = await fetch(url);
    const json = await res.json();
    const data = json.data || [];

    // Sincronizar los inputs si el backend devolvió el rango aplicado por defecto
    if (json.range && filterFrom && filterTo && !from) {
      filterFrom.value = json.range.from;
      filterTo.value = json.range.to;
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

      return `
        <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 shadow-xs hover:border-emerald-500/50 transition">
          <div class="flex justify-between items-center mb-2">
            <span class="text-base font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
              ${item.total_jumps ?? 0} saltos
            </span>
            <span class="text-xs text-gray-400">${fechaFormateada}</span>
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
