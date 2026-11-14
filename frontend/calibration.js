// ===================================================================
// CALIBRATION MODULE (Principio de Responsabilidad Única)
// Gestiona exclusivamente la calibración, selección de modos y la línea límite
// ===================================================================

const CONFIG_STORAGE_KEY = 'saltasoga_config';

// Configuración por defecto
const DEFAULT_CONFIG = {
  mode: 'auto',              // 'auto' (Cuerpo Completo) o 'line' (Línea de Umbral)
  lineY: 0.52,               // Posición normalizada de la línea en pantalla (0.0 = arriba, 1.0 = abajo)
  countdownSeconds: 3,       // 3, 5 o 10 segundos de preparación
  jumpSensitivity: 'short'   // 'short' (salto corto/rápido de soga), 'normal' (estándar), 'high' (alto/potencia)
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
let lastDetectedWaistY = null;
let lastDetectedTorsoHeight = 0.25;
let isTestingInAir = false;

// Referencias a elementos del DOM de calibración
const modeAutoBtn = document.getElementById('modeAutoBtn');
const modeLineBtn = document.getElementById('modeLineBtn');
const modeDescription = document.getElementById('modeDescription');
const lineModeOptions = document.getElementById('lineModeOptions');

const timer3sBtn = document.getElementById('timer3sBtn');
const timer5sBtn = document.getElementById('timer5sBtn');
const timer10sBtn = document.getElementById('timer10sBtn');

const sensShortBtn = document.getElementById('sensShortBtn');
const sensNormalBtn = document.getElementById('sensNormalBtn');
const sensHighBtn = document.getElementById('sensHighBtn');

const calibrationCamContainer = document.getElementById('calibrationCamContainer');
const calibrationVideo = document.getElementById('calibrationWebcam');
const calibrationCanvas = document.getElementById('calibrationCanvas');
const calibCtx = calibrationCanvas ? calibrationCanvas.getContext('2d', { alpha: false, desynchronized: true }) : null;

const calibFeedbackBadge = document.getElementById('calibFeedbackBadge');
const calibFeedbackDot = document.getElementById('calibFeedbackDot');
const calibFeedbackText = document.getElementById('calibFeedbackText');
const autoPositionBtn = document.getElementById('autoPositionBtn');
const autoPositionBtnText = document.getElementById('autoPositionBtnText');
const calibCountdownOverlay = document.getElementById('calibCountdownOverlay');
const calibCountdownNumber = document.getElementById('calibCountdownNumber');
const calibCountdownMsg = document.getElementById('calibCountdownMsg');
const cancelCountdownBtn = document.getElementById('cancelCountdownBtn');
const calibInstructionText = document.getElementById('calibInstructionText');
const saveCalibrationBtn = document.getElementById('saveCalibrationBtn');

// Generador de audio sintetizado ligero (Web Audio API)
let audioCtx = null;
function playBeep(freq = 520, duration = 0.12, type = 'sine') {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {}
}

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

  let currentTrackedWaistY = null;

  if (results.poseLandmarks) {
    const landmarks = results.poseLandmarks;
    const nose = landmarks[0];
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];

    const shouldersVisible = leftShoulder && rightShoulder && leftShoulder.visibility > 0.48 && rightShoulder.visibility > 0.48;
    const hipsVisible = leftHip && rightHip && leftHip.visibility > 0.48 && rightHip.visibility > 0.48;
    const headVisible = nose && nose.visibility > 0.35;

    const testHipY = (leftHip && rightHip) ? (leftHip.y + rightHip.y) / 2 : 0;
    const testShoulderY = (leftShoulder && rightShoulder) ? (leftShoulder.y + rightShoulder.y) / 2 : 0;
    const torsoHeight = Math.abs(testHipY - testShoulderY);
    const hasValidAnatomy = testHipY > testShoulderY && torsoHeight > 0.08 && torsoHeight < 0.65;

    // Solo si hay un cuerpo humano real y anatómico
    if (shouldersVisible && hipsVisible && (headVisible || torsoHeight > 0.12) && hasValidAnatomy) {
      // ESTIMACIÓN ANATÓMICA INMUNE AL POLO:
      // La cresta ilíaca / cintura anatómica se sitúa a ~88-90% de distancia entre hombros y cadera
      currentTrackedWaistY = testShoulderY + torsoHeight * 0.90;
      lastDetectedWaistY = currentTrackedWaistY;
      lastDetectedTorsoHeight = torsoHeight;

      // Dibujar punto visual en la cintura anatómica
      const waistScreenX = ((leftHip.x + rightHip.x) / 2) * calibrationCanvas.width;
      const waistScreenY = currentTrackedWaistY * calibrationCanvas.height;

      calibCtx.beginPath();
      calibCtx.arc(waistScreenX, waistScreenY, 7, 0, 2 * Math.PI);
      calibCtx.fillStyle = isTestingInAir ? '#10b981' : '#38bdf8';
      calibCtx.strokeStyle = '#ffffff';
      calibCtx.lineWidth = 2;
      calibCtx.fill();
      calibCtx.stroke();
    } else {
      lastDetectedWaistY = null;
    }
  } else {
    lastDetectedWaistY = null;
  }

  // Dibujar elementos específicos del modo
  if (currentConfig.mode === 'line') {
    drawLineGuide(currentTrackedWaistY);
  } else {
    drawAutoGuide(results.poseLandmarks);
  }

  calibCtx.restore();
}

// Dibujar la línea interactiva de umbral
function drawLineGuide(detectedWaistY) {
  const linePixelY = currentConfig.lineY * calibrationCanvas.height;
  const isCrossing = detectedWaistY !== null && detectedWaistY < currentConfig.lineY;

  // Actualizar estado de prueba de salto
  if (isCrossing && !isTestingInAir) {
    isTestingInAir = true;
    updateFeedbackBadge('success', '¡Salto!');
  } else if (!isCrossing && isTestingInAir) {
    isTestingInAir = false;
    updateFeedbackBadge('ready', 'Listo');
  } else if (!isTestingInAir && detectedWaistY === null) {
    updateFeedbackBadge('waiting', 'Buscando cintura...');
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

  // Tiradores / Handles táctiles en el centro
  const handleX = calibrationCanvas.width / 2;
  calibCtx.fillStyle = lineColor;
  calibCtx.shadowBlur = 0;
  calibCtx.beginPath();
  calibCtx.arc(handleX, linePixelY, 8, 0, 2 * Math.PI);
  calibCtx.fill();
  calibCtx.strokeStyle = '#ffffff';
  calibCtx.lineWidth = 2;
  calibCtx.stroke();

  // Etiqueta flotante sobre la línea (des-espejada para contrarrestar el scaleX(-1) del canvas)
  calibCtx.save();
  calibCtx.translate(handleX, linePixelY - 16);
  calibCtx.scale(-1, 1); // Invierte horizontalmente el texto para que se lea al derecho

  const labelText = isCrossing ? '¡SUPERADO!' : 'LÍNEA SALTO';
  calibCtx.fillStyle = isCrossing ? 'rgba(16, 185, 129, 0.95)' : 'rgba(0, 0, 0, 0.75)';

  const pillWidth = 96;
  const pillHeight = 22;
  const rx = -pillWidth / 2;
  const ry = -pillHeight / 2;

  calibCtx.beginPath();
  if (calibCtx.roundRect) {
    calibCtx.roundRect(rx, ry, pillWidth, pillHeight, 6);
  } else {
    calibCtx.rect(rx, ry, pillWidth, pillHeight);
  }
  calibCtx.fill();

  calibCtx.fillStyle = '#ffffff';
  calibCtx.font = 'bold 11px system-ui, -apple-system, sans-serif';
  calibCtx.textAlign = 'center';
  calibCtx.textBaseline = 'middle';
  calibCtx.fillText(labelText, 0, 0);
  calibCtx.restore();

  calibCtx.restore();
}

// Dibujar marco guía cuando está en modo auto
function drawAutoGuide(landmarks) {
  calibCtx.save();
  calibCtx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
  calibCtx.lineWidth = 2;
  calibCtx.setLineDash([8, 8]);
  calibCtx.strokeRect(20, 20, calibrationCanvas.width - 40, calibrationCanvas.height - 40);

  const hasFullBody = landmarks && 
    landmarks[11] && landmarks[12] && landmarks[23] && landmarks[24] && landmarks[27] && landmarks[28] &&
    landmarks[11].visibility > 0.5 && landmarks[12].visibility > 0.5 &&
    landmarks[23].visibility > 0.5 && landmarks[24].visibility > 0.5 &&
    landmarks[27].visibility > 0.45 && landmarks[28].visibility > 0.45;

  if (hasFullBody) {
    updateFeedbackBadge('success', 'Cuerpo detectado');
  } else {
    updateFeedbackBadge('waiting', 'Aléjate un poco');
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
    if (currentConfig.mode !== 'line' || isCountdownRunning) return;
    const rect = calibrationCanvas.getBoundingClientRect();
    const linePixelY = currentConfig.lineY * rect.height;
    const pointerY = e.clientY - rect.top;

    // Permitir arrastrar si toca cerca de la línea (margen de 55px)
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

// ===================================================================
// AUTO-CALIBRACIÓN CON TEMPORIZADOR (Permite ubicarse sin tocar el móvil)
// ===================================================================
let isCountdownRunning = false;
let countdownTimerId = null;

function cancelCountdown() {
  if (countdownTimerId) {
    clearInterval(countdownTimerId);
    countdownTimerId = null;
  }
  isCountdownRunning = false;
  if (calibCountdownOverlay) {
    calibCountdownOverlay.classList.add('opacity-0');
    setTimeout(() => {
      calibCountdownOverlay.classList.add('hidden');
    }, 200);
  }
  updateAutoPositionBtnLabel();
}

function updateAutoPositionBtnLabel() {
  if (autoPositionBtnText) {
    autoPositionBtnText.textContent = `Calibrar (${currentConfig.countdownSeconds || 3}s)`;
  }
}

function startAutoCalibrationCountdown(seconds = null) {
  if (isCountdownRunning) {
    cancelCountdown();
    return;
  }

  const duration = seconds || currentConfig.countdownSeconds || 3;
  isCountdownRunning = true;
  let remaining = duration;

  if (calibCountdownOverlay && calibCountdownNumber && calibCountdownMsg) {
    calibCountdownNumber.textContent = remaining;
    calibCountdownMsg.textContent = "Ubícate en tu posición de salto";
    calibCountdownOverlay.classList.remove('hidden');
    setTimeout(() => calibCountdownOverlay.classList.remove('opacity-0'), 10);
  }
  if (autoPositionBtnText) {
    autoPositionBtnText.textContent = "Cancelar";
  }

  playBeep(520, 0.12);

  countdownTimerId = setInterval(() => {
    remaining--;

    if (remaining > 0) {
      if (calibCountdownNumber) calibCountdownNumber.textContent = remaining;
      playBeep(520, 0.12);
    } else {
      // Fin del conteo regresivo -> Medición y muestreo
      clearInterval(countdownTimerId);
      countdownTimerId = null;

      if (calibCountdownNumber) calibCountdownNumber.textContent = "✓";
      if (calibCountdownMsg) calibCountdownMsg.textContent = "¡Midiendo postura...! Quédate quieto";
      playBeep(660, 0.15);

      // Muestrear lecturas de cintura durante 750ms
      const sampleWaistBuffer = [];
      const sampleTorsoBuffer = [];

      const sampleInterval = setInterval(() => {
        if (lastDetectedWaistY !== null) {
          sampleWaistBuffer.push(lastDetectedWaistY);
          sampleTorsoBuffer.push(lastDetectedTorsoHeight);
        }
      }, 50);

      setTimeout(() => {
        clearInterval(sampleInterval);
        isCountdownRunning = false;

        if (calibCountdownOverlay) {
          calibCountdownOverlay.classList.add('opacity-0');
          setTimeout(() => calibCountdownOverlay.classList.add('hidden'), 200);
        }
        updateAutoPositionBtnLabel();

        if (sampleWaistBuffer.length >= 4) {
          // Promedio de cintura anatómica y torso
          const avgWaistY = sampleWaistBuffer.reduce((a, b) => a + b, 0) / sampleWaistBuffer.length;
          const avgTorso = sampleTorsoBuffer.reduce((a, b) => a + b, 0) / sampleTorsoBuffer.length;

          // FACTOR DE ELEVACIÓN BIOMECÁNICO (Adapta la línea a saltos reales de soga ~2.5 - 4 cm)
          // 'short': ~7% del torso (salto soga veloz y bajo, aprox 2.5 cm reales)
          // 'normal': ~12% del torso (salto estándar, aprox 4 cm)
          // 'high': ~18% del torso (saltos altos de potencia, aprox 6 cm)
          let offsetFactor = 0.07;
          if (currentConfig.jumpSensitivity === 'normal') offsetFactor = 0.12;
          if (currentConfig.jumpSensitivity === 'high') offsetFactor = 0.18;

          const dynamicJumpOffset = Math.max(0.015, avgTorso * offsetFactor);
          currentConfig.lineY = Math.max(0.15, Math.min(0.85, avgWaistY - dynamicJumpOffset));

          // Sonido de confirmación
          playBeep(880, 0.15);
          setTimeout(() => playBeep(1174, 0.22), 160);

          updateFeedbackBadge('success', '¡Línea fijada!');
        } else {
          // No se detectó a la persona con estabilidad
          playBeep(280, 0.3, 'sawtooth');
          updateFeedbackBadge('waiting', 'No detectado');
        }
      }, 750);
    }
  }, 1000);
}

if (autoPositionBtn) {
  autoPositionBtn.addEventListener('click', () => {
    startAutoCalibrationCountdown();
  });
}

if (cancelCountdownBtn) {
  cancelCountdownBtn.addEventListener('click', cancelCountdown);
}

// Controles de tiempo (3s, 5s, 10s)
function applyTimerUI(sec) {
  currentConfig.countdownSeconds = sec;
  const activeClass = "py-0.5 px-1.5 rounded-md font-bold transition text-[10px] bg-emerald-500 text-black";
  const inactiveClass = "py-0.5 px-1.5 rounded-md font-bold transition text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white";

  if (timer3sBtn) timer3sBtn.className = sec === 3 ? activeClass : inactiveClass;
  if (timer5sBtn) timer5sBtn.className = sec === 5 ? activeClass : inactiveClass;
  if (timer10sBtn) timer10sBtn.className = sec === 10 ? activeClass : inactiveClass;

  updateAutoPositionBtnLabel();
}

if (timer3sBtn) timer3sBtn.addEventListener('click', () => applyTimerUI(3));
if (timer5sBtn) timer5sBtn.addEventListener('click', () => applyTimerUI(5));
if (timer10sBtn) timer10sBtn.addEventListener('click', () => applyTimerUI(10));

// Controles de sensibilidad / altura de salto (short, normal, high)
function applySensitivityUI(sens) {
  currentConfig.jumpSensitivity = sens;
  const activeClass = "py-0.5 px-1.5 rounded-md font-bold transition text-[10px] bg-emerald-500 text-black";
  const inactiveClass = "py-0.5 px-1.5 rounded-md font-bold transition text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white";

  if (sensShortBtn) sensShortBtn.className = sens === 'short' ? activeClass : inactiveClass;
  if (sensNormalBtn) sensNormalBtn.className = sens === 'normal' ? activeClass : inactiveClass;
  if (sensHighBtn) sensHighBtn.className = sens === 'high' ? activeClass : inactiveClass;
}

if (sensShortBtn) sensShortBtn.addEventListener('click', () => applySensitivityUI('short'));
if (sensNormalBtn) sensNormalBtn.addEventListener('click', () => applySensitivityUI('normal'));
if (sensHighBtn) sensHighBtn.addEventListener('click', () => applySensitivityUI('high'));

// Botones de selección de modo
function applyModeUI(mode) {
  currentConfig.mode = mode;

  if (mode === 'auto') {
    modeAutoBtn.className = "flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 bg-emerald-500 text-black shadow-xs";
    modeLineBtn.className = "flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white";
    if (modeDescription) modeDescription.textContent = "Modo Cuerpo Completo: requiere estar de pie a 2.5-3m para ver cabeza y pies.";
    if (lineModeOptions) lineModeOptions.classList.add('hidden');
    if (autoPositionBtn) autoPositionBtn.classList.add('hidden');
    if (calibInstructionText) calibInstructionText.textContent = "Modo automático activo: Aléjate para ver cuerpo entero";
  } else {
    modeLineBtn.className = "flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 bg-emerald-500 text-black shadow-xs";
    modeAutoBtn.className = "flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white";
    if (modeDescription) modeDescription.textContent = "Modo Línea Límite: ideal a 1-1.5m. Solo necesitas ver tu cintura o cadera.";
    if (lineModeOptions) lineModeOptions.classList.remove('hidden');
    if (autoPositionBtn) autoPositionBtn.classList.remove('hidden');
    if (calibInstructionText) calibInstructionText.textContent = "Toca o arrastra la línea con tu dedo para ajustar la altura";
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
  applyTimerUI(currentConfig.countdownSeconds || 3);
  applySensitivityUI(currentConfig.jumpSensitivity || 'short');

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
    updateFeedbackBadge('waiting', 'Sin cámara');
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
  cancelCountdown();
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
