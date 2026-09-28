"use strict";

const SESSION_SIZE = 20;
const MIN_PER_CHAPTER = 2;
const MAX_PER_CHAPTER = 10;
const STORAGE_KEY = "maxhack_v14_progress";
const ALLOWED_CHAPTERS = new Set([1, 2, 3, 4]);
const ALLOWED_KEYS = new Set(["A", "B", "C", "D"]);
const MAX_TEXT = 1200;
const MAX_EXPLANATION = 2400;

const state = {
  questions: [], activeQuestions: [], currentIndex: 0, selectedKey: null,
  answered: false, correctCount: 0, responses: [], sessionDistribution: {}
};

const $ = id => document.getElementById(id);
const screens = {
  start: $("startScreen"), quiz: $("quizScreen"), result: $("resultScreen"), error: $("errorScreen")
};

// Bloqueo defensivo si la página intenta abrirse dentro de un frame.
if (window.top !== window.self) {
  document.documentElement.classList.add("framed-blocked");
  try { window.top.location = window.self.location.href; } catch (_) { /* navegación bloqueada por el navegador */ }
}

function showScreen(name) {
  Object.values(screens).forEach(el => el.classList.add("hidden"));
  if (screens[name]) screens[name].classList.remove("hidden");
}

function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function safeString(value, maxLength = MAX_TEXT) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > maxLength) return null;
  return text;
}

function asNonNegativeInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

function defaultProgress() {
  return { questionStats: {}, lastChapterPerformance: null, sessions: 0, lastSessionIds: [] };
}

function sanitizeProgress(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaultProgress();
  const clean = defaultProgress();
  clean.sessions = Math.min(asNonNegativeInt(raw.sessions), 100000);

  if (raw.questionStats && typeof raw.questionStats === "object" && !Array.isArray(raw.questionStats)) {
    for (const [id, value] of Object.entries(raw.questionStats).slice(0, 5000)) {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || !value || typeof value !== "object") continue;
      clean.questionStats[id] = {
        seen: Math.min(asNonNegativeInt(value.seen), 100000),
        correct: Math.min(asNonNegativeInt(value.correct), 100000),
        wrong: Math.min(asNonNegativeInt(value.wrong), 100000),
        lastWrong: value.lastWrong === true
      };
    }
  }

  if (raw.lastChapterPerformance && typeof raw.lastChapterPerformance === "object") {
    const perf = {};
    for (const ch of [1, 2, 3, 4]) {
      const value = raw.lastChapterPerformance[ch];
      if (!value || typeof value !== "object") continue;
      const total = Math.min(asNonNegativeInt(value.total), SESSION_SIZE);
      const correct = Math.min(asNonNegativeInt(value.correct), total);
      const percent = total ? Math.round((correct / total) * 100) : 0;
      perf[ch] = { total, correct, percent };
    }
    clean.lastChapterPerformance = Object.keys(perf).length ? perf : null;
  }

  if (Array.isArray(raw.lastSessionIds)) {
    clean.lastSessionIds = raw.lastSessionIds
      .filter(id => typeof id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(id))
      .slice(0, SESSION_SIZE);
  }
  return clean;
}

function progress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw || raw.length > 500000) return defaultProgress();
    return sanitizeProgress(JSON.parse(raw));
  } catch (_) {
    return defaultProgress();
  }
}

function saveProgress(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeProgress(data)));
  } catch (_) {
    // La aplicación continúa funcionando aunque el navegador bloquee almacenamiento local.
  }
}

function validateQuestion(raw, seenIds) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const id = safeString(raw.id_pregunta, 80);
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id) || seenIds.has(id)) return null;

  const chapter = Number(raw.capitulo);
  if (!ALLOWED_CHAPTERS.has(chapter)) return null;

  const question = safeString(raw.pregunta);
  const optionA = safeString(raw.opcion_a);
  const optionB = safeString(raw.opcion_b);
  const optionC = safeString(raw.opcion_c);
  const optionD = safeString(raw.opcion_d);
  const correct = safeString(raw.respuesta_correcta, 1);
  const explanation = safeString(raw.explicacion, MAX_EXPLANATION);
  const difficulty = safeString(raw.dificultad, 60) || "";
  const status = safeString(raw.estado, 30) || "Activa";

  if (!question || !optionA || !optionB || !optionC || !optionD || !explanation) return null;
  if (!ALLOWED_KEYS.has(correct)) return null;
  if (new Set([optionA, optionB, optionC, optionD]).size !== 4) return null;

  seenIds.add(id);
  return Object.freeze({
    id_pregunta: id,
    capitulo: chapter,
    pregunta: question,
    opcion_a: optionA,
    opcion_b: optionB,
    opcion_c: optionC,
    opcion_d: optionD,
    respuesta_correcta: correct,
    explicacion: explanation,
    dificultad: difficulty,
    estado: status
  });
}

function validateQuestionBank(data) {
  if (!Array.isArray(data) || data.length < SESSION_SIZE || data.length > 5000) {
    throw new Error("Banco inválido");
  }
  const seenIds = new Set();
  const clean = [];
  for (const raw of data) {
    const q = validateQuestion(raw, seenIds);
    if (q && q.estado !== "Inactiva") clean.push(q);
  }
  if (clean.length < SESSION_SIZE) throw new Error("Banco insuficiente");
  for (const ch of ALLOWED_CHAPTERS) {
    if (clean.filter(q => q.capitulo === ch).length < MIN_PER_CHAPTER) {
      throw new Error("Cobertura de capítulos insuficiente");
    }
  }
  return Object.freeze(clean);
}

async function loadQuestions() {
  try {
    const response = await fetch(new URL("preguntas.json", window.location.href), {
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      referrerPolicy: "no-referrer"
    });
    if (!response.ok) throw new Error("No disponible");
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json") && !contentType.includes("text/json")) {
      throw new Error("Formato inválido");
    }
    state.questions = validateQuestionBank(await response.json());
    $("topbarMeta").textContent = "Aporte NMZ-2026";
    $("availableQuestions").textContent = String(state.questions.length);
    renderStartProgress();
  } catch (err) {
    console.error("MaxHack: no fue posible cargar el banco de preguntas.");
    showScreen("error");
  }
}

function clearElement(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function appendTextElement(parent, tag, text, className = "") {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = text;
  parent.appendChild(el);
  return el;
}

function renderStartProgress() {
  const p = progress();
  const box = $("previousPerformance");
  clearElement(box);
  if (!p.lastChapterPerformance) {
    box.classList.add("hidden");
    return;
  }

  box.classList.remove("hidden");
  appendTextElement(box, "strong", "Tu sesión anterior");
  const perf = document.createElement("div");
  perf.className = "mini-performance";

  Object.entries(p.lastChapterPerformance)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .forEach(([ch, v]) => {
      const row = document.createElement("div");
      appendTextElement(row, "span", `Capítulo ${ch}`);
      appendTextElement(row, "strong", `${v.percent}%`);
      perf.appendChild(row);
    });

  box.appendChild(perf);
  $("adaptiveNoticeText").textContent = "MaxHack usará tu desempeño anterior para reforzar los capítulos con más errores, manteniendo presencia de todos los contenidos.";
}

function computeDistribution(lastPerf) {
  const chapters = [1, 2, 3, 4];
  if (!lastPerf) return { 1: 5, 2: 5, 3: 5, 4: 5 };

  const allocation = { 1: MIN_PER_CHAPTER, 2: MIN_PER_CHAPTER, 3: MIN_PER_CHAPTER, 4: MIN_PER_CHAPTER };
  let remaining = SESSION_SIZE - MIN_PER_CHAPTER * chapters.length;
  const weights = {};

  chapters.forEach(ch => {
    const pct = (lastPerf[ch]?.percent ?? 50) / 100;
    const weakness = 1 - pct;
    weights[ch] = 0.15 + weakness * weakness;
  });

  while (remaining > 0) {
    const eligible = chapters.filter(ch => allocation[ch] < MAX_PER_CHAPTER);
    if (!eligible.length) break;
    const totalW = eligible.reduce((s, ch) => s + weights[ch], 0);
    let best = eligible[0];
    let bestNeed = -Infinity;

    eligible.forEach(ch => {
      const ideal = (weights[ch] / totalW) * remaining;
      const noise = Math.random() * 0.12;
      const score = ideal + weights[ch] + noise - (allocation[ch] - MIN_PER_CHAPTER) * 0.18;
      if (score > bestNeed) {
        bestNeed = score;
        best = ch;
      }
    });

    allocation[best]++;
    remaining--;
  }
  return allocation;
}

function questionPriority(q, p, lastIds) {
  const s = p.questionStats[q.id_pregunta] || { seen: 0, correct: 0, wrong: 0, lastWrong: false };
  let score = Math.random() * 18;
  if (lastIds.has(q.id_pregunta)) score -= 12;
  if (!s.seen) score += 75;
  if (s.wrong > 0) score += 35 + Math.min(35, s.wrong * 8);
  if (s.seen > 0) {
    const accuracy = s.correct / s.seen;
    score += (1 - accuracy) * 35;
    if (accuracy === 1) score -= 10;
  }
  if (s.lastWrong) score += 55;
  return score;
}

function chooseQuestions() {
  const p = progress();
  const dist = computeDistribution(p.lastChapterPerformance);
  const lastIds = new Set(p.lastSessionIds || []);
  const chosen = [];

  [1, 2, 3, 4].forEach(ch => {
    const pool = state.questions.filter(q => q.capitulo === ch);
    const ranked = pool
      .map(q => ({ q, score: questionPriority(q, p, lastIds) }))
      .sort((a, b) => b.score - a.score);
    chosen.push(...ranked.slice(0, Math.min(dist[ch], ranked.length)).map(x => x.q));
  });

  if (chosen.length < SESSION_SIZE) {
    const used = new Set(chosen.map(q => q.id_pregunta));
    const extra = state.questions
      .filter(q => !used.has(q.id_pregunta))
      .map(q => ({ q, score: questionPriority(q, p, lastIds) }))
      .sort((a, b) => b.score - a.score);
    chosen.push(...extra.slice(0, SESSION_SIZE - chosen.length).map(x => x.q));
  }

  state.sessionDistribution = chosen.reduce((acc, q) => {
    acc[q.capitulo] = (acc[q.capitulo] || 0) + 1;
    return acc;
  }, {});

  return shuffle(chosen).map(normalizeQuestion);
}

function normalizeQuestion(q) {
  const options = shuffle([
    { key: "A", text: q.opcion_a },
    { key: "B", text: q.opcion_b },
    { key: "C", text: q.opcion_c },
    { key: "D", text: q.opcion_d }
  ]);
  return Object.freeze({ ...q, options: Object.freeze(options) });
}

function startQuiz() {
  state.currentIndex = 0;
  state.selectedKey = null;
  state.answered = false;
  state.correctCount = 0;
  state.responses = [];
  state.activeQuestions = chooseQuestions();
  showScreen("quiz");
  renderQuestion();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderQuestion() {
  const q = state.activeQuestions[state.currentIndex];
  if (!q) return showScreen("error");

  state.selectedKey = null;
  state.answered = false;
  $("questionCounter").textContent = `Pregunta ${state.currentIndex + 1} de ${state.activeQuestions.length}`;
  $("scoreLive").textContent = `${state.correctCount} correctas`;
  $("progressBar").style.width = `${(state.currentIndex / state.activeQuestions.length) * 100}%`;
  $("chapterBadge").textContent = `Capítulo ${q.capitulo}`;
  $("difficultyBadge").textContent = q.dificultad;
  $("questionText").textContent = q.pregunta;

  const feedback = $("feedbackBox");
  feedback.className = "feedback hidden";
  clearElement(feedback);

  $("submitBtn").disabled = true;
  $("submitBtn").classList.remove("hidden");
  $("nextBtn").classList.add("hidden");

  const container = $("answersContainer");
  clearElement(container);
  q.options.forEach(option => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "answer-option";
    button.dataset.key = option.key;
    appendTextElement(button, "span", option.text, "answer-text");
    button.addEventListener("click", () => selectAnswer(option.key), { passive: true });
    container.appendChild(button);
  });
}

function selectAnswer(key) {
  if (state.answered || !ALLOWED_KEYS.has(key)) return;
  state.selectedKey = key;
  document.querySelectorAll(".answer-option").forEach(button => {
    button.classList.toggle("selected", button.dataset.key === key);
  });
  $("submitBtn").disabled = false;
}

function optionText(q, key) {
  return q.options.find(o => o.key === key)?.text || "";
}

function submitAnswer() {
  if (!state.selectedKey || state.answered) return;
  state.answered = true;

  const q = state.activeQuestions[state.currentIndex];
  const isCorrect = state.selectedKey === q.respuesta_correcta;
  if (isCorrect) state.correctCount++;

  state.responses.push(Object.freeze({
    id: q.id_pregunta,
    chapter: q.capitulo,
    question: q.pregunta,
    selectedText: optionText(q, state.selectedKey),
    correctText: optionText(q, q.respuesta_correcta),
    isCorrect,
    explanation: q.explicacion
  }));

  document.querySelectorAll(".answer-option").forEach(button => {
    button.disabled = true;
    if (button.dataset.key === q.respuesta_correcta) button.classList.add("correct");
    if (button.dataset.key === state.selectedKey && !isCorrect) button.classList.add("incorrect");
  });

  const fb = $("feedbackBox");
  fb.classList.remove("hidden");
  fb.classList.add(isCorrect ? "success" : "error");
  clearElement(fb);
  appendTextElement(fb, "strong", isCorrect ? "Respuesta correcta" : "Respuesta incorrecta");
  appendTextElement(fb, "p", q.explicacion);

  $("scoreLive").textContent = `${state.correctCount} correctas`;
  $("submitBtn").classList.add("hidden");
  $("nextBtn").classList.remove("hidden");
  $("nextBtn").textContent = state.currentIndex === state.activeQuestions.length - 1 ? "Ver resumen" : "Siguiente";
}

function nextQuestion() {
  if (state.currentIndex < state.activeQuestions.length - 1) {
    state.currentIndex++;
    renderQuestion();
  } else {
    showResults();
  }
}

function updateAdaptiveProgress(byChapter) {
  const p = progress();
  p.sessions = (p.sessions || 0) + 1;
  p.questionStats = p.questionStats || {};

  state.responses.forEach(r => {
    const s = p.questionStats[r.id] || { seen: 0, correct: 0, wrong: 0, lastWrong: false };
    s.seen++;
    if (r.isCorrect) s.correct++; else s.wrong++;
    s.lastWrong = !r.isCorrect;
    p.questionStats[r.id] = s;
  });

  p.lastChapterPerformance = {};
  Object.entries(byChapter).forEach(([ch, v]) => {
    p.lastChapterPerformance[ch] = {
      total: v.total,
      correct: v.correct,
      percent: Math.round((v.correct / v.total) * 100)
    };
  });
  p.lastSessionIds = state.responses.map(r => r.id);
  saveProgress(p);
  return p;
}

function weakestChapters(performance) {
  const entries = Object.entries(performance || {});
  if (!entries.length) return [];
  const min = Math.min(...entries.map(([, v]) => v.percent));
  return entries.filter(([, v]) => v.percent === min).map(([ch]) => ch);
}

function showResults() {
  const total = state.activeQuestions.length;
  const percent = Math.round((state.correctCount / total) * 100);
  $("scorePercent").textContent = `${percent}%`;
  $("scoreCircle").style.setProperty("--score", `${percent}%`);
  $("scoreText").textContent = `${state.correctCount} de ${total} respuestas correctas`;
  $("resultMessage").textContent = messageForScore(percent);

  const byChapter = {};
  state.responses.forEach(r => {
    byChapter[r.chapter] ??= { total: 0, correct: 0 };
    byChapter[r.chapter].total++;
    if (r.isCorrect) byChapter[r.chapter].correct++;
  });

  updateAdaptiveProgress(byChapter);

  const chapterResults = $("chapterResults");
  clearElement(chapterResults);
  [1, 2, 3, 4].forEach(ch => {
    const v = byChapter[ch] || { total: 0, correct: 0 };
    const pct = v.total ? Math.round((v.correct / v.total) * 100) : 0;

    const row = document.createElement("div");
    row.className = "chapter-row";
    const left = document.createElement("div");
    appendTextElement(left, "strong", `Capítulo ${ch}`);
    appendTextElement(left, "small", `${v.correct} de ${v.total} correctas`);
    const track = document.createElement("div");
    track.className = "mini-track";
    const bar = document.createElement("span");
    bar.style.width = `${pct}%`;
    track.appendChild(bar);
    left.appendChild(track);
    row.appendChild(left);
    appendTextElement(row, "strong", `${pct}%`);
    chapterResults.appendChild(row);
  });

  const p = progress();
  const nextDist = computeDistribution(p.lastChapterPerformance);
  const weakest = weakestChapters(p.lastChapterPerformance);
  if (weakest.length && (p.lastChapterPerformance[weakest[0]]?.percent ?? 100) < 90) {
    const label = weakest.length === 1
      ? `el Capítulo ${weakest[0]}`
      : `los capítulos ${weakest.slice(0, -1).join(", ")} y ${weakest.at(-1)}`;
    $("nextSessionMessage").textContent = `Se reforzará especialmente ${label}, manteniendo práctica de los demás capítulos.`;
  } else {
    $("nextSessionMessage").textContent = "Tu desempeño es equilibrado; la próxima sesión mantendrá una distribución amplia y variada.";
  }

  const distribution = $("nextDistribution");
  clearElement(distribution);
  [1, 2, 3, 4].forEach(ch => {
    const box = document.createElement("div");
    appendTextElement(box, "span", `Cap. ${ch}`);
    appendTextElement(box, "strong", String(nextDist[ch]));
    appendTextElement(box, "small", "preguntas");
    distribution.appendChild(box);
  });

  const review = $("reviewContainer");
  clearElement(review);
  state.responses.forEach((r, i) => {
    const item = document.createElement("div");
    item.className = `review-item ${r.isCorrect ? "ok" : "bad"}`;
    appendTextElement(item, "strong", `${i + 1}. ${r.question}`);

    const selected = document.createElement("p");
    selected.appendChild(document.createTextNode("Tu respuesta: "));
    appendTextElement(selected, "strong", r.selectedText);
    item.appendChild(selected);

    if (!r.isCorrect) {
      const correct = document.createElement("p");
      correct.appendChild(document.createTextNode("Respuesta correcta: "));
      appendTextElement(correct, "strong", r.correctText);
      item.appendChild(correct);
    }

    appendTextElement(item, "p", r.explanation, "explain");
    review.appendChild(item);
  });

  renderStartProgress();
  showScreen("result");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function messageForScore(p) {
  if (p === 100) return "Excelente. Respondiste correctamente todas las preguntas de esta sesión.";
  if (p >= 90) return "Muy buen dominio. MaxHack mantendrá estos contenidos activos y dará más espacio a los capítulos con errores.";
  if (p >= 75) return "Buen avance. La próxima sesión aumentará gradualmente el refuerzo en tus áreas más débiles.";
  if (p >= 60) return "Vas avanzando. Revisa las explicaciones: la próxima sesión reforzará los contenidos con más errores.";
  return "Este resultado sirve como diagnóstico. MaxHack aumentará el refuerzo en los capítulos que necesitan más práctica.";
}

$("startBtn").addEventListener("click", startQuiz);
$("submitBtn").addEventListener("click", submitAnswer);
$("nextBtn").addEventListener("click", nextQuestion);
$("restartBtn").addEventListener("click", () => {
  showScreen("start");
  renderStartProgress();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
$("resetBtn").addEventListener("click", () => {
  if (window.confirm("¿Reiniciar el progreso adaptativo de MaxHack en este navegador?")) {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* almacenamiento no disponible */ }
    renderStartProgress();
    $("adaptiveNoticeText").textContent = "En la primera sesión recibirás una selección equilibrada. En las siguientes, MaxHack reforzará tus capítulos más débiles sin dejar de practicar los demás.";
  }
});

loadQuestions();
