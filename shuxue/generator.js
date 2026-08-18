/* ============================================================
 * 数学题目生成引擎
 * 每个生成函数返回统一结构：
 * {
 *   type:    题型内部标识
 *   typeName:题型中文名（badge 展示）
 *   prompt:  题面（主展示，等号右侧留待作答）
 *   extra:   补充说明/提示口诀（可空）
 *   answer:  正确答案（字符串，用于比对与去重）
 *   choices: 四个选项字符串数组（已含正确答案，顺序待打乱）
 *   hint:    点击"提示"时展示的解题思路
 *   key:     题目去重用的唯一标识
 * }
 * ============================================================ */
(function (global) {
  "use strict";

  // ---------- 工具函数 ----------
  function ri(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 从正确数值答案生成 3 个不重复的干扰项（数值型）
  function numDistractors(correct, count, spread) {
    const set = new Set([correct]);
    const out = [];
    let guard = 0;
    while (out.length < count && guard < 200) {
      guard++;
      const delta = ri(1, spread) * (Math.random() < 0.5 ? -1 : 1);
      const cand = correct + delta;
      if (!set.has(cand)) { set.add(cand); out.push(cand); }
    }
    // 兜底：若仍不足，顺延填充
    let d = 1;
    while (out.length < count) {
      if (!set.has(correct + d)) { set.add(correct + d); out.push(correct + d); }
      d++;
    }
    return out;
  }

  function buildNumChoices(correct, spread) {
    const distractors = numDistractors(correct, 3, spread || Math.max(5, Math.round(Math.abs(correct) * 0.15) + 3));
    return shuffle([correct, ...distractors].map(String));
  }

  // 从若干候选表达式字符串里构造选项（表达式型，去重）
  function buildStrChoices(correct, wrongPool) {
    const seen = new Set([correct]);
    const wrongs = [];
    for (const w of shuffle(wrongPool)) {
      if (wrongs.length >= 3) break;
      if (!seen.has(w)) { seen.add(w); wrongs.push(w); }
    }
    let idx = 0;
    while (wrongs.length < 3) {
      const filler = correct + " + " + (++idx);
      if (!seen.has(filler)) { seen.add(filler); wrongs.push(filler); }
    }
    return shuffle([correct, ...wrongs]);
  }

  // ============================================================
  // 题型 1：简单口算（加减乘除）
  // ============================================================
  function genMental(level) {
    const ops = level === 1 ? ["+", "-", "×"] : ["+", "-", "×", "÷"];
    const op = pick(ops);
    let a, b, ans, prompt;
    if (op === "+") {
      const max = level === 1 ? 50 : level === 2 ? 100 : 999;
      a = ri(2, max); b = ri(2, max); ans = a + b;
      prompt = `${a} + ${b} = ?`;
    } else if (op === "-") {
      const max = level === 1 ? 50 : level === 2 ? 100 : 999;
      a = ri(10, max); b = ri(1, a); ans = a - b;
      prompt = `${a} − ${b} = ?`;
    } else if (op === "×") {
      const m = level === 1 ? 9 : level === 2 ? 12 : 20;
      a = ri(2, m); b = ri(2, m); ans = a * b;
      prompt = `${a} × ${b} = ?`;
    } else {
      const m = level === 2 ? 9 : 12;
      b = ri(2, m); ans = ri(2, m); a = b * ans;
      prompt = `${a} ÷ ${b} = ?`;
    }
    return {
      type: "mental", typeName: "简单口算",
      prompt, extra: "",
      answer: String(ans),
      choices: buildNumChoices(ans),
      hint: "按四则运算规则直接计算即可。",
      key: `mental:${prompt}`
    };
  }

  // ============================================================
  // 题型 2：乘法简便运算（凑整、拆分、乘法分配律）
  // ============================================================
  function genFastMul(level) {
    const kind = pick(["near100", "times5", "distribute"]);
    let a, b, ans, prompt, hint;

    if (kind === "near100") {
      // 接近整十/整百：如 98 × 5 = (100 − 2) × 5
      const base = pick([10, 100]);
      const near = base - pick([1, 2, 3]);
      const mul = ri(3, 9);
      a = near; b = mul; ans = a * b;
      prompt = `${a} × ${b} = ?`;
      hint = `把 ${a} 看成 (${base} − ${base - a})，再用乘法分配律：${base}×${b} − ${base - a}×${b}。`;
    } else if (kind === "times5") {
      // ×5 = ×10 ÷2；×25 = ×100 ÷4
      const factor = level >= 2 ? pick([5, 25]) : 5;
      a = factor === 5 ? ri(6, 40) * 2 : ri(2, 16) * 2; // 保证结果整齐
      b = factor; ans = a * b;
      prompt = `${a} × ${b} = ?`;
      hint = factor === 5
        ? `×5 = ×10÷2，即 ${a}×10÷2 = ${a * 10}÷2。`
        : `×25 = ×100÷4，即 ${a}×100÷4 = ${a * 100}÷4。`;
    } else {
      // 乘法分配律：a×(b+c)，如 12×101 = 12×100 + 12×1
      a = ri(3, 25);
      const b100 = pick([100, 1000]);
      const extra = pick([1, 2, 3]);
      b = b100 + extra; ans = a * b;
      prompt = `${a} × ${b} = ?`;
      hint = `${a}×${b} = ${a}×${b100} + ${a}×${extra} = ${a * b100} + ${a * extra}。`;
    }

    return {
      type: "fastmul", typeName: "乘法简算",
      prompt, extra: "💡 想想怎样凑整最快",
      answer: String(ans),
      choices: buildNumChoices(ans, Math.max(10, Math.round(ans * 0.05))),
      hint,
      key: `fastmul:${prompt}`
    };
  }

  // ============================================================
  // 题型 3：括号运算（先算括号内）
  // ============================================================
  function genParen(level) {
    const style = pick(["ab_c", "a_bc", "abc"]);
    let prompt, ans, hint;
    const max = level === 1 ? 20 : level === 2 ? 50 : 99;

    if (style === "ab_c") {
      // (a + b) × c   或  (a − b) × c
      const op = pick(["+", "-"]);
      let a = ri(2, max), b = ri(1, max), c = ri(2, level === 1 ? 6 : 9);
      if (op === "-" && b > a) [a, b] = [b, a];
      const inner = op === "+" ? a + b : a - b;
      ans = inner * c;
      prompt = `(${a} ${op === "+" ? "+" : "−"} ${b}) × ${c} = ?`;
      hint = `先算括号：${a}${op}${b} = ${inner}，再 ×${c}。`;
    } else if (style === "a_bc") {
      // a × (b + c)  含乘法分配律味道
      let a = ri(2, level === 1 ? 6 : 9), b = ri(2, max), c = ri(2, max);
      const op = pick(["+", "-"]);
      if (op === "-" && c > b) [b, c] = [c, b];
      const inner = op === "+" ? b + c : b - c;
      ans = a * inner;
      prompt = `${a} × (${b} ${op === "+" ? "+" : "−"} ${c}) = ?`;
      hint = `先算括号：${b}${op}${c} = ${inner}，再 ×${a}。`;
    } else {
      // a + b × (c − d) 混合，考察运算顺序
      let a = ri(2, max), b = ri(2, level === 1 ? 5 : 9), c = ri(4, max), d = ri(1, c - 1);
      const inner = c - d;
      ans = a + b * inner;
      prompt = `${a} + ${b} × (${c} − ${d}) = ?`;
      hint = `先括号 ${c}−${d} = ${inner}，再乘 ${b}×${inner} = ${b * inner}，最后加 ${a}。`;
    }

    return {
      type: "paren", typeName: "括号运算",
      prompt, extra: "🔢 先算括号里的",
      answer: String(ans),
      choices: buildNumChoices(ans, Math.max(6, Math.round(Math.abs(ans) * 0.12))),
      hint,
      key: `paren:${prompt}`
    };
  }

  // ============================================================
  // 题型 4：括号拆除（去括号 / 展开）
  // ============================================================
  function fmtTerm(coef, varName, first) {
    // 格式化一个代数项，first 表示是否为表达式首项
    let s;
    const sign = coef < 0 ? "−" : "+";
    const abs = Math.abs(coef);
    const body = varName ? (abs === 1 ? varName : abs + varName) : String(abs);
    if (first) {
      s = (coef < 0 ? "−" : "") + body;
    } else {
      s = ` ${sign} ${body}`;
    }
    return s;
  }

  function polyToStr(terms) {
    // terms: [{coef, var}]  var 为 "" 表示常数项
    let out = "";
    let first = true;
    for (const t of terms) {
      if (t.coef === 0) continue;
      out += fmtTerm(t.coef, t.var, first);
      first = false;
    }
    return out === "" ? "0" : out;
  }

  function genExpand(level) {
    const kind = pick(["mulParen", "minusParen"]);
    let prompt, ansTerms, hint;

    if (kind === "mulParen") {
      // k(x + b)  或  k(ax + b)
      const k = ri(2, level === 1 ? 5 : 9);
      const a = level === 1 ? 1 : ri(1, 4);
      const b = ri(-9, 9) || 2;
      const aStr = a === 1 ? "x" : a + "x";
      prompt = `${k}(${polyToStr([{ coef: a, var: "x" }, { coef: b, var: "" }])}) = ?`;
      ansTerms = [{ coef: k * a, var: "x" }, { coef: k * b, var: "" }];
      hint = `用分配律：${k}×${aStr} 和 ${k}×(${b})，分别乘进括号。`;
    } else {
      // a − (bx + c) 去括号变号
      const a = ri(2, 20);
      const b = ri(1, 6);
      const c = ri(-9, 9) || 3;
      prompt = `${a} − (${polyToStr([{ coef: b, var: "x" }, { coef: c, var: "" }])}) = ?`;
      ansTerms = [{ coef: -b, var: "x" }, { coef: a - c, var: "" }];
      hint = `括号前是"−"，去括号后括号里每一项都要变号：−${b}x ${c >= 0 ? "−" : "+"} ${Math.abs(c)}，再与 ${a} 合并常数。`;
    }

    const answer = polyToStr(ansTerms);

    // 干扰项：常见错误——漏乘常数、去括号忘变号、系数算错
    const wrongPool = [];
    if (kind === "mulParen") {
      // 漏乘常数项
      const k = parseInt(prompt);
      wrongPool.push(polyToStr([{ coef: ansTerms[0].coef, var: "x" }, { coef: Math.round(ansTerms[1].coef / (k || 1)), var: "" }]));
    }
    // 常数项 +/- 偏移
    wrongPool.push(polyToStr([{ coef: ansTerms[0].coef, var: "x" }, { coef: ansTerms[1].coef + ri(1, 4), var: "" }]));
    wrongPool.push(polyToStr([{ coef: ansTerms[0].coef + (Math.random() < .5 ? 1 : -1), var: "x" }, { coef: ansTerms[1].coef, var: "" }]));
    // 符号错误
    wrongPool.push(polyToStr([{ coef: -ansTerms[0].coef, var: "x" }, { coef: ansTerms[1].coef, var: "" }]));
    wrongPool.push(polyToStr([{ coef: ansTerms[0].coef, var: "x" }, { coef: -ansTerms[1].coef, var: "" }]));

    return {
      type: "expand", typeName: "括号拆除",
      prompt, extra: "📂 去括号 · 注意符号与分配律",
      answer,
      choices: buildStrChoices(answer, wrongPool),
      hint,
      key: `expand:${prompt}`
    };
  }

  // ============================================================
  // 题型 5：含字母表达式变形（合并同类项 / 提取公因式）
  // ============================================================
  function genAlgebra(level) {
    const kind = pick(["combine", "factor"]);
    let prompt, answer, hint, wrongPool = [];

    if (kind === "combine") {
      // 合并同类项：ax + b + cx + d
      const a = ri(1, 6), c = ri(1, 6), b = ri(-9, 9) || 2, d = ri(-9, 9) || 3;
      const terms = [
        { coef: a, var: "x" }, { coef: b, var: "" },
        { coef: c, var: "x" }, { coef: d, var: "" }
      ];
      prompt = polyToStr(terms) + " = ?";
      const merged = [{ coef: a + c, var: "x" }, { coef: b + d, var: "" }];
      answer = polyToStr(merged);
      hint = `把含 x 的项相加：${a}x+${c}x=${a + c}x；常数相加：${b}+(${d})=${b + d}。`;
      // 干扰项：把 x 项与常数错误相加、系数偏差
      wrongPool.push(polyToStr([{ coef: a + c, var: "x" }, { coef: b + d + ri(1, 3), var: "" }]));
      wrongPool.push(polyToStr([{ coef: a + c + 1, var: "x" }, { coef: b + d, var: "" }]));
      wrongPool.push(polyToStr([{ coef: a + c, var: "x" }, { coef: b - d, var: "" }]));
      wrongPool.push(String(a + c + b + d) + "x"); // 把常数也当 x
    } else {
      // 提取公因式：kax + kb  ->  k(ax + b)
      const k = ri(2, 6);
      const a = ri(1, 4), b = ri(1, 6);
      prompt = polyToStr([{ coef: k * a, var: "x" }, { coef: k * b, var: "" }]) + " = ?";
      const inner = polyToStr([{ coef: a, var: "x" }, { coef: b, var: "" }]);
      answer = `${k}(${inner})`;
      hint = `找出公因数 ${k}：${k * a}x=${k}×${a}x，${k * b}=${k}×${b}，提到括号外。`;
      wrongPool.push(`${k}(${polyToStr([{ coef: a, var: "x" }, { coef: b + 1, var: "" }])})`);
      wrongPool.push(`${k + 1}(${polyToStr([{ coef: a, var: "x" }, { coef: b, var: "" }])})`);
      wrongPool.push(`${k}(${polyToStr([{ coef: a + 1, var: "x" }, { coef: b, var: "" }])})`);
      wrongPool.push(polyToStr([{ coef: k * a, var: "x" }, { coef: k * b, var: "" }])); // 没提取
    }

    return {
      type: "algebra", typeName: "表达式变形",
      prompt, extra: "🔤 合并同类项 / 提公因式",
      answer,
      choices: buildStrChoices(answer, wrongPool),
      hint,
      key: `algebra:${prompt}`
    };
  }

  // ============================================================
  // 题型 6：方程转换（解一元一次方程 / 移项求解）
  // ============================================================
  function genEquation(level) {
    // 生成 ax + b = c 或 ax + b = dx + e，保证 x 为整数
    const kind = level >= 2 && Math.random() < 0.5 ? "twoSide" : "oneSide";
    let prompt, x, hint, a;

    if (kind === "oneSide") {
      // a x + b = c
      a = ri(2, level === 1 ? 6 : 12);
      x = ri(-9, 12);
      const b = ri(-15, 15);
      const c = a * x + b;
      prompt = `${polyToStr([{ coef: a, var: "x" }])} ${b >= 0 ? "+ " + b : "− " + Math.abs(b)} = ${c}，  x = ?`;
      hint = `移项：${a}x = ${c} ${b >= 0 ? "−" : "+"} ${Math.abs(b)} = ${c - b}，再除以 ${a}。`;
    } else {
      // a x + b = d x + e
      a = ri(3, 12);
      let d = ri(1, a - 1); // 保证 a-d>0 且整除
      x = ri(-8, 12);
      const b = ri(-12, 12);
      const e = (a - d) * x + b;
      prompt = `${polyToStr([{ coef: a, var: "x" }])} ${b >= 0 ? "+ " + b : "− " + Math.abs(b)} = ${polyToStr([{ coef: d, var: "x" }])} ${e >= 0 ? "+ " + e : "− " + Math.abs(e)}，  x = ?`;
      hint = `含 x 项移到左边：${a}x−${d}x=(${a - d})x，常数移到右边：${e}−(${b})=${e - b}，再除以 ${a - d}。`;
    }

    const answer = String(x);
    return {
      type: "equation", typeName: "解方程",
      prompt, extra: "⚖️ 移项 · 系数化为 1",
      answer,
      choices: buildNumChoices(x, Math.max(3, Math.abs(x) + 2)),
      hint,
      key: `equation:${prompt}`
    };
  }

  // ---------- 分发表 ----------
  const GENERATORS = {
    mental: genMental,
    fastmul: genFastMul,
    paren: genParen,
    expand: genExpand,
    algebra: genAlgebra,
    equation: genEquation
  };

  const TYPE_NAMES = {
    mental: "简单口算",
    fastmul: "乘法简算",
    paren: "括号运算",
    expand: "括号拆除",
    algebra: "表达式变形",
    equation: "解方程"
  };

  // 生成一批不重复的题目
  function generateQuestions(types, level, count) {
    if (!types || types.length === 0) types = Object.keys(GENERATORS);
    const out = [];
    const seen = new Set();
    let guard = 0;
    while (out.length < count && guard < count * 40) {
      guard++;
      const t = pick(types);
      const q = GENERATORS[t](level);
      if (seen.has(q.key)) continue;
      // 保证四个选项互不相同
      const uniq = new Set(q.choices);
      if (uniq.size < 4) continue;
      seen.add(q.key);
      out.push(q);
    }
    return out;
  }

  global.MathGen = {
    generateQuestions,
    GENERATORS,
    TYPE_NAMES,
    // 供错题本按 key 重建同题（错题本存储的是完整题目对象，这里保留接口）
    _utils: { ri, pick, shuffle }
  };
})(window);
