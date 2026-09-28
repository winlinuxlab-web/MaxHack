const SESSION_SIZE = 20;
const MIN_PER_CHAPTER = 2;
const MAX_PER_CHAPTER = 10;
const STORAGE_KEY = "maxhack_v13_progress";

const state = {
  questions: [], activeQuestions: [], currentIndex: 0, selectedKey: null,
  answered: false, correctCount: 0, responses: [], sessionDistribution: {}
};
const $ = id => document.getElementById(id);
const screens = { start: $("startScreen"), quiz: $("quizScreen"), result: $("resultScreen"), error: $("errorScreen") };

function showScreen(name){ Object.values(screens).forEach(el=>el.classList.add("hidden")); screens[name].classList.remove("hidden"); }
function shuffle(array){ const a=[...array]; for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }
function progress(){
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {questionStats:{}, lastChapterPerformance:null, sessions:0}; }
  catch { return {questionStats:{}, lastChapterPerformance:null, sessions:0}; }
}
function saveProgress(data){ localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }

async function loadQuestions(){
  try{
    const response=await fetch("preguntas.json",{cache:"no-store"});
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    const data=await response.json();
    if(!Array.isArray(data)||!data.length) throw new Error("Banco vacío");
    state.questions=data.filter(q=>q.estado!=="Inactiva");
    $("topbarMeta").textContent="Aporte NMZ-2026";
    $("availableQuestions").textContent=state.questions.length;
    renderStartProgress();
  }catch(err){ console.error(err); showScreen("error"); }
}

function renderStartProgress(){
  const p=progress();
  const box=$("previousPerformance");
  if(!p.lastChapterPerformance){ box.classList.add("hidden"); return; }
  box.classList.remove("hidden");
  const rows=Object.entries(p.lastChapterPerformance).sort((a,b)=>Number(a[0])-Number(b[0])).map(([ch,v])=>
    `<div><span>Capítulo ${ch}</span><strong>${v.percent}%</strong></div>`).join("");
  box.innerHTML=`<strong>Tu sesión anterior</strong><div class="mini-performance">${rows}</div>`;
  $("adaptiveNoticeText").textContent="MaxHack usará tu desempeño anterior para reforzar los capítulos con más errores, manteniendo presencia de todos los contenidos.";
}

function computeDistribution(lastPerf){
  const chapters=[1,2,3,4];
  if(!lastPerf) return {1:5,2:5,3:5,4:5};
  const allocation={1:MIN_PER_CHAPTER,2:MIN_PER_CHAPTER,3:MIN_PER_CHAPTER,4:MIN_PER_CHAPTER};
  let remaining=SESSION_SIZE - MIN_PER_CHAPTER*chapters.length;
  const weights={};
  chapters.forEach(ch=>{
    const pct=(lastPerf[ch]?.percent ?? 50)/100;
    const weakness=1-pct;
    weights[ch]=0.15 + weakness*weakness;
  });
  while(remaining>0){
    const eligible=chapters.filter(ch=>allocation[ch]<MAX_PER_CHAPTER);
    if(!eligible.length) break;
    const totalW=eligible.reduce((s,ch)=>s+weights[ch],0);
    let best=eligible[0], bestNeed=-Infinity;
    eligible.forEach(ch=>{
      const ideal=(weights[ch]/totalW)*remaining;
      const noise=Math.random()*0.12;
      const score=ideal + weights[ch] + noise - (allocation[ch]-MIN_PER_CHAPTER)*0.18;
      if(score>bestNeed){ bestNeed=score; best=ch; }
    });
    allocation[best]++; remaining--;
  }
  return allocation;
}

function questionPriority(q,p,lastIds){
  const s=p.questionStats[q.id_pregunta] || {seen:0,correct:0,wrong:0};
  let score=Math.random()*18;
  if(lastIds.has(q.id_pregunta)) score-=12;
  if(!s.seen) score+=75;
  if(s.wrong>0) score+=35 + Math.min(35,s.wrong*8);
  if(s.seen>0){
    const accuracy=s.correct/s.seen;
    score+=(1-accuracy)*35;
    if(accuracy===1) score-=10;
  }
  if(s.lastWrong) score+=55;
  return score;
}

function chooseQuestions(){
  const p=progress();
  const dist=computeDistribution(p.lastChapterPerformance);
  const lastIds=new Set(p.lastSessionIds||[]);
  const chosen=[];
  [1,2,3,4].forEach(ch=>{
    const pool=state.questions.filter(q=>Number(q.capitulo)===ch);
    const ranked=pool.map(q=>({q,score:questionPriority(q,p,lastIds)})).sort((a,b)=>b.score-a.score);
    chosen.push(...ranked.slice(0,Math.min(dist[ch],ranked.length)).map(x=>x.q));
  });
  // Relleno de seguridad si algún capítulo tuviera menos preguntas de las requeridas.
  if(chosen.length<SESSION_SIZE){
    const used=new Set(chosen.map(q=>q.id_pregunta));
    const extra=state.questions.filter(q=>!used.has(q.id_pregunta)).map(q=>({q,score:questionPriority(q,p,lastIds)})).sort((a,b)=>b.score-a.score);
    chosen.push(...extra.slice(0,SESSION_SIZE-chosen.length).map(x=>x.q));
  }
  state.sessionDistribution=chosen.reduce((acc,q)=>{ acc[q.capitulo]=(acc[q.capitulo]||0)+1; return acc; },{});
  return shuffle(chosen).map(normalizeQuestion);
}

function normalizeQuestion(q){
  const options=shuffle([
    {key:"A",text:q.opcion_a},{key:"B",text:q.opcion_b},{key:"C",text:q.opcion_c},{key:"D",text:q.opcion_d}
  ]);
  return {...q,options};
}

function startQuiz(){
  state.currentIndex=0; state.selectedKey=null; state.answered=false; state.correctCount=0; state.responses=[];
  state.activeQuestions=chooseQuestions();
  showScreen("quiz"); renderQuestion(); window.scrollTo({top:0,behavior:"smooth"});
}

function renderQuestion(){
  const q=state.activeQuestions[state.currentIndex];
  state.selectedKey=null; state.answered=false;
  $("questionCounter").textContent=`Pregunta ${state.currentIndex+1} de ${state.activeQuestions.length}`;
  $("scoreLive").textContent=`${state.correctCount} correctas`;
  $("progressBar").style.width=`${(state.currentIndex/state.activeQuestions.length)*100}%`;
  $("chapterBadge").textContent=`Capítulo ${q.capitulo}`;
  $("difficultyBadge").textContent=q.dificultad;
  $("questionText").textContent=q.pregunta;
  $("feedbackBox").className="feedback hidden"; $("feedbackBox").innerHTML="";
  $("submitBtn").disabled=true; $("submitBtn").classList.remove("hidden"); $("nextBtn").classList.add("hidden");
  const container=$("answersContainer"); container.innerHTML="";
  q.options.forEach(option=>{
    const b=document.createElement("button"); b.type="button"; b.className="answer-option"; b.dataset.key=option.key;
    b.innerHTML=`<span class="answer-text">${escapeHtml(option.text)}</span>`;
    b.addEventListener("click",()=>selectAnswer(option.key)); container.appendChild(b);
  });
}

function selectAnswer(key){
  if(state.answered) return; state.selectedKey=key;
  document.querySelectorAll(".answer-option").forEach(b=>b.classList.toggle("selected",b.dataset.key===key));
  $("submitBtn").disabled=false;
}
function optionText(q,key){ return q.options.find(o=>o.key===key)?.text || ""; }

function submitAnswer(){
  if(!state.selectedKey||state.answered) return; state.answered=true;
  const q=state.activeQuestions[state.currentIndex]; const isCorrect=state.selectedKey===q.respuesta_correcta;
  if(isCorrect) state.correctCount++;
  state.responses.push({id:q.id_pregunta,chapter:q.capitulo,question:q.pregunta,selectedText:optionText(q,state.selectedKey),correctText:optionText(q,q.respuesta_correcta),isCorrect,explanation:q.explicacion});
  document.querySelectorAll(".answer-option").forEach(b=>{
    b.disabled=true; if(b.dataset.key===q.respuesta_correcta)b.classList.add("correct");
    if(b.dataset.key===state.selectedKey&&!isCorrect)b.classList.add("incorrect");
  });
  const fb=$("feedbackBox"); fb.classList.remove("hidden"); fb.classList.add(isCorrect?"success":"error");
  fb.innerHTML=`<strong>${isCorrect?"Respuesta correcta":"Respuesta incorrecta"}</strong><p>${escapeHtml(q.explicacion)}</p>`;
  $("scoreLive").textContent=`${state.correctCount} correctas`; $("submitBtn").classList.add("hidden"); $("nextBtn").classList.remove("hidden");
  $("nextBtn").textContent=state.currentIndex===state.activeQuestions.length-1?"Ver resumen":"Siguiente";
}
function nextQuestion(){ if(state.currentIndex<state.activeQuestions.length-1){state.currentIndex++;renderQuestion();}else showResults(); }

function updateAdaptiveProgress(byChapter){
  const p=progress(); p.sessions=(p.sessions||0)+1; p.questionStats=p.questionStats||{};
  state.responses.forEach(r=>{
    const s=p.questionStats[r.id]||{seen:0,correct:0,wrong:0,lastWrong:false};
    s.seen++; if(r.isCorrect)s.correct++; else s.wrong++; s.lastWrong=!r.isCorrect; p.questionStats[r.id]=s;
  });
  p.lastChapterPerformance={};
  Object.entries(byChapter).forEach(([ch,v])=>{ p.lastChapterPerformance[ch]={total:v.total,correct:v.correct,percent:Math.round(v.correct/v.total*100)}; });
  p.lastSessionIds=state.responses.map(r=>r.id); saveProgress(p); return p;
}

function showResults(){
  const total=state.activeQuestions.length, percent=Math.round(state.correctCount/total*100);
  $("scorePercent").textContent=`${percent}%`; $("scoreCircle").style.setProperty("--score",`${percent}%`);
  $("scoreText").textContent=`${state.correctCount} de ${total} respuestas correctas`; $("resultMessage").textContent=messageForScore(percent);
  const byChapter={}; state.responses.forEach(r=>{byChapter[r.chapter]??={total:0,correct:0};byChapter[r.chapter].total++;if(r.isCorrect)byChapter[r.chapter].correct++;});
  updateAdaptiveProgress(byChapter);
  const chapterResults=$("chapterResults"); chapterResults.innerHTML="";
  [1,2,3,4].forEach(ch=>{
    const v=byChapter[ch]||{total:0,correct:0}; const pct=v.total?Math.round(v.correct/v.total*100):0;
    chapterResults.insertAdjacentHTML("beforeend",`<div class="chapter-row"><div><strong>Capítulo ${ch}</strong><small>${v.correct} de ${v.total} correctas</small><div class="mini-track"><span style="width:${pct}%"></span></div></div><strong>${pct}%</strong></div>`);
  });
  const nextDist=computeDistribution(progress().lastChapterPerformance);
  const weakest=Object.entries(progress().lastChapterPerformance).sort((a,b)=>a[1].percent-b[1].percent)[0];
  $("nextSessionMessage").textContent=weakest && weakest[1].percent<90 ? `Se reforzará especialmente el Capítulo ${weakest[0]}, manteniendo práctica de los demás capítulos.` : "Tu desempeño es equilibrado; la próxima sesión mantendrá una distribución amplia y variada.";
  $("nextDistribution").innerHTML=[1,2,3,4].map(ch=>`<div><span>Cap. ${ch}</span><strong>${nextDist[ch]}</strong><small>preguntas</small></div>`).join("");

  const review=$("reviewContainer"); review.innerHTML="";
  state.responses.forEach((r,i)=>review.insertAdjacentHTML("beforeend",`<div class="review-item ${r.isCorrect?"ok":"bad"}"><strong>${i+1}. ${escapeHtml(r.question)}</strong><p>Tu respuesta: <strong>${escapeHtml(r.selectedText)}</strong></p>${r.isCorrect?"":`<p>Respuesta correcta: <strong>${escapeHtml(r.correctText)}</strong></p>`}<p class="explain">${escapeHtml(r.explanation)}</p></div>`));
  renderStartProgress(); showScreen("result"); window.scrollTo({top:0,behavior:"smooth"});
}

function messageForScore(p){
  if(p===100)return"Excelente. Respondiste correctamente todas las preguntas de esta sesión.";
  if(p>=90)return"Muy buen dominio. MaxHack mantendrá estos contenidos activos y dará más espacio a los capítulos con errores.";
  if(p>=75)return"Buen avance. La próxima sesión aumentará gradualmente el refuerzo en tus áreas más débiles.";
  if(p>=60)return"Vas avanzando. Revisa las explicaciones: la próxima sesión reforzará los contenidos con más errores.";
  return"Este resultado sirve como diagnóstico. MaxHack aumentará el refuerzo en los capítulos que necesitan más práctica.";
}
function escapeHtml(v){return String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}

$("startBtn").addEventListener("click",startQuiz); $("submitBtn").addEventListener("click",submitAnswer); $("nextBtn").addEventListener("click",nextQuestion);
$("restartBtn").addEventListener("click",()=>{showScreen("start");renderStartProgress();window.scrollTo({top:0,behavior:"smooth"});});
$("resetBtn").addEventListener("click",()=>{ if(confirm("¿Reiniciar el progreso adaptativo de MaxHack en este navegador?")){localStorage.removeItem(STORAGE_KEY);renderStartProgress();$("adaptiveNoticeText").textContent="En la primera sesión recibirás una selección equilibrada. En las siguientes, MaxHack reforzará tus capítulos más débiles sin dejar de practicar los demás.";} });
loadQuestions();
