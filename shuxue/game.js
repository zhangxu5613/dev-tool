/* ============================================================
 * 数学练习主逻辑：流程控制 / 答题 / 错题本 / 结算
 * 依赖 generator.js 暴露的 window.MathGen
 * ============================================================ */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const WRONG_KEY = "shuxue_wrong_book_v1";
  const SCORE_KEY = "shuxue_total_correct_v1";

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

  // 错题本按 key 去重存储完整题目对象
  function addWrong(q) {
    const list = loadWrong();
    if (!list.some((it) => it.key === q.key)) {
      list.push({
        key: q.key, type: q.type, typeName: q.typeName,
        prompt: q.prompt, extra: q.extra, answer: q.answer,
        choices: q.choices, hint: q.hint
      });
      saveWrong(list);
    }
  }
  function removeWrong(key) {
    const list = loadWrong().filter((it) => it.key !== key);
    saveWrong(list);
  }

  // ---------- 全局状态 ----------
  const state = {
    questions: [],
    index: 0,
    score: 0,
    correct: 0,
    wrong: 0,
    streak: 0,
    maxStreak: 0,
    answered: false,
    isReview: false,
    roundWrong: [],   // 本轮新产生的错题
    hintUsed: false
  };

  // ---------- 屏幕切换 ----------
  function showScreen(name) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    $("screen-" + name).classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---------- 首页数据刷新 ----------
  function refreshHome() {
    $("wrong-count").textContent = loadWrong().length;
    $("master-count").textContent = loadTotalCorrect();
  }

  // ---------- 读取首页配置 ----------
  function getSelectedTypes() {
    const map = {
      "mode-mental": "mental",
      "mode-fastmul": "fastmul",
      "mode-paren": "paren",
      "mode-expand": "expand",
      "mode-algebra": "algebra",
      "mode-equation": "equation"
    };
    const types = [];
    Object.keys(map).forEach((id) => { if ($(id).checked) types.push(map[id]); });
    return types;
  }
  function getLevel() {
    const r = document.querySelector('input[name="level"]:checked');
    return r ? parseInt(r.value, 10) : 1;
  }
  function getCount() {
    const r = document.querySelector('input[name="qcount"]:checked');
    return r ? parseInt(r.value, 10) : 10;
  }

  // ---------- 开始一轮 ----------
  function startRound(questions, isReview) {
    state.questions = questions;
    state.index = 0;
    state.score = 0;
    state.correct = 0;
    state.wrong = 0;
    state.streak = 0;
    state.maxStreak = 0;
    state.isReview = !!isReview;
    state.roundWrong = [];
    showScreen("quiz");
    renderQuestion();
  }

  // ---------- 渲染当前题 ----------
  function renderQuestion() {
    const q = state.questions[state.index];
    state.answered = false;
    state.hintUsed = false;

    $("q-type-badge").textContent = q.typeName;
    $("q-retry-badge").style.display = state.isReview ? "inline-block" : "none";
    $("q-prompt").textContent = q.prompt;
    $("q-extra").textContent = q.extra || "";
    $("q-extra").style.display = q.extra ? "block" : "none";

    // 进度
    $("quiz-progress").textContent = `${state.index + 1} / ${state.questions.length}`;
    $("quiz-score").textContent = `⭐ ${state.score}`;
    $("quiz-streak").textContent = `🔥 ${state.streak}`;
    $("progress-bar").style.width = `${(state.index / state.questions.length) * 100}%`;

    // 选项
    const wrap = $("answer-choices");
    wrap.innerHTML = "";
    q.choices.forEach((c) => {
      const btn = document.createElement("button");
      btn.className = "choice-btn";
      btn.textContent = c;
      btn.addEventListener("click", () => onAnswer(btn, c, q));
      wrap.appendChild(btn);
    });

    $("feedback").innerHTML = "";
    $("btn-next").style.display = "none";
    $("btn-hint").style.display = "inline-block";
  }

  // ---------- 作答 ----------
  function onAnswer(btn, chosen, q) {
    if (state.answered) return;
    state.answered = true;

    const buttons = Array.from(document.querySelectorAll(".choice-btn"));
    buttons.forEach((b) => (b.disabled = true));

    const isCorrect = chosen === q.answer;
    // 标出正确项
    buttons.forEach((b) => {
      if (b.textContent === q.answer) b.classList.add("correct");
    });

    if (isCorrect) {
      btn.classList.add("correct");
      // 提示未用才给满分
      const gained = state.hintUsed ? 5 : 10;
      state.score += gained;
      state.correct++;
      state.streak++;
      state.maxStreak = Math.max(state.maxStreak, state.streak);
      saveTotalCorrect(loadTotalCorrect() + 1);
      $("feedback").innerHTML = `✅ 正确！ +${gained} 分`;
      // 复习模式答对则移出错题本
      if (state.isReview) removeWrong(q.key);
    } else {
      btn.classList.add("wrong");
      state.wrong++;
      state.streak = 0;
      addWrong(q);
      if (!state.roundWrong.some((it) => it.key === q.key)) state.roundWrong.push(q);
      $("feedback").innerHTML =
        `❌ 答错了 <span class="detail">正确答案：${q.answer}</span>`;
    }

    $("quiz-score").textContent = `⭐ ${state.score}`;
    $("quiz-streak").textContent = `🔥 ${state.streak}`;
    $("btn-hint").style.display = "none";
    $("btn-next").style.display = "block";
    $("btn-next").textContent =
      state.index + 1 >= state.questions.length ? "查看结果 🏁" : "下一题 ➜";
  }

  // ---------- 下一题 ----------
  function nextQuestion() {
    if (state.index + 1 >= state.questions.length) {
      finishRound();
    } else {
      state.index++;
      renderQuestion();
    }
  }

  // ---------- 结算 ----------
  function finishRound() {
    $("progress-bar").style.width = "100%";
    const total = state.correct + state.wrong;
    const rate = total ? Math.round((state.correct / total) * 100) : 0;

    $("r-score").textContent = state.score;
    $("r-correct").textContent = state.correct;
    $("r-wrong").textContent = state.wrong;
    $("r-rate").textContent = rate + "%";
    $("r-streak").textContent = state.maxStreak;

    let title = "🎉 练习完成！";
    if (rate === 100) title = "🏆 全对！太强了！";
    else if (rate >= 80) title = "👏 表现优秀！";
    else if (rate >= 60) title = "💪 继续加油！";
    else title = "📖 多练几轮会更好！";
    $("result-title").textContent = title;

    // 本轮错题列表
    const card = $("r-wrong-card");
    const ul = $("r-wrong-list");
    ul.innerHTML = "";
    if (state.roundWrong.length) {
      card.style.display = "block";
      state.roundWrong.forEach((q) => {
        const li = document.createElement("li");
        li.innerHTML = `<b>[${q.typeName}]</b> ${escapeHTML(q.prompt)}　→　答案 <b>${escapeHTML(q.answer)}</b>`;
        ul.appendChild(li);
      });
    } else {
      card.style.display = "none";
    }

    showScreen("result");
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // ---------- 事件绑定 ----------
  function bind() {
    $("btn-start").addEventListener("click", () => {
      const types = getSelectedTypes();
      if (types.length === 0) {
        alert("请至少选择一种题型！");
        return;
      }
      const qs = MathGen.generateQuestions(types, getLevel(), getCount());
      if (!qs.length) { alert("题目生成失败，请重试"); return; }
      startRound(qs, false);
    });

    $("btn-review").addEventListener("click", () => {
      const list = loadWrong();
      if (list.length === 0) {
        alert("错题本是空的，先去练习吧！");
        return;
      }
      // 复习时打乱选项顺序，避免死记位置
      const qs = MathGen._utils.shuffle(list).map((q) => ({
        ...q,
        choices: MathGen._utils.shuffle(q.choices)
      }));
      startRound(qs, true);
    });

    $("btn-clear-wrong").addEventListener("click", () => {
      if (confirm("确定清空错题本？")) { saveWrong([]); refreshHome(); }
    });
    $("btn-clear-master").addEventListener("click", () => {
      if (confirm("确定重置累计答对成绩？")) { saveTotalCorrect(0); refreshHome(); }
    });

    $("btn-hint").addEventListener("click", () => {
      if (state.answered) return;
      state.hintUsed = true;
      const q = state.questions[state.index];
      $("feedback").innerHTML = `💡 <span class="detail">${escapeHTML(q.hint)}</span>`;
    });

    $("btn-next").addEventListener("click", nextQuestion);
    $("btn-quit").addEventListener("click", () => {
      if (confirm("确定结束本轮？")) finishRound();
    });

    $("btn-again").addEventListener("click", () => {
      if (state.isReview) {
        const list = loadWrong();
        if (list.length === 0) { showScreen("start"); refreshHome(); return; }
        const qs = MathGen._utils.shuffle(list).map((q) => ({
          ...q, choices: MathGen._utils.shuffle(q.choices)
        }));
        startRound(qs, true);
      } else {
        const types = getSelectedTypes();
        const qs = MathGen.generateQuestions(types.length ? types : null, getLevel(), getCount());
        startRound(qs, false);
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
    refreshHome();
  }
  document.addEventListener("DOMContentLoaded", init);
  // DOMContentLoaded 可能已触发
  if (document.readyState !== "loading") init();
})();
