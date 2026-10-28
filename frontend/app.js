const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output');
// Optimización GPU móvil: alpha: false y desynchronized: true para renderizado directo sin overhead
const canvasCtx = canvasElement.getContext('2d', {
  alpha: false,
  desynchronized: true
});

const counterElement = document.getElementById('counter');
const timerElement = document.getElementById('timer');
const spmElement = document.getElementById('spm');
const statusElement = document.getElementById('status');

// Elementos de la guía de encuadre y estado
const poseGuideBadge = document.getElementById('poseGuideBadge');
const poseGuideDot = document.getElementById('poseGuideDot');
const poseGuideText = document.getElementById('poseGuideText');
const guideFrame = document.getElementById('guideFrame');

const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const finishBtn = document.getElementById('finishBtn');
const resetBtn = document.getElementById('resetBtn');
const switchCamBtn = document.getElementById('switchCamBtn');

// Detección automática del entorno
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

const API_BASE_URL = isLocal 
  ? 'http://127.0.0.1:8000/api' 
  : 'https://api-saltasoga.devandre.com/api';

// Configuración de calibración activa
let workoutConfig = { mode: 'auto', lineY: 0.52 };

function loadWorkoutConfig() {
  if (typeof window.getSaltasogaConfig === 'function') {
    workoutConfig = window.getSaltasogaConfig();
  } else {
    try {
      const raw = localStorage.getItem('saltasoga_config');
      if (raw) workoutConfig = JSON.parse(raw);
    } catch (e) {}
  }
}

// Cargar al inicio y exponer recarga global
loadWorkoutConfig();
window.reloadWorkoutConfig = loadWorkoutConfig;

// Variables de estado de saltos
let jumpCount = 0;
let isInAir = false;
let lastJumpTimestamp = 0;
const MIN_JUMP_INTERVAL_MS = 220;

// Variables de calibración, encuadre y estabilidad (Modo Automático)
let isCalibrated = false;
let calibrationStartTime = null;
const CALIBRATION_DURATION_MS = 1000; // 1 segundo quieto de pie para calibrar
let calibrationSamples = { hips: [], ankles: [] };
let lostTrackingCount = 0;
const MAX_LOST_FRAMES = 12; // Si se pierde el cuerpo completo ~0.4s, descalibra y no cuenta

let baselineHipY = null;
let baselineAnkleY = null;

let isRunning = false;
let isPaused = false;
let cameraInstance = null;
let currentFacingMode = 'user'; // 'user' (frontal) o 'environment' (trasera)
let secondsElapsed = 0;
let timerInterval = null;

// Optimización: Ajuste de dimensiones de canvas solo cuando cambie el stream
function updateCanvasDimensions() {
    const vw = videoElement.videoWidth || 360;
    const vh = videoElement.videoHeight || 480;
    if (canvasElement.width !== vw || canvasElement.height !== vh) {
        canvasElement.width = vw;
        canvasElement.height = vh;
    }
}

// Función para reiniciar la calibración
function resetCalibration() {
    isCalibrated = false;
    calibrationStartTime = null;
    calibrationSamples = { hips: [], ankles: [] };
    baselineHipY = null;
    baselineAnkleY = null;
    isInAir = false;
    lostTrackingCount = 0;
}

// Actualizador visual de la guía y estado
function updatePoseGuide(statusType, message) {
    if (poseGuideText) poseGuideText.textContent = message;
    if (statusElement) statusElement.textContent = message;

    if (!poseGuideDot || !guideFrame) return;

    poseGuideDot.className = "w-2.5 h-2.5 rounded-full";
    guideFrame.className = "absolute inset-4 rounded-xl border-2 pointer-events-none transition-colors duration-300";

    switch (statusType) {
        case 'waiting':
            poseGuideDot.classList.add('bg-gray-400');
            guideFrame.classList.add('border-dashed', 'border-white/20');
            statusElement.className = "text-xs sm:text-sm md:text-base font-bold text-gray-400 leading-tight truncate mt-1";
            break;
        case 'searching':
            poseGuideDot.classList.add('bg-rose-500', 'animate-pulse');
            guideFrame.classList.add('border-dashed', 'border-rose-500/50');
            statusElement.className = "text-xs sm:text-sm md:text-base font-bold text-rose-500 leading-tight truncate mt-1";
            break;
        case 'calibrating':
            poseGuideDot.classList.add('bg-amber-400', 'animate-ping');
            guideFrame.classList.add('border-dashed', 'border-amber-400/60');
            statusElement.className = "text-xs sm:text-sm md:text-base font-bold text-yellow-400 leading-tight truncate mt-1";
            break;
        case 'ready':
            poseGuideDot.classList.add('bg-emerald-500');
            guideFrame.classList.add('border-solid', 'border-emerald-500/40');
            statusElement.className = "text-xs sm:text-sm md:text-base font-bold text-emerald-400 leading-tight truncate mt-1";
            break;
        case 'air':
            poseGuideDot.classList.add('bg-cyan-400', 'animate-pulse');
            guideFrame.classList.add('border-solid', 'border-cyan-400/80');
            statusElement.className = "text-xs sm:text-sm md:text-base font-bold text-cyan-400 leading-tight truncate mt-1";
            break;
        case 'ground':
            poseGuideDot.classList.add('bg-emerald-400');
            guideFrame.classList.add('border-solid', 'border-emerald-500/60');
            statusElement.className = "text-xs sm:text-sm md:text-base font-bold text-emerald-400 leading-tight truncate mt-1";
            break;
        case 'paused':
            poseGuideDot.classList.add('bg-amber-500');
            guideFrame.classList.add('border-dashed', 'border-amber-500/50');
            statusElement.className = "text-xs sm:text-sm md:text-base font-bold text-amber-400 leading-tight truncate mt-1";
            break;
    }
}

// Dibuja puntos sutiles en caderas y tobillos para dar confirmación visual
function drawTrackingAids(landmarks) {
    if (!landmarks) return;
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];
    const leftAnkle = landmarks[27];
    const rightAnkle = landmarks[28];

    const color = isInAir ? '#22d3ee' : (isCalibrated ? '#10b981' : '#f59e0b');

    canvasCtx.save();
    canvasCtx.fillStyle = color;
    canvasCtx.strokeStyle = '#ffffff';
    canvasCtx.lineWidth = 2;

    [leftHip, rightHip, leftAnkle, rightAnkle].forEach(pt => {
        if (pt && pt.visibility > 0.45) {
            canvasCtx.beginPath();
            canvasCtx.arc(pt.x * canvasElement.width, pt.y * canvasElement.height, 5, 0, 2 * Math.PI);
            canvasCtx.fill();
            canvasCtx.stroke();
        }
    });

    // Línea de referencia del suelo cuando está calibrado
    if (isCalibrated && baselineAnkleY !== null) {
        const floorY = baselineAnkleY * canvasElement.height;
        canvasCtx.strokeStyle = isInAir ? 'rgba(34, 211, 238, 0.5)' : 'rgba(16, 185, 129, 0.35)';
        canvasCtx.setLineDash([6, 6]);
        canvasCtx.lineWidth = 1.5;
        canvasCtx.beginPath();
        canvasCtx.moveTo(0, floorY);
        canvasCtx.lineTo(canvasElement.width, floorY);
        canvasCtx.stroke();
    }

    canvasCtx.restore();
}

// Configurar MediaPipe Pose con optimizaciones de rendimiento
const pose = new Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
});

pose.setOptions({
    modelComplexity: 0, // 0 = BlazePose Lite optimizado para 30+ FPS estables en móviles
    smoothLandmarks: true,
    enableSegmentation: false, // Desactiva segmentación innecesaria para ahorrar CPU/GPU
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});

pose.onResults(onResults);

function onResults(results) {
    updateCanvasDimensions();

    // Si es cámara frontal, aplicamos efecto espejo al canvas
    if (currentFacingMode === 'user') {
        canvasElement.style.transform = 'scaleX(-1)';
    } else {
        canvasElement.style.transform = 'scaleX(1)';
    }

    canvasCtx.save();
    // No se necesita clearRect: drawImage sobreescribe completamente el canvas ahorrando ciclos de GPU
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.poseLandmarks && isRunning && !isPaused) {
        const landmarks = results.poseLandmarks;

        // =====================================================================
        // MODO B: LÍNEA LÍMITE (Espacio reducido / Plano medio)
        // =====================================================================
        if (workoutConfig.mode === 'line') {
            const thresholdY = workoutConfig.lineY || 0.52;
            const thresholdPixelY = thresholdY * canvasElement.height;

            const leftHip = landmarks[23];
            const rightHip = landmarks[24];
            const hipsVisible = leftHip && rightHip && leftHip.visibility > 0.45 && rightHip.visibility > 0.45;

            // Dibujar la línea de umbral en pantalla
            const lineColor = isInAir ? '#10b981' : 'rgba(6, 182, 212, 0.85)';
            canvasCtx.save();
            canvasCtx.strokeStyle = lineColor;
            canvasCtx.lineWidth = isInAir ? 4 : 2.5;
            canvasCtx.setLineDash(isInAir ? [] : [8, 6]);
            canvasCtx.shadowColor = lineColor;
            canvasCtx.shadowBlur = isInAir ? 14 : 6;
            canvasCtx.beginPath();
            canvasCtx.moveTo(0, thresholdPixelY);
            canvasCtx.lineTo(canvasElement.width, thresholdPixelY);
            canvasCtx.stroke();
            canvasCtx.restore();

            if (!hipsVisible) {
                lostTrackingCount++;
                if (lostTrackingCount > MAX_LOST_FRAMES) {
                    isInAir = false;
                    updatePoseGuide('searching', 'Ponte frente a la cámara (cintura visible)');
                }
                canvasCtx.restore();
                return;
            }

            lostTrackingCount = 0;
            const currentHipY = (leftHip.y + rightHip.y) / 2;

            // Dibujar punto en la cadera para feedback visual
            canvasCtx.save();
            canvasCtx.beginPath();
            canvasCtx.arc(((leftHip.x + rightHip.x) / 2) * canvasElement.width, currentHipY * canvasElement.height, 6, 0, 2 * Math.PI);
            canvasCtx.fillStyle = isInAir ? '#10b981' : '#38bdf8';
            canvasCtx.strokeStyle = '#ffffff';
            canvasCtx.lineWidth = 2;
            canvasCtx.fill();
            canvasCtx.stroke();
            canvasCtx.restore();

            const now = performance.now();

            // Takeoff: La cadera sube y cruza la línea hacia arriba (en canvas, Y menor es más alto)
            if (currentHipY < thresholdY && !isInAir) {
                if (now - lastJumpTimestamp > MIN_JUMP_INTERVAL_MS) {
                    isInAir = true;
                    updatePoseGuide('air', 'En el aire');
                }
            } 
            // Landing: La cadera vuelve a bajar por debajo de la línea (con margen de histéresis)
            else if (isInAir && currentHipY > (thresholdY + 0.02)) {
                isInAir = false;
                jumpCount++;
                lastJumpTimestamp = now;

                counterElement.textContent = jumpCount;
                updatePoseGuide('ground', 'Suelo');
                updateSPM();
            } 
            else if (!isInAir) {
                updatePoseGuide('ready', 'Listo para saltar');
            }

            canvasCtx.restore();
            return;
        }

        // =====================================================================
        // MODO A: CUERPO COMPLETO / AUTOMÁTICO (Algoritmo Dual)
        // =====================================================================
        const leftShoulder = landmarks[11];
        const rightShoulder = landmarks[12];
        const leftHip = landmarks[23];
        const rightHip = landmarks[24];
        const leftKnee = landmarks[25];
        const rightKnee = landmarks[26];
        const leftAnkle = landmarks[27];
        const rightAnkle = landmarks[28];

        // 1. Visibilidad estricta de cuerpo completo
        const shouldersVisible = leftShoulder && rightShoulder && leftShoulder.visibility > 0.5 && rightShoulder.visibility > 0.5;
        const hipsVisible = leftHip && rightHip && leftHip.visibility > 0.6 && rightHip.visibility > 0.6;
        const kneesVisible = leftKnee && rightKnee && leftKnee.visibility > 0.45 && rightKnee.visibility > 0.45;
        const anklesVisible = leftAnkle && rightAnkle && leftAnkle.visibility > 0.45 && rightAnkle.visibility > 0.45;

        const isFullBodyVisible = shouldersVisible && hipsVisible && kneesVisible && anklesVisible;

        if (!isFullBodyVisible) {
            lostTrackingCount++;
            if (lostTrackingCount > MAX_LOST_FRAMES) {
                resetCalibration();
                updatePoseGuide('searching', 'Muestra cuerpo completo (pies a cabeza)');
            }
            canvasCtx.restore();
            return;
        }

        const currentHipY = (leftHip.y + rightHip.y) / 2;
        const currentAnkleY = (leftAnkle.y + rightAnkle.y) / 2;
        const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
        const torsoHeight = Math.abs(currentHipY - shoulderY) || 0.25;
        const bodyHeight = Math.abs(currentAnkleY - shoulderY);

        // 2. Control de encuadre y distancia
        const isTooClose = bodyHeight > 0.94 || currentAnkleY > 0.98 || shoulderY < 0.02 || torsoHeight > 0.45;
        const isTooFar = bodyHeight < 0.30;

        if (isTooClose) {
            lostTrackingCount++;
            if (lostTrackingCount > MAX_LOST_FRAMES) {
                resetCalibration();
            }
            updatePoseGuide('searching', 'Aléjate un poco de la cámara');
            canvasCtx.restore();
            return;
        }

        if (isTooFar) {
            updatePoseGuide('searching', 'Acércate un poco más');
            canvasCtx.restore();
            return;
        }

        lostTrackingCount = 0;
        drawTrackingAids(landmarks);

        const now = performance.now();

        // 3. Fase de Calibración previa al conteo (requiere 1 segundo de estabilidad)
        if (!isCalibrated) {
            if (calibrationStartTime === null) {
                calibrationStartTime = now;
                calibrationSamples = { hips: [currentHipY], ankles: [currentAnkleY] };
            } else {
                const lastSampleHip = calibrationSamples.hips[calibrationSamples.hips.length - 1];
                if (Math.abs(currentHipY - lastSampleHip) > 0.035) {
                    calibrationStartTime = now;
                    calibrationSamples = { hips: [currentHipY], ankles: [currentAnkleY] };
                } else {
                    calibrationSamples.hips.push(currentHipY);
                    calibrationSamples.ankles.push(currentAnkleY);
                }
            }

            const elapsedCalibration = now - calibrationStartTime;
            const progress = Math.min(100, Math.round((elapsedCalibration / CALIBRATION_DURATION_MS) * 100));

            if (elapsedCalibration < CALIBRATION_DURATION_MS) {
                updatePoseGuide('calibrating', `Calibrando... quédate quieto (${progress}%)`);
                canvasCtx.restore();
                return;
            }

            baselineHipY = calibrationSamples.hips.reduce((a, b) => a + b, 0) / calibrationSamples.hips.length;
            baselineAnkleY = calibrationSamples.ankles.reduce((a, b) => a + b, 0) / calibrationSamples.ankles.length;
            isCalibrated = true;
            updatePoseGuide('ready', '¡Listo para saltar!');
            canvasCtx.restore();
            return;
        }

        // 4. Detección Cinemática de Saltos (Usuario Calibrado)
        const hipElevation = baselineHipY - currentHipY;
        const ankleElevation = baselineAnkleY - currentAnkleY;

        const dynamicHipThreshold = torsoHeight * 0.09;
        const dynamicAnkleThreshold = torsoHeight * 0.11;

        const ankleDifference = Math.abs(leftAnkle.y - rightAnkle.y);
        const isSymmetric = ankleDifference < torsoHeight * 0.35;

        // Takeoff
        if (hipElevation > dynamicHipThreshold && ankleElevation > dynamicAnkleThreshold && isSymmetric && !isInAir) {
            if (now - lastJumpTimestamp > MIN_JUMP_INTERVAL_MS) {
                isInAir = true;
                updatePoseGuide('air', 'En el aire');
            }
        } 
        // Landing
        else if (isInAir && (hipElevation < dynamicHipThreshold * 0.35 || ankleElevation < dynamicAnkleThreshold * 0.35)) {
            isInAir = false;
            jumpCount++;
            lastJumpTimestamp = now;

            counterElement.textContent = jumpCount;
            updatePoseGuide('ground', 'Suelo');
            updateSPM();

            baselineHipY = baselineHipY * 0.94 + currentHipY * 0.06;
            baselineAnkleY = baselineAnkleY * 0.94 + currentAnkleY * 0.06;
        } 
        else if (!isInAir) {
            if (Math.abs(hipElevation) < dynamicHipThreshold * 0.5 && Math.abs(ankleElevation) < dynamicAnkleThreshold * 0.5) {
                baselineHipY = baselineHipY * 0.98 + currentHipY * 0.02;
                baselineAnkleY = baselineAnkleY * 0.98 + currentAnkleY * 0.02;
            }
            updatePoseGuide('ready', 'Listo para saltar');
        }
    } else if (!isRunning) {
        updatePoseGuide('waiting', 'Pulsa Iniciar para entrenar');
    }

    canvasCtx.restore();
}

function updateSPM() {
    if (secondsElapsed > 2) {
        const minutes = secondsElapsed / 60;
        const spm = Math.round(jumpCount / minutes);
        spmElement.textContent = spm;
    }
}

function startTimer() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        if (!isPaused) {
            secondsElapsed++;
            const mins = String(Math.floor(secondsElapsed / 60)).padStart(2, '0');
            const secs = String(secondsElapsed % 60).padStart(2, '0');
            timerElement.textContent = `${mins}:${secs}`;
            updateSPM();
        }
    }, 1000);
}

// Inicializador de la cámara con resolución optimizada
let currentStream = null;
let isProcessingFrame = false;

async function startCamera() {
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
    }

    const constraints = {
        video: {
            facingMode: currentFacingMode,
            width: { ideal: 360, max: 480 },
            height: { ideal: 480, max: 640 },
            frameRate: { ideal: 30, max: 30 }
        },
        audio: false
    };

    currentStream = await navigator.mediaDevices.getUserMedia(constraints);
    videoElement.srcObject = currentStream;
    await videoElement.play();

    updateCanvasDimensions();

    if (!videoElement.dataset.looping) {
        videoElement.dataset.looping = "true";
        requestAnimationFrame(processVideo);
    }
}

let lastInferenceTimestamp = 0;
const TARGET_INFERENCE_INTERVAL_MS = 30;

async function processVideo(timestamp) {
    if (videoElement.dataset.looping !== "true") return;

    if (isRunning && !isPaused && !isProcessingFrame && videoElement.readyState >= 2) {
        const now = timestamp || performance.now();
        if (now - lastInferenceTimestamp >= TARGET_INFERENCE_INTERVAL_MS) {
            lastInferenceTimestamp = now;
            isProcessingFrame = true;
            try {
                await pose.send({ image: videoElement });
            } catch (err) {
                console.warn("Pose processing:", err);
            }
            isProcessingFrame = false;
        }
    }
    requestAnimationFrame(processVideo);
}

function stopCamera() {
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
        currentStream = null;
    }
    videoElement.srcObject = null;
    videoElement.dataset.looping = "";
    isProcessingFrame = false;
}

// Alternar entre frontal y trasera
switchCamBtn.addEventListener('click', async () => {
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    resetCalibration();
    await startCamera();
});

startBtn.addEventListener('click', async () => {
    loadWorkoutConfig();
    resetCalibration();
    await startCamera();
    isRunning = true;
    isPaused = false;
    startBtn.classList.add('hidden');
    pauseBtn.classList.remove('hidden');
    finishBtn.classList.remove('hidden');
    pauseBtn.textContent = "Pausar";

    if (workoutConfig.mode === 'line') {
        updatePoseGuide('ready', 'Listo para saltar (Modo Línea)');
    } else {
        updatePoseGuide('searching', 'Muestra cuerpo completo...');
    }
    startTimer();
});

pauseBtn.addEventListener('click', () => {
    isPaused = !isPaused;
    if (isPaused) {
        pauseBtn.textContent = "Reanudar";
        updatePoseGuide('paused', 'Pausado');
    } else {
        pauseBtn.textContent = "Pausar";
        resetCalibration();
        if (workoutConfig.mode === 'line') {
            updatePoseGuide('ready', 'Listo para saltar');
        } else {
            updatePoseGuide('searching', 'Recalibrando postura...');
        }
    }
});

// BOTÓN REINICIAR: Pone todo en cero sin guardar
resetBtn.addEventListener('click', () => {
    jumpCount = 0;
    secondsElapsed = 0;
    resetCalibration();

    counterElement.textContent = "0";
    timerElement.textContent = "00:00";
    spmElement.textContent = "0";

    if (isRunning) {
        if (isPaused) {
            updatePoseGuide('paused', 'Pausado');
        } else {
            if (workoutConfig.mode === 'line') {
                updatePoseGuide('ready', 'Listo para saltar');
            } else {
                updatePoseGuide('searching', 'Muestra cuerpo completo');
            }
        }
    } else {
        updatePoseGuide('waiting', 'Listo');
    }
});

// Registro de Service Worker para habilitar instalación PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .catch((err) => console.log('Fallo registro SW:', err));
  });
}

// BOTÓN TERMINAR: Guarda en Laravel, detiene la cámara y muestra resumen
finishBtn.addEventListener('click', async () => {
    if (secondsElapsed < 3 && jumpCount === 0) {
        alert("Realiza algunos saltos antes de terminar la sesión.");
        return;
    }

    clearInterval(timerInterval);
    stopCamera();
    isRunning = false;
    isPaused = false;
    resetCalibration();

    const minutes = secondsElapsed > 0 ? (secondsElapsed / 60) : 1;
    const finalSpm = Math.round(jumpCount / minutes);
    const estimatedCalories = (jumpCount * 0.18).toFixed(2);

    statusElement.textContent = "Guardando en servidor...";
    statusElement.className = "text-xs sm:text-sm md:text-base font-bold text-cyan-400 leading-tight truncate mt-1";
    finishBtn.disabled = true;

    await guardarSesionEnBackend(secondsElapsed, jumpCount, finalSpm, estimatedCalories);

    finishBtn.disabled = false;
    updatePoseGuide('ground', `¡Completado! ${jumpCount} saltos`);

    finishBtn.classList.add('hidden');
    pauseBtn.classList.add('hidden');
    startBtn.classList.remove('hidden');
    startBtn.textContent = "Nuevo Entrenamiento";
});

// --- Control de Modo Oscuro / Claro ---
const themeToggleBtn = document.getElementById('themeToggleBtn');
const sunIcon = document.getElementById('sunIcon');
const moonIcon = document.getElementById('moonIcon');
const themeColorMeta = document.getElementById('themeColorMeta');

function applyTheme(isDark) {
  if (isDark) {
    document.documentElement.classList.add('dark');
    sunIcon.classList.remove('hidden');
    moonIcon.classList.add('hidden');
    themeColorMeta.setAttribute('content', '#030712');
    localStorage.setItem('theme', 'dark');
  } else {
    document.documentElement.classList.remove('dark');
    sunIcon.classList.add('hidden');
    moonIcon.classList.remove('hidden');
    themeColorMeta.setAttribute('content', '#f3f4f6');
    localStorage.setItem('theme', 'light');
  }
}

const savedTheme = localStorage.getItem('theme');
const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
const isInitialDark = savedTheme ? savedTheme === 'dark' : prefersDark;

applyTheme(isInitialDark);

themeToggleBtn.addEventListener('click', () => {
  const isCurrentDark = document.documentElement.classList.contains('dark');
  applyTheme(!isCurrentDark);
});

async function guardarSesionEnBackend(duracionSegundos, totalSaltos, promedioSpm, calorias) {
  try {
    const response = await fetch(`${API_BASE_URL}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        duration_seconds: Math.round(duracionSegundos),
        total_jumps: totalSaltos,
        avg_spm: Math.round(promedioSpm),
        calories: parseFloat(calorias) || 0,
        user_id: 1
      })
    });

    const resultado = await response.json();
    if (response.ok) {
      console.log('Sesión sincronizada con éxito:', resultado);
    } else {
      console.warn('Error devuelto por la API:', resultado);
    }
  } catch (error) {
    console.error('Error al conectar con la API de Laravel:', error);
  }
}
