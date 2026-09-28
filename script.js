(function () {
  'use strict';

  // ================= CONFIGURAÇÃO =================
  const canvas = document.getElementById('waveCanvas');
  const ctx = canvas.getContext('2d');
  const width = 1000;
  const height = 400;
  const centerY = height / 2;
  const scaleX = (2 * Math.PI) / width;

  // Elementos UI
  const aSlider = document.getElementById('aSlider');
  const bSlider = document.getElementById('bSlider');
  const cSlider = document.getElementById('cSlider');
  const dSlider = document.getElementById('dSlider');
  const aValue = document.getElementById('aValue');
  const bValue = document.getElementById('bValue');
  const cValue = document.getElementById('cValue');
  const dValue = document.getElementById('dValue');
  const feedbackMsg = document.getElementById('feedbackMsg');
  const micBtn = document.getElementById('micBtn');
  const playNoteBtn = document.getElementById('playNoteBtn');
  const noteBtns = document.querySelectorAll('.note-btn');
  const micDot = document.getElementById('micDot');
  const micStatus = document.getElementById('micStatus');
  const freqDisplay = document.getElementById('freqDisplay');
  const noteDisplay = document.getElementById('noteDisplay');
  const rmsDisplay = document.getElementById('rmsDisplay');
  const levelBar = document.getElementById('levelBar');
  const aAutoBadge = document.getElementById('aAutoBadge');
  const bAutoBadge = document.getElementById('bAutoBadge');
  const successOverlay = document.getElementById('successOverlay');
  const successSub = document.getElementById('successSub');
  const retryBtn = document.getElementById('retryBtn');
  const progressFill = document.getElementById('progressFill');
  const progressPct = document.getElementById('progressPct');
  const canvasContainer = document.getElementById('canvasContainer');
  const card = document.querySelector('.card');

  // ================= ESTADO =================
  let A = 1.0;
  let B = 1.0;
  let C = 0.0;
  let D = 0.0;

  let targetA = 1.0;
  let targetB = 1.2;
  let targetC = 0.0;
  let targetD = 0.0;

  let currentNote = 'C5';
  const noteFrequencies = {
    'A4': 440.00,
    'C5': 523.25,
    'E5': 659.25
  };

  // -------- ESTADO DE LOCK / ACERTO --------
  let isLocked = false;                  // trava geral (bloqueia updates)
  let progress = 0;                      // 0..100, acumula tempo na zona de acerto
  const PROGRESS_GAIN = 0.9;             // ganho por frame de acerto
  const PROGRESS_DECAY = 0.35;           // decaimento por frame fora da zona
  const LOCK_THRESHOLD = 100;            // % para travar
  const ERROR_ACCEPT = 0.14;             // erro médio para considerar "acerto"
  const ERROR_PERFECT = 0.06;            // erro para "perfeito"

  // Zona estável (evita travar por 1 frame milagroso)
  let stableFrames = 0;
  const STABLE_REQUIRED = 3;             // frames consecutivos de acerto

  // Flash visual no acerto
  let flashAlpha = 0;
  let flashColor = '61, 255, 160';

  // ================= MAPEAMENTOS =================
  const FREQ_REF = 440;
  function freqToB(freq) {
    if (freq <= 0) return 1.0;
    const b = 1.0 + Math.log2(freq / FREQ_REF) * 0.55;
    return Math.max(0.3, Math.min(5.0, b));
  }

  function rmsToA(rms) {
    const a = 0.2 + Math.min(rms * 12, 2.8);
    return Math.max(0.1, Math.min(3.0, a));
  }

  function freqToNoteName(freq) {
    if (freq < 20) return null;
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const midi = Math.round(12 * Math.log2(freq / 440) + 69);
    if (midi < 0 || midi > 127) return null;
    const note = noteNames[midi % 12];
    const octave = Math.floor(midi / 12) - 1;
    return `${note}${octave}`;
  }

  // ================= ÁUDIO =================
  let audioCtx = null;
  let micStream = null;
  let analyser = null;
  let sourceNode = null;
  let isMicOn = false;
  let animationId = null;
  let dataArray = null;
  let timeDomainData = null;

  const FFT_SIZE = 2048;
  const SMOOTHING = 0.8;

  let smoothedFreq = 0;
  const FREQ_SMOOTH = 0.2;

  // ================= DESENHO =================
  function drawWaves() {
    ctx.clearRect(0, 0, width, height);

    // Grade
    ctx.lineWidth = 1;
    for (let y = 0; y <= height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.strokeStyle = '#1e2538';
      ctx.stroke();
    }
    for (let x = 0; x <= width; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.strokeStyle = '#1a1f30';
      ctx.stroke();
    }

    // Eixo central
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.strokeStyle = '#2e3a5c';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Onda alvo (vermelha)
    ctx.beginPath();
    ctx.strokeStyle = '#ff4d6d';
    ctx.lineWidth = 4;
    ctx.shadowColor = '#ff4d6d';
    ctx.shadowBlur = 12;
    for (let x = 0; x < width; x++) {
      const t = x * scaleX;
      const y = targetA * Math.sin(targetB * t + targetC) + targetD;
      const canvasY = centerY - y * 70;
      if (x === 0) ctx.moveTo(x, canvasY);
      else ctx.lineTo(x, canvasY);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Onda resposta (verde)
    ctx.beginPath();
    ctx.strokeStyle = isLocked ? '#6effa0' : '#3dffa0';
    ctx.lineWidth = isLocked ? 5 : 3.5;
    ctx.shadowColor = '#3dffa0';
    ctx.shadowBlur = isLocked ? 25 : 12;
    for (let x = 0; x < width; x++) {
      const t = x * scaleX;
      const y = A * Math.sin(B * t + C) + D;
      const canvasY = centerY - y * 70;
      if (x === 0) ctx.moveTo(x, canvasY);
      else ctx.lineTo(x, canvasY);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Flash branco/verde por cima (ao acertar)
    if (flashAlpha > 0) {
      ctx.fillStyle = `rgba(${flashColor}, ${flashAlpha})`;
      ctx.fillRect(0, 0, width, height);
    }
  }

  // ================= FEEDBACK / ERRO =================
  function computeError() {
    let errorSum = 0;
    const samples = 150;
    for (let i = 0; i < samples; i++) {
      const t = (i / samples) * (2 * Math.PI);
      const targetY = targetA * Math.sin(targetB * t + targetC) + targetD;
      const respY = A * Math.sin(B * t + C) + D;
      errorSum += Math.abs(targetY - respY);
    }
    return errorSum / samples;
  }

  function updateFeedback() {
    const avgError = computeError();

    // Atualiza barra de progresso global
    if (avgError < ERROR_ACCEPT) {
      progress = Math.min(LOCK_THRESHOLD, progress + PROGRESS_GAIN);
      stableFrames++;
    } else {
      progress = Math.max(0, progress - PROGRESS_DECAY);
      stableFrames = 0;
    }

    progressFill.style.width = `${progress}%`;
    progressPct.textContent = `${Math.round(progress)}%`;

    // Mensagem
    if (isLocked) {
      feedbackMsg.innerHTML = `<span class="match">✅ Travado! Você acertou!</span>`;
      feedbackMsg.style.background = '#1a3a2a';
    } else if (avgError < ERROR_PERFECT) {
      feedbackMsg.innerHTML = `<span class="match">💚 Perfeito! Segure firme!</span>`;
      feedbackMsg.style.background = '#1a3a2a';
    } else if (avgError < ERROR_ACCEPT) {
      feedbackMsg.innerHTML = `<span style="color:#b3ffb3;">🎯 Quase travando! Continue...</span>`;
      feedbackMsg.style.background = '#1e2f2a';
    } else if (avgError < 0.3) {
      feedbackMsg.innerHTML = `🔍 Erro: ${avgError.toFixed(3)} · continue`;
      feedbackMsg.style.background = '#1a1f2e';
    } else {
      feedbackMsg.innerHTML = `🎯 Erro grande: ${avgError.toFixed(3)}`;
      feedbackMsg.style.background = '#2a1f2e';
    }

    // Verifica se deve travar
    if (!isLocked && stableFrames >= STABLE_REQUIRED && progress >= LOCK_THRESHOLD) {
      triggerSuccess(avgError);
    }

    return avgError;
  }

  // ================= SUCESSO / LOCK =================
  function triggerSuccess(avgError) {
    isLocked = true;
    card.classList.add('locked');
    canvasContainer.classList.add('success-flash');

    // Texto do subtítulo
    if (avgError < ERROR_PERFECT) {
      successSub.textContent = '🌟 Onda PERFEITA! Precisão absoluta!';
    } else {
      successSub.textContent = `🎉 Coeficientes alinhados! Erro: ${avgError