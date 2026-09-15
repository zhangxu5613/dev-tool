/* ============================================================
 * 语文·汉字题生成器
 * 对外暴露 window.YuwenGen，与 math 的 MathGen 接口保持一致：
 *   generateQuestions(types, level, count) -> [题目对象]
 *   题目对象 { type, typeName, prompt, extra, answer, choices, hint, key }
 *
 * 题型：
 *   pinyin  拼音选字     —— 给拼音+词语语境，从同音字中选正确的字
 *   word    词语填字     —— 给词语（挖空一字）+整词拼音，选填入的字
 *   typo    找出错别字   —— 四个词语中一个有错别字，找出它
 *   shape   形近字辨析   —— 给拼音+释义，从形近字中选对应的字
 * ============================================================ */
(function () {
  "use strict";

  const D = window.YuwenData;

  // ---------- 通用工具 ----------
  function ri(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function pick(arr) { return arr[ri(0, arr.length - 1)]; }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 从候选池取 n 个不与 exclude 重复的元素
  function pickDistinct(pool, n, exclude) {
    const ex = new Set(exclude || []);
    const cand = shuffle(pool.filter((x) => !ex.has(x)));
    return cand.slice(0, n);
  }

  // 把词语中第 idx 个字替换为占位符
  function blank(word, idx, ph) {
    return word.slice(0, idx) + (ph || "□") + word.slice(idx + 1);
  }

  // 难度 → 备选项个数（干扰项越多越难）
  function choiceCount(level) {
    return level >= 3 ? 4 : 4; // 统一 4 选 1，难度体现在干扰项的相似度与词语难度
  }

  // 按难度筛词：简单=常用双字词，挑战=易错程度高的词（错别字候选多）
  function wordsByLevel(level) {
    const all = D.WORDS;
    const errCnt = (it) => (it.wrong || []).length + (it.shapeWrong || []).length;
    if (level === 1) return all.filter((it) => it.w.length === 2 && errCnt(it) <= 2);
    if (level === 2) return all.filter((it) => it.w.length === 2);
    return all.filter((it) => errCnt(it) >= 2 || it.w.length > 2);
  }

  // ============================================================
  // 题型 1：拼音选字（核心题型）
  // 给出「拼音 + 词语语境（挖空）」，从同音字中选出正确的字
  // 干扰项 = 同组同音字（真实易混），而非随机汉字
  // ============================================================
  function genPinyin(level) {
    const pool = wordsByLevel(level);
    for (let attempt = 0; attempt < 200; attempt++) {
      const item = pick(pool.length ? pool : D.WORDS);
      const target = item.w[item.idx];              // 正确的字
      const sylls = item.py.split(/\s+/);           // 整词拼音按音节拆
      if (sylls.length !== item.w.length) continue; // 音节数与字数不匹配则跳过
      const py = sylls[item.idx];                   // 被考查字的拼音

      // 干扰项优先用该词条登记的真实易错字
      const wrongs = (item.wrong || []).filter((c) => c !== target);
      // 不足则从同音字组补充
      const need = choiceCount(level) - 1;
      let distractors = pickDistinct(wrongs, need, [target]);
      if (distractors.length < need) {
        const grp = D.HOMOPHONE_GROUPS.find((g) => g.chars.includes(target));
        if (grp) {
          const more = pickDistinct(grp.chars, need - distractors.length, [target, ...distractors]);
          distractors = distractors.concat(more);
        }
      }
      if (distractors.length < need) continue; // 凑不齐同音干扰项则换词

      const prompt = `${py}　—　${blank(item.w, item.idx)}`;
      return {
        type: "pinyin", typeName: "拼音选字",
        prompt,
        extra: `选出「${py}」在词语「${blank(item.w, item.idx)}」中应写的字`,
        answer: target,
        choices: shuffle([target, ...distractors]),
        hint: item.tip || `注意「${target}」的偏旁与词义的关系。`,
        key: `pinyin:${item.w}:${item.idx}`
      };
    }
    return null;
  }

  // ============================================================
  // 题型 2：词语填字
  // 给出整词拼音 + 挖空词语，选出填入的字（干扰项为登记的易错字）
  // 与题型 1 的区别：展示整词拼音，更考查整体词义理解
  // ============================================================
  function genWord(level) {
    const pool = wordsByLevel(level);
    for (let attempt = 0; attempt < 200; attempt++) {
      const item = pick(pool.length ? pool : D.WORDS);
      const target = item.w[item.idx];
      const need = choiceCount(level) - 1;

      let distractors = pickDistinct((item.wrong || []).filter((c) => c !== target), need, [target]);
      if (distractors.length < need) {
        const grp = D.HOMOPHONE_GROUPS.find((g) => g.chars.includes(target));
        if (grp) {
          distractors = distractors.concat(
            pickDistinct(grp.chars, need - distractors.length, [target, ...distractors])
          );
        }
      }
      if (distractors.length < need) continue;

      return {
        type: "word", typeName: "词语填字",
        prompt: `${blank(item.w, item.idx)}`,
        extra: `拼音：${item.py}　—　请选出「□」处应填的字`,
        answer: target,
        choices: shuffle([target, ...distractors]),
        hint: item.tip || `想一想这个词的意思，再判断用哪个字。`,
        key: `word:${item.w}:${item.idx}`
      };
    }
    return null;
  }

  // ============================================================
  // 题型 3：找出错别字
  // 四个词语中三个正确、一个把关键字换成了真实易错字，找出错的那个
  // ============================================================
  function genTypo(level) {
    // 找错别字：同音错字与形近错字都是真实的错别字来源
    const withCands = (list) => list
      .map((it) => ({ it, cands: (it.wrong || []).concat(it.shapeWrong || []) }))
      .filter((x) => x.cands.length > 0);
    let typoPool = withCands(wordsByLevel(level));
    if (!typoPool.length) typoPool = withCands(D.WORDS);

    for (let attempt = 0; attempt < 200; attempt++) {
      const entry = pick(typoPool);
      const bad = entry.it;
      const wrongChar = pick(entry.cands);
      if (!wrongChar || wrongChar === bad.w[bad.idx]) continue;
      const badWord = blank(bad.w, bad.idx, wrongChar);   // 写错后的词
      if (badWord === bad.w) continue;
      // 写错后若恰好构成另一个正确词，则此题无效（会有两个"正确"答案）
      if (D.WORDS.some((it) => it.w === badWord)) continue;

      // 对照项优先取"含同类易混字的正确词"，让四个选项都在考同音字辨析
      const correctChar = bad.w[bad.idx];
      const related = D.WORDS.filter((it) =>
        it.w !== bad.w &&
        (it.w.includes(correctChar) || it.w.includes(wrongChar) ||
         (it.wrong || []).includes(correctChar))
      ).map((it) => it.w);

      let others = pickDistinct(related, 3, [bad.w, badWord]);
      if (others.length < 3) {
        const rest = D.WORDS.filter((it) => it.w !== bad.w).map((it) => it.w);
        others = others.concat(pickDistinct(rest, 3 - others.length, [bad.w, badWord, ...others]));
      }
      if (others.length < 3) continue;

      return {
        type: "typo", typeName: "找出错别字",
        prompt: "下面哪个词语有错别字？",
        extra: "四个词语中只有一个写错了字",
        answer: badWord,
        choices: shuffle([badWord, ...others]),
        hint: `注意同音字的区别：${bad.tip || "逐字读一遍，想想每个字的意思对不对。"}`,
        key: `typo:${bad.w}:${wrongChar}`
      };
    }
    return null;
  }

  // ============================================================
  // 题型 4：形近字辨析
  // 给出拼音 + 用法说明，从一组形近字中选出对应的字
  // ============================================================
  function genShape(level) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const grp = pick(D.SHAPE_GROUPS);
      if (!grp.chars || grp.chars.length < 2) continue;
      const target = pick(grp.chars);
      const need = choiceCount(level) - 1;

      // 优先用同组形近字作干扰项（最强干扰）
      let distractors = pickDistinct(
        grp.chars.filter((x) => x.c !== target.c).map((x) => x.c),
        need, [target.c]
      );
      // 同组不足则用同音字组补充（次强干扰）
      if (distractors.length < need) {
        const hg = D.HOMOPHONE_GROUPS.find((g) => g.chars.includes(target.c));
        if (hg) {
          distractors = distractors.concat(
            pickDistinct(hg.chars, need - distractors.length, [target.c, ...distractors])
          );
        }
      }
      // 仍不足则从其他形近组借形近字（保证选项数一致）
      if (distractors.length < need) {
        const otherPool = [];
        D.SHAPE_GROUPS.forEach((g) => {
          if (g !== grp) g.chars.forEach((x) => otherPool.push(x.c));
        });
        distractors = distractors.concat(
          pickDistinct(otherPool, need - distractors.length, [target.c, ...distractors])
        );
      }
      if (distractors.length < need) continue;

      return {
        type: "shape", typeName: "形近字辨析",
        prompt: `${target.py}　—　${target.tip}`,
        extra: "从下面字形相近的字中选出正确的那个",
        answer: target.c,
        choices: shuffle([target.c, ...distractors]),
        hint: `读音是「${target.py}」，${target.tip}。`,
        key: `shape:${target.c}`
      };
    }
    return null;
  }

  // ---------- 分发表 ----------
  const GEN = {
    pinyin: genPinyin,
    word: genWord,
    typo: genTypo,
    shape: genShape
  };

  const TYPE_NAMES = {
    pinyin: "拼音选字",
    word: "词语填字",
    typo: "找出错别字",
    shape: "形近字辨析"
  };

  // ---------- 批量出题（同一轮内避免重复题目） ----------
  function generateQuestions(types, level, count) {
    const use = (types && types.length) ? types.slice() : Object.keys(GEN);
    const lv = level || 1;
    const n = count || 10;
    const out = [];
    const usedKeys = new Set();

    let guard = 0;
    while (out.length < n && guard < n * 60) {
      guard++;
      const t = use[out.length % use.length];      // 轮转题型，保证分布均匀
      const gen = GEN[t];
      if (!gen) continue;
      const q = gen(lv);
      if (!q) continue;
      if (usedKeys.has(q.key)) continue;           // 同轮去重
      usedKeys.add(q.key);
      out.push(q);
    }

    // 极端情况下（题库不足）允许重复以凑满题数
    while (out.length < n && out.length > 0) {
      const src = out[ri(0, out.length - 1)];
      out.push({ ...src, choices: shuffle(src.choices) });
    }
    return shuffle(out);
  }

  window.YuwenGen = {
    generateQuestions,
    TYPE_NAMES,
    _utils: { shuffle, pick, ri }
  };
})();
