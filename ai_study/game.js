/* ============================================================
 * ai_study 主逻辑：需求提交 / 出题等待 / 答题 / 错题本 / 结算
 * 依赖 deepseek.js 暴露的 window.AIGen
 * ============================================================ */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const WRONG_KEY = "ai_study_wrong_book_v1";
  const SCORE_KEY = "ai_study_total_correct_v1";
  const REQ_KEY = "ai_study_last_req_v1";

  // ---------- 持久化 ----------
  function loadWrong() {
    try { return JSON.parse(localStorage.getItem(WRONG_KEY) || "[]"); }
    catch (e) { return []; }
  }
  function saveWrong(list) {
    try { localStorage.setItem(WRONG_KEY, JSON.stringify(list)); } catch (e) {}
  }
  function loadTotalCorrect() {
    return parseInt(localStorage.getItem(SCORE_KEY) || "0", 10) || 0;
  }
  function saveTotalCorrect(n) {
    try { localStorage.setItem(SCORE_KEY, String(n)); } catch (e) {}
  }

  function addWrong(q) {
    const list = loadWrong();
    if (!list.some((it) => it.key === q.key)) {
      list.push({
        key: q.key, type: q.type, typeName: q.typeName,
        prompt: q.prompt, extra: q.extra, answer: q.answer,
        choices: q.choices, hint: q.hint, topic: q.topic || ""
      });
      saveWrong(list);
    }
  }
  function removeWrong(key) {
    saveWrong(loadWrong().filter((it) => it.key !== key));
  }

  // ---------- 全局状态 ----------
  const state = {
    questions: [], index: 0, score: 0, correct: 0, wrong: 0,
    streak: 0, maxStreak: 0, answered: false, isReview: false,
    roundWrong: [], hintUsed: false, level: 1,
    startTime: 0, endTime: 0,
    topic: "", lastReq: "",
    abort: null
  };

  // ---------- 屏幕切换 ----------
  function showScreen(name) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    $("screen-" + name).classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function refreshHome() {
    $("wrong-count").textContent = loadWrong().length;
    $("master-count").textContent = loadTotalCorrect();
  }

  // ---------- 读取首页配置 ----------
  function getLevel() {
    const r = document.querySelector('input[name="level"]:checked');
    return r ? parseInt(r.value, 10) : 1;
  }
  function getCount() {
    const r = document.querySelector('input[name="qcount"]:checked');
    return r ? parseInt(r.value, 10) : 5;
  }
  function getModel() {
    const r = document.querySelector('input[name="model"]:checked');
    return r ? r.value : "deepseek-v4-flash";
  }

  // ---------- AI 出题流程 ----------
  async function doGenerate(req) {
    const level = getLevel();
    const count = getCount();
    const model = getModel();
    const apiKey = $("api-key").value.trim();

    if (!req) { alert("请先说说你想练什么内容～"); return; }
    if (!apiKey) { alert("请先填写 DeepSeek API Key"); $("api-key").focus(); return; }

    AIGen.saveKey(apiKey);
    try { localStorage.setItem(REQ_KEY, req); } catch (e) {}
    state.lastReq = req;

    // 进入等待页，展示需求与分步提示
    showScreen("loading");
    $("load-error").style.display = "none";
    $("load-req").textContent = "「" + req + "」";
    $("load-step").textContent = "正在整理你的出题需求…";
    const t1 = setTimeout(() => { $("load-step").textContent = "AI 正在命题与设计干扰项…"; }, 2500);
    const t2 = setTimeout(() => { $("load-step").textContent = "正在校对答案与解析…"; }, 9000);

    const ctrl = new AbortController();
    state.abort = ctrl;

    try {
      const result = await AIGen.generate({
        req: req, level: level, count: count, model: model,
        apiKey: apiKey, signal: ctrl.signal
      });
      clearTimeout(t1); clearTimeout(t2);
      state.abort = null;
      state.topic = result.topic;
      result.questions.forEach((q) => { q.topic = result.topic; });
      startRound(result.questions, false, level);
    } catch (e) {
      clearTimeout(t1); clearTimeout(t2);
      state.abort = null;
      if (e && e.name === "AbortError") return; // 用户主动取消，不报错
      const box = $("load-error");
      box.style.display = "block";
      box.innerHTML = "⚠️ " + escapeHTML(e.message || "出题失败，请重试") +
        '<br><button class="btn-retry" id="btn-retry">重试一次</button>';
      $("btn-retry").addEventListener("click", () => doGenerate(req));
    }
  }

  // ---------- 开始一轮 ----------
  function startRound(questions, isReview, level) {
    state.questions = questions;
    state.index = 0; state.score = 0; state.correct = 0; state.wrong = 0;
    state.streak = 0; state.maxStreak = 0;
    state.isReview = !!isReview;
    state.roundWrong = [];
    state.level = level || 1;
    state.startTime = Date.now();
    state.endTime = 0;
    showScreen("quiz");
    renderQuestion();
  }

  // ---------- 渲染当前题 ----------
  function renderQuestion() {
    const q = state.questions[state.index];
    state.answered = false;
    state.hintUsed = false;

    $("q-type-badge").textContent = q.typeName || "AI 出题";
    $("q-retry-badge").style.display = state.isReview ? "inline-block" : "none";
    $("q-prompt").textContent = q.prompt;
    $("q-extra").textContent = q.extra || "";
    $("q-extra").style.display = q.extra ? "block" : "none";

    $("quiz-progress").textContent = `${state.index + 1} / ${state.questions.length}`;
    $("quiz-score").textContent = `⭐ ${state.score}`;
    $("quiz-streak").textContent = `🔥 ${state.streak}`;
    $("progress-bar").style.width = `${(state.index / state.questions.length) * 100}%`;

    const wrap = $("answer-choices");
    wrap.innerHTML = "";
    q.choices.forEach((c) => {
      const btn = document.createElement("button");
      btn.className = "choice-btn";
      // AI 题目的选项长度不可控，按长度分档降字号
      const len = String(c).length;
      if (len > 24) btn.classList.add("long");
      else if (len > 8) btn.classList.add("mid");
      btn.textContent = c;
      btn.addEventListener("click", () => onAnswer(btn, c, q));
      wrap.appendChild(btn);
    });

    $("feedback").innerHTML = "";
    $("btn-next").style.display = "none";
    $("btn-hint").style.display = "inline-block";
  }

  // ---------- 作答判定：以 DeepSeek 给出的 answer 为准 ----------
  function onAnswer(btn, chosen, q) {
    if (state.answered) return;
    state.answered = true;

    const buttons = Array.from(document.querySelectorAll(".choice-btn"));
    buttons.forEach((b) => (b.disabled = true));

    const isCorrect = chosen === q.answer;
    buttons.forEach((b) => {
      if (b.textContent === q.answer) b.classList.add("correct");
    });

    if (isCorrect) {
      btn.classList.add("correct");
      const gained = state.hintUsed ? 5 : 10;
      state.score += gained;
      state.correct++;
      state.streak++;
      state.maxStreak = Math.max(state.maxStreak, state.streak);
      saveTotalCorrect(loadTotalCorrect() + 1);
      $("feedback").innerHTML =
        `✅ 正确！ +${gained} 分<span class="detail">${escapeHTML(q.hint)}</span>`;
      if (state.isReview) removeWrong(q.key);
    } else {
      btn.classList.add("wrong");
      state.wrong++;
      state.streak = 0;
      addWrong(q);
      if (!state.roundWrong.some((it) => it.key === q.key)) state.roundWrong.push(q);
      $("feedback").innerHTML =
        `❌ 答错了　正确答案：${escapeHTML(q.answer)}` +
        `<span class="detail">${escapeHTML(q.hint)}</span>`;
    }

    $("quiz-score").textContent = `⭐ ${state.score}`;
    $("quiz-streak").textContent = `🔥 ${state.streak}`;
    $("btn-hint").style.display = "none";
    $("btn-next").style.display = "block";
    $("btn-next").textContent =
      state.index + 1 >= state.questions.length ? "查看结果 🏁" : "下一题 ➜";
  }

  function nextQuestion() {
    if (state.index + 1 >= state.questions.length) finishRound();
    else { state.index++; renderQuestion(); }
  }

  // ---------- 结算 ----------
  const LEVEL_NAMES = { 1: "🟢 简单", 2: "🟡 中等", 3: "🔴 挑战" };
  function fmtDuration(ms) {
    const totalSec = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return m > 0 ? `${m}分${s}秒` : `${s}秒`;
  }

  function finishRound() {
    state.endTime = Date.now();
    $("progress-bar").style.width = "100%";
    const total = state.correct + state.wrong;
    const rate = total ? Math.round((state.correct / total) * 100) : 0;
    const elapsed = state.endTime - state.startTime;

    $("r-topic").textContent = state.isReview
      ? "📕 错题复习"
      : (state.topic ? truncate(state.topic, 40) : "—");
    $("r-level").textContent = state.isReview ? "📕 错题复习" : (LEVEL_NAMES[state.level] || "简单");
    $("r-score").textContent = state.score;
    $("r-correct").textContent = state.correct;
    $("r-wrong").textContent = state.wrong;
    $("r-rate").textContent = rate + "%";
    $("r-streak").textContent = state.maxStreak;
    $("r-total-time").textContent = fmtDuration(elapsed);

    let title = "🎉 练习完成！";
    if (rate === 100) title = "🏆 全对！太强了！";
    else if (rate >= 80) title = "👏 表现优秀！";
    else if (rate >= 60) title = "💪 继续加油！";
    else title = "📖 再多练几轮就熟了！";
    $("result-title").textContent = title;

    const card = $("r-wrong-card");
    const ul = $("r-wrong-list");
    ul.innerHTML = "";
    if (state.roundWrong.length) {
      card.style.display = "block";
      state.roundWrong.forEach((q) => {
        const li = document.createElement("li");
        li.innerHTML = `${escapeHTML(truncate(q.prompt, 50))}　→　答案 <b>${escapeHTML(q.answer)}</b>`;
        ul.appendChild(li);
      });
    } else {
      card.style.display = "none";
    }

    showScreen("result");
  }

  function truncate(s, n) {
    const str = String(s == null ? "" : s);
    return str.length > n ? str.slice(0, n) + "…" : str;
  }
  function escapeHTML(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- 事件绑定 ----------
  function bind() {
    $("btn-gen").addEventListener("click", () => {
      doGenerate($("req-input").value.trim());
    });

    // 快捷主题按钮：点一下直接填入需求框
    $("chip-row").addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      $("req-input").value = chip.getAttribute("data-req") || "";
      $("req-input").focus();
    });

    $("btn-cancel").addEventListener("click", () => {
      if (state.abort) { state.abort.abort(); state.abort = null; }
      showScreen("start");
    });

    $("btn-review").addEventListener("click", () => {
      const list = loadWrong();
      if (list.length === 0) { alert("错题本是空的，先让 AI 出几道题吧！"); return; }
      const qs = shuffle(list).map((q) => ({ ...q, choices: shuffle(q.choices) }));
      startRound(qs, true, getLevel());
    });

    $("btn-clear-wrong").addEventListener("click", () => {
      if (confirm("确定清空错题本？")) { saveWrong([]); refreshHome(); }
    });

    $("btn-hint").addEventListener("click", () => {
      if (state.answered) return;
      state.hintUsed = true;
      const q = state.questions[state.index];
      // 提示只排除一个错误选项，不直接给答案
      const wrongOnes = q.choices.filter((c) => c !== q.answer);
      const drop = wrongOnes[Math.floor(Math.random() * wrongOnes.length)];
      Array.from(document.querySelectorAll(".choice-btn")).forEach((b) => {
        if (b.textContent === drop) { b.disabled = true; b.classList.add("excluded"); }
      });
      $("feedback").innerHTML =
        `💡 <span class="detail">已帮你排除一个错误选项（答对得 5 分）</span>`;
    });

    $("btn-next").addEventListener("click", nextQuestion);
    $("btn-quit").addEventListener("click", () => {
      if (confirm("确定结束本轮？")) finishRound();
    });

    $("btn-again").addEventListener("click", () => {
      if (state.isReview) {
        const list = loadWrong();
        if (list.length === 0) { showScreen("start"); refreshHome(); return; }
        const qs = shuffle(list).map((q) => ({ ...q, choices: shuffle(q.choices) }));
        startRound(qs, true, getLevel());
      } else {
        // 用同一需求重新向 AI 要一批新题
        doGenerate(state.lastReq || $("req-input").value.trim());
      }
    });
    $("btn-home").addEventListener("click", () => { showScreen("start"); refreshHome(); });
  }

  // ---------- 初始化 ----------
  let _inited = false;
  function init() {
    if (_inited) return;
    _inited = true;
    bind();
    // 回填上次填过的 Key 与需求，省去重复输入
    const k = AIGen.loadKey();
    if (k) $("api-key").value = k;
    try {
      const r = localStorage.getItem(REQ_KEY);
      if (r) { $("req-input").value = r; state.lastReq = r; }
    } catch (e) {}
    refreshHome();
  }
  document.addEventListener("DOMContentLoaded", init);
  if (document.readyState !== "loading") init();
})();
