const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output');
const canvasCtx = canvasElement.getContext('2d');

const counterElement = document.getElementById('counter');
const timerElement = document.getElementById('timer');
const spmElement = document.getElementById('spm');
const statusElement = document.getElementById('status');

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

// Variables de estado
let jumpCount = 0;
let isInAir = false;
let baselineHipY = null;
let lastJumpTimestamp = 0;
const MIN_JUMP_INTERVAL_MS = 220;

let isRunning = false;
let isPaused = false;
let cameraInstance = null;
let currentFacingMode = 'user'; // 'user' (frontal) o 'environment' (trasera)
let secondsElapsed = 0;
let timerInterval = null;

// Configurar MediaPipe Pose
const pose = new Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
});

pose.setOptions({
    modelComplexity: 0, // 0 = Modo rápido optimizado para móviles (30+ FPS estables)
    smoothLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});

pose.onResults(onResults);

function onResults(results) {
    canvasElement.width = videoElement.videoWidth;
    canvasElement.height = videoElement.videoHeight;

    // Si es cámara frontal, aplicamos efecto espejo al canvas
    if (currentFacingMode === 'user') {
        canvasElement.style.transform = 'scaleX(-1)';
    } else {
        canvasElement.style.transform = 'scaleX(1)';
    }

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.poseLandmarks && isRunning && !isPaused) {
        const landmarks = results.poseLandmarks;

        const leftHip = landmarks[23];
        const rightHip = landmarks[24];
        const leftAnkle = landmarks[27];
        const rightAnkle = landmarks[28];
        const leftShoulder = landmarks[11];
        const rightShoulder = landmarks[12];

        const hipsVisible = leftHip.visibility > 0.6 && rightHip.visibility > 0.6;
        const anklesVisible = leftAnkle.visibility > 0.5 && rightAnkle.visibility > 0.5;

        if (hipsVisible) {
            const currentHipY = (leftHip.y + rightHip.y) / 2;
            const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
            const torsoHeight = Math.abs(currentHipY - shoulderY) || 0.3;
            const dynamicThreshold = torsoHeight * 0.12;

            if (baselineHipY === null) {
                baselineHipY = currentHipY;
            } else {
                baselineHipY = baselineHipY * 0.96 + currentHipY * 0.04;
            }

            const elevation = baselineHipY - currentHipY;
            const now = performance.now();

            let isSymmetric = true;
            if (anklesVisible) {
                const ankleDifference = Math.abs(leftAnkle.y - rightAnkle.y);
                if (ankleDifference > torsoHeight * 0.25) {
                    isSymmetric = false;
                }
            }

            if (elevation > dynamicThreshold && !isInAir && isSymmetric) {
                if (now - lastJumpTimestamp > MIN_JUMP_INTERVAL_MS) {
                    isInAir = true;
                    statusElement.textContent = "En el aire";
                    statusElement.className = "text-base font-bold text-cyan-400 mt-2";
                }
            } else if (elevation < (dynamicThreshold * 0.3) && isInAir) {
                isInAir = false;
                jumpCount++;
                lastJumpTimestamp = now;

                counterElement.textContent = jumpCount;
                statusElement.textContent = "Suelo";
                statusElement.className = "text-base font-bold text-emerald-400 mt-2";

                updateSPM();
            }
        }
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

// Inicializador de la cámara
let currentStream = null;
let isProcessingFrame = false;

async function startCamera() {
    // 1. Detener el stream anterior para liberar la GPU y la cámara
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
    }

    // 2. Pedir resolución ligera y fija para ambas cámaras
    const constraints = {
        video: {
            facingMode: currentFacingMode,
            width: { ideal: 480 },
            height: { ideal: 640 },
            frameRate: { ideal: 30, max: 30 }
        },
        audio: false
    };

    currentStream = await navigator.mediaDevices.getUserMedia(constraints);
    videoElement.srcObject = currentStream;
    await videoElement.play();

    // 3. Iniciar el loop de procesamiento una sola vez
    if (!videoElement.dataset.looping) {
        videoElement.dataset.looping = "true";
        processVideo();
    }
}

async function processVideo() {
    if (!isProcessingFrame && videoElement.readyState >= 2) {
        isProcessingFrame = true;
        await pose.send({ image: videoElement });
        isProcessingFrame = false;
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
    baselineHipY = null;
    await startCamera();
});

startBtn.addEventListener('click', async () => {
    await startCamera();
    isRunning = true;
    isPaused = false;
    startBtn.classList.add('hidden');
    pauseBtn.classList.remove('hidden');
    finishBtn.classList.remove('hidden');
    pauseBtn.textContent = "Pausar";
    startTimer();
});

pauseBtn.addEventListener('click', () => {
    isPaused = !isPaused;
    if (isPaused) {
        pauseBtn.textContent = "Reanudar";
        statusElement.textContent = "Pausado";
        statusElement.className = "text-base font-bold text-amber-400 mt-2";
    } else {
        pauseBtn.textContent = "Pausar";
        statusElement.textContent = "Listo";
        statusElement.className = "text-base font-bold text-emerald-400 mt-2";
    }
});

// BOTÓN REINICIAR: Pone todo en cero sin guardar
resetBtn.addEventListener('click', () => {
    jumpCount = 0;
    secondsElapsed = 0;
    baselineHipY = null;
    isInAir = false;

    counterElement.textContent = "0";
    timerElement.textContent = "00:00";
    spmElement.textContent = "0";
    statusElement.textContent = isRunning ? (isPaused ? "Pausado" : "Listo") : "Reiniciado";
    statusElement.className = "text-base font-bold text-yellow-400 mt-2";
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

    // Detener timer y cámara
    clearInterval(timerInterval);
    stopCamera();
    isRunning = false;
    isPaused = false;

    // Métricas finales
    const minutes = secondsElapsed > 0 ? (secondsElapsed / 60) : 1;
    const finalSpm = Math.round(jumpCount / minutes);
    const estimatedCalories = (jumpCount * 0.18).toFixed(2);

    statusElement.textContent = "Guardando en servidor...";
    statusElement.className = "text-base font-bold text-cyan-400 mt-2";
    finishBtn.disabled = true;

    // Enviar a la API de Laravel
    await guardarSesionEnBackend(secondsElapsed, jumpCount, finalSpm, estimatedCalories);

    finishBtn.disabled = false;
    statusElement.textContent = `¡Completado! ${jumpCount} saltos`;
    statusElement.className = "text-base font-bold text-emerald-400 mt-2";

    // Reajustar visibilidad de botones
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

// Cargar preferencia guardada o usar oscuro por defecto
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
        user_id: 1 // Usuario por defecto mientras agregamos auth
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
