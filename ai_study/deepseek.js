/* ============================================================
 * ai_study · DeepSeek 出题层（流式版）
 * 职责：把用户的粗略需求扩写成完整出题要求 → 调用 DeepSeek（stream）
 *       → 严格校验并归一化返回的题目数据
 * 通过 opts.onStep(step, extra) 向调用方报告进度
 * 暴露 window.AIGen
 * ============================================================ */
(function () {
  "use strict";

  const API_URL = "https://api.deepseek.com/chat/completions";
  const KEY_STORE = "ds-api-key";

  const LEVEL_DESC = {
    1: "简单：考查基础概念和直接套用，题干简短直白，干扰项明显有别于答案",
    2: "中等：需要两三步推理或对易混概念做辨析，干扰项要贴近正确答案",
    3: "挑战：需要综合运用、多步推理或识别常见陷阱，干扰项必须是典型错误答案"
  };

  function loadKey() {
    try { return localStorage.getItem(KEY_STORE) || ""; } catch (e) { return ""; }
  }
  function saveKey(k) {
    try { localStorage.setItem(KEY_STORE, k); } catch (e) {}
  }

  function buildSystemPrompt() {
    return [
      "你是一位命题老师。用户会给出一个可能很简略的学习需求，你要完成两件事：",
      "1) 先把这个需求扩写成明确的出题要求：补全学科、学段、知识点范围、题目形式与考查重点。",
      "2) 再按扩写后的要求出【单选题】。",
      "",
      "硬性规则（必须全部满足）：",
      "- 每题恰好 4 个选项，有且只有一个正确答案。",
      "- answer 字段必须与 choices 中的某一项【完全一致】（逐字符相同）。",
      "- 4 个选项内容互不重复，且不要在选项里写 A/B/C/D 之类的编号前缀。",
      "- 干扰项必须是学习者真实容易犯的错误，不允许凑数或明显荒谬。",
      "- 每题都要给 explain：说明为什么答案对，以及错误选项错在哪。",
      "- 题干 prompt 不要包含选项列表，选项只放在 choices 里。",
      "- 数学计算题必须保证答案在数学上确实正确。",
      "",
      "只输出 JSON，不要输出任何解释性文字或 markdown 代码块，格式：",
      '{"topic":"扩写后的出题要求（一句话概括）","questions":[{"prompt":"题干","extra":"可选的补充说明，没有就留空字符串","choices":["选项1","选项2","选项3","选项4"],"answer":"正确选项原文","explain":"解析"}]}'
    ].join("\n");
  }

  function buildUserPrompt(req, level, count) {
    return [
      "学习需求：" + req,
      "难度要求：" + (LEVEL_DESC[level] || LEVEL_DESC[1]),
      "题目数量：恰好 " + count + " 道",
      "",
      "请先在心里把上面的需求扩写完整，然后输出符合前述 JSON 格式的题目。",
      "注意 topic 字段填写你扩写后的出题要求。"
    ].join("\n");
  }

  /* ---------- 返回内容解析 ---------- */
  function extractJSON(text) {
    if (!text) throw new Error("AI 返回内容为空");
    let s = String(text).trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    try { return JSON.parse(s); } catch (e) {}
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a >= 0 && b > a) {
      const cut = s.slice(a, b + 1);
      try { return JSON.parse(cut); } catch (e) {}
    }
    throw new Error("AI 返回的不是合法 JSON，请重试");
  }

  /* ---------- 题目校验与归一化 ---------- */
  function normalize(raw, level) {
    const out = [];
    const dropped = [];
    const list = raw && Array.isArray(raw.questions) ? raw.questions : [];

    list.forEach((q, i) => {
      if (!q || typeof q !== "object") { dropped.push({ i: i + 1, reason: "数据格式异常" }); return; }
      const prompt = clean(q.prompt);
      let choices = Array.isArray(q.choices) ? q.choices.map(clean) : [];
      const answer = clean(q.answer);
      if (!prompt || !answer) { dropped.push({ i: i + 1, reason: "题干或答案为空" }); return; }
      choices = choices.filter((c) => c !== "");
      choices = choices.filter((c, idx) => choices.indexOf(c) === idx);
      if (choices.length !== 4) { dropped.push({ i: i + 1, reason: "选项数不等于4" }); return; }
      let ans = answer;
      if (choices.indexOf(ans) < 0) {
        const mapped = mapLetterAnswer(ans, choices);
        if (mapped === null) { dropped.push({ i: i + 1, reason: "答案不在选项中" }); return; }
        ans = mapped;
      }
      out.push({
        key: "ai_" + Date.now() + "_" + i + "_" + hash(prompt),
        type: "ai", typeName: "AI 出题",
        prompt: prompt, extra: clean(q.extra),
        choices: shuffle(choices), answer: ans,
        hint: clean(q.explain) || "暂无解析", level: level
      });
    });
    return { questions: out, total: list.length, dropped: dropped };
  }

  function mapLetterAnswer(ans, choices) {
    const m = String(ans).trim().match(/^([A-Da-d])\s*[.、:：)]?\s*(.*)$/);
    if (!m) return null;
    const tail = clean(m[2]);
    if (tail && choices.indexOf(tail) >= 0) return tail;
    if (!tail) {
      const idx = m[1].toUpperCase().charCodeAt(0) - 65;
      if (idx >= 0 && idx < choices.length) return choices[idx];
    }
    return null;
  }

  function clean(v) {
    if (v === null || v === undefined) return "";
    return String(v).replace(/\s+/g, " ").trim();
  }
  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ---------- 流式读取 SSE ---------- */
  async function streamRead(response, signal, onChunk) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";

    try {
      while (true) {
        if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE 格式：每行 data: ... ，以 \n\n 分隔
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // 最后一行可能不完整

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          if (!trimmed.startsWith("data: ")) continue;
          try {
            const json = JSON.parse(trimmed.slice(6));
            const delta = json.choices && json.choices[0] && json.choices[0].delta;
            if (delta && delta.content) {
              full += delta.content;
              onChunk(full, delta.content);
            }
          } catch (e) { /* skip malformed SSE line */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
    return full;
  }

  /* ---------- 主入口 ---------- */
  async function generate(opts) {
    const req = clean(opts.req);
    const count = opts.count || 5;
    const level = opts.level || 1;
    const model = opts.model || "deepseek-v4-flash";
    const apiKey = (opts.apiKey || "").trim();
    const onStep = opts.onStep || function () {};

    if (!req) throw new Error("请先填写你想练习的内容");
    if (!apiKey) throw new Error("请先填写 DeepSeek API Key");

    // Step 1: expand
    onStep("expand");

    // Step 2: send
    onStep("send");
    const body = {
      model: model,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(req, level, count) }
      ],
      response_format: { type: "json_object" },
      temperature: 1.0,
      stream: true
    };

    let res;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + apiKey
        },
        body: JSON.stringify(body),
        signal: opts.signal
      });
    } catch (e) {
      if (e && e.name === "AbortError") throw e;
      throw new Error("网络请求失败，请检查网络后重试");
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = (err && err.error && err.error.message) || "";
      if (res.status === 401) throw new Error("API Key 无效或已过期，请检查后重填");
      if (res.status === 402) throw new Error("账户余额不足，请前往 DeepSeek 平台充值");
      if (res.status === 429) throw new Error("请求过于频繁，请稍后再试");
      throw new Error(msg || "接口返回错误 HTTP " + res.status);
    }

    // Step 3: receive (streaming)
    onStep("receive");
    let content;
    if (res.headers.get("content-type")?.includes("text/event-stream")) {
      content = await streamRead(res, opts.signal, function (full, chunk) {
        onStep("receiving", { text: full, len: full.length });
      });
    } else {
      // fallback: non-stream response
      const data = await res.json();
      content = data && data.choices && data.choices[0] &&
        data.choices[0].message && data.choices[0].message.content;
      onStep("receiving", { text: content || "", len: (content || "").length });
    }

    // Step 4: parse
    onStep("parse");
    const parsed = extractJSON(content);

    // Step 5: validate
    onStep("validate");
    const result = normalize(parsed, level);

    onStep("validate_done", {
      total: result.total,
      passed: result.questions.length,
      dropped: result.dropped
    });

    if (!result.questions.length) throw new Error("AI 这次没能给出合格的题目，请重试或换个说法");

    onStep("done");
    return {
      topic: clean(parsed.topic) || req,
      questions: result.questions
    };
  }

  window.AIGen = {
    generate: generate,
    loadKey: loadKey,
    saveKey: saveKey,
    _internal: { extractJSON: extractJSON, normalize: normalize, mapLetterAnswer: mapLetterAnswer }
  };
})();
