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
  let isLocked = false;
  let progress = 0;
  const PROGRESS_GAIN = 0.9;
  const PROGRESS_DECAY = 0.35;
  const LOCK_THRESHOLD = 100;
  const ERROR_ACCEPT = 0.14;
  const ERROR_PERFECT = 0.06;

  let stableFrames = 0;
  const STABLE_REQUIRED = 3;

  let flashAlpha = 0;
  let flashColor = '61, 255, 160';

  // Congela valores no momento do lock
  let lockedA = 1.0;
  let lockedB = 1.0;

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

    // Onda resposta (verde) — usa valores travados se estiver locked
    const drawA = isLocked ? lockedA : A;
    const drawB = isLocked ? lockedB : B;

    ctx.beginPath();
    ctx.strokeStyle = isLocked ? '#6effa0' : '#3dffa0';
    ctx.lineWidth = isLocked ? 5 : 3.5;
    ctx.shadowColor = '#3dffa0';
    ctx.shadowBlur = isLocked ? 25 : 12;
    for (let x = 0; x < width; x++) {
      const t = x * scaleX;
      const y = drawA * Math.sin(drawB * t + C) + D;
      const canvasY = centerY - y * 70;
      if (x === 0) ctx.moveTo(x, canvasY);
      else ctx.lineTo(x, canvasY);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Flash por cima (ao acertar)
    if (flashAlpha > 0) {
      ctx.fillStyle = `rgba(${flashColor}, ${flashAlpha})`;
      ctx.fillRect(0, 0, width, height);
    }
  }

  // ================= FEEDBACK / ERRO =================
  function computeError() {
    let errorSum = 0;
    const samples = 150;
    const drawA = isLocked ? lockedA : A;
    const drawB = isLocked ? lockedB : B;
    for (let i = 0; i < samples; i++) {
      const t = (i / samples) * (2 * Math.PI);
      const targetY = targetA * Math.sin(targetB * t + targetC) + targetD;
      const respY = drawA * Math.sin(drawB * t + C) + D;
      errorSum += Math.abs(targetY - respY);
    }
    return errorSum / samples;
  }

  function updateFeedback() {
    const avgError = computeError();

    if (!isLocked) {
      // Atualiza barra de progresso
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
      if (avgError < ERROR_PERFECT) {
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

      // Dispara lock
      if (stableFrames >= STABLE_REQUIRED && progress >= LOCK_THRESHOLD) {
        triggerSuccess(avgError);
      }
    }

    return avgError;
  }

  // ================= SUCESSO / LOCK =================
  function triggerSuccess(avgError) {
    isLocked = true;
    lockedA = A;
    lockedB = B;

    card.classList.add('locked');

    // Texto do subtítulo
    if (avgError < ERROR_PERFECT) {
      successSub.textContent = '🌟 Onda PERFEITA! Precisão absoluta!';
    } else {
      successSub.textContent = `🎉 Coeficientes alinhados! Erro: ${avgError.toFixed(3)}`;
    }

    // Flash visual na onda
    flashAlpha = 0.85;
    flashColor = '61, 255, 160';
    let flashFade = setInterval(() => {
      flashAlpha -= 0.06;
      if (flashAlpha <= 0) {
        flashAlpha = 0;
        clearInterval(flashFade);
      }
      drawWaves();
    }, 25);

    // Mostra overlay
    successOverlay.classList.add('show');

    // Confete
    spawnConfetti();

    // Som de vitória
    playVictorySound();

    // Feedback fixo
    feedbackMsg.innerHTML = `<span class="match">✅ Travado! Você acertou!</span>`;
    feedbackMsg.style.background = '#1a3a2a';
  }

  function resetLock() {
    isLocked = false;
    progress = 0;
    stableFrames = 0;
    lockedA = A;
    lockedB = B;
    progressFill.style.width = '0%';
    progressPct.textContent = '0%';
    successOverlay.classList.remove('show');
    card.classList.remove('locked');
    feedbackMsg.innerHTML = `⏳ Continue ajustando...`;
    feedbackMsg.style.background = '#1a1f2e';
    drawWaves();
  }

  // ================= CONFETES =================
  function spawnConfetti() {
    const colors = ['#3dffa0', '#4b6ef5', '#ff4d6d', '#ffd93d', '#c084fc'];
    const rect = canvasContainer.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    for (let i = 0; i < 45; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      const color = colors[Math.floor(Math.random() * colors.length)];
      const size = 6 + Math.random() * 10;
      p.style.width = `${size}px`;
      p.style.height = `${size}px`;
      p.style.background = color;
      p.style.boxShadow = `0 0 12px ${color}`;
      p.style.left = `${centerX}px`;
      p.style.top = `${centerY}px`;
      p.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';

      const angle = Math.random() * Math.PI * 2;
      const dist = 80 + Math.random() * 240;
      p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      p.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);

      // Animação personalizada
      p.style.animation = `particleFly ${0.8 + Math.random() * 0.6}s ease-out forwards`;

      canvasContainer.appendChild(p);
      setTimeout(() => p.remove(), 1500);
    }
  }

  // ================= SOM DE VITÓRIA =================
  function playVictorySound() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const now = audioCtx.currentTime;
    // Arpejo maior: C5 - E5 - G5 - C6
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const t0 = now + i * 0.09;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.22, t0 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.5);
    });
  }

  // ================= SOM DE REFERÊNCIA =================
  function playTone(frequency, duration = 0.8) {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.value = frequency;

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(now);
    osc.stop(now + duration);
  }

  // ================= MICROFONE =================
  async function enableMicrophone() {
    if (isMicOn) {
      disableMicrophone();
      return;
    }

    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') await audioCtx.resume();

      analyser = audioCtx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = SMOOTHING;

      sourceNode = audioCtx.createMediaStreamSource(micStream);
      sourceNode.connect(analyser);

      dataArray = new Uint8Array(analyser.frequencyBinCount);
      timeDomainData = new Uint8Array(analyser.fftSize);

      isMicOn = true;
      micBtn.classList.add('active');
      micBtn.innerHTML = '🎤 Microfone ligado';
      micDot.classList.add('live');
      micStatus.textContent = 'Captando...';

      aSlider.disabled = true;
      bSlider.disabled = true;
      aAutoBadge.style.display = 'inline';
      bAutoBadge.style.display = 'inline';

      updateLoop();
    } catch (err) {
      console.error('Erro ao acessar microfone:', err);
      alert('Não foi possível acessar o microfone. Verifique as permissões do navegador.');
    }
  }

  function disableMicrophone() {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    if (sourceNode) {
      sourceNode.disconnect();
      sourceNode = null;
    }
    if (micStream) {
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
    }
    analyser = null;
    isMicOn = false;
    micBtn.classList.remove('active');
    micBtn.innerHTML = '🎤 Ativar microfone';
    micDot.classList.remove('live');
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

  function updateLoop() {
    if (!isMicOn || !analyser) return;

    // Se estiver travado, só continua o loop sem atualizar a onda
    if (isLocked) {
      // ainda lê o microfone para o painel, mas não atualiza A/B
      analyser.getByteFrequencyData(dataArray);
      analyser.getByteTimeDomainData(timeDomainData);

      let sumSquares = 0;
      for (let i = 0; i < timeDomainData.length; i++) {
        const v = (timeDomainData[i] - 128) / 128;
        sumSquares += v * v;
      }
      const rms = Math.sqrt(sumSquares / timeDomainData.length);
      rmsDisplay.textContent = rms.toFixed(4);
      levelBar.style.width = `${Math.min(rms * 300, 100)}%`;

      animationId = requestAnimationFrame(updateLoop);
      return;
    }

    analyser.getByteFrequencyData(dataArray);
    analyser.getByteTimeDomainData(timeDomainData);

    // RMS
    let sumSquares = 0;
    for (let i = 0; i < timeDomainData.length; i++) {
      const v = (timeDomainData[i] - 128) / 128;
      sumSquares += v * v;
    }
    const rms = Math.sqrt(sumSquares / timeDomainData.length);

    // Frequência dominante
    let maxVal = -1;
    let maxIndex = -1;
    for (let i = 0; i < dataArray.length; i++) {
      if (dataArray[i] > maxVal) {
        maxVal = dataArray[i];
        maxIndex = i;
      }
    }
    const nyquist = audioCtx.sampleRate / 2;
    const binFreq = maxIndex * nyquist / dataArray.length;
    const rawFreq = (maxVal > 40) ? binFreq : 0;

    if (rawFreq > 0) {
      if (smoothedFreq === 0) smoothedFreq = rawFreq;
      else smoothedFreq = smoothedFreq * (1 - FREQ_SMOOTH) + rawFreq * FREQ_SMOOTH;
    } else {
      smoothedFreq *= 0.95;
      if (smoothedFreq < 20) smoothedFreq = 0;
    }

    // Displays
    freqDisplay.textContent = smoothedFreq > 0 ? `${smoothedFreq.toFixed(0)} Hz` : '— Hz';
    noteDisplay.textContent = freqToNoteName(smoothedFreq) || '—';
    rmsDisplay.textContent = rms.toFixed(4);
    levelBar.style.width = `${Math.min(rms * 300, 100)}%`;

    // A e B do microfone
    if (rms > 0.005) {
      A = rmsToA(rms);
      B = freqToB(smoothedFreq > 0 ? smoothedFreq : 440);
    } else {
      A = 0.05;
    }

    aSlider.value = A;
    bSlider.value = B;
    aValue.textContent = A.toFixed(2);
    bValue.textContent = B.toFixed(2);

    drawWaves();
    updateFeedback();

    animationId = requestAnimationFrame(updateLoop);
  }

  // ================= ALVO =================
  function setTargetFromNote(note) {
    if (note === 'A4') {
      targetA = 0.9;
      targetB = 1.0;
      targetC = 0.0;
      targetD = 0.0;
    } else if (note === 'C5') {
      targetA = 1.3;
      targetB = 1.25;
      targetC = 0.6;
      targetD = 0.15;
    } else if (note === 'E5') {
      targetA = 1.6;
      targetB = 1.6;
      targetC = -0.4;
      targetD = -0.2;
    }
    currentNote = note;
    noteBtns.forEach(btn => {
      if (btn.dataset.note === note) btn.classList.add('active');
      else btn.classList.remove('active');
    });

    // Se trocar de nota, reseta o lock
    if (isLocked) resetLock();

    drawWaves();
    updateFeedback();
  }

  // ================= SLIDERS MANUAIS (C e D) =================
  function updateManualSliders() {
    C = parseFloat(cSlider.value);
    D = parseFloat(dSlider.value);
    cValue.textContent = C.toFixed(2);
    dValue.textContent = D.toFixed(2);
    if (!isLocked) {
      drawWaves();
      updateFeedback();
    }
  }

  cSlider.addEventListener('input', updateManualSliders);
  dSlider.addEventListener('input', updateManualSliders);

  // ================= EVENTOS =================
  micBtn.addEventListener('click', enableMicrophone);

  playNoteBtn.addEventListener('click', () => {
    const freq = noteFrequencies[currentNote] || 523.25;
    playTone(freq, 0.9);
  });

  noteBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const note = btn.dataset.note;
      setTargetFromNote(note);
      playTone(noteFrequencies[note] || 523.25, 0.7);
    });
  });

  retryBtn.addEventListener('click', () => {
    resetLock();
  });

  // ================= INICIALIZAÇÃO =================
  setTargetFromNote('C5');
  updateManualSliders();
  drawWaves();
  updateFeedback();
})();