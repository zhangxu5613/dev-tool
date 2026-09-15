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
      if (level >= 3) {
        // 挑战：一位数 × 两位数
        a = ri(2, 9); b = ri(12, 99); ans = a * b;
      } else {
        const m = level === 1 ? 9 : 12;
        a = ri(2, m); b = ri(2, m); ans = a * b;
      }
      prompt = `${a} × ${b} = ?`;
    } else {
      if (level >= 3) {
        // 挑战：两位数商 ÷ 更大除数
        b = ri(3, 12); ans = ri(12, 25); a = b * ans;
      } else {
        b = ri(2, 9); ans = ri(2, 9); a = b * ans;
      }
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
      const base = level >= 3 ? pick([100, 1000]) : pick([10, 100]);
      const near = base - pick(level >= 3 ? [1, 2, 3, 4, 5] : [1, 2, 3]);
      const mul = level >= 3 ? ri(4, 19) : ri(3, 9);
      a = near; b = mul; ans = a * b;
      prompt = `${a} × ${b} = ?`;
      hint = `把 ${a} 看成 (${base} − ${base - a})，再用乘法分配律：${base}×${b} − ${base - a}×${b}。`;
    } else if (kind === "times5") {
      // ×5 = ×10 ÷2；×25 = ×100 ÷4；×125 = ×1000 ÷8
      const factor = level >= 3 ? pick([5, 25, 125]) : level >= 2 ? pick([5, 25]) : 5;
      a = factor === 5 ? ri(6, level >= 3 ? 90 : 40) * 2
        : factor === 25 ? ri(2, level >= 3 ? 40 : 16) * 2
        : ri(2, 12) * 8; // ×125 保证结果整齐
      b = factor; ans = a * b;
      prompt = `${a} × ${b} = ?`;
      hint = factor === 5
        ? `×5 = ×10÷2，即 ${a}×10÷2 = ${a * 10}÷2。`
        : factor === 25
          ? `×25 = ×100÷4，即 ${a}×100÷4 = ${a * 100}÷4。`
          : `×125 = ×1000÷8，即 ${a}×1000÷8 = ${a * 1000}÷8。`;
    } else {
      // 乘法分配律：a×(b+c)，如 12×101 = 12×100 + 12×1
      a = level >= 3 ? ri(11, 99) : ri(3, 25);
      const b100 = pick([100, 1000]);
      const extra = pick(level >= 3 ? [1, 2, 3, 4, 5, 9] : [1, 2, 3]);
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
      let a = ri(2, max), b = ri(1, max), c = ri(2, level === 1 ? 6 : level === 2 ? 9 : 15);
      if (op === "-" && b > a) [a, b] = [b, a];
      const inner = op === "+" ? a + b : a - b;
      ans = inner * c;
      prompt = `(${a} ${op === "+" ? "+" : "−"} ${b}) × ${c} = ?`;
      hint = `先算括号：${a}${op}${b} = ${inner}，再 ×${c}。`;
    } else if (style === "a_bc") {
      // a × (b + c)  含乘法分配律味道
      let a = ri(2, level === 1 ? 6 : level === 2 ? 9 : 15), b = ri(2, max), c = ri(2, max);
      const op = pick(["+", "-"]);
      if (op === "-" && c > b) [b, c] = [c, b];
      const inner = op === "+" ? b + c : b - c;
      ans = a * inner;
      prompt = `${a} × (${b} ${op === "+" ? "+" : "−"} ${c}) = ?`;
      hint = `先算括号：${b}${op}${c} = ${inner}，再 ×${a}。`;
    } else {
      // a + b × (c − d) 混合，考察运算顺序
      let a = ri(2, max), b = ri(2, level === 1 ? 5 : level === 2 ? 9 : 15), c = ri(4, max), d = ri(1, c - 1);
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
      const k = level >= 3 ? ri(6, 19) : ri(2, level === 1 ? 5 : 9);
      const a = level === 1 ? 1 : level === 2 ? ri(1, 4) : ri(2, 9);
      const b = level >= 3 ? (ri(-19, 19) || 5) : (ri(-9, 9) || 2);
      const aStr = a === 1 ? "x" : a + "x";
      prompt = `${k}(${polyToStr([{ coef: a, var: "x" }, { coef: b, var: "" }])}) = ?`;
      ansTerms = [{ coef: k * a, var: "x" }, { coef: k * b, var: "" }];
      hint = `用分配律：${k}×${aStr} 和 ${k}×(${b})，分别乘进括号。`;
    } else {
      // a − (bx + c) 去括号变号
      const a = level >= 3 ? ri(10, 60) : ri(2, 20);
      const b = level >= 3 ? ri(3, 12) : ri(1, 6);
      const c = level >= 3 ? (ri(-19, 19) || 7) : (ri(-9, 9) || 3);
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
      const m = level >= 3 ? 15 : 6;
      const n = level >= 3 ? 19 : 9;
      const a = ri(1, m), c = ri(1, m), b = ri(-n, n) || 2, d = ri(-n, n) || 3;
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
      // 提取公因式：kax + kb  ->  k(ax + b)，保证括号内互质
      const gcd = (x, y) => y ? gcd(y, x % y) : x;
      const k = level >= 3 ? ri(4, 12) : ri(2, 6);
      let a = level >= 3 ? ri(2, 9) : ri(1, 4), b = level >= 3 ? ri(2, 12) : ri(1, 6);
      while (gcd(a, b) > 1) b = level >= 3 ? ri(2, 12) : ri(1, 6);
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
    const kind = level >= 2 && Math.random() < (level >= 3 ? 0.7 : 0.5) ? "twoSide" : "oneSide";
    let prompt, x, hint, a;

    if (kind === "oneSide") {
      // a x + b = c
      a = ri(2, level === 1 ? 6 : level === 2 ? 12 : 19);
      x = level >= 3 ? ri(-15, 20) : ri(-9, 12);
      const b = level >= 3 ? ri(-30, 30) : ri(-15, 15);
      const c = a * x + b;
      prompt = `${polyToStr([{ coef: a, var: "x" }])} ${b >= 0 ? "+ " + b : "− " + Math.abs(b)} = ${c}，  x = ?`;
      hint = `移项：${a}x = ${c} ${b >= 0 ? "−" : "+"} ${Math.abs(b)} = ${c - b}，再除以 ${a}。`;
    } else {
      // a x + b = d x + e
      a = level >= 3 ? ri(5, 19) : ri(3, 12);
      let d = ri(1, a - 1); // 保证 a-d>0 且整除
      x = level >= 3 ? ri(-12, 18) : ri(-8, 12);
      const b = level >= 3 ? ri(-25, 25) : ri(-12, 12);
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

  // ============================================================
  // 题型 7：小数加减法（按难度分档）
  //   简单：1 位整数 + 1 位小数，单步加或减      （如 7.3 + 5.8）
  //   中等：2 位整数 + 2 位小数，单步加或减      （如 46.75 − 18.36）
  //   挑战：2 位整数 + 2 位小数，三数加减混合    （如 31.77 + 28.39 − 24.86）
  // 全程以最小单位（0.1 或 0.01）的整数做运算，避免浮点误差
  // 干扰项：模拟竖式计算中"忘记进位 / 忘记借位"的典型错误，
  // 并让错误从出错的那一步传播到最终答案
  // ============================================================

  // 整数单位值 → 小数字符串。dp = 小数位数（1 或 2）
  function fmtScaled(v, dp) {
    const base = dp === 1 ? 10 : 100;
    const int = Math.floor(v / base), frac = v % base;
    return int + "." + String(frac).padStart(dp, "0");
  }

  // 各数位中文名（由最低位往高位）：dp=2 → [百分位, 十分位, 个位, 十位]
  function digitNames(dp) {
    return dp === 2
      ? ["百分位", "十分位", "个位", "十位"]
      : ["十分位", "个位", "十位"];
  }

  // 单步竖式计算。返回 { result, wrongs: [{v, why}] }
  // wrongs：这一步"忘记进位/借位"会得到的错误结果（仅收集纯单点错误）
  // 通用于任意小数位数：逐位模拟，第 i 位向第 i+1 位的进/借位被遗漏时结果的偏差
  function decimalStep(cur, op, x, dp) {
    const wrongs = [];
    const names = digitNames(dp);
    const digit = (n, i) => Math.floor(n / Math.pow(10, i)) % 10;
    // 最高需要检查的位：进/借位只可能发生在两数实际拥有的数位上
    const maxPos = names.length - 1;

    if (op === "+") {
      const result = cur + x;
      let carry = 0;
      for (let i = 0; i < maxPos; i++) {
        const s = digit(cur, i) + digit(x, i) + carry;
        if (s >= 10) {
          // 该位满 10 需向上一位进 1；遗漏则结果少 10^(i+1)
          wrongs.push({
            v: result - Math.pow(10, i + 1),
            why: `${names[i]}相加满 10，要向${names[i + 1]}进 1`
          });
          // 进位加错位置：把进上去的 1 又留在了本位
          wrongs.push({
            v: result - Math.pow(10, i + 1) + Math.pow(10, i),
            why: `${names[i]}进位的 1 要加到${names[i + 1]}，不能留在${names[i]}`,
            weak: true
          });
          carry = 1;
        } else {
          // 该位未满 10 却多进了 1（进位判断做反）
          wrongs.push({
            v: result + Math.pow(10, i + 1),
            why: `${names[i]}相加未满 10，不该向${names[i + 1]}进位`,
            weak: true
          });
          carry = 0;
        }
      }
      return { result, wrongs };
    }

    // 减法（题目保证 cur >= x）
    const result = cur - x;
    let borrow = 0;
    for (let i = 0; i < maxPos; i++) {
      const top = digit(cur, i) - borrow;
      const bot = digit(x, i);
      if (top < bot) {
        // 该位不够减需向上一位借 1；只有上一位本身够减时，遗漏才是纯单点错误
        const upTop = digit(cur, i + 1), upBot = digit(x, i + 1);
        if (upTop - upBot >= 0) {
          wrongs.push({
            v: result + Math.pow(10, i + 1),
            why: `${names[i]}不够减，要向${names[i + 1]}借 1`
          });
          // 借位后本位应加 10，只加了 1
          wrongs.push({
            v: result - 9 * Math.pow(10, i),
            why: `向${names[i + 1]}借 1，${names[i]}要加 10 再减`,
            weak: true
          });
        }
        borrow = 1;
      } else {
        // 该位够减却多借了 1（借位判断做反）
        wrongs.push({
          v: result - Math.pow(10, i + 1),
          why: `${names[i]}够减，不用向${names[i + 1]}借位`,
          weak: true
        });
        borrow = 0;
      }
    }
    return { result, wrongs };
  }

  function genDecimal(level) {
    // 难度参数：小数位数、整数部分范围、运算步数
    const dp = level === 1 ? 1 : 2;                 // 小数位数
    const base = dp === 1 ? 10 : 100;               // 最小单位换算基数
    const steps = level >= 3 ? 2 : 1;               // 运算步数（1=两数，2=三数混合）
    const intMin = 1;
    const intMax = level === 1 ? 9 : 99;            // 简单=1 位整数，中等/挑战=2 位整数
    const MAXC = intMax * base + (base - 1);        // 结果上限（简单 9.9 / 其余 99.99）

    for (let attempt = 0; attempt < 400; attempt++) {
      // 运算符：单步为纯加或纯减；两步为加减混合
      const ops = steps === 1
        ? [pick(["+", "-"])]
        : (Math.random() < 0.5 ? ["+", "-"] : ["-", "+"]);

      // 整数部分 + 非零小数部分
      const genNum = () => ri(intMin, intMax) * base + ri(1, base - 1);
      const a = genNum();
      const xs = [];
      for (let s = 0; s < steps; s++) xs.push(genNum());

      // 从左到右正确计算，记录每步的进/借位错误点
      let cur = a, ok = true;
      const stepWrongLists = [];
      for (let s = 0; s < steps; s++) {
        const r = decimalStep(cur, ops[s], xs[s], dp);
        if (r.result < 0 || r.result > MAXC) { ok = false; break; } // 中间出负或越界
        stepWrongLists.push(r.wrongs);
        cur = r.result;
      }
      if (!ok) continue;
      const final = cur;
      if (final < 1) continue; // 排除 0

      // 必须存在至少一个真实的进位/借位点，保证题目确实考察进位借位
      if (stepWrongLists.every((l) => l.every((w) => w.weak))) continue;

      // 错误传播：第 s 步进/借位出错后，后续步骤仍按正确方式计算
      // strong = 真实进/借位失误（优先作为干扰项），weak = 进借位判断做反
      const strongFinals = new Set(), weakFinals = new Set();
      for (let s = 0; s < steps; s++) {
        for (const w of stepWrongLists[s]) {
          let v = w.v, valid = v >= 0;
          for (let t = s + 1; t < steps && valid; t++) {
            v = ops[t] === "+" ? v + xs[t] : v - xs[t];
            if (v < 0) valid = false;
          }
          if (valid && v !== final) (w.weak ? weakFinals : strongFinals).add(v);
        }
      }

      const opSym = (o) => (o === "+" ? "+" : "−");
      let prompt = fmtScaled(a, dp);
      for (let s = 0; s < steps; s++) prompt += ` ${opSym(ops[s])} ${fmtScaled(xs[s], dp)}`;
      prompt += " = ?";
      const answer = fmtScaled(final, dp);

      // 组装选项：真实进/借位失误优先，其次"进借位判断做反"，最后才用数位偏移兜底
      const byNear = (p, q) => Math.abs(p - final) - Math.abs(q - final);
      const inRange = (v) => v >= 0 && v <= MAXC;
      const chosen = [];
      const seen = new Set([answer]);
      const pushVals = (vals) => {
        for (const v of vals) {
          if (chosen.length === 3) return;
          if (!inRange(v)) continue;
          const s = fmtScaled(v, dp);
          if (!seen.has(s)) { seen.add(s); chosen.push(s); }
        }
      };
      pushVals([...strongFinals].sort(byNear));
      pushVals([...weakFinals].sort(byNear));
      // 兜底：按数位量级做小幅偏移补足（整位数偏移，仍属进位借位量级）
      const unit = Math.pow(10, dp);            // 1 个"个位"对应的最小单位数
      const fallbacks = [];
      for (const k of [1, unit, unit * 10]) fallbacks.push(k, -k);
      pushVals(fallbacks.map((d) => final + d));
      if (chosen.length < 3) continue; // 选项凑不齐则换题

      // 提示：指向第一个真实进/借位点（找不到再退回任意点）
      let firstWrong = null, firstStep = 0;
      for (let s = 0; s < steps && !firstWrong; s++) {
        for (const w of stepWrongLists[s]) {
          if (!w.weak) { firstWrong = w; firstStep = s; break; }
        }
      }
      if (!firstWrong) {
        for (let s = 0; s < steps && !firstWrong; s++) {
          if (stepWrongLists[s].length) { firstWrong = stepWrongLists[s][0]; firstStep = s; }
        }
      }
      const stepExpr = firstStep === 0
        ? `${fmtScaled(a, dp)} ${opSym(ops[0])} ${fmtScaled(xs[0], dp)}`
        : `前一步结果 ${opSym(ops[firstStep])} ${fmtScaled(xs[firstStep], dp)}`;
      const hint = (steps === 1 ? "竖式计算，小数点对齐（相同数位对齐）。" : "从左往右依次算，小数点对齐（相同数位对齐）。") +
        `算 ${stepExpr} 时：${firstWrong.why}。`;

      const typeName = steps === 1 ? "小数加减法" : "小数加减混合";
      return {
        type: "decimal", typeName,
        prompt, extra: "📐 小数点对齐 · 留意进位与借位",
        answer,
        choices: shuffle([answer, ...chosen]),
        hint,
        key: `decimal:${prompt}`
      };
    }
    // 理论上不可达（重试充足）
    return genMental(level);
  }

  // ---------- 分发表 ----------
  const GENERATORS = {
    mental: genMental,
    fastmul: genFastMul,
    paren: genParen,
    expand: genExpand,
    algebra: genAlgebra,
    equation: genEquation,
    decimal: genDecimal
  };

  const TYPE_NAMES = {
    mental: "简单口算",
    fastmul: "乘法简算",
    paren: "括号运算",
    expand: "括号拆除",
    algebra: "表达式变形",
    equation: "解方程",
    decimal: "小数加减法"
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
