/* =========================================================================
   ACERTE A ONDA — Estação 1
   JavaScript vanilla, arquivo único.
   ========================================================================= */
(function () {
  'use strict';

  /* =========================================================
     1. ESTADO GLOBAL AGRUPADO
     ========================================================= */
  const state = {
    // Onda resposta (do usuário)
    A: 1.0, B: 1.0, C: 0.0, D: 0.0,
    // Onda alvo
    targetA: 1.0, targetB: 1.2, targetC: 0.0, targetD: 0.0,
    targetFreq: 523.25,
    targetNote: '—',

    // Lock / acerto
    isLocked: false,
    progress: 0,
    stableFrames: 0,
    lockedA: 1.0,
    lockedB: 1.0,

    // Zoom / pan
    zoomLevel: 1.0,
    panOffset: 0,
    isDragging: false,
    dragStartX: 0,
    dragStartPan: 0,

    // Áudio
    isMicOn: false,
    isCalibrating: false,
    noiseFloor: 0.005,
    smoothedFreq: 0,

    // Dificuldade
    mode: 'hard', // 'easy' | 'hard'

    // Stats
    hits: 0,
    lockStartTime: 0,

    // Render
    needsRedraw: true,
    frameCount: 0,
    flashAlpha: 0,
    flashColor: '61, 255, 160',

    // Calibração
    calibrationSamples: [],
    calibrationEndTime: 0,
  };

  // -------- Constantes --------
  const PROGRESS_GAIN = 2.2;
  const PROGRESS_DECAY = 0.15;
  const LOCK_THRESHOLD = 100;
  const ERROR_ACCEPT = 0.38;
  const ERROR_PERFECT = 0.20;
  const STABLE_REQUIRED = 2;
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 10.0;
  const ZOOM_STEP = 0.5;
  const PAN_LIMIT = 100; // radianos máximos de pan

  const FREQ_MIN = 130.81;   // C3
  const FREQ_MAX = 1046.50;  // C6
  const FREQ_REF = 440;

  const ERROR_SAMPLES = 100;
  const ERROR_CALC_INTERVAL = 3; // a cada 3 frames

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* =========================================================
     2. REFERÊNCIAS DOM
     ========================================================= */
  const canvas = document.getElementById('waveCanvas');
  const ctx = canvas.getContext('2d');
  const appRoot = document.getElementById('appRoot');
  const canvasContainer = document.getElementById('canvasContainer');

  const micBtn = document.getElementById('micBtn');
  const playNoteBtn = document.getElementById('playNoteBtn');
  const novaNotaBtn = document.getElementById('novaNotaBtn');
  const calibrateBtn = document.getElementById('calibrateBtn');
  const tutorialBtn = document.getElementById('tutorialBtn');
  const retryBtn = document.getElementById('retryBtn');
  const tutorialCloseBtn = document.getElementById('tutorialCloseBtn');
  const tutorialOverlay = document.getElementById('tutorialOverlay');

  const micDot = document.getElementById('micDot');
  const micStatus = document.getElementById('micStatus');
  const freqDisplay = document.getElementById('freqDisplay');
  const noteDisplay = document.getElementById('noteDisplay');
  const rmsDisplay = document.getElementById('rmsDisplay');
  const levelBar = document.getElementById('levelBar');

  const aSlider = document.getElementById('aSlider');
  const bSlider = document.getElementById('bSlider');
  const cSlider = document.getElementById('cSlider');
  const dSlider = document.getElementById('dSlider');
  const aValue = document.getElementById('aValue');
  const bValue = document.getElementById('bValue');
  const cValue = document.getElementById('cValue');
  const dValue = document.getElementById('dValue');
  const aAutoBadge = document.getElementById('aAutoBadge');
  const bAutoBadge = document.getElementById('bAutoBadge');

  const feedbackMsg = document.getElementById('feedbackMsg');
  const successOverlay = document.getElementById('successOverlay');
  const successSub = document.getElementById('successSub');
  const progressFill = document.getElementById('progressFill');
  const progressPct = document.getElementById('progressPct');
  const errorMeterFill = document.getElementById('errorMeterFill');
  const errorValue = document.getElementById('errorValue');

  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const zoomResetBtn = document.getElementById('zoomResetBtn');
  const zoomDisplay = document.getElementById('zoomDisplay');

  const targetDisplay = document.getElementById('targetDisplay');
  const hitsDisplay = document.getElementById('hitsDisplay');
  const timeDisplay = document.getElementById('timeDisplay');
  const modeSelect = document.getElementById('modeSelect');

  /* =========================================================
     3. CANVAS — RESOLUÇÃO / DPR
     ========================================================= */
  const BASE_W = 1000;
  const BASE_H = 400;

  function resizeCanvasToDPR() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = BASE_W * dpr;
    canvas.height = BASE_H * dpr;
    canvas.style.aspectRatio = `${BASE_W} / ${BASE_H}`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.needsRedraw = true;
  }

  /* =========================================================
     4. MAPEAMENTOS / UTILITÁRIOS
     ========================================================= */
  function freqToB(freq) {
    if (freq <= 0) return 1.0;
    const b = 1.0 + Math.log2(freq / FREQ_REF) * 0.55;
    return Math.max(0.3, Math.min(5.0, b));
  }

  function rmsToA(rms) {
    const a = Math.min(rms * 12, 1.0);
    return Math.max(0.0, Math.min(1.0, a));
  }

  function freqToNoteName(freq) {
    if (freq < 20) return null;
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const midi = Math.round(12 * Math.log2(freq / 440) + 69);
    if (midi < 0 || midi > 127) return null;
    return `${noteNames[midi % 12]}${Math.floor(midi / 12) - 1}`;
  }

  /* =========================================================
     5. ÁUDIO — CONTEXTO E ANALISADOR
     ========================================================= */
  let audioCtx = null;
  let micStream = null;
  let analyser = null;
  let sourceNode = null;
  let timeDomainBuf = null;
  let freqDomainBuf = null;
  const FFT_SIZE = 2048;

  async function ensureAudioCtx() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        console.error('Falha ao criar AudioContext', e);
        return null;
      }
    }
    if (audioCtx.state === 'suspended') {
      try { await audioCtx.resume(); } catch (e) { /* silencioso */ }
    }
    return audioCtx;
  }

  /* =========================================================
     6. DETECÇÃO DE PITCH — AUTOCORRELAÇÃO
     ========================================================= */
  function autoCorrelate(buf, sampleRate) {
    // Baseado em "A Tuner" de Chris Wilson (domínio público adaptado)
    const SIZE = buf.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) {
      const v = buf[i];
      rms += v * v;
    }
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return -1; // sinal muito fraco

    // Trim bordas
    let r1 = 0, r2 = SIZE - 1;
    const thres = 0.2;
    for (let i = 0; i < SIZE / 2; i++) {
      if (Math.abs(buf[i]) < thres) { r1 = i; break; }
    }
    for (let i = 1; i < SIZE / 2; i++) {
      if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }
    }

    const trimmed = buf.slice(r1, r2);
    const newSize = trimmed.length;

    const c = new Array(newSize).fill(0);
    for (let i = 0; i < newSize; i++) {
      for (let j = 0; j < newSize - i; j++) {
        c[i] += trimmed[j] * trimmed[j + i];
      }
    }

    // Encontra primeiro mínimo local e depois o máximo
    let d = 0;
    while (d < newSize - 1 && c[d] > c[d + 1]) d++;

    let maxval = -1, maxpos = -1;
    for (let i = d; i < newSize; i++) {
      if (c[i] > maxval) {
        maxval = c[i];
        maxpos = i;
      }
    }

    let T0 = maxpos;
    // Interpolação parabólica
    const x1 = c[T0 - 1] || 0;
    const x2 = c[T0];
    const x3 = c[T0 + 1] || 0;
    const a = (x1 + x3 - 2 * x2) / 2;
    const b = (x3 - x1) / 2;
    if (a) T0 = T0 - b / (2 * a);

    return sampleRate / T0;
  }

  /* =========================================================
     7. DESENHO
     ========================================================= */
  function drawWaves() {
    const W = BASE_W, H = BASE_H;
    const centerY = H / 2;
    const scaleX = (2 * Math.PI) / W;

    ctx.clearRect(0, 0, W, H);

    // Grade
    ctx.lineWidth = 1;
    for (let y = 0; y <= H; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.strokeStyle = '#1e2538';
      ctx.stroke();
    }
    for (let x = 0; x <= W; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.strokeStyle = '#1a1f30';
      ctx.stroke();
    }

    // Eixo central
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(W, centerY);
    ctx.strokeStyle = '#2e3a5c';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const tAtX = (x) => (x * scaleX * state.zoomLevel) + state.panOffset;

    // Onda alvo (vermelha)
    ctx.beginPath();
    ctx.strokeStyle = '#ff4d6d';
    ctx.lineWidth = 4;
    ctx.shadowColor = '#ff4d6d';
    ctx.shadowBlur = prefersReducedMotion ? 0 : 12;
    for (let x = 0; x <= W; x++) {
      const t = tAtX(x);
      const y = state.targetA * Math.sin(state.targetB * t + state.targetC) + state.targetD;
      const cy = centerY - y * 70;
      if (x === 0) ctx.moveTo(x, cy); else ctx.lineTo(x, cy);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Onda resposta (verde)
    const drawA = state.isLocked ? state.lockedA : state.A;
    const drawB = state.isLocked ? state.lockedB : state.B;

    ctx.beginPath();
    ctx.strokeStyle = state.isLocked ? '#6effa0' : '#3dffa0';
    ctx.lineWidth = state.isLocked ? 5 : 3.5;
    ctx.shadowColor = '#3dffa0';
    ctx.shadowBlur = prefersReducedMotion ? 0 : (state.isLocked ? 25 : 12);
    for (let x = 0; x <= W; x++) {
      const t = tAtX(x);
      const y = drawA * Math.sin(drawB * t + state.C) + state.D;
      const cy = centerY - y * 70;
      if (x === 0) ctx.moveTo(x, cy); else ctx.lineTo(x, cy);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Indicador de zoom
    if (state.zoomLevel !== 1.0) {
      ctx.fillStyle = 'rgba(61, 255, 160, 0.55)';
      ctx.font = '600 13px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`🔍 ${state.zoomLevel.toFixed(1)}×  ·  arraste para navegar`, 18, H - 18);
    }

    // Flash
    if (state.flashAlpha > 0) {
      ctx.fillStyle = `rgba(${state.flashColor}, ${state.flashAlpha})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* =========================================================
     8. CÁLCULO DE ERRO
     ========================================================= */
  function computeError() {
    let errorSum = 0;
    const drawA = state.isLocked ? state.lockedA : state.A;
    const drawB = state.isLocked ? state.lockedB : state.B;
    // Modo fácil: ignora C e D do usuário (assume 0) para não penalizar
    const userC = (state.mode === 'easy') ? 0 : state.C;
    const userD = (state.mode === 'easy') ? 0 : state.D;

    for (let i = 0; i < ERROR_SAMPLES; i++) {
      const t = (i / ERROR_SAMPLES) * (2 * Math.PI);
      const targetY = state.targetA * Math.sin(state.targetB * t + state.targetC) + state.targetD;
      const respY = drawA * Math.sin(drawB * t + userC) + userD;
      errorSum += Math.abs(targetY - respY);
    }
    return errorSum / ERROR_SAMPLES;
  }

  /* =========================================================
     9. FEEDBACK E VERIFICAÇÃO DE LOCK
     ========================================================= */
  function updateFeedbackFromError(avgError) {
    if (state.isLocked) return;

    if (avgError < ERROR_ACCEPT) {
      state.progress = Math.min(LOCK_THRESHOLD, state.progress + PROGRESS_GAIN);
      state.stableFrames++;
    } else {
      state.progress = Math.max(0, state.progress - PROGRESS_DECAY);
      state.stableFrames = 0;
    }

    progressFill.style.width = `${state.progress}%`;
    progressPct.textContent = `${Math.round(state.progress)}%`;

    // Medidor de erro com cores
    errorValue.textContent = avgError.toFixed(3);
    // Mapeia erro [0, 0.6] → largura [100%, 0%]
    const errWidth = Math.max(0, Math.min(100, (1 - avgError / 0.6) * 100));
    errorMeterFill.style.width = `${errWidth}%`;
    errorMeterFill.classList.remove('perfect', 'close', 'far');
    if (avgError < ERROR_PERFECT) errorMeterFill.classList.add('perfect');
    else if (avgError < ERROR_ACCEPT) errorMeterFill.classList.add('close');
    else errorMeterFill.classList.add('far');

    // Mensagem
    if (avgError < ERROR_PERFECT) {
      feedbackMsg.innerHTML = `<span class="match">💚 Perfeito! Segure firme!</span>`;
      feedbackMsg.style.background = '#1a3a2a';
    } else if (avgError < ERROR_ACCEPT) {
      feedbackMsg.innerHTML = `<span style="color:#b3ffb3;">🎯 Muito perto! Continue...</span>`;
      feedbackMsg.style.background = '#1e2f2a';
    } else if (avgError < 0.65) {
      feedbackMsg.innerHTML = `🔍 Erro: ${avgError.toFixed(3)} · continue`;
      feedbackMsg.style.background = '#1a1f2e';
    } else {
      feedbackMsg.innerHTML = `🎯 Erro grande: ${avgError.toFixed(3)}`;
      feedbackMsg.style.background = '#2a1f2e';
    }

    // Lock
    if (state.stableFrames >= STABLE_REQUIRED && state.progress >= LOCK_THRESHOLD) {
      triggerSuccess(avgError);
    }
  }

  /* =========================================================
     10. SUCESSO / LOCK
     ========================================================= */
  function triggerSuccess(avgError) {
    state.isLocked = true;
    state.lockedA = state.A;
    state.lockedB = state.B;
    state.hits++;
    state.lockStartTime = performance.now();
    hitsDisplay.textContent = state.hits;

    appRoot.classList.add('locked');

    if (avgError < ERROR_PERFECT) {
      successSub.textContent = '🌟 Onda PERFEITA! Precisão absoluta!';
    } else {
      successSub.textContent = `🎉 Muito bem! Erro: ${avgError.toFixed(3)}`;
    }

    // Flash integrado ao rAF (sem setInterval)
    state.flashAlpha = 0.85;
    state.flashColor = '61, 255, 160';

    successOverlay.classList.add('show');

    if (!prefersReducedMotion) spawnConfetti();
    playVictorySound();

    feedbackMsg.innerHTML = `<span class="match">✅ Travado! Você acertou!</span>`;
    feedbackMsg.style.background = '#1a3a2a';
    state.needsRedraw = true;
  }

  function resetLock() {
    state.isLocked = false;
    state.progress = 0;
    state.stableFrames = 0;
    state.lockedA = state.A;
    state.lockedB = state.B;
    progressFill.style.width = '0%';
    progressPct.textContent = '0%';
    successOverlay.classList.remove('show');
    appRoot.classList.remove('locked');
    feedbackMsg.innerHTML = `⏳ Continue ajustando...`;
    feedbackMsg.style.background = '#1a1f2e';
    state.needsRedraw = true;
  }

  /* =========================================================
     11. CONFETES
     ========================================================= */
  function spawnConfetti() {
    const colors = ['#3dffa0', '#4b6ef5', '#ff4d6d', '#ffd93d', '#c084fc'];
    const rect = canvasContainer.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    for (let i = 0; i < 40; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      const color = colors[(Math.random() * colors.length) | 0];
      const size = 6 + Math.random() * 10;
      p.style.width = `${size}px`;
      p.style.height = `${size}px`;
      p.style.background = color;
      p.style.boxShadow = `0 0 12px ${color}`;
      p.style.left = `${cx}px`;
      p.style.top = `${cy}px`;
      p.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';

      const angle = Math.random() * Math.PI * 2;
      const dist = 80 + Math.random() * 240;
      p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      p.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
      p.style.animation = `particleFly ${0.8 + Math.random() * 0.6}s ease-out forwards`;

      canvasContainer.appendChild(p);
      setTimeout(() => p.remove(), 1500);
    }
  }

  /* =========================================================
     12. SONS
     ========================================================= */
  async function playTone(frequency, duration = 0.8) {
    const ac = await ensureAudioCtx();
    if (!ac) return;
    const now = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  function playVictorySound() {
    if (prefersReducedMotion) return;
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach(async (freq, i) => {
      const ac = await ensureAudioCtx();
      if (!ac) return;
      const now = ac.currentTime + i * 0.09;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.22, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(now);
      osc.stop(now + 0.5);
    });
  }

  /* =========================================================
     13. SORTEIO DA NOTA ALVO
     ========================================================= */
  function sortearFrequencia() {
    const logMin = Math.log(FREQ_MIN);
    const logMax = Math.log(FREQ_MAX);
    return Math.exp(logMin + Math.random() * (logMax - logMin));
  }

  function sortearNotaAlvo() {
    state.targetFreq = sortearFrequencia();
    state.targetB = freqToB(state.targetFreq);
    state.targetA = 0.8 + Math.random() * 0.9;   // 0.8 .. 1.7

    if (state.mode === 'easy') {
      state.targetC = 0;
      state.targetD = 0;
    } else {
      state.targetC = (Math.random() * 2 - 1) * 0.15;
      state.targetD = (Math.random() * 2 - 1) * 0.10;
    }

    state.targetNote = freqToNoteName(state.targetFreq) || `${state.targetFreq.toFixed(1)}Hz`;
    targetDisplay.textContent = `🎯 ${state.targetNote} · ${state.targetFreq.toFixed(0)} Hz`;

    if (state.isLocked) resetLock();

    state.needsRedraw = true;
    // Força atualização imediata do feedback
    updateFeedbackFromError(computeError());
  }

  /* =========================================================
     14. MICROFONE
     ========================================================= */
  async function enableMicrophone() {
    if (state.isMicOn) { disableMicrophone(); return; }

    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });

      const ac = await ensureAudioCtx();
      if (!ac) throw new Error('AudioContext indisponível');

      analyser = ac.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.8;

      sourceNode = ac.createMediaStreamSource(micStream);
      sourceNode.connect(analyser);

      timeDomainBuf = new Float32Array(analyser.fftSize);
      freqDomainBuf = new Uint8Array(analyser.frequencyBinCount);

      state.isMicOn = true;
      micBtn.classList.add('active');
      micBtn.textContent = '🎤 Microfone ligado';
      micDot.classList.add('live');
      micStatus.textContent = 'Captando...';

      aSlider.disabled = true;
      bSlider.disabled = true;
      aAutoBadge.style.display = 'inline';
      bAutoBadge.style.display = 'inline';
    } catch (err) {
      console.error('Erro ao acessar microfone:', err);
      alert('Não foi possível acessar o microfone. Verifique as permissões do navegador.');
    }
  }

  function disableMicrophone() {
    if (sourceNode) { sourceNode.disconnect(); sourceNode = null; }
    if (micStream) {
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
    }
    analyser = null;
    state.isMicOn = false;
    state.smoothedFreq = 0;    // BUG FIX: reseta frequência suavizada

    micBtn.classList.remove('active');
    micBtn.textContent = '🎤 Ativar microfone';
    micDot.classList.remove('live');
    micDot.classList.remove('calibrating');
    micStatus.textContent = 'Desligado';
    freqDisplay.textContent = '— Hz';
    noteDisplay.textContent = '—';
    rmsDisplay.textContent = '0.00';
    levelBar.style.width = '0%';

    aSlider.disabled = false;
    bSlider.disabled = false;
    aAutoBadge.style.display = 'none';
    bAutoBadge.style.display = 'none';
  }

  /* =========================================================
     15. CALIBRAÇÃO DE SILÊNCIO
     ========================================================= */
  function startCalibration() {
    if (!state.isMicOn) {
      alert('Ative o microfone antes de calibrar.');
      return;
    }
    state.isCalibrating = true;
    state.calibrationSamples = [];
    state.calibrationEndTime = performance.now() + 2000;

    micDot.classList.add('calibrating');
    micStatus.textContent = 'Calibrando (2s)...';
    calibrateBtn.textContent = '🎚️ Calibrando...';
    calibrateBtn.disabled = true;
  }

  function finishCalibration() {
    state.isCalibrating = false;
    micDot.classList.remove('calibrating');
    micStatus.textContent = 'Captando...';
    calibrateBtn.textContent = '🎚️ Calibrar silêncio';
    calibrateBtn.disabled = false;

    if (state.calibrationSamples.length > 0) {
      const avg = state.calibrationSamples.reduce((a, b) => a + b, 0) / state.calibrationSamples.length;
      state.noiseFloor = Math.max(0.003, avg * 1.2); // margem de segurança
    }
  }

  /* =========================================================
     16. LOOP DE ÁUDIO (chamado pelo renderLoop)
     ========================================================= */
  function updateAudioFromMic() {
    if (!state.isMicOn || !analyser) return;

    // Domínio do tempo (para RMS e autocorrelação)
    analyser.getFloatTimeDomainData(timeDomainBuf);

    // RMS
    let sumSquares = 0;
    for (let i = 0; i < timeDomainBuf.length; i++) {
      const v = timeDomainBuf[i];
      sumSquares += v * v;
    }
    let rms = Math.sqrt(sumSquares / timeDomainBuf.length);

    // Calibração em andamento
    if (state.isCalibrating) {
      state.calibrationSamples.push(rms);
      if (performance.now() >= state.calibrationEndTime) finishCalibration();
    }

    // Subtrai piso de ruído
    const effectiveRms = Math.max(0, rms - state.noiseFloor);

    // Pitch por autocorrelação (mais robusto que FFT maxIndex)
    let pitch = -1;
    if (effectiveRms > 0.005) {
      pitch = autoCorrelate(timeDomainBuf, audioCtx.sampleRate);
      if (pitch < 50 || pitch > 2000) pitch = -1; // fora da faixa vocal
    }

    // Suavização do pitch
    if (pitch > 0) {
      if (state.smoothedFreq === 0) state.smoothedFreq = pitch;
      else state.smoothedFreq = state.smoothedFreq * 0.8 + pitch * 0.2;
    } else {
      state.smoothedFreq *= 0.95;
      if (state.smoothedFreq < 20) state.smoothedFreq = 0;
    }

    // Atualiza displays
    freqDisplay.textContent = state.smoothedFreq > 0
      ? `${state.smoothedFreq.toFixed(0)} Hz` : '— Hz';
    noteDisplay.textContent = freqToNoteName(state.smoothedFreq) || '—';
    rmsDisplay.textContent = effectiveRms.toFixed(4);
    levelBar.style.width = `${Math.min(effectiveRms * 300, 100)}%`;

    // Converte para coeficientes (se não estiver locked)
    if (!state.isLocked) {
      if (effectiveRms > 0.005) {
        state.A = rmsToA(effectiveRms);
        state.B = freqToB(state.smoothedFreq > 0 ? state.smoothedFreq : 440);
      } else {
        state.A = 0.05;
      }
      aSlider.value = state.A;
      bSlider.value = state.B;
      aValue.textContent = state.A.toFixed(2);
      bValue.textContent = state.B.toFixed(2);
      state.needsRedraw = true;
    }
  }

  /* =========================================================
     17. RENDER LOOP ÚNICO
     ========================================================= */
  let lastErrorCalc = 0;

  function renderLoop() {
    state.frameCount++;

    // Áudio
    updateAudioFromMic();

    // Erro a cada N frames (perf)
    if (state.frameCount % ERROR_CALC_INTERVAL === 0) {
      const err = computeError();
      updateFeedbackFromError(err);
    }

    // Flash decay
    if (state.flashAlpha > 0) {
      state.flashAlpha = Math.max(0, state.flashAlpha - 0.04);
      state.needsRedraw = true;
    }

    // Timer de tempo do lock
    if (state.isLocked && state.lockStartTime > 0) {
      const elapsed = (performance.now() - state.lockStartTime) / 1000;
      timeDisplay.textContent = `${elapsed.toFixed(1)}s`;
    }

    // Desenho
    if (state.needsRedraw) {
      drawWaves();
      state.needsRedraw = false;
    }

    requestAnimationFrame(renderLoop);
  }

  /* =========================================================
     18. ZOOM / PAN
     ========================================================= */
  function updateZoomDisplay() {
    zoomDisplay.textContent = `${state.zoomLevel.toFixed(1)}×`;
    canvas.classList.toggle('zoomed', state.zoomLevel !== 1.0);
  }

  function clampPan() {
    state.panOffset = Math.max(-PAN_LIMIT, Math.min(PAN_LIMIT, state.panOffset));
  }

  function setZoom(newZoom, anchorX = BASE_W / 2) {
    const oldZoom = state.zoomLevel;
    newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom));
    if (newZoom === oldZoom) return;

    const scaleX = (2 * Math.PI) / BASE_W;
    const tAtAnchor = anchorX * scaleX * oldZoom + state.panOffset;
    state.zoomLevel = newZoom;
    state.panOffset = tAtAnchor - anchorX * scaleX * state.zoomLevel;
    clampPan();

    updateZoomDisplay();
    state.needsRedraw = true;
  }

  /* =========================================================
     19. EVENTOS — SLIDERS MANUAIS
     ========================================================= */
  function onManualSliderChange() {
    state.C = parseFloat(cSlider.value);
    state.D = parseFloat(dSlider.value);
    cValue.textContent = state.C.toFixed(2);
    dValue.textContent = state.D.toFixed(2);
    if (!state.isLocked) state.needsRedraw = true;
  }

  cSlider.addEventListener('input', onManualSliderChange);
  dSlider.addEventListener('input', onManualSliderChange);

  /* =========================================================
     20. EVENTOS — BOTÕES
     ========================================================= */
  micBtn.addEventListener('click', enableMicrophone);

  playNoteBtn.addEventListener('click', () => {
    playTone(state.targetFreq, 0.9);
  });

  novaNotaBtn.addEventListener('click', () => {
    sortearNotaAlvo();
    playTone(state.targetFreq, 0.7);
  });

  calibrateBtn.addEventListener('click', startCalibration);

  retryBtn.addEventListener('click', resetLock);

  tutorialBtn.addEventListener('click', () => {
    tutorialOverlay.classList.add('show');
    tutorialOverlay.setAttribute('aria-hidden', 'false');
  });

  tutorialCloseBtn.addEventListener('click', () => {
    tutorialOverlay.classList.remove('show');
    tutorialOverlay.setAttribute('aria-hidden', 'true');
    try { localStorage.setItem('acertouTutorialVisto', '1'); } catch (e) {}
  });

  modeSelect.addEventListener('change', (e) => {
    state.mode = e.target.value;
    // Re-sorteia alvo respeitando o novo modo
    sortearNotaAlvo();
  });

  /* =========================================================
     21. EVENTOS — ZOOM
     ========================================================= */
  zoomInBtn.addEventListener('click', () => setZoom(state.zoomLevel + ZOOM_STEP));
  zoomOutBtn.addEventListener('click', () => setZoom(state.zoomLevel - ZOOM_STEP));
  zoomResetBtn.addEventListener('click', () => {
    state.zoomLevel = 1.0;
    state.panOffset = 0;
    updateZoomDisplay();
    state.needsRedraw = true;
  });

  // Wheel
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const scale = BASE_W / rect.width;
    const mouseX = (e.clientX - rect.left) * scale;
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    setZoom(state.zoomLevel + delta, mouseX);
  }, { passive: false });

  // Pan com mouse
  canvas.addEventListener('mousedown', (e) => {
    if (state.zoomLevel === 1.0) return;
    state.isDragging = true;
    state.dragStartX = e.clientX;
    state.dragStartPan = state.panOffset;
    canvas.classList.add('dragging');
  });

  window.addEventListener('mousemove', (e) => {
    if (!state.isDragging) return;
    const rect = canvas.getBoundingClientRect();
    const scale = BASE_W / rect.width;
    const scaleX = (2 * Math.PI) / BASE_W;
    const dx = (e.clientX - state.dragStartX) * scale;
    state.panOffset = state.dragStartPan - dx * scaleX * state.zoomLevel;
    clampPan();
    state.needsRedraw = true;
  });

  window.addEventListener('mouseup', () => {
    if (state.isDragging) {
      state.isDragging = false;
      canvas.classList.remove('dragging');
    }
  });

  /* =========================================================
     22. EVENTOS — TOUCH (pan + pinch-to-zoom)
     ========================================================= */
  let pinchStartDist = 0;
  let pinchStartZoom = 1;

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1 && state.zoomLevel !== 1.0) {
      state.isDragging = true;
      state.dragStartX = e.touches[0].clientX;
      state.dragStartPan = state.panOffset;
      canvas.classList.add('dragging');
    } else if (e.touches.length === 2) {
      // Pinch-to-zoom
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDist = Math.hypot(dx, dy);
      pinchStartZoom = state.zoomLevel;
    }
  }, { passive: true });

  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1 && state.isDragging) {
      const rect = canvas.getBoundingClientRect();
      const scale = BASE_W / rect.width;
      const scaleX = (2 * Math.PI) / BASE_W;
      const dx = (e.touches[0].clientX - state.dragStartX) * scale;
      state.panOffset = state.dragStartPan - dx * scaleX * state.zoomLevel;
      clampPan();
      state.needsRedraw = true;
    } else if (e.touches.length === 2 && pinchStartDist > 0) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const factor = dist / pinchStartDist;
      const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pinchStartZoom * factor));
      if (newZoom !== state.zoomLevel) {
        state.zoomLevel = newZoom;
        updateZoomDisplay();
        state.needsRedraw = true;
      }
    }
  }, { passive: true });

  canvas.addEventListener('touchend', () => {
    state.isDragging = false;
    pinchStartDist = 0;
    canvas.classList.remove('dragging');
  }, { passive: true });

  /* =========================================================
     23. EVENTOS — TECLADO
     ========================================================= */
  window.addEventListener('keydown', (e) => {
    // Ignora se está digitando em input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    const scaleX = (2 * Math.PI) / BASE_W;
    const panStep = 20 * scaleX * state.zoomLevel;

    switch (e.key) {
      case '+':
      case '=':
        setZoom(state.zoomLevel + ZOOM_STEP);
        e.preventDefault();
        break;
      case '-':
      case '_':
        setZoom(state.zoomLevel - ZOOM_STEP);
        e.preventDefault();
        break;
      case '0':
        state.zoomLevel = 1.0;
        state.panOffset = 0;
        updateZoomDisplay();
        state.needsRedraw = true;
        break;
      case 'ArrowLeft':
        state.panOffset -= panStep;
        clampPan();
        state.needsRedraw = true;
        e.preventDefault();
        break;
      case 'ArrowRight':
        state.panOffset += panStep;
        clampPan();
        state.needsRedraw = true;
        e.preventDefault();
        break;
    }
  });

  /* =========================================================
     24. INICIALIZAÇÃO
     ========================================================= */
  function init() {
    resizeCanvasToDPR();

    // Estado inicial dos sliders manuais
    state.C = parseFloat(cSlider.value);
    state.D = parseFloat(dSlider.value);
    cValue.textContent = state.C.toFixed(2);
    dValue.textContent = state.D.toFixed(2);

    updateZoomDisplay();
    sortearNotaAlvo();

    // Tutorial na primeira visita
    let viu = false;
    try { viu = localStorage.getItem('acertouTutorialVisto') === '1'; } catch (e) {}
    if (!viu) {
      tutorialOverlay.classList.add('show');
      tutorialOverlay.setAttribute('aria-hidden', 'false');
    }

    // Resize do canvas com DPR
    window.addEventListener('resize', () => {
      resizeCanvasToDPR();
      state.needsRedraw = true;
    });

    // Inicia o render loop único
    requestAnimationFrame(renderLoop);
  }

  init();

})();