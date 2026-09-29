const express = require("express");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database("quiz.db");

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS creators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quizzes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  join_code TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (creator_id) REFERENCES creators(id)
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id INTEGER NOT NULL,
  question_text TEXT NOT NULL,
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  c TEXT NOT NULL,
  d TEXT NOT NULL,
  e TEXT NOT NULL,
  answer TEXT NOT NULL,
  points REAL NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id INTEGER NOT NULL,
  student_name TEXT NOT NULL,
  score REAL NOT NULL,
  correct_count INTEGER NOT NULL,
  total_questions INTEGER NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
);
`);

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

function clean(s, max = 500) {
  return String(s ?? "").trim().slice(0, max);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, original] = String(stored).split(":");
  if (!salt || !original) return false;
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(original, "hex"));
}

// Simple signed session token. For a small school project this keeps setup easy.
const sessions = new Map();
function newSession(creatorId) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, { creatorId, expires: Date.now() + 7 * 24 * 3600 * 1000 });
  return token;
}
function requireCreator(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) {
    sessions.delete(token);
    return res.status(401).json({ error: "Sesi pembuat tidak valid atau sudah habis." });
  }
  req.creatorId = session.creatorId;
  req.token = token;
  next();
}
function makeJoinCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = "";
    for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!db.prepare("SELECT 1 FROM quizzes WHERE join_code=?").get(code)) return code;
  }
  throw new Error("Gagal membuat kode kuis.");
}

// Creator auth
app.post("/api/creator/register", (req, res) => {
  const username = clean(req.body.username, 30).toLowerCase();
  const displayName = clean(req.body.displayName, 60);
  const password = String(req.body.password || "");
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
    return res.status(400).json({ error: "Nama pengguna: 3-30 karakter, gunakan huruf/angka/titik/_/-." });
  }
  if (displayName.length < 2) return res.status(400).json({ error: "Nama pembuat minimal 2 karakter." });
  if (password.length < 4) return res.status(400).json({ error: "Password minimal 4 karakter." });

  try {
    const info = db.prepare(
      "INSERT INTO creators(username, display_name, password_hash) VALUES(?,?,?)"
    ).run(username, displayName, hashPassword(password));
    const token = newSession(info.lastInsertRowid);
    res.json({ token, creator: { id: info.lastInsertRowid, username, displayName } });
  } catch (e) {
    res.status(409).json({ error: "Nama pengguna itu sudah dipakai." });
  }
});

app.post("/api/creator/login", (req, res) => {
  const username = clean(req.body.username, 30).toLowerCase();
  const password = String(req.body.password || "");
  const creator = db.prepare("SELECT * FROM creators WHERE username=?").get(username);
  if (!creator || !verifyPassword(password, creator.password_hash)) {
    return res.status(401).json({ error: "Nama pengguna atau password salah." });
  }
  const token = newSession(creator.id);
  res.json({ token, creator: { id: creator.id, username, displayName: creator.display_name } });
});

// Creator dashboard
app.get("/api/creator/quizzes", requireCreator, (req, res) => {
  const quizzes = db.prepare(`
    SELECT q.id, q.title, q.subject, q.join_code, q.created_at,
      (SELECT COUNT(*) FROM questions x WHERE x.quiz_id=q.id) AS question_count,
      (SELECT COUNT(*) FROM attempts a WHERE a.quiz_id=q.id) AS attempt_count
    FROM quizzes q WHERE q.creator_id=? ORDER BY q.id DESC
  `).all(req.creatorId);
  res.json({ quizzes });
});

app.post("/api/creator/quizzes", requireCreator, (req, res) => {
  const title = clean(req.body.title, 100);
  const subject = clean(req.body.subject, 80);
  if (!title || !subject) return res.status(400).json({ error: "Judul dan bidang pelajaran wajib diisi." });
  const code = makeJoinCode();
  const info = db.prepare(
    "INSERT INTO quizzes(creator_id,title,subject,join_code) VALUES(?,?,?,?)"
  ).run(req.creatorId, title, subject, code);
  res.json({ quiz: { id: info.lastInsertRowid, title, subject, joinCode: code } });
});

app.get("/api/creator/quizzes/:id", requireCreator, (req, res) => {
  const quiz = db.prepare(
    "SELECT id,title,subject,join_code,created_at FROM quizzes WHERE id=? AND creator_id=?"
  ).get(req.params.id, req.creatorId);
  if (!quiz) return res.status(404).json({ error: "Kuis tidak ditemukan." });
  const questions = db.prepare(`
    SELECT id, question_text, a,b,c,d,e,answer,points,position
    FROM questions WHERE quiz_id=? ORDER BY position,id
  `).all(quiz.id);
  const attempts = db.prepare(`
    SELECT id, student_name, score, correct_count, total_questions, submitted_at
    FROM attempts WHERE quiz_id=? ORDER BY id DESC
  `).all(quiz.id);
  res.json({ quiz, questions, attempts });
});

app.post("/api/creator/quizzes/:id/questions", requireCreator, (req, res) => {
  const quiz = db.prepare("SELECT id FROM quizzes WHERE id=? AND creator_id=?").get(req.params.id, req.creatorId);
  if (!quiz) return res.status(404).json({ error: "Kuis tidak ditemukan." });

  const q = req.body;
  const text = clean(q.questionText, 1000);
  const choices = ["a","b","c","d","e"].map(k => clean(q[k], 500));
  const answer = clean(q.answer, 1).toLowerCase();
  const points = Number(q.points ?? 1);

  if (!text || choices.some(x => !x) || !["a","b","c","d","e"].includes(answer)) {
    return res.status(400).json({ error: "Soal, 5 pilihan A-E, dan jawaban benar wajib diisi." });
  }
  if (!Number.isFinite(points) || points <= 0 || points > 1000) {
    return res.status(400).json({ error: "Nilai soal harus lebih dari 0." });
  }

  const maxPos = db.prepare("SELECT COALESCE(MAX(position),0) AS p FROM questions WHERE quiz_id=?").get(quiz.id).p;
  const info = db.prepare(`
    INSERT INTO questions(quiz_id,question_text,a,b,c,d,e,answer,points,position)
    VALUES(?,?,?,?,?,?,?,?,?,?)
  `).run(quiz.id, text, ...choices, answer, points, maxPos + 1);

  res.json({ questionId: info.lastInsertRowid });
});

app.put("/api/creator/quizzes/:quizId/questions/:questionId", requireCreator, (req, res) => {
  const quiz = db.prepare("SELECT id FROM quizzes WHERE id=? AND creator_id=?").get(req.params.quizId, req.creatorId);
  if (!quiz) return res.status(404).json({ error: "Kuis tidak ditemukan." });
  const q = req.body;
  const text = clean(q.questionText, 1000);
  const choices = ["a","b","c","d","e"].map(k => clean(q[k], 500));
  const answer = clean(q.answer, 1).toLowerCase();
  const points = Number(q.points ?? 1);

  if (!text || choices.some(x => !x) || !["a","b","c","d","e"].includes(answer)) {
    return res.status(400).json({ error: "Data soal belum lengkap." });
  }
  db.prepare(`
    UPDATE questions SET question_text=?,a=?,b=?,c=?,d=?,e=?,answer=?,points=?
    WHERE id=? AND quiz_id=?
  `).run(text, ...choices, answer, points, req.params.questionId, quiz.id);
  res.json({ ok: true });
});

app.delete("/api/creator/quizzes/:quizId/questions/:questionId", requireCreator, (req, res) => {
  db.prepare("DELETE FROM questions WHERE id=? AND quiz_id=?").run(req.params.questionId, req.params.quizId);
  res.json({ ok: true });
});

app.delete("/api/creator/quizzes/:id", requireCreator, (req, res) => {
  const info = db.prepare("DELETE FROM quizzes WHERE id=? AND creator_id=?").run(req.params.id, req.creatorId);
  if (!info.changes) return res.status(404).json({ error: "Kuis tidak ditemukan." });
  res.json({ ok: true });
});

// Student flow
app.get("/api/join/:code", (req, res) => {
  const code = clean(req.params.code, 10).toUpperCase();
  const quiz = db.prepare("SELECT id,title,subject,join_code FROM quizzes WHERE join_code=?").get(code);
  if (!quiz) return res.status(404).json({ error: "Kode kuis tidak ditemukan." });
  const count = db.prepare("SELECT COUNT(*) AS c FROM questions WHERE quiz_id=?").get(quiz.id).c;
  res.json({ quiz: { ...quiz, questionCount: count } });
});

app.get("/api/join/:code/questions", (req, res) => {
  const code = clean(req.params.code, 10).toUpperCase();
  const quiz = db.prepare("SELECT id,title,subject,join_code FROM quizzes WHERE join_code=?").get(code);
  if (!quiz) return res.status(404).json({ error: "Kode kuis tidak ditemukan." });
  const questions = db.prepare(`
    SELECT id,question_text,a,b,c,d,e,points,position
    FROM questions WHERE quiz_id=? ORDER BY position,id
  `).all(quiz.id);
  res.json({ quiz, questions });
});

app.post("/api/join/:code/submit", (req, res) => {
  const code = clean(req.params.code, 10).toUpperCase();
  const quiz = db.prepare("SELECT * FROM quizzes WHERE join_code=?").get(code);
  if (!quiz) return res.status(404).json({ error: "Kode kuis tidak ditemukan." });

  const studentName = clean(req.body.studentName, 80);
  const answers = req.body.answers || {};
  if (studentName.length < 2) return res.status(400).json({ error: "Nama pengisi minimal 2 karakter." });

  const questions = db.prepare(`
    SELECT id,answer,points FROM questions WHERE quiz_id=? ORDER BY position,id
  `).all(quiz.id);
  if (!questions.length) return res.status(400).json({ error: "Kuis ini belum memiliki soal." });

  let earned = 0;
  let total = 0;
  let correct = 0;
  for (const q of questions) {
    total += Number(q.points);
    if (String(answers[q.id] || "").toLowerCase() === q.answer) {
      earned += Number(q.points);
      correct++;
    }
  }
  const score = Math.round((earned / total) * 10000) / 100;
  db.prepare(`
    INSERT INTO attempts(quiz_id,student_name,score,correct_count,total_questions)
    VALUES(?,?,?,?,?)
  `).run(quiz.id, studentName, score, correct, questions.length);

  res.json({
    score,
    correct,
    totalQuestions: questions.length,
    quizTitle: quiz.title,
    subject: quiz.subject
  });
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Kuis Mudah Online berjalan di http://localhost:${PORT}`);
});
