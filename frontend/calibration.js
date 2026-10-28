// ===================================================================
// CALIBRATION MODULE (Principio de Responsabilidad Única)
// Gestiona exclusivamente la calibración, selección de modos y la línea límite
// ===================================================================

const CONFIG_STORAGE_KEY = 'saltasoga_config';

// Configuración por defecto
const DEFAULT_CONFIG = {
  mode: 'auto',       // 'auto' (Cuerpo Completo) o 'line' (Línea de Umbral)
  lineY: 0.52         // Posición normalizada de la línea en pantalla (0.0 = arriba, 1.0 = abajo)
};

// Cargar configuración de localStorage o usar por defecto
function getStoredConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.warn("No se pudo leer la configuración, usando predeterminada:", e);
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config) {
  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.error("Error al guardar la configuración en localStorage:", e);
  }
}

// Variables de estado del módulo
let currentConfig = getStoredConfig();
let isDraggingLine = false;
let calibrationStream = null;
let calibrationVideoLooping = false;
let lastDetectedHipY = null;
let isTestingInAir = false;

// Referencias a elementos del DOM de calibración
const modeAutoBtn = document.getElementById('modeAutoBtn');
const modeLineBtn = document.getElementById('modeLineBtn');
const modeDescription = document.getElementById('modeDescription');
const calibrationCamContainer = document.getElementById('calibrationCamContainer');
const calibrationVideo = document.getElementById('calibrationWebcam');
const calibrationCanvas = document.getElementById('calibrationCanvas');
const calibCtx = calibrationCanvas ? calibrationCanvas.getContext('2d', { alpha: false, desynchronized: true }) : null;

const calibFeedbackBadge = document.getElementById('calibFeedbackBadge');
const calibFeedbackDot = document.getElementById('calibFeedbackDot');
const calibFeedbackText = document.getElementById('calibFeedbackText');
const autoPositionBtn = document.getElementById('autoPositionBtn');
const calibInstructionText = document.getElementById('calibInstructionText');
const saveCalibrationBtn = document.getElementById('saveCalibrationBtn');

// Inicializar MediaPipe Pose dedicado para la vista de calibración
const calibrationPose = new Pose({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
});

calibrationPose.setOptions({
  modelComplexity: 0,
  smoothLandmarks: true,
  enableSegmentation: false,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

calibrationPose.onResults(onCalibrationResults);

// Renderizado y procesamiento de cada frame en calibración
function onCalibrationResults(results) {
  if (!calibrationCanvas || !calibCtx) return;

  const vw = calibrationVideo.videoWidth || 360;
  const vh = calibrationVideo.videoHeight || 480;
  if (calibrationCanvas.width !== vw || calibrationCanvas.height !== vh) {
    calibrationCanvas.width = vw;
    calibrationCanvas.height = vh;
  }

  // Cámara frontal en espejo
  calibrationCanvas.style.transform = 'scaleX(-1)';

  calibCtx.save();
  calibCtx.drawImage(results.image, 0, 0, calibrationCanvas.width, calibrationCanvas.height);

  let currentHipY = null;

  if (results.poseLandmarks) {
    const leftHip = results.poseLandmarks[23];
    const rightHip = results.poseLandmarks[24];

    if (leftHip && rightHip && leftHip.visibility > 0.5 && rightHip.visibility > 0.5) {
      currentHipY = (leftHip.y + rightHip.y) / 2;
      lastDetectedHipY = currentHipY;

      // Dibujar punto visual en la cadera para confirmar rastreo
      const hipScreenX = ((leftHip.x + rightHip.x) / 2) * calibrationCanvas.width;
      const hipScreenY = currentHipY * calibrationCanvas.height;

      calibCtx.beginPath();
      calibCtx.arc(hipScreenX, hipScreenY, 7, 0, 2 * Math.PI);
      calibCtx.fillStyle = '#38bdf8';
      calibCtx.strokeStyle = '#ffffff';
      calibCtx.lineWidth = 2;
      calibCtx.fill();
      calibCtx.stroke();
    }
  }

  // Dibujar elementos específicos del modo
  if (currentConfig.mode === 'line') {
    drawLineGuide(currentHipY);
  } else {
    drawAutoGuide(results.poseLandmarks);
  }

  calibCtx.restore();
}

// Dibujar la línea interactiva de umbral
function drawLineGuide(detectedHipY) {
  const linePixelY = currentConfig.lineY * calibrationCanvas.height;
  const isCrossing = detectedHipY !== null && detectedHipY < currentConfig.lineY;

  // Actualizar estado de prueba de salto
  if (isCrossing && !isTestingInAir) {
    isTestingInAir = true;
    updateFeedbackBadge('success', '¡LÍMITE SUPERADO! (Salto detectado)');
  } else if (!isCrossing && isTestingInAir) {
    isTestingInAir = false;
    updateFeedbackBadge('ready', 'Prueba dando un salto');
  } else if (!isTestingInAir && detectedHipY === null) {
    updateFeedbackBadge('waiting', 'Ponte frente a la cámara (cintura visible)');
  }

  // Color de la línea según interacción
  const lineColor = isCrossing 
    ? '#10b981' // Verde al cruzar
    : (isDraggingLine ? '#f59e0b' : '#06b6d4'); // Ámbar si arrastra, cyan por defecto

  // Aura brillante de la línea
  calibCtx.save();
  calibCtx.strokeStyle = lineColor;
  calibCtx.lineWidth = isCrossing ? 5 : 3;
  calibCtx.shadowColor = lineColor;
  calibCtx.shadowBlur = 12;

  calibCtx.beginPath();
  calibCtx.moveTo(0, linePixelY);
  calibCtx.lineTo(calibrationCanvas.width, linePixelY);
  calibCtx.stroke();

  // Tiradores / Handles táctiles en los extremos y centro
  const handleX = calibrationCanvas.width / 2;
  calibCtx.fillStyle = lineColor;
  calibCtx.shadowBlur = 0;
  calibCtx.beginPath();
  calibCtx.arc(handleX, linePixelY, 8, 0, 2 * Math.PI);
  calibCtx.fill();
  calibCtx.strokeStyle = '#ffffff';
  calibCtx.lineWidth = 2;
  calibCtx.stroke();

  // Etiqueta flotante sobre la línea
  calibCtx.fillStyle = 'rgba(0,0,0,0.7)';
  calibCtx.fillRect(handleX - 45, linePixelY - 26, 90, 20);
  calibCtx.fillStyle = '#ffffff';
  calibCtx.font = 'bold 11px sans-serif';
  calibCtx.textAlign = 'center';
  calibCtx.textBaseline = 'middle';
  calibCtx.fillText(isCrossing ? '¡SUPERADO!' : 'LÍNEA SALTO', handleX, linePixelY - 16);

  calibCtx.restore();
}

// Dibujar marco guía cuando está en modo auto
function drawAutoGuide(landmarks) {
  calibCtx.save();
  calibCtx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
  calibCtx.lineWidth = 2;
  calibCtx.setLineDash([8, 8]);
  calibCtx.strokeRect(20, 20, calibrationCanvas.width - 40, calibrationCanvas.height - 40);

  const hasFullBody = landmarks && landmarks[11] && landmarks[27] && landmarks[11].visibility > 0.5 && landmarks[27].visibility > 0.5;
  if (hasFullBody) {
    updateFeedbackBadge('success', '¡Cuerpo completo detectado!');
  } else {
    updateFeedbackBadge('waiting', 'Aléjate hasta ver cabeza y pies');
  }
  calibCtx.restore();
}

// Actualizar el badge de estado en pantalla
function updateFeedbackBadge(type, message) {
  if (!calibFeedbackText || !calibFeedbackDot) return;
  calibFeedbackText.textContent = message;

  calibFeedbackDot.className = "w-2.5 h-2.5 rounded-full";
  if (type === 'success') {
    calibFeedbackDot.classList.add('bg-emerald-400', 'animate-ping');
  } else if (type === 'ready') {
    calibFeedbackDot.classList.add('bg-cyan-400');
  } else {
    calibFeedbackDot.classList.add('bg-amber-400', 'animate-pulse');
  }
}

// Interacción táctil / ratón para arrastrar la línea
function setupLineDragging() {
  if (!calibrationCamContainer) return;

  function updateLineFromClientY(clientY) {
    const rect = calibrationCanvas.getBoundingClientRect();
    const relativeY = clientY - rect.top;
    let normalized = relativeY / rect.height;

    // Limitar entre 15% y 85% del alto de la pantalla
    normalized = Math.max(0.15, Math.min(0.85, normalized));
    currentConfig.lineY = normalized;
  }

  calibrationCamContainer.addEventListener('pointerdown', (e) => {
    if (currentConfig.mode !== 'line') return;
    const rect = calibrationCanvas.getBoundingClientRect();
    const linePixelY = currentConfig.lineY * rect.height;
    const pointerY = e.clientY - rect.top;

    // Permitir arrastrar si toca cerca de la línea (margen de 45px) o en el contenedor
    if (Math.abs(pointerY - linePixelY) < 55) {
      isDraggingLine = true;
      calibrationCamContainer.setPointerCapture(e.pointerId);
      updateLineFromClientY(e.clientY);
    }
  });

  calibrationCamContainer.addEventListener('pointermove', (e) => {
    if (isDraggingLine) {
      updateLineFromClientY(e.clientY);
    }
  });

  const stopDrag = (e) => {
    if (isDraggingLine) {
      isDraggingLine = false;
      try {
        calibrationCamContainer.releasePointerCapture(e.pointerId);
      } catch (err) {}
    }
  };

  calibrationCamContainer.addEventListener('pointerup', stopDrag);
  calibrationCamContainer.addEventListener('pointercancel', stopDrag);
}

// Auto-posicionar la línea unos centímetros arriba de la cadera detectada
if (autoPositionBtn) {
  autoPositionBtn.addEventListener('click', () => {
    if (lastDetectedHipY !== null) {
      // Posicionar la línea aproximadamente un 8% de altura arriba de la cadera
      currentConfig.lineY = Math.max(0.15, lastDetectedHipY - 0.08);
      updateFeedbackBadge('success', '¡Línea auto-ajustada sobre tu cadera!');
    } else {
      updateFeedbackBadge('waiting', 'Ponte frente a la cámara primero para detectar tu cadera');
    }
  });
}

// Botones de selección de modo
function applyModeUI(mode) {
  currentConfig.mode = mode;

  if (mode === 'auto') {
    modeAutoBtn.className = "flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 bg-emerald-500 text-black shadow-xs";
    modeLineBtn.className = "flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white";
    modeDescription.textContent = "Modo Cuerpo Completo: requiere estar de pie a 2.5-3m para ver cabeza y pies.";
    if (autoPositionBtn) autoPositionBtn.classList.add('hidden');
    if (calibInstructionText) calibInstructionText.textContent = "Modo automático activo: Aléjate para ver cuerpo entero";
  } else {
    modeLineBtn.className = "flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 bg-emerald-500 text-black shadow-xs";
    modeAutoBtn.className = "flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white";
    modeDescription.textContent = "Modo Línea Límite: ideal a 1-1.5m. Solo necesitas ver tu cintura o cadera.";
    if (autoPositionBtn) autoPositionBtn.classList.remove('hidden');
    if (calibInstructionText) calibInstructionText.textContent = "Toca o arrastra la línea con tu dedo para definir la altura del salto";
  }
}

if (modeAutoBtn) modeAutoBtn.addEventListener('click', () => applyModeUI('auto'));
if (modeLineBtn) modeLineBtn.addEventListener('click', () => applyModeUI('line'));

// Botón: Guardar y pasar a entrenar
if (saveCalibrationBtn) {
  saveCalibrationBtn.addEventListener('click', () => {
    saveConfig(currentConfig);

    // Detener la cámara de calibración
    stopCalibrationCamera();

    // Notificar al módulo de entrenamiento para recargar la configuración guardada
    if (typeof window.reloadWorkoutConfig === 'function') {
      window.reloadWorkoutConfig();
    }

    // Cambiar a la vista de entrenamiento
    if (typeof window.switchView === 'function') {
      window.switchView('workout');
    }
  });
}

// Iniciar cámara de calibración
async function startCalibrationCamera() {
  if (calibrationStream) {
    calibrationStream.getTracks().forEach(track => track.stop());
  }

  currentConfig = getStoredConfig();
  applyModeUI(currentConfig.mode);

  try {
    const constraints = {
      video: {
        facingMode: 'user',
        width: { ideal: 360, max: 480 },
        height: { ideal: 480, max: 640 },
        frameRate: { ideal: 30, max: 30 }
      },
      audio: false
    };

    calibrationStream = await navigator.mediaDevices.getUserMedia(constraints);
    calibrationVideo.srcObject = calibrationStream;
    await calibrationVideo.play();

    calibrationVideoLooping = true;
    requestAnimationFrame(processCalibrationFrame);
  } catch (err) {
    console.error("Error al abrir cámara de calibración:", err);
    updateFeedbackBadge('waiting', 'Error al acceder a la cámara');
  }
}

let lastCalibInferenceTime = 0;
const CALIB_INTERVAL_MS = 32;

async function processCalibrationFrame(timestamp) {
  if (!calibrationVideoLooping) return;

  if (calibrationVideo.readyState >= 2) {
    const now = timestamp || performance.now();
    if (now - lastCalibInferenceTime >= CALIB_INTERVAL_MS) {
      lastCalibInferenceTime = now;
      try {
        await calibrationPose.send({ image: calibrationVideo });
      } catch (e) {
        console.warn("Error en pose calibración:", e);
      }
    }
  }
  requestAnimationFrame(processCalibrationFrame);
}

// Detener cámara de calibración
function stopCalibrationCamera() {
  calibrationVideoLooping = false;
  if (calibrationStream) {
    calibrationStream.getTracks().forEach(track => track.stop());
    calibrationStream = null;
  }
  if (calibrationVideo) {
    calibrationVideo.srcObject = null;
  }
}

// Configurar listeners táctiles
setupLineDragging();

// Exportar funciones globales para menu.js y app.js
window.startCalibration = startCalibrationCamera;
window.stopCalibrationCamera = stopCalibrationCamera;
window.getSaltasogaConfig = getStoredConfig;
