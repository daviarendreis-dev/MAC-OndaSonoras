// ----- CONFIGURAÇÃO -----
const canvas = document.getElementById("waveCanvas");
const ctx = canvas.getContext("2d");

// Elementos de UI
const aSlider = document.getElementById("aSlider");
const bSlider = document.getElementById("bSlider");
const cSlider = document.getElementById("cSlider");
const dSlider = document.getElementById("dSlider");
const aValue = document.getElementById("aValue");
const bValue = document.getElementById("bValue");
const cValue = document.getElementById("cValue");
const dValue = document.getElementById("dValue");
const feedbackMsg = document.getElementById("feedbackMsg");
const playNoteBtn = document.getElementById("playNoteBtn");
const noteBtns = document.querySelectorAll(".note-btn");

// Dimensões do canvas
const width = 1000;
const height = 400;
const centerY = height / 2;
const scaleX = (2 * Math.PI) / width; // para que o eixo x vá de 0 a 2pi em ~1000px

// ----- VARIÁVEIS DE ESTADO -----
// Coeficientes da onda resposta (verde) - controlados pelos sliders
let A = 1.0;
let B = 1.0;
let C = 0.0;
let D = 0.0;

// Coeficientes da onda alvo (vermelha) - alterados pela nota
// Valores padrão: C5 (frequência 523.25 Hz) mapeada para B = 1.0?
// Vamos usar uma escala musical simples: A4 -> B=1.0, C5 -> B=1.2, E5 -> B=1.5
// Mas também alteramos amplitude, fase e deslocamento para tornar o desafio interessante.
let targetA = 1.0;
let targetB = 1.2;
let targetC = 0.0;
let targetD = 0.0;

// Nota atual (para som)
let currentNote = "C5";
const noteFrequencies = {
  A4: 440.0,
  C5: 523.25,
  E5: 659.25,
};

// Contexto de áudio
let audioCtx = null;

// ----- FUNÇÕES DE DESENHO -----
function drawWaves() {
  ctx.clearRect(0, 0, width, height);

  // Desenhar linhas de grade suaves
  ctx.strokeStyle = "#1e2538";
  ctx.lineWidth = 1;
  for (let y = 0; y <= height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.strokeStyle = "#1e2538";
    ctx.stroke();
  }
  for (let x = 0; x <= width; x += 50) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.strokeStyle = "#1a1f30";
    ctx.stroke();
  }

  // Linha do eixo central
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.strokeStyle = "#2e3a5c";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Desenhar onda alvo (vermelha)
  ctx.beginPath();
  ctx.strokeStyle = "#ff4d6d";
  ctx.lineWidth = 4;
  ctx.shadowColor = "#ff4d6d";
  ctx.shadowBlur = 12;

  for (let x = 0; x < width; x++) {
    const t = x * scaleX; // t vai de 0 a ~2pi
    const y = targetA * Math.sin(targetB * t + targetC) + targetD;
    const canvasY = centerY - y * 70; // 70 px por unidade de amplitude
    if (x === 0) ctx.moveTo(x, canvasY);
    else ctx.lineTo(x, canvasY);
  }

  ctx.stroke();
  ctx.shadowBlur = 0;

  // Desenhar onda resposta (verde)
  ctx.beginPath();
  ctx.strokeStyle = "#3dffa0";
  ctx.lineWidth = 3.5;
  ctx.shadowColor = "#3dffa0";
  ctx.shadowBlur = 12;

  for (let x = 0; x < width; x++) {
    const t = x * scaleX;
    const y = A * Math.sin(B * t + C) + D;
    const canvasY = centerY - y * 70;
    if (x === 0) ctx.moveTo(x, canvasY);
    else ctx.lineTo(x, canvasY);
  }

  ctx.stroke();
  ctx.shadowBlur = 0;
}

// ----- ATUALIZAÇÃO DOS VALORES E FEEDBACK -----
function updateFromSliders() {
  A = parseFloat(aSlider.value);
  B = parseFloat(bSlider.value);
  C = parseFloat(cSlider.value);
  D = parseFloat(dSlider.value);

  aValue.textContent = A.toFixed(2);
  bValue.textContent = B.toFixed(2);
  cValue.textContent = C.toFixed(2);
  dValue.textContent = D.toFixed(2);

  drawWaves();
  updateFeedback();
}

function updateFeedback() {
  // Calcula erro médio absoluto entre as ondas (amostrado)
  let errorSum = 0;
  const samples = 150;
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * (2 * Math.PI); // 0..2pi
    const targetY = targetA * Math.sin(targetB * t + targetC) + targetD;
    const respY = A * Math.sin(B * t + C) + D;
    errorSum += Math.abs(targetY - respY);
  }
  const avgError = errorSum / samples;
  const matchPercent = Math.max(0, 100 - avgError * 100);

  if (avgError < 0.03) {
    feedbackMsg.innerHTML = `<span class="match">✅ Perfeito! Onda idêntica!</span>`;
    feedbackMsg.style.background = "#1a3a2a";
  } else if (avgError < 0.12) {
    feedbackMsg.innerHTML = `<span style="color: #b3ffb3;">👍 Quase lá! Ajuste fino</span>`;
    feedbackMsg.style.background = "#1e2f2a";
  } else if (avgError < 0.3) {
    feedbackMsg.innerHTML = `🔍 Erro médio: ${avgError.toFixed(3)} · continue ajustando`;
    feedbackMsg.style.background = "#1a1f2e";
  } else {
    feedbackMsg.innerHTML = `🎯 Erro grande: ${avgError.toFixed(3)} · tente aproximar`;
    feedbackMsg.style.background = "#2a1f2e";
  }
}

// ----- TOCAR SOM (WEB AUDIO) -----
function playTone(frequency, duration = 0.8) {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = "sine";
  osc.frequency.value = frequency;

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.25, now + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(now);
  osc.stop(now + duration);
}

// ----- ATUALIZAR ONDA ALVO BASEADA NA NOTA -----
function setTargetFromNote(note) {
  // Mapeamento criativo: cada nota define um conjunto diferente de coeficientes
  // para que o aluno precise ajustar A, B, C, D
  if (note === "A4") {
    targetA = 0.8;
    targetB = 1.0;
    targetC = 0.0;
    targetD = 0.0;
  } else if (note === "C5") {
    targetA = 1.2;
    targetB = 1.3;
    targetC = 0.8;
    targetD = 0.2;
  } else if (note === "E5") {
    targetA = 1.5;
    targetB = 1.8;
    targetC = -0.5;
    targetD = -0.3;
  }
  currentNote = note;
  // Atualiza classe dos botões
  noteBtns.forEach((btn) => {
    if (btn.dataset.note === note) btn.classList.add("active");
    else btn.classList.remove("active");
  });
  drawWaves();
  updateFeedback();
}

// ----- EVENT LISTENERS -----
aSlider.addEventListener("input", updateFromSliders);
bSlider.addEventListener("input", updateFromSliders);
cSlider.addEventListener("input", updateFromSliders);
dSlider.addEventListener("input", updateFromSliders);

// Botão tocar nota alvo
playNoteBtn.addEventListener("click", () => {
  const freq = noteFrequencies[currentNote] || 523.25;
  playTone(freq, 0.9);
  // Pequeno efeito visual: piscar a onda alvo (opcional)
});

// Botões de nota
noteBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const note = btn.dataset.note;
    setTargetFromNote(note);
    // Tocar som da nota
    const freq = noteFrequencies[note] || 523.25;
    playTone(freq, 0.7);
  });
});

// Inicialização
function init() {
  // Define alvo inicial como C5
  setTargetFromNote("C5");

  // Sincroniza sliders com os valores iniciais (A=1, B=1, C=0, D=0)
  // Mas para o desafio, podemos deixar o aluno começar de valores neutros.
  // Já estão definidos nos sliders: A=1, B=1, C=0, D=0
  A = 1.0;
  B = 1.0;
  C = 0.0;
  D = 0.0;
  aSlider.value = 1.0;
  bSlider.value = 1.0;
  cSlider.value = 0.0;
  dSlider.value = 0.0;

  updateFromSliders(); // atualiza os labels e desenha
  drawWaves();
}

init();

// Redesenhar se a janela mudar (apenas para manter proporção)
window.addEventListener("resize", () => {
  // O canvas tem tamanho fixo interno, mas redimensionamos o estilo via CSS.
  // Não é necessário redesenhar, pois as dimensões internas continuam 1000x400.
  drawWaves();
});

// Expor uma função para testes (opcional)
window.updateFromSliders = updateFromSliders;
