/* ================= 工具函数 ================= */
const $ = id => document.getElementById(id);
const shuffle = arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

/* ================= 不规则动词表 ================= */
const IRREGULAR = {
  be: ["was/were", "been", "being", "is"], go: ["went", "gone", "going", "goes"],
  do: ["did", "done", "doing", "does"], have: ["had", "had", "having", "has"],
  eat: ["ate", "eaten", "eating", "eats"], see: ["saw", "seen", "seeing", "sees"],
  run: ["ran", "run", "running", "runs"], swim: ["swam", "swum", "swimming", "swims"],
  come: ["came", "come", "coming", "comes"], get: ["got", "got", "getting", "gets"],
  give: ["gave", "given", "giving", "gives"], take: ["took", "taken", "taking", "takes"],
  make: ["made", "made", "making", "makes"], read: ["read", "read", "reading", "reads"],
  write: ["wrote", "written", "writing", "writes"], sing: ["sang", "sung", "singing", "sings"],
  drink: ["drank", "drunk", "drinking", "drinks"], draw: ["drew", "drawn", "drawing", "draws"],
  fly: ["flew", "flown", "flying", "flies"], buy: ["bought", "bought", "buying", "buys"],
  bring: ["brought", "brought", "bringing", "brings"], think: ["thought", "thought", "thinking", "thinks"],
  teach: ["taught", "taught", "teaching", "teaches"], catch: ["caught", "caught", "catching", "catches"],
  say: ["said", "said", "saying", "says"], tell: ["told", "told", "telling", "tells"],
  find: ["found", "found", "finding", "finds"], sit: ["sat", "sat", "sitting", "sits"],
  stand: ["stood", "stood", "standing", "stands"], sleep: ["slept", "slept", "sleeping", "sleeps"],
  keep: ["kept", "kept", "keeping", "keeps"], sweep: ["swept", "swept", "sweeping", "sweeps"],
  feel: ["felt", "felt", "feeling", "feels"], meet: ["met", "met", "meeting", "meets"],
  leave: ["left", "left", "leaving", "leaves"], speak: ["spoke", "spoken", "speaking", "speaks"],
  know: ["knew", "known", "knowing", "knows"], grow: ["grew", "grown", "growing", "grows"],
  throw: ["threw", "thrown", "throwing", "throws"], wear: ["wore", "worn", "wearing", "wears"],
  ride: ["rode", "ridden", "riding", "rides"], drive: ["drove", "driven", "driving", "drives"],
  begin: ["began", "begun", "beginning", "begins"], put: ["put", "put", "putting", "puts"],
  cut: ["cut", "cut", "cutting", "cuts"], let: ["let", "let", "letting", "lets"],
  hit: ["hit", "hit", "hitting", "hits"], cost: ["cost", "cost", "costing", "costs"],
  hear: ["heard", "heard", "hearing", "hears"], win: ["won", "won", "winning", "wins"],
  lose: ["lost", "lost", "losing", "loses"], sell: ["sold", "sold", "selling", "sells"],
  send: ["sent", "sent", "sending", "sends"], spend: ["spent", "spent", "spending", "spends"],
  build: ["built", "built", "building", "builds"], pay: ["paid", "paid", "paying", "pays"],
  hold: ["held", "held", "holding", "holds"], fall: ["fell", "fallen", "falling", "falls"],
  wake: ["woke", "woken", "waking", "wakes"], break: ["broke", "broken", "breaking", "breaks"],
  choose: ["chose", "chosen", "choosing", "chooses"], forget: ["forgot", "forgotten", "forgetting", "forgets"]
};

/* 规则动词变形 */
function verbForms(w) {
  const lw = w.toLowerCase();
  if (IRREGULAR[lw]) {
    const [past, pp, ing, third] = IRREGULAR[lw];
    return { past, ing, third, irregular: true };
  }
  let past, ing, third;
  const endsCons_y = /[^aeiou]y$/.test(lw);
  const cvc = /[^aeiou][aeiou][^aeiouwxy]$/.test(lw) && lw.length <= 5;
  // 过去式
  if (lw.endsWith("e")) past = lw + "d";
  else if (endsCons_y) past = lw.slice(0, -1) + "ied";
  else if (cvc) past = lw + lw.slice(-1) + "ed";
  else past = lw + "ed";
  // 现在分词
  if (lw.endsWith("ie")) ing = lw.slice(0, -2) + "ying";
  else if (lw.endsWith("e") && !lw.endsWith("ee")) ing = lw.slice(0, -1) + "ing";
  else if (cvc) ing = lw + lw.slice(-1) + "ing";
  else ing = lw + "ing";
  // 第三人称单数
  if (/(s|x|z|ch|sh|o)$/.test(lw)) third = lw + "es";
  else if (endsCons_y) third = lw.slice(0, -1) + "ies";
  else third = lw + "s";
  return { past, ing, third, irregular: false };
}

/* ================= 错题本（localStorage） ================= */
const WRONG_KEY = "word_game_wrong_book_v1";
function loadWrongBook() { try { return JSON.parse(localStorage.getItem(WRONG_KEY)) || {}; } catch (e) { return {}; } }
function saveWrongBook(b) { localStorage.setItem(WRONG_KEY, JSON.stringify(b)); }
function addWrong(word, type) {
  const b = loadWrongBook();
  const k = word + "||" + type;
  b[k] = { w: word, t: type, n: (b[k] ? b[k].n : 0) + 1, ts: Date.now() };
  saveWrongBook(b);
}
function removeWrong(word, type) {
  const b = loadWrongBook();
  delete b[word + "||" + type];
  saveWrongBook(b);
}
function updateWrongCount() {
  $("wrong-count").textContent = Object.keys(loadWrongBook()).length;
}

/* ================= 已掌握记录（localStorage） ================= */
const MASTER_KEY = "word_game_master_book_v1";
function loadMasterBook() { try { return JSON.parse(localStorage.getItem(MASTER_KEY)) || {}; } catch (e) { return {}; } }
function saveMasterBook(b) { localStorage.setItem(MASTER_KEY, JSON.stringify(b)); }
function addMaster(word, type) {
  const b = loadMasterBook();
  b[word + "||" + type] = { w: word, t: type, ts: Date.now() };
  saveMasterBook(b);
}
function removeMaster(word, type) {
  const b = loadMasterBook();
  delete b[word + "||" + type];
  saveMasterBook(b);
}
function isMastered(word, type) {
  return !!loadMasterBook()[word + "||" + type];
}
function updateMasterCount() {
  const words = new Set(Object.values(loadMasterBook()).map(e => e.w));
  $("master-count").textContent = words.size;
}

/* ================= 出题引擎 ================= */
const TYPE_NAMES = { spell: "✏️ 拼写题", trans: "🔄 翻译题", tense: "⏰ 时态题" };
let wordPool = [];   // 当前范围内的词
let verbPool = [];   // 当前范围内的动词
const wordMap = {};  // w -> item
WORD_DATA.forEach(x => { wordMap[x.w.toLowerCase()] = x; });

function buildPool(category) {
  wordPool = WORD_DATA.filter(x =>
    (!category || x.cat.includes(category)) && x.w.length >= 2 && /^[a-zA-Z' -]+$/.test(x.w));
  verbPool = wordPool.filter(x => x.v && /^[a-z]+$/i.test(x.w) && x.w.length >= 2);
}

function makeQuestion(type, item) {
  const q = { type, word: item.w, item };
  if (type === "spell") {
    // 拼写题（选择题）：从易混淆的错误拼写中选出正确的
    q.prompt = "「" + item.sm + "」的正确拼写是？";
    q.extra = item.ex.length ? "例句：" + maskWord(item.ex[0][0], item.w) + "<br>" + item.ex[0][1] : "";
    q.answer = item.w;
    q.choices = makeChoices(item.w, fakeSpellings(item.w));
    q.hint = "首字母是 " + item.w[0].toUpperCase() + "，共 " + item.w.length + " 个字母";
  } else if (type === "trans") {
    if (Math.random() < 0.5) {
      // 英译中
      q.prompt = item.w;
      q.extra = item.ex.length ? "例句：" + item.ex[0][0] : "";
      q.answer = item.sm;
      q.choices = makeChoices(item.sm, wordPool.filter(x => x.w !== item.w).map(x => x.sm));
    } else {
      // 中译英
      q.prompt = "「" + item.sm + "」对应的英文单词是？";
      q.extra = "";
      q.answer = item.w;
      q.choices = makeChoices(item.w, wordPool.filter(x => x.w !== item.w).map(x => x.w));
    }
    q.hint = "再想想它的发音和词形～";
  } else if (type === "tense") {
    const f = verbForms(item.w);
    const kinds = [
      { k: "past", name: "过去式", ans: f.past },
      { k: "ing", name: "现在分词（-ing形式）", ans: f.ing },
      { k: "third", name: "第三人称单数", ans: f.third }
    ];
    const kind = pick(kinds);
    q.prompt = "动词 <span class='blank'>" + item.w + "</span> 的" + kind.name + "是？";
    const vMeaning = item.vm || (item.sm.match(/^(v|vt|vi)\./) ? item.sm : "作动词时的变形");
    q.extra = "「" + vMeaning + "」" + (f.irregular ? "　⚠️ 注意：这是不规则变化！" : "");
    q.answer = kind.ans;
    q.choices = makeChoices(kind.ans, fakeTenses(item.w, f, kind.k));
    q.hint = f.irregular ? "不规则动词，要特殊记忆哦" : "按规则变形即可";
    // 时态题只展示包含动词变形的例句，避免出现名词用法的例句
    q.feedbackEx = pickVerbExample(item, f);
  }
  return q;
}

function maskWord(sentence, word) {
  const re = new RegExp("\\b" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\w*\\b", "gi");
  return sentence.replace(re, "____");
}

/* 从例句中挑选包含动词变形（过去式/分词/三单）的句子，找不到则不展示例句 */
function pickVerbExample(item, f) {
  const forms = [];
  [f.past, f.ing, f.third].forEach(x => { if (x) forms.push(...x.split("/")); });
  for (const [en, cn] of item.ex) {
    for (const fm of forms) {
      const re = new RegExp("\\b" + fm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
      if (re.test(en)) return [en, cn];
    }
  }
  return null;
}

/* 生成易混淆的错误拼写（干扰项） */
function fakeSpellings(w) {
  const out = new Set();
  const vowels = "aeiou";
  const lw = w;
  const tries = [
    // 交换相邻两个字母
    () => { const i = 1 + Math.floor(Math.random() * (lw.length - 2)); if (lw[i] === lw[i+1] || lw[i] === " ") return null; return lw.slice(0, i) + lw[i+1] + lw[i] + lw.slice(i+2); },
    // 替换一个元音
    () => { const idxs = [...lw].map((c, i) => vowels.includes(c.toLowerCase()) ? i : -1).filter(i => i > 0); if (!idxs.length) return null; const i = pick(idxs); const v = pick(vowels.replace(lw[i].toLowerCase(), "").split("")); return lw.slice(0, i) + v + lw.slice(i + 1); },
    // 双写/去双写一个字母
    () => { const m = lw.match(/(.)\1/); if (m) return lw.replace(m[0], m[1]); const i = 1 + Math.floor(Math.random() * (lw.length - 1)); if (!/[a-z]/i.test(lw[i])) return null; return lw.slice(0, i + 1) + lw[i] + lw.slice(i + 1); },
    // 删掉一个中间字母
    () => { if (lw.length < 4) return null; const i = 1 + Math.floor(Math.random() * (lw.length - 2)); if (!/[a-z]/i.test(lw[i])) return null; return lw.slice(0, i) + lw.slice(i + 1); }
  ];
  let guard = 0;
  while (out.size < 3 && guard++ < 40) {
    const f = pick(tries);
    const r = f();
    if (r && r.toLowerCase() !== w.toLowerCase()) out.add(r);
  }
  return [...out];
}

/* 生成时态干扰项：其他正确变形 + 常见错误变形 */
function fakeTenses(w, f, kind) {
  const lw = w.toLowerCase();
  const cands = new Set();
  // 其他变形作干扰
  [f.past, f.ing, f.third, lw].forEach(x => cands.add(x));
  // 常见错误：不规则动词被规则化
  cands.add(lw + "ed");
  cands.add(lw + "ing");
  cands.add(lw + "s");
  if (lw.endsWith("e")) { cands.add(lw + "d"); cands.add(lw.slice(0, -1) + "ing"); }
  // 双写尾字母的错误形式
  cands.add(lw + lw.slice(-1) + "ed");
  cands.add(lw + lw.slice(-1) + "ing");
  const ans = kind === "past" ? f.past : kind === "ing" ? f.ing : f.third;
  cands.delete(ans);
  return shuffle([...cands]).slice(0, 6);
}
function makeChoices(answer, others) {
  const wrongs = shuffle([...new Set(others.filter(x => x && x !== answer))]).slice(0, 3);
  return shuffle([answer, ...wrongs]);
}

/* ================= 游戏状态 ================= */
let queue = [];        // 待答题队列
let current = null;    // 当前题
let answered = false;
let stats = null;
let sessionModes = [];

function newSession(fromWrongBook) {
  const modes = [];
  if ($("mode-spell").checked) modes.push("spell");
  if ($("mode-trans").checked) modes.push("trans");
  if ($("mode-tense").checked) modes.push("tense");
  if (!modes.length) { alert("请至少选择一种题型！"); return; }
  sessionModes = modes;

  const category = $("sel-category").value;
  buildPool(category);
  if (wordPool.length < 8) { alert("该范围单词太少，请换一个范围"); return; }

  const count = parseInt(document.querySelector("input[name=qcount]:checked").value);
  queue = [];

  if (fromWrongBook) {
    const book = Object.values(loadWrongBook()).sort((a, b) => b.n - a.n || b.ts - a.ts);
    if (!book.length) { alert("错题本是空的，先去闯关吧！"); return; }
    buildPool("");
    for (const e of book.slice(0, count)) {
      const item = wordMap[e.w.toLowerCase()];
      if (!item) continue;
      if (e.t === "tense" && !item.v) continue;
      queue.push(makeQuestion(e.t, item));
    }
    if (!queue.length) { alert("错题本中的单词不在词库里了"); return; }
  } else {
    const usable = modes.filter(m => m !== "tense" || verbPool.length >= 4);
    // 优先混入几道历史错题（占比约1/4）
    const book = Object.values(loadWrongBook());
    const mixCount = Math.min(Math.floor(count / 4), book.length);
    const mixed = shuffle(book).slice(0, mixCount);
    for (const e of mixed) {
      const item = wordMap[e.w.toLowerCase()];
      if (!item || !usable.includes(e.t)) continue;
      if (e.t === "tense" && !item.v) continue;
      const q = makeQuestion(e.t, item);
      q.fromBook = true;
      queue.push(q);
    }
    const usedWords = new Set(queue.map(q => q.word));
    let guard = 0;
    // 第一轮：只抽"未掌握"的词
    while (queue.length < count && guard++ < count * 30) {
      const m = pick(usable);
      const item = m === "tense" ? pick(verbPool) : pick(wordPool);
      if (!item || usedWords.has(item.w)) continue;
      if (isMastered(item.w, m)) continue;
      usedWords.add(item.w);
      queue.push(makeQuestion(m, item));
    }
    // 第二轮兜底：生词不够时，回收已掌握的词凑数
    guard = 0;
    while (queue.length < count && guard++ < count * 30) {
      const m = pick(usable);
      const item = m === "tense" ? pick(verbPool) : pick(wordPool);
      if (!item || usedWords.has(item.w)) continue;
      usedWords.add(item.w);
      queue.push(makeQuestion(m, item));
    }
    queue = shuffle(queue);
  }

  stats = { total: queue.length, done: 0, correct: 0, wrong: 0, score: 0, streak: 0, maxStreak: 0, wrongList: [], retried: new Set() };
  showScreen("quiz");
  nextQuestion();
}

/* ================= 答题流程 ================= */
function nextQuestion() {
  if (!queue.length) { endSession(); return; }
  current = queue.shift();
  answered = false;

  $("q-type-badge").textContent = TYPE_NAMES[current.type];
  $("q-retry-badge").style.display = (current.retry || current.fromBook) ? "inline-block" : "none";
  $("q-retry-badge").textContent = current.retry ? "🔁 错题重现" : "📕 来自错题本";
  $("q-prompt").innerHTML = current.prompt;
  $("q-extra").innerHTML = current.extra || "";
  $("feedback").innerHTML = "";
  $("btn-next").style.display = "none";
  $("btn-hint").style.display = "inline-block";

  const total = stats.total;
  $("quiz-progress").textContent = (stats.done + 1) + " / " + Math.max(total, stats.done + 1 + queue.length);
  $("quiz-score").textContent = "⭐ " + stats.score;
  $("quiz-streak").textContent = "🔥 " + stats.streak;
  $("progress-bar").style.width = (stats.done / Math.max(total, stats.done + 1 + queue.length) * 100) + "%";

  if (current.inputMode) {
    // 已全部改为选择题，保留兜底
    current.choices = current.choices || makeChoices(current.answer, []);
  }
  const box = $("answer-choices");
  box.innerHTML = "";
  current.choices.forEach(c => {
    const b = document.createElement("button");
    b.className = "choice-btn";
    b.textContent = c;
    b.onclick = () => submitAnswer(c, b);
    box.appendChild(b);
  });
}

function submitAnswer(val, btnEl) {
  if (answered) return;
  answered = true;
  $("btn-hint").style.display = "none";

  const ok = val === current.answer;

  stats.done++;
  if (ok) {
    stats.correct++;
    stats.streak++;
    stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
    stats.score += 10 + Math.min(stats.streak - 1, 5) * 2;
    const fbEx = current.type === "tense" ? current.feedbackEx : (current.item.ex.length ? current.item.ex[0] : null);
    $("feedback").innerHTML = pick(["🎉 太棒了！", "✅ 答对啦！", "👍 真厉害！", "🌟 完全正确！"]) +
      (fbEx ? "<span class='detail'>" + fbEx[0] + "　" + fbEx[1] + "</span>" : "");
    if (current.retry || current.fromBook) removeWrong(current.word, current.type);
    // 一次答对（非错题重现）即记为已掌握，后续出题不再优先出现
    if (!current.retry) addMaster(current.word, current.type);
  } else {
    stats.wrong++;
    stats.streak = 0;
    removeMaster(current.word, current.type);
    const wrongMeaning = current.type === "tense" ? (current.item.vm || current.item.sm) : current.item.sm;
    $("feedback").innerHTML = "❌ 正确答案：<u>" + current.answer + "</u>" +
      "<span class='detail'>" + current.word + " —— " + wrongMeaning + "</span>";
    addWrong(current.word, current.type);
    stats.wrongList.push({ w: current.word, t: current.type, ans: current.answer });
    // 错题稍后重现：插回队列靠后位置（每题最多重现2次）
    const key = current.word + "|" + current.type;
    const times = (stats.retried.has(key + "#2")) ? 2 : (stats.retried.has(key) ? 1 : 0);
    if (times < 2) {
      stats.retried.add(times === 0 ? key : key + "#2");
      const rq = makeQuestion(current.type, current.item);
      rq.retry = true;
      const pos = Math.min(queue.length, 2 + Math.floor(Math.random() * 3));
      queue.splice(pos, 0, rq);
    }
  }

  document.querySelectorAll(".choice-btn").forEach(b => {
    b.disabled = true;
    if (b.textContent === current.answer) b.classList.add("correct");
    else if (b === btnEl) b.classList.add("wrong");
  });
  $("quiz-score").textContent = "⭐ " + stats.score;
  $("quiz-streak").textContent = "🔥 " + stats.streak;
  $("btn-next").style.display = "block";
  $("btn-next").focus();
  updateWrongCount();
  updateMasterCount();
}

function endSession() {
  const rate = stats.done ? Math.round(stats.correct / stats.done * 100) : 0;
  $("result-title").textContent = rate >= 90 ? "🏆 完美通关！" : rate >= 70 ? "🎉 闯关成功！" : "💪 继续加油！";
  $("r-score").textContent = stats.score;
  $("r-correct").textContent = stats.correct;
  $("r-wrong").textContent = stats.wrong;
  $("r-rate").textContent = rate + "%";
  $("r-streak").textContent = stats.maxStreak;

  const uniq = {};
  stats.wrongList.forEach(e => { uniq[e.w + e.t] = e; });
  const list = Object.values(uniq);
  if (list.length) {
    $("r-wrong-card").style.display = "block";
    $("r-wrong-list").innerHTML = list.map(e =>
      "<li><b>" + e.w + "</b>（" + TYPE_NAMES[e.t] + "）正确答案：" + e.ans + "</li>").join("");
  } else {
    $("r-wrong-card").style.display = "none";
  }
  showScreen("result");
  updateWrongCount();
}

/* ================= 界面切换与初始化 ================= */
function showScreen(name) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $("screen-" + name).classList.add("active");
}

function init() {
  const sel = $("sel-category");
  ALL_CATEGORIES.forEach(c => {
    const o = document.createElement("option");
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  });
  updateWrongCount();
  updateMasterCount();

  $("btn-start").onclick = () => newSession(false);
  $("btn-review").onclick = () => newSession(true);
  $("btn-clear-wrong").onclick = () => {
    if (confirm("确定清空错题本吗？")) { saveWrongBook({}); updateWrongCount(); }
  };
  $("btn-clear-master").onclick = () => {
    if (confirm("确定重置学习进度吗？所有单词将重新进入出题范围。")) { saveMasterBook({}); updateMasterCount(); }
  };
  document.addEventListener("keydown", e => {
    if (e.key === "Enter" && answered && $("screen-quiz").classList.contains("active")) $("btn-next").click();
  });
  $("btn-next").onclick = nextQuestion;
  $("btn-quit").onclick = endSession;
  $("btn-again").onclick = () => showScreen("start");
  $("btn-home").onclick = () => showScreen("start");
  $("btn-hint").onclick = () => {
    $("feedback").innerHTML = "💡 " + (current ? current.hint : "");
  };
}
init();
