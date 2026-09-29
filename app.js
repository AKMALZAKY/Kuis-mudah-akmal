let token = localStorage.getItem("kuis_token") || "";
let creator = JSON.parse(localStorage.getItem("kuis_creator") || "null");
let authIsLogin = true;
let currentQuiz = null;
let studentQuiz = null;

const $ = (id) => document.getElementById(id);

function show(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $(id).classList.add("active");
  window.scrollTo({top:0,behavior:"smooth"});
}
function setMsg(id, text="") { $(id).textContent = text; }

function toggleAuth(login) {
  authIsLogin = login;
  $("loginTab").classList.toggle("active", login);
  $("registerTab").classList.toggle("active", !login);
  $("authTitle").textContent = login ? "Masuk sebagai pembuat" : "Buat akun pembuat";
  $("authButton").textContent = login ? "Masuk" : "Buat akun";
  $("registerExtra").innerHTML = login ? "" : `
    <label>Nama yang ditampilkan
      <input id="authDisplayName" placeholder="contoh: Guru Geografi">
    </label>`;
  $("authPassword").autocomplete = login ? "current-password" : "new-password";
  setMsg("authMsg","");
}

async function api(url, opts={}) {
  const headers = {"Content-Type":"application/json", ...(opts.headers||{})};
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(url, {...opts, headers});
  const data = await res.json().catch(()=>({error:"Jawaban server tidak terbaca."}));
  if (!res.ok) throw new Error(data.error || "Terjadi kesalahan.");
  return data;
}

async function submitAuth() {
  setMsg("authMsg","");
  try {
    const username = $("authUsername").value;
    const password = $("authPassword").value;
    const body = {username, password};
    if (!authIsLogin) body.displayName = $("authDisplayName").value;
    const data = await api(authIsLogin ? "/api/creator/login" : "/api/creator/register", {
      method:"POST", body:JSON.stringify(body)
    });
    token = data.token;
    creator = data.creator;
    localStorage.setItem("kuis_token",token);
    localStorage.setItem("kuis_creator",JSON.stringify(creator));
    loadMaker();
  } catch(e) { setMsg("authMsg", e.message); }
}

function logout() {
  token=""; creator=null;
  localStorage.removeItem("kuis_token"); localStorage.removeItem("kuis_creator");
  show("home");
}

async function loadMaker() {
  $("creatorHello").textContent = `Halo, ${creator.displayName}`;
  show("maker");
  try {
    const data = await api("/api/creator/quizzes");
    $("quizList").innerHTML = data.quizzes.length ? data.quizzes.map(q => `
      <div class="quiz-card">
        <div>
          <strong>${esc(q.title)}</strong>
          <div class="meta">${esc(q.subject)} • ${q.question_count} soal • ${q.attempt_count} pengisi</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="code-badge">${q.join_code}</span>
          <button class="ghost" onclick="openEditor(${q.id})">Kelola</button>
        </div>
      </div>`).join("") : `<div class="panel">Belum ada kelas. Buat kelas kuis pertama kamu di atas.</div>`;
  } catch(e) {
    if (e.message.includes("Sesi")) logout();
    else $("quizList").innerHTML = `<div class="panel">${esc(e.message)}</div>`;
  }
}

async function createQuiz() {
  setMsg("createMsg","");
  try {
    const data = await api("/api/creator/quizzes", {
      method:"POST",
      body:JSON.stringify({subject:$("newSubject").value,title:$("newTitle").value})
    });
    $("newSubject").value=""; $("newTitle").value="";
    await loadMaker();
    openEditor(data.quiz.id);
  } catch(e) { setMsg("createMsg",e.message); }
}

function choiceInputs(values={a:"",b:"",c:"",d:"",e:""}) {
  const names = [["a","A"],["b","B"],["c","C"],["d","D"],["e","E"]];
  $("choiceInputs").innerHTML = names.map(([k,L]) => `
    <div class="choice-line">
      <div class="letter">${L}</div>
      <input id="q_${k}" value="${escAttr(values[k]||"")}" placeholder="Pilihan ${L}">
    </div>`).join("");
}
choiceInputs();

async function openEditor(id) {
  try {
    const data = await api(`/api/creator/quizzes/${id}`);
    currentQuiz=data;
    $("editorTop").innerHTML = `
      <div class="panel" style="margin-bottom:18px">
        <div class="section-head" style="margin:0">
          <div><div class="eyebrow">${esc(data.quiz.subject)}</div><h2>${esc(data.quiz.title)}</h2><div class="meta">Kode peserta: <span class="code-badge">${data.quiz.join_code}</span></div></div>
          <button class="ghost" onclick="copyCode('${data.quiz.join_code}')">Salin kode</button>
        </div>
      </div>`;
    renderQuestions();
    renderAttempts();
    clearQuestionForm();
    show("quizEditor");
  } catch(e) { alert(e.message); }
}

function renderQuestions() {
  $("questionList").innerHTML = currentQuiz.questions.length ? currentQuiz.questions.map((q,i)=>`
    <div class="question-item">
      <div class="qtop"><span class="qnum">${i+1}. ${esc(q.question_text)}</span><span>${q.points} poin</span></div>
      <div class="sub">Jawaban benar: ${q.answer.toUpperCase()}</div>
      <div class="question-actions">
        <button onclick='editQuestion(${q.id})'>Edit</button>
        <button onclick='deleteQuestion(${q.id})'>Hapus</button>
      </div>
    </div>`).join("") : `<div class="hint">Belum ada soal.</div>`;
}
function renderAttempts() {
  $("attemptList").innerHTML = currentQuiz.attempts.length ? currentQuiz.attempts.map(a=>`
    <div class="attempt">
      <div><strong>${esc(a.student_name)}</strong><div class="sub">${new Date(a.submitted_at).toLocaleString("id-ID")} • ${a.correct_count}/${a.total_questions} benar</div></div>
      <div class="score">${a.score}</div>
    </div>`).join("") : `<div class="hint">Belum ada yang mengisi.</div>`;
}

function clearQuestionForm() {
  $("editingId").value="";
  $("qText").value="";
  $("qPoints").value="1";
  $("qAnswer").value="a";
  choiceInputs();
}
function editQuestion(id) {
  const q=currentQuiz.questions.find(x=>x.id===id);
  if (!q) return;
  $("editingId").value=id; $("qText").value=q.question_text; $("qPoints").value=q.points; $("qAnswer").value=q.answer;
  choiceInputs(q);
  window.scrollTo({top:0,behavior:"smooth"});
}
async function saveQuestion() {
  if (!currentQuiz) return;
  const body = {questionText:$("qText").value,a:$("q_a").value,b:$("q_b").value,c:$("q_c").value,d:$("q_d").value,e:$("q_e").value,answer:$("qAnswer").value,points:Number($("qPoints").value)};
  try {
    const editing=$("editingId").value;
    if (editing) {
      await api(`/api/creator/quizzes/${currentQuiz.quiz.id}/questions/${editing}`,{method:"PUT",body:JSON.stringify(body)});
    } else {
      await api(`/api/creator/quizzes/${currentQuiz.quiz.id}/questions`,{method:"POST",body:JSON.stringify(body)});
    }
    const refreshed=await api(`/api/creator/quizzes/${currentQuiz.quiz.id}`);
    currentQuiz=refreshed; renderQuestions(); renderAttempts(); clearQuestionForm();
    setMsg("questionMsg","Soal tersimpan.");
  } catch(e) { setMsg("questionMsg",e.message); }
}
async function deleteQuestion(id) {
  if (!confirm("Hapus soal ini?")) return;
  try {
    await api(`/api/creator/quizzes/${currentQuiz.quiz.id}/questions/${id}`,{method:"DELETE"});
    const refreshed=await api(`/api/creator/quizzes/${currentQuiz.quiz.id}`);
    currentQuiz=refreshed; renderQuestions(); renderAttempts();
  } catch(e) { alert(e.message); }
}
async function copyCode(code) {
  try { await navigator.clipboard.writeText(code); alert("Kode berhasil disalin: " + code); }
  catch { alert("Kode kuis: " + code); }
}

async function openQuiz() {
  setMsg("joinMsg","");
  const code=$("joinCode").value.trim().toUpperCase(), name=$("studentName").value.trim();
  if (!code || !name) { setMsg("joinMsg","Masukkan kode kuis dan nama kamu."); return; }
  try {
    const info=await api(`/api/join/${code}`);
    if (!info.quiz.questionCount) throw new Error("Kuis ini belum memiliki soal.");
    const qs=await api(`/api/join/${code}/questions`);
    studentQuiz={quiz:qs.quiz,questions:qs.questions,studentName:name,answers:{}};
    $("studentSubject").textContent=studentQuiz.quiz.subject;
    $("studentTitle").textContent=studentQuiz.quiz.title;
    renderStudentQuestions();
    show("studentQuiz");
  } catch(e){ setMsg("joinMsg",e.message); }
}
function renderStudentQuestions() {
  $("studentQuestions").innerHTML=studentQuiz.questions.map((q,i)=>`
    <div class="student-card">
      <h3>${i+1}. ${esc(q.question_text)}</h3>
      <div class="options">
        ${["a","b","c","d","e"].map(k=>`
          <label class="option" id="opt_${q.id}_${k}">
            <input type="radio" name="q_${q.id}" value="${k}" onchange="choose(${q.id},'${k}')">
            <span><b>${k.toUpperCase()}.</b> ${esc(q[k])}</span>
          </label>`).join("")}
      </div>
    </div>`).join("");
  updateProgress();
}
function choose(qid,k) {
  studentQuiz.answers[qid]=k;
  ["a","b","c","d","e"].forEach(x=>{ const el=$(`opt_${qid}_${x}`); if(el) el.classList.toggle("selected",x===k); });
  updateProgress();
}
function updateProgress() {
  if (!studentQuiz) return;
  const done=Object.keys(studentQuiz.answers).length, total=studentQuiz.questions.length;
  $("progressText").textContent=`${done}/${total}`;
  $("progressBar").style.width=(done/total*100)+"%";
}
async function submitQuiz() {
  const done=Object.keys(studentQuiz.answers).length, total=studentQuiz.questions.length;
  if (done<total && !confirm(`Kamu baru menjawab ${done} dari ${total} soal. Tetap kirim?`)) return;
  try {
    const data=await api(`/api/join/${studentQuiz.quiz.join_code}/submit`,{method:"POST",body:JSON.stringify({studentName:studentQuiz.studentName,answers:studentQuiz.answers})});
    $("finalScore").textContent=data.score;
    $("resultTitle").textContent=data.quizTitle;
    $("resultDetail").textContent=`${studentQuiz.studentName} • ${data.correct} dari ${data.totalQuestions} soal benar • nilai ${data.score}`;
    show("result");
  } catch(e) { setMsg("studentMsg",e.message); }
}

function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m]));}
function escAttr(s){return esc(s);}
toggleAuth(true);

if (token && creator) {
  loadMaker();
}
