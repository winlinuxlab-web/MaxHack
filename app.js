const state = {
  questions: [],
  currentIndex: 0,
  selectedKey: null,
  answered: false,
  correctCount: 0,
  responses: [],
  shuffleQuestions: true,
  shuffleAnswers: true
};

const $ = (id) => document.getElementById(id);

const screens = {
  start: $("startScreen"),
  quiz: $("quizScreen"),
  result: $("resultScreen"),
  error: $("errorScreen")
};

function showScreen(name) {
  Object.values(screens).forEach(el => el.classList.add("hidden"));
  screens[name].classList.remove("hidden");
}

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function loadQuestions() {
  try {
    const response = await fetch("preguntas.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error("Banco vacío");
    state.questions = data;
    $("topbarMeta").textContent = `${data.length} preguntas disponibles`;
  } catch (error) {
    console.error(error);
    showScreen("error");
  }
}

function normalizeQuestion(q) {
  const options = [
    { key: "A", text: q.opcion_a },
    { key: "B", text: q.opcion_b },
    { key: "C", text: q.opcion_c },
    { key: "D", text: q.opcion_d }
  ];
  return {
    ...q,
    options: state.shuffleAnswers ? shuffle(options) : options
  };
}

function startQuiz() {
  state.shuffleQuestions = $("shuffleQuestions").checked;
  state.shuffleAnswers = $("shuffleAnswers").checked;
  state.currentIndex = 0;
  state.selectedKey = null;
  state.answered = false;
  state.correctCount = 0;
  state.responses = [];

  let bank = [...state.questions];
  if (state.shuffleQuestions) bank = shuffle(bank);
  state.activeQuestions = bank.map(normalizeQuestion);
  showScreen("quiz");
  renderQuestion();
}

function renderQuestion() {
  const q = state.activeQuestions[state.currentIndex];
  state.selectedKey = null;
  state.answered = false;

  $("questionCounter").textContent = `Pregunta ${state.currentIndex + 1} de ${state.activeQuestions.length}`;
  $("scoreLive").textContent = `${state.correctCount} correctas`;
  $("progressBar").style.width = `${(state.currentIndex / state.activeQuestions.length) * 100}%`;
  $("chapterBadge").textContent = `Capítulo ${q.capitulo}`;
  $("difficultyBadge").textContent = q.dificultad;
  $("questionText").textContent = q.pregunta;
  $("feedbackBox").className = "feedback hidden";
  $("feedbackBox").innerHTML = "";
  $("submitBtn").disabled = true;
  $("submitBtn").classList.remove("hidden");
  $("nextBtn").classList.add("hidden");

  const container = $("answersContainer");
  container.innerHTML = "";
  q.options.forEach(option => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "answer-option";
    button.dataset.key = option.key;
    button.innerHTML = `<span class="answer-key">${option.key}</span><span>${escapeHtml(option.text)}</span>`;
    button.addEventListener("click", () => selectAnswer(option.key));
    container.appendChild(button);
  });
}

function selectAnswer(key) {
  if (state.answered) return;
  state.selectedKey = key;
  document.querySelectorAll(".answer-option").forEach(btn => {
    btn.classList.toggle("selected", btn.dataset.key === key);
  });
  $("submitBtn").disabled = false;
}

function submitAnswer() {
  if (!state.selectedKey || state.answered) return;
  state.answered = true;
  const q = state.activeQuestions[state.currentIndex];
  const isCorrect = state.selectedKey === q.respuesta_correcta;
  if (isCorrect) state.correctCount += 1;

  state.responses.push({
    id: q.id_pregunta,
    chapter: q.capitulo,
    question: q.pregunta,
    selected: state.selectedKey,
    correct: q.respuesta_correcta,
    isCorrect,
    explanation: q.explicacion
  });

  document.querySelectorAll(".answer-option").forEach(btn => {
    btn.disabled = true;
    const key = btn.dataset.key;
    if (key === q.respuesta_correcta) btn.classList.add("correct");
    if (key === state.selectedKey && !isCorrect) btn.classList.add("incorrect");
  });

  const feedback = $("feedbackBox");
  feedback.classList.remove("hidden");
  feedback.classList.add(isCorrect ? "success" : "error");
  feedback.innerHTML = `<strong>${isCorrect ? "Respuesta correcta" : "Respuesta incorrecta"}</strong>${escapeHtml(q.explicacion)}`;

  $("scoreLive").textContent = `${state.correctCount} correctas`;
  $("submitBtn").classList.add("hidden");
  $("nextBtn").classList.remove("hidden");
  $("nextBtn").textContent = state.currentIndex === state.activeQuestions.length - 1 ? "Ver resultados" : "Siguiente";
}

function nextQuestion() {
  if (state.currentIndex < state.activeQuestions.length - 1) {
    state.currentIndex += 1;
    renderQuestion();
  } else {
    showResults();
  }
}

function showResults() {
  const total = state.activeQuestions.length;
  const percent = Math.round((state.correctCount / total) * 100);
  $("progressBar").style.width = "100%";
  $("scorePercent").textContent = `${percent}%`;
  $("scoreCircle").style.setProperty("--score", `${percent}%`);
  $("scoreText").textContent = `${state.correctCount} de ${total} respuestas correctas`;
  $("resultMessage").textContent = messageForScore(percent);

  const byChapter = {};
  state.responses.forEach(r => {
    byChapter[r.chapter] ??= { total: 0, correct: 0 };
    byChapter[r.chapter].total += 1;
    if (r.isCorrect) byChapter[r.chapter].correct += 1;
  });

  const chapterResults = $("chapterResults");
  chapterResults.innerHTML = "";
  Object.keys(byChapter).sort((a,b) => Number(a)-Number(b)).forEach(chapter => {
    const item = byChapter[chapter];
    const p = Math.round((item.correct / item.total) * 100);
    chapterResults.insertAdjacentHTML("beforeend", `
      <div class="chapter-row">
        <div><strong>Capítulo ${chapter}</strong><small>${item.correct} de ${item.total} correctas</small></div>
        <strong>${p}%</strong>
      </div>`);
  });

  const review = $("reviewContainer");
  review.innerHTML = "";
  state.responses.forEach((r, idx) => {
    review.insertAdjacentHTML("beforeend", `
      <div class="review-item ${r.isCorrect ? "ok" : "bad"}">
        <strong>${idx + 1}. ${escapeHtml(r.question)}</strong>
        <p>Tu respuesta: <strong>${r.selected}</strong> · Correcta: <strong>${r.correct}</strong></p>
        <p class="explain">${escapeHtml(r.explanation)}</p>
      </div>`);
  });

  showScreen("result");
}

function messageForScore(percent) {
  if (percent >= 90) return "Muy buen dominio del contenido. Revisa solo los errores puntuales.";
  if (percent >= 75) return "Buen resultado. Conviene reforzar los capítulos con menor porcentaje.";
  if (percent >= 60) return "Vas avanzando. Revisa las explicaciones y vuelve a intentarlo.";
  return "Este intento sirve como diagnóstico. Repasa los conceptos y prueba nuevamente.";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

$("startBtn").addEventListener("click", startQuiz);
$("submitBtn").addEventListener("click", submitAnswer);
$("nextBtn").addEventListener("click", nextQuestion);
$("restartBtn").addEventListener("click", () => {
  showScreen("start");
  window.scrollTo({ top: 0, behavior: "smooth" });
});

loadQuestions();
