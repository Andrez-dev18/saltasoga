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
let airStartTime = 0;
let lastJumpTimestamp = 0;
const MIN_JUMP_INTERVAL_MS = 220;
const MIN_AIR_DURATION_MS = 90;   // Un salto de soga real requiere al menos ~90-100ms en el aire
const MAX_AIR_DURATION_MS = 1500; // Si supera 1.5s arriba no es un salto de soga, se anula

// Variables de calibración, encuadre y estabilidad (Modo Automático)
let isCalibrated = false;
let calibrationStartTime = null;
const CALIBRATION_DURATION_MS = 1000; // 1 segundo quieto de pie para calibrar
let calibrationSamples = { hips: [], ankles: [] };
let lostTrackingCount = 0;
const MAX_LOST_FRAMES = 8; // Si se pierde la persona por ~0.25s, suspender estado en el aire y re-alinear

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
    airStartTime = 0;
    lostTrackingCount = 0;
}

// Manejador centralizado cuando no hay persona frente a la cámara o se pierde el encuadre
function handleMissingPerson(message) {
    lostTrackingCount++;
    // Si se pierde tracking por más de ~120-150ms, cancelar estado en el aire para evitar aterrizajes falsos
    if (lostTrackingCount >= 4) {
        isInAir = false;
        airStartTime = 0;
    }
    if (lostTrackingCount > MAX_LOST_FRAMES) {
        if (workoutConfig.mode === 'auto') {
            resetCalibration();
        }
        updatePoseGuide('searching', message);
    }
}

// Actualizador visual de la guía y estado
function updatePoseGuide(statusType, message) {
    if (poseGuideText) poseGuideText.textContent = message;
    if (statusElement) statusElement.textContent = message;

    if (!poseGuideDot || !guideFrame) return;

    poseGuideDot.className = "w-2.5 h-2.5 rounded-full shrink-0";
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

// Dibuja la línea guía de umbral cuando está activo el modo línea
function drawWorkoutLineOverlay() {
    const thresholdY = workoutConfig.lineY || 0.52;
    const thresholdPixelY = thresholdY * canvasElement.height;
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
}

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

    if (isRunning && !isPaused) {
        const now = performance.now();
        const landmarks = results.poseLandmarks;

        // 1. DIBUJAR LÍNEA GUÍA SI ESTÁ EN MODO LÍNEA (Incluso antes de validar presencia humana)
        if (workoutConfig.mode === 'line') {
            drawWorkoutLineOverlay();
        }

        // 2. GATEKEEPER DE PRESENCIA HUMANA REAL (Evita detección de sombras, paredes y cámaras vacías)
        if (!landmarks) {
            handleMissingPerson(workoutConfig.mode === 'line' 
                ? 'Muestra tu cintura' 
                : 'Muestra cuerpo entero');
            canvasCtx.restore();
            return;
        }

        const nose = landmarks[0];
        const leftShoulder = landmarks[11];
        const rightShoulder = landmarks[12];
        const leftHip = landmarks[23];
        const rightHip = landmarks[24];

        const shouldersVisible = leftShoulder && rightShoulder && leftShoulder.visibility > 0.48 && rightShoulder.visibility > 0.48;
        const hipsVisible = leftHip && rightHip && leftHip.visibility > 0.48 && rightHip.visibility > 0.48;
        const headVisible = nose && nose.visibility > 0.35;

        const currentHipY = (leftHip && rightHip) ? (leftHip.y + rightHip.y) / 2 : 0;
        const shoulderY = (leftShoulder && rightShoulder) ? (leftShoulder.y + rightShoulder.y) / 2 : 0;
        const torsoHeight = Math.abs(currentHipY - shoulderY);

        // Anatomía coherente: la cadera debe estar por debajo del hombro y con proporción humana
        const hasValidAnatomy = currentHipY > shoulderY && torsoHeight > 0.08 && torsoHeight < 0.65;
        const hasHumanPresence = shouldersVisible && hipsVisible && (headVisible || torsoHeight > 0.12) && hasValidAnatomy;

        if (!hasHumanPresence) {
            handleMissingPerson(workoutConfig.mode === 'line' 
                ? 'Muestra tu cintura' 
                : 'Muestra cuerpo entero');
            canvasCtx.restore();
            return;
        }

        // =====================================================================
        // MODO B: LÍNEA LÍMITE (Espacio reducido / Plano medio)
        // =====================================================================
        if (workoutConfig.mode === 'line') {
            const thresholdY = workoutConfig.lineY || 0.52;

            lostTrackingCount = 0; // Persona humana real presente y validada

            // ESTIMACIÓN ANATÓMICA INMUNE AL POLO:
            // La cintura anatómica / cresta ilíaca se sitúa a ~88-90% de distancia entre hombros y cadera
            const trackedWaistY = shoulderY + torsoHeight * 0.90;

            // Dibujar punto en la cintura anatómica para feedback visual
            canvasCtx.save();
            canvasCtx.beginPath();
            canvasCtx.arc(((leftHip.x + rightHip.x) / 2) * canvasElement.width, trackedWaistY * canvasElement.height, 6, 0, 2 * Math.PI);
            canvasCtx.fillStyle = isInAir ? '#10b981' : '#38bdf8';
            canvasCtx.strokeStyle = '#ffffff';
            canvasCtx.lineWidth = 2;
            canvasCtx.fill();
            canvasCtx.stroke();
            canvasCtx.restore();

            // A. FASE: DESPEGUE (Takeoff) - La cintura sube y cruza la línea hacia arriba
            if (trackedWaistY < thresholdY && !isInAir) {
                if (now - lastJumpTimestamp > MIN_JUMP_INTERVAL_MS) {
                    isInAir = true;
                    airStartTime = now;
                    updatePoseGuide('air', 'En el aire');
                }
            } 
            // B. FASE: ATERRIZAJE (Landing) - La cintura vuelve a bajar por debajo de la línea
            else if (isInAir && trackedWaistY > (thresholdY + 0.008)) {
                const airDuration = now - airStartTime;

                // Solo contar si el tiempo en el aire es biológicamente verosímil
                if (airDuration >= MIN_AIR_DURATION_MS && airDuration <= MAX_AIR_DURATION_MS) {
                    jumpCount++;
                    lastJumpTimestamp = now;
                    counterElement.textContent = jumpCount;
                    updatePoseGuide('ground', 'Suelo');
                    updateSPM();
                } else if (airDuration > MAX_AIR_DURATION_MS) {
                    // Si estuvo demasiado tiempo arriba, no fue un salto de cuerda; cancelar estado
                    updatePoseGuide('ready', 'Listo para saltar');
                }
                isInAir = false;
                airStartTime = 0;
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
        const leftKnee = landmarks[25];
        const rightKnee = landmarks[26];
        const leftAnkle = landmarks[27];
        const rightAnkle = landmarks[28];

        const kneesVisible = leftKnee && rightKnee && leftKnee.visibility > 0.45 && rightKnee.visibility > 0.45;
        const anklesVisible = leftAnkle && rightAnkle && leftAnkle.visibility > 0.45 && rightAnkle.visibility > 0.45;

        const isFullBodyVisible = kneesVisible && anklesVisible;

        if (!isFullBodyVisible) {
            handleMissingPerson('Muestra cuerpo completo (pies a cabeza)');
            canvasCtx.restore();
            return;
        }

        const currentAnkleY = (leftAnkle.y + rightAnkle.y) / 2;
        const bodyHeight = Math.abs(currentAnkleY - shoulderY);

        // Control de encuadre y distancia adecuada
        const isTooClose = bodyHeight > 0.94 || currentAnkleY > 0.98 || shoulderY < 0.02 || torsoHeight > 0.45;
        const isTooFar = bodyHeight < 0.30;

        if (isTooClose) {
            handleMissingPerson('Aléjate un poco de la cámara');
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

        // Fase de Calibración previa al conteo (requiere 1 segundo de estabilidad)
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

        // Detección Cinemática de Saltos (Usuario Calibrado)
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
                airStartTime = now;
                updatePoseGuide('air', 'En el aire');
            }
        } 
        // Landing
        else if (isInAir && (hipElevation < dynamicHipThreshold * 0.35 || ankleElevation < dynamicAnkleThreshold * 0.35)) {
            const airDuration = now - airStartTime;

            if (airDuration >= MIN_AIR_DURATION_MS && airDuration <= MAX_AIR_DURATION_MS) {
                jumpCount++;
                lastJumpTimestamp = now;
                counterElement.textContent = jumpCount;
                updatePoseGuide('ground', 'Suelo');
                updateSPM();

                baselineHipY = baselineHipY * 0.94 + currentHipY * 0.06;
                baselineAnkleY = baselineAnkleY * 0.94 + currentAnkleY * 0.06;
            } else if (airDuration > MAX_AIR_DURATION_MS) {
                updatePoseGuide('ready', 'Listo para saltar');
            }
            isInAir = false;
            airStartTime = 0;
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
    } else if (isRunning && isPaused && videoElement.readyState >= 2) {
        // Vista previa en vivo mientras está en pausa (sin procesar saltos ni gastar CPU)
        updateCanvasDimensions();
        canvasElement.style.transform = currentFacingMode === 'user' ? 'scaleX(-1)' : 'scaleX(1)';
        canvasCtx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
        if (workoutConfig.mode === 'line') {
            drawWorkoutLineOverlay();
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

    if (canvasCtx && canvasElement) {
        canvasCtx.fillStyle = '#000000';
        canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);
    }
}

// Alternar entre frontal y trasera
switchCamBtn.addEventListener('click', async () => {
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    resetCalibration();
    await startCamera();
});

startBtn.addEventListener('click', async () => {
    loadWorkoutConfig();
    jumpCount = 0;
    secondsElapsed = 0;
    counterElement.textContent = "0";
    timerElement.textContent = "00:00";
    spmElement.textContent = "0";
    resetCalibration();
    await startCamera();
    isRunning = true;
    isPaused = false;
    startBtn.classList.add('hidden');
    pauseBtn.classList.remove('hidden');
    finishBtn.classList.remove('hidden');
    resetBtn.classList.remove('hidden');
    pauseBtn.textContent = "Pausar";

    if (workoutConfig.mode === 'line') {
        updatePoseGuide('ready', 'Listo para saltar (Modo Línea)');
    } else {
        updatePoseGuide('searching', 'Muestra cuerpo entero');
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
        startTimer();
        if (workoutConfig.mode === 'line') {
            updatePoseGuide('ready', 'Listo para saltar');
        } else {
            updatePoseGuide('searching', 'Recalibrando postura...');
        }
    }
});

// Pausa segura al salir de la vista de entrenamiento (libera cámara y conserva progreso)
window.pauseWorkoutOnLeave = function () {
    if (typeof timerInterval !== 'undefined') clearInterval(timerInterval);
    stopCamera();
    if (isRunning) {
        isPaused = true;
        if (pauseBtn) pauseBtn.textContent = "Reanudar";
        updatePoseGuide('paused', 'Pausado');
    }
};

// Reactiva la cámara en vivo al regresar a Saltar Soga si hay una sesión activa
window.resumeWorkoutView = async function () {
    loadWorkoutConfig();
    if (!isRunning) return;

    resetCalibration();
    isPaused = true;
    if (pauseBtn) pauseBtn.textContent = "Reanudar";
    updatePoseGuide('paused', 'Pausado');

    try {
        await startCamera();
    } catch (err) {
        console.warn("No se pudo reactivar la cámara al volver:", err);
    }
};

// Recuperación automática si el usuario cambia de pestaña/app o bloquea el teléfono
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden' && isRunning) {
        if (!isPaused) {
            isPaused = true;
            if (pauseBtn) pauseBtn.textContent = "Reanudar";
            updatePoseGuide('paused', 'Pausado');
        }
        clearInterval(timerInterval);
    } else if (document.visibilityState === 'visible' && isRunning) {
        const viewWorkoutEl = document.getElementById('view-workout');
        const isWorkoutVisible = viewWorkoutEl && !viewWorkoutEl.classList.contains('hidden');
        if (isWorkoutVisible) {
            const hasLiveTrack = currentStream && currentStream.getVideoTracks().some(t => t.readyState === 'live');
            if (!hasLiveTrack || videoElement.paused) {
                try {
                    await startCamera();
                } catch (err) {
                    console.warn("Error al reactivar cámara tras volver a la pestaña:", err);
                }
            }
        }
    }
});

// BOTÓN CANCELAR: Detiene la sesión, apaga la cámara y reinicia todo sin guardar
resetBtn.addEventListener('click', () => {
    clearInterval(timerInterval);
    stopCamera();
    isRunning = false;
    isPaused = false;
    jumpCount = 0;
    secondsElapsed = 0;
    resetCalibration();

    counterElement.textContent = "0";
    timerElement.textContent = "00:00";
    spmElement.textContent = "0";

    updatePoseGuide('waiting', 'Inicia para calibrar');
    if (statusElement) statusElement.textContent = "Listo";

    pauseBtn.classList.add('hidden');
    finishBtn.classList.add('hidden');
    resetBtn.classList.add('hidden');
    startBtn.classList.remove('hidden');
    startBtn.textContent = "Iniciar";
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
    resetBtn.classList.add('hidden');
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

function saveGuestSessionLocal(sessionData) {
  const key = window.GUEST_SESSIONS_KEY || 'saltasoga_guest_sessions';
  try {
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    existing.unshift({
      id: Date.now(),
      ...sessionData,
      completed_at: new Date().toISOString(),
      is_local: true
    });
    localStorage.setItem(key, JSON.stringify(existing));
  } catch (e) {
    console.warn('No se pudo guardar la sesión local:', e);
  }
}

async function guardarSesionEnBackend(duracionSegundos, totalSaltos, promedioSpm, calorias) {
  const payload = {
    duration_seconds: Math.round(duracionSegundos),
    total_jumps: totalSaltos,
    avg_spm: Math.round(promedioSpm),
    calories: parseFloat(calorias) || 0
  };

  if (typeof window.isAuthenticated === 'function' && !window.isAuthenticated()) {
    saveGuestSessionLocal(payload);
    return;
  }

  try {
    const fetcher = typeof window.apiFetch === 'function'
      ? window.apiFetch
      : (ep, opts) => fetch(`${API_BASE_URL}${ep}`, opts);

    const response = await fetcher('/sessions', {
      method: 'POST',
      body: JSON.stringify(payload)
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
