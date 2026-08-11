(function () {
    'use strict';

    // ---------- DOM ----------
    const $ = (sel) => document.querySelector(sel);
    const input = $('#input');
    const output = $('#output');
    const tree = $('#tree');
    const gutter = $('#inputGutter');
    const inputInfo = $('#inputInfo');
    const outputInfo = $('#outputInfo');
    const statusBar = $('#statusBar');
    const statusText = $('#statusText');
    const indentSel = $('#indentSize');
    const toast = $('#toast');
    const treeActions = $('#treeActions');

    let currentObj = null; // 最近一次成功解析的对象

    // ---------- Theme ----------
    const themeKey = 'json-tool-theme';
    const savedTheme = localStorage.getItem(themeKey);
    if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
    $('#themeToggle').addEventListener('click', () => {
        const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', cur);
        localStorage.setItem(themeKey, cur);
    });

    // ---------- Utils ----------
    function showToast(msg, type = 'info') {
        toast.textContent = msg;
        toast.hidden = false;
        toast.className = 'toast';
        if (type === 'error') {
            toast.style.backgroundColor = '#ef4444';
        } else if (type === 'success') {
            toast.style.backgroundColor = '#10b981';
        } else if (type === 'warning') {
            toast.style.backgroundColor = '';
            toast.classList.add('toast-warn');
        } else {
            toast.style.backgroundColor = '#1f2937';
        }
        clearTimeout(showToast._t);
        showToast._t = setTimeout(() => { toast.hidden = true; }, type === 'warning' ? 3500 : 1800);
    }

    function setStatus(kind, msg) {
        const cls = kind === 'ok' ? 'status-ok'
            : kind === 'err' ? 'status-err'
            : kind === 'warn' ? 'status-warn'
            : 'status-idle';
        statusBar.className = 'status-bar ' + cls;
        statusText.textContent = msg;
    }

    function getIndent() {
        const v = indentSel.value;
        if (v === 'tab') return '\t';
        return ' '.repeat(parseInt(v, 10));
    }

    function escapeHTML(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    // 通用 JSON 语法高亮（单次扫描 tokenizer，IIFE 顶层定义，各模块都能用）
    function highlightJSON(s) {
        const re = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}\[\]:,]/g;
        let out = '';
        let lastIndex = 0;
        let m;
        while ((m = re.exec(s)) !== null) {
            const match = m[0];
            const offset = m.index;
            if (offset > lastIndex) out += escapeHTML(s.slice(lastIndex, offset));
            lastIndex = offset + match.length;
            if (match[0] === '"') {
                const rest = s.slice(lastIndex);
                if (/^\s*:/.test(rest)) {
                    out += `<span class="tk-key">${escapeHTML(match)}</span>`;
                } else {
                    out += `<span class="tk-str">${escapeHTML(match)}</span>`;
                }
            } else if (/^-?\d/.test(match)) {
                out += `<span class="tk-num">${match}</span>`;
            } else if (match === 'true' || match === 'false') {
                out += `<span class="tk-bool">${match}</span>`;
            } else if (match === 'null') {
                out += `<span class="tk-null">null</span>`;
            } else {
                out += `<span class="tk-punc">${match}</span>`;
            }
            if (match.length === 0) re.lastIndex++;
        }
        if (lastIndex < s.length) out += escapeHTML(s.slice(lastIndex));
        return out;
    }

    function countInfo(text) {
        if (!text) return '0 行 · 0 字符';
        const lines = text.split('\n').length;
        return `${lines} 行 · ${text.length} 字符`;
    }

    function typeOf(v) {
        if (v === null) return 'null';
        if (isBigIntStr(v)) return 'bigint';
        if (Array.isArray(v)) return 'array';
        return typeof v;
    }

    function valueHTML(v) {
        const t = typeOf(v);
        if (t === 'bigint') return `<span class="jl-value tk-num" title="大整数（超出安全范围）">${escapeHTML(v.v)}</span>`;
        if (t === 'string') {
            // 检测 HTTP(S) 链接
            if (/^https?:\/\/.+/i.test(v)) {
                const escaped = escapeHTML(v);
                const rawUrl = v; // href 用原始 URL，不做 HTML 转义（引号除外）
                const safeHref = rawUrl.replace(/"/g, '&quot;');
                const isImg = /\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?.*)?$/i.test(v);
                const popup = isImg
                    ? `<span class="link-popup"><a href="${safeHref}" target="_blank" rel="noopener noreferrer">在新窗口打开</a><img class="img-preview" src="${safeHref}" alt="预览" /></span>`
                    : `<span class="link-popup"><a href="${safeHref}" target="_blank" rel="noopener noreferrer">在新窗口打开链接</a></span>`;
                return `<span class="jl-value tk-str jl-link">"${escaped}"${popup}</span>`;
            }
            return `<span class="jl-value tk-str">"${escapeHTML(v)}"</span>`;
        }
        if (t === 'number') return `<span class="jl-value tk-num">${v}</span>`;
        if (t === 'boolean') return `<span class="jl-value tk-bool">${v}</span>`;
        if (t === 'null') return `<span class="jl-value tk-null">null</span>`;
        return '';
    }

    // ---------- Gutter line numbers ----------
    function updateGutter() {
        const lines = input.value.split('\n').length || 1;
        let html = '';
        for (let i = 1; i <= lines; i++) html += `<div>${i}</div>`;
        gutter.innerHTML = html;
        gutter.scrollTop = input.scrollTop;
        inputInfo.textContent = countInfo(input.value);
    }

    input.addEventListener('scroll', () => { gutter.scrollTop = input.scrollTop; });

    // Support Tab key indentation in textarea
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const s = input.selectionStart, en = input.selectionEnd;
            input.value = input.value.substring(0, s) + '    ' + input.value.substring(en);
            input.selectionStart = input.selectionEnd = s + 4;
            updateGutter();
            scheduleAutoProcess();
        }
    });

    // ---------- Auto process ----------
    let autoTimer;
    function scheduleAutoProcess() {
        clearTimeout(autoTimer);
        autoTimer = setTimeout(() => autoProcess(), 200);
    }

    // 大数字保护：超过 MAX_SAFE_INTEGER 的整数用 BigIntStr 对象保留原始字符串
    const _BIGINT_TAG = '__BIGINT__';
    function BigIntStr(s) { return { [_BIGINT_TAG]: true, v: String(s) }; }
    function isBigIntStr(v) { return v && typeof v === 'object' && v[_BIGINT_TAG] === true; }
    function hasBigIntInObj(obj) {
        if (isBigIntStr(obj)) return true;
        if (Array.isArray(obj)) return obj.some(hasBigIntInObj);
        if (obj && typeof obj === 'object') return Object.values(obj).some(hasBigIntInObj);
        return false;
    }

    function safeJSONParse(text) {
        // 匹配 JSON 中超出安全整数范围的数字，替换为带标记字符串
        const placeholder = '"__BIGINT_PLACEHOLDER_';
        let counter = 0;
        const bigInts = [];
        // 先把字符串内容替换为占位，再处理数字，最后恢复字符串
        const stringMap = [];
        const withoutStrings = text.replace(/"(?:\\.|[^"\\])*"/g, (m) => {
            const ph = `"__STR_PH_${stringMap.length}__"`;
            stringMap.push(m);
            return ph;
        });
        // 在无字符串的文本中替换大数字
        const replaced = withoutStrings.replace(
            /-?\d{16,}(\.\d+)?([eE][+-]?\d+)?/g,
            (match) => {
                const num = Number(match);
                if (Number.isFinite(num) && String(num) === match) return match;
                const key = placeholder + (counter++) + '"';
                bigInts.push({ key: key.slice(1, -1), raw: match });
                return key;
            }
        );
        // 恢复字符串
        let finalText = replaced.replace(/"__STR_PH_(\d+)__"/g, (_, i) => stringMap[+i]);
        const parsed = JSON.parse(finalText);
        // 将标记字符串恢复为 BigIntStr 对象
        if (bigInts.length) {
            (function walk(obj) {
                if (Array.isArray(obj)) {
                    for (let i = 0; i < obj.length; i++) {
                        if (typeof obj[i] === 'string' && obj[i].startsWith('__BIGINT_PLACEHOLDER_')) {
                            const found = bigInts.find(b => b.key === obj[i]);
                            if (found) obj[i] = BigIntStr(found.raw);
                        } else if (typeof obj[i] === 'object' && obj[i] !== null) {
                            walk(obj[i]);
                        }
                    }
                } else if (typeof obj === 'object' && obj !== null) {
                    for (const k of Object.keys(obj)) {
                        if (typeof obj[k] === 'string' && obj[k].startsWith('__BIGINT_PLACEHOLDER_')) {
                            const found = bigInts.find(b => b.key === obj[k]);
                            if (found) obj[k] = BigIntStr(found.raw);
                        } else if (typeof obj[k] === 'object' && obj[k] !== null) {
                            walk(obj[k]);
                        }
                    }
                }
            })(parsed);
        }
        return parsed;
    }

    // 序列化时将 BigIntStr 还原为原始数字字符串
    function safeJSONStringify(obj, indent) {
        return JSON.stringify(obj, (key, val) => {
            if (isBigIntStr(val)) return val.v;
            return val;
        }, indent);
    }

    function autoProcess() {
        const raw = input.value.trim();
        if (!raw) {
            currentObj = null;
            output.innerHTML = '';
            tree.innerHTML = '';
            outputInfo.textContent = countInfo('');
            setStatus('idle', '等待输入...');
            return;
        }

        // 优先尝试标准解析（带大数保护）
        let strictOk = false;
        let parsed = null;
        try {
            parsed = safeJSONParse(raw);
            strictOk = true;
        } catch (e) {
            // 标准解析失败，回退到容错解析
            const tol = tolerantParse(raw);
            if (tol.ok && tol.value !== undefined) {
                parsed = tol.value;
            }
        }

        if (parsed !== null && parsed !== undefined) {
            currentObj = parsed;
            if (strictOk) {
                renderFoldable(parsed, false);
                buildTree(parsed);
                setStatus('ok', 'JSON 格式正确 ✓');
            } else {
                renderFoldable(parsed, true);
                buildTree(parsed);
                setStatus('warn', 'JSON 不完整或有小错误，已尽力格式化');
                showToast('⚠ JSON 格式不完整，已尽力格式化', 'warning');
            }
            return;
        }

        // 连容错解析都失败
        currentObj = null;
        try { JSON.parse(raw); } catch (err) {
            const info = parseJSONError(err.message, raw);
            renderErrorText(raw, info);
            tree.innerHTML = `<div style="color:var(--text-muted)">JSON 无效，无法生成树形视图</div>`;
            setStatus('err', info.message);
        }
    }

    input.addEventListener('input', () => {
        updateGutter();
        scheduleAutoProcess();
    });

    // Parse JSON error to find line / column
    function parseJSONError(msg, text) {
        let pos = -1;
        const m1 = msg.match(/position\s+(\d+)/i);
        if (m1) pos = parseInt(m1[1], 10);
        let line = 0, col = 0;
        if (pos >= 0) {
            const before = text.slice(0, pos);
            const lines = before.split('\n');
            line = lines.length;
            col = lines[lines.length - 1].length + 1;
        }
        return {
            message: line > 0 ? `解析错误：第 ${line} 行，第 ${col} 列 - ${msg}` : `解析错误：${msg}`,
            line, col, pos
        };
    }

    function renderErrorText(raw, info) {
        const lines = raw.split('\n');
        let html = '';
        lines.forEach((ln, i) => {
            if (i + 1 === info.line) {
                html += `<div class="err-line">${escapeHTML(ln) || '&nbsp;'}</div>`;
            } else {
                html += `<div>${escapeHTML(ln) || '&nbsp;'}</div>`;
            }
        });
        output.innerHTML = html;
        outputInfo.textContent = countInfo(raw);
    }

    // ---------- Tolerant JSON parser ----------
    // 设计目标：不做"智能补齐"，仅把已完整输入的部分按 JSON 结构格式化出来。
    // 规则：
    //   - 遇到 EOF 或非法 token：立即停止当前容器的解析，返回当前已收集到的完整条目。
    //   - 不自动给缺失的值补 null，不闭合未闭合的字符串（未闭合字符串直接丢弃）。
    //   - 已经解析到的键值（值已完整）会保留并渲染。
    function tolerantParse(text) {
        try {
            const parser = new TolerantParser(text);
            const value = parser.parseValue();
            if (value === TolerantParser.INCOMPLETE) return { ok: false };
            return { ok: true, value };
        } catch (e) {
            return { ok: false, error: e };
        }
    }

    class TolerantParser {
        constructor(src) {
            this.src = src;
            this.i = 0;
            this.n = src.length;
        }
        peek() { return this.i < this.n ? this.src[this.i] : ''; }
        eof() { return this.i >= this.n; }
        skipWs() {
            while (this.i < this.n) {
                const c = this.src[this.i];
                if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { this.i++; continue; }
                break;
            }
        }
        parseValue() {
            this.skipWs();
            if (this.eof()) return TolerantParser.INCOMPLETE;
            const c = this.peek();
            if (c === '{') return this.parseObject();
            if (c === '[') return this.parseArray();
            if (c === '"') return this.parseString();
            if (c === '-' || (c >= '0' && c <= '9')) return this.parseNumber();
            return this.parseLiteral();
        }
        // 对象：严格模式下只接受双引号键；未闭合时不再补全，返回已完整采集到的键值对
        parseObject() {
            const obj = {};
            this.i++; // 跳过 {
            while (true) {
                this.skipWs();
                if (this.eof()) return obj;            // 未闭合：停在这里
                if (this.peek() === '}') { this.i++; return obj; }

                // 解析 key，要求双引号
                if (this.peek() !== '"') return obj;
                const keyStart = this.i;
                const key = this.parseString();
                if (key === TolerantParser.INCOMPLETE) {
                    // 字符串未闭合，回退并停止
                    this.i = keyStart;
                    return obj;
                }

                this.skipWs();
                if (this.peek() !== ':') return obj;   // 没等到冒号：停止
                this.i++;
                this.skipWs();
                if (this.eof()) return obj;            // 冒号后没有值：丢弃这个键，停止

                const saved = this.i;
                const v = this.parseValue();
                if (v === TolerantParser.INCOMPLETE) {
                    this.i = saved;
                    return obj;                         // 值不完整：丢弃该键，保留之前
                }
                obj[key] = v;

                this.skipWs();
                if (this.peek() === ',') { this.i++; continue; }
                if (this.peek() === '}') { this.i++; return obj; }
                return obj;                             // 其它情况停止
            }
        }
        parseArray() {
            const arr = [];
            this.i++; // 跳过 [
            while (true) {
                this.skipWs();
                if (this.eof()) return arr;
                if (this.peek() === ']') { this.i++; return arr; }

                const saved = this.i;
                const v = this.parseValue();
                if (v === TolerantParser.INCOMPLETE) {
                    this.i = saved;
                    return arr;
                }
                arr.push(v);

                this.skipWs();
                if (this.peek() === ',') { this.i++; continue; }
                if (this.peek() === ']') { this.i++; return arr; }
                return arr;
            }
        }
        // 字符串必须有闭合引号，否则返回 INCOMPLETE
        parseString() {
            const start = this.i;
            this.i++; // 跳过开引号
            let out = '';
            while (!this.eof()) {
                const c = this.src[this.i];
                if (c === '\\') {
                    this.i++;
                    if (this.eof()) { this.i = start; return TolerantParser.INCOMPLETE; }
                    const esc = this.src[this.i++];
                    switch (esc) {
                        case '"': out += '"'; break;
                        case '\\': out += '\\'; break;
                        case '/': out += '/'; break;
                        case 'b': out += '\b'; break;
                        case 'f': out += '\f'; break;
                        case 'n': out += '\n'; break;
                        case 'r': out += '\r'; break;
                        case 't': out += '\t'; break;
                        case 'u': {
                            const h = this.src.slice(this.i, this.i + 4);
                            if (/^[0-9a-fA-F]{4}$/.test(h)) {
                                out += String.fromCharCode(parseInt(h, 16));
                                this.i += 4;
                            } else { out += 'u'; }
                            break;
                        }
                        default: out += esc;
                    }
                    continue;
                }
                if (c === '"') { this.i++; return out; }
                out += c;
                this.i++;
            }
            // 未闭合
            this.i = start;
            return TolerantParser.INCOMPLETE;
        }
        // 数字：仅当后面是终止符（空白 / , } ] / EOF）才认为完整
        parseNumber() {
            const start = this.i;
            if (this.peek() === '-') this.i++;
            while (!this.eof() && /[0-9.eE+\-]/.test(this.peek())) this.i++;
            const numStr = this.src.slice(start, this.i);
            const after = this.peek();
            const isTerm = this.eof() === false && /[\s,}\]]/.test(after);
            if (this.eof() || isTerm) {
                const n = Number(numStr);
                if (!isNaN(n)) return n;
            }
            // 不完整或非法数字
            this.i = start;
            return TolerantParser.INCOMPLETE;
        }
        // 字面量 true/false/null，必须完整拼出来
        parseLiteral() {
            const start = this.i;
            while (!this.eof() && /[a-zA-Z]/.test(this.peek())) this.i++;
            const word = this.src.slice(start, this.i);
            const after = this.peek();
            const isTerm = this.eof() || /[\s,}\]]/.test(after);
            if (!isTerm) { this.i = start; return TolerantParser.INCOMPLETE; }
            if (word === 'true') return true;
            if (word === 'false') return false;
            if (word === 'null') return null;
            this.i = start;
            return TolerantParser.INCOMPLETE;
        }
    }
    TolerantParser.INCOMPLETE = Symbol('INCOMPLETE');

    // ---------- Foldable text view ----------
    function renderFoldable(data, tolerant) {
        output.innerHTML = '';
        // 大数精度提示
        if (hasBigIntInObj(data)) {
            const tip = document.createElement('div');
            tip.className = 'bigint-tip';
            tip.innerHTML = '⚠️ JSON 中存在大数，JavaScript 会丢失精度，建议使用 string 存储';
            output.appendChild(tip);
        }
        const indent = getIndent();
        const frag = document.createDocumentFragment();
        renderValueLines(frag, data, 0, indent, '', false);
        output.appendChild(frag);
        const pretty = safeJSONStringify(data, indent);
        outputInfo.textContent = countInfo(pretty);

        // 容错模式：标记补齐的尾部闭合行
        if (tolerant) {
            markAutoClosedTails(pretty);
        }

        // 给所有 .fold-body 计算缩进对齐竖线的水平位置
        applyIndentGuides();
    }

    // 计算并设置每个 fold-body 的对齐竖线水平位置
    function applyIndentGuides() {
        // 测量一个等宽字符的真实像素宽度（用 output 的字体）
        const probe = document.createElement('span');
        probe.style.cssText = 'visibility:hidden;position:absolute;white-space:pre;';
        probe.textContent = ' '.repeat(10);
        output.appendChild(probe);
        const charWidth = probe.getBoundingClientRect().width / 10;
        probe.remove();

        // .jl 行的 padding-left 是 22px，父级 } 在 padding-left + depth*indentUnit 个空格之后
        // 竖线对齐到父级 } 的字符位置（正上方）
        output.querySelectorAll('.fold-body').forEach(body => {
            const depth = parseInt(body.dataset.depth, 10) || 0;
            const indentUnit = parseInt(body.dataset.indentUnit, 10) || 4;
            const left = 22 + depth * indentUnit * charWidth;
            body.style.setProperty('--guide-left', left + 'px');
        });
    }

    // 把格式化后的文本和原始输入对比，找出原输入里缺少的尾部闭合括号行并标红
    function markAutoClosedTails(prettyText) {
        const raw = input.value.trim();
        const prettyLines = prettyText.split('\n');

        // 从格式化结果末尾往前数，看原输入里是否缺少这些闭合括号
        // 策略：统计原输入里的 { [ } ] 数量，和格式化结果比较
        const countInRaw = { '{': 0, '}': 0, '[': 0, ']': 0 };
        const countInPretty = { '{': 0, '}': 0, '[': 0, ']': 0 };

        // 简单计数（忽略字符串内部的括号，用正则去掉字符串内容）
        function countBrackets(s) {
            // 去掉字符串内容
            const stripped = s.replace(/"(?:\\.|[^"\\])*"/g, '""');
            const c = { '{': 0, '}': 0, '[': 0, ']': 0 };
            for (const ch of stripped) {
                if (ch in c) c[ch]++;
            }
            return c;
        }

        const rawC = countBrackets(raw);
        const prettyC = countBrackets(prettyText);

        // 补齐的 } 数量 = prettyC['}'] - rawC['}']
        // 补齐的 ] 数量 = prettyC[']'] - rawC[']']
        let missingClose = (prettyC['}'] - rawC['}']) + (prettyC[']'] - rawC[']']);
        if (missingClose <= 0) return;

        // 从输出 DOM 的末尾往前标红 missingClose 个 jl-tail 行
        const allTails = output.querySelectorAll('.jl-tail');
        const tailArr = Array.from(allTails).reverse();
        for (let i = 0; i < Math.min(missingClose, tailArr.length); i++) {
            tailArr[i].classList.add('auto-closed');
        }
    }

    /**
     * 把一个值渲染成若干行
     * @param {Node} parent 父 DOM
     * @param {*} value
     * @param {number} depth
     * @param {string} indentStr 单位缩进字符串
     * @param {string} keyPrefixHTML 行首的 key 部分 HTML（如 "key": ）
     * @param {boolean} trailingComma 行末是否加逗号
     * @param {Array} path 从根到当前元素的路径（用于删除功能）
     */
    function renderValueLines(parent, value, depth, indentStr, keyPrefixHTML, trailingComma, path) {
        if (!path) path = [];
        const pad = indentStr.repeat(depth);
        const t = typeOf(value);
        const comma = trailingComma ? '<span class="tk-punc">,</span>' : '';

        if (t === 'object' || t === 'array') {
            const keys = t === 'array' ? value.map((_, i) => i) : Object.keys(value);
            const open = t === 'array' ? '[' : '{';
            const close = t === 'array' ? ']' : '}';
            const typeLabel = t === 'array' ? 'Array' : 'Object';
            const summary = `${keys.length} ${t === 'array' ? '项' : '键'}`;

            const wrap = document.createElement('div');
            wrap.className = 'fold-block expanded';
            wrap.dataset.jsonPath = JSON.stringify(path);

            const canFold = keys.length > 0;

            // 开始行
            const headLine = document.createElement('div');
            headLine.className = 'jl jl-head';
            headLine.innerHTML =
                `<span class="pad">${pad}</span>` +
                (canFold ? `<span class="fold-toggle expanded" title="折叠/展开">▼</span>` : '') +
                `${keyPrefixHTML}<span class="tk-punc">${open}</span>` +
                (canFold
                    ? `<span class="fold-inline-btn collapse-btn" title="折叠">-</span>` +
                      `<span class="fold-inline-btn expand-btn" title="展开">+</span>` +
                      `<span class="fold-placeholder"><span class="fold-type">${typeLabel}</span> <span class="tk-punc">${close}</span>${comma}<span class="fold-summary"> // ${summary}</span></span>`
                    : `<span class="tk-punc">${close}</span>${comma}`) +
                `<span class="jl-del-btn" title="删除">✕</span>`;
            wrap.appendChild(headLine);

            if (canFold) {
                const body = document.createElement('div');
                body.className = 'fold-body';
                // 记录当前层级深度，渲染后用于定位对齐竖线
                body.dataset.depth = String(depth);
                body.dataset.indentUnit = String(indentStr === '\t' ? 4 : indentStr.length);
                keys.forEach((k, idx) => {
                    const isLast = idx === keys.length - 1;
                    const childKeyHTML = t === 'array'
                        ? ''
                        : `<span class="tk-key">"${escapeHTML(k)}"</span><span class="tk-punc">: </span>`;
                    renderValueLines(body, value[k], depth + 1, indentStr, childKeyHTML, !isLast, [...path, k]);
                });
                wrap.appendChild(body);

                const tailLine = document.createElement('div');
                tailLine.className = 'jl jl-tail';
                tailLine.innerHTML = `<span class="pad">${pad}</span><span class="tk-punc">${close}</span>${comma}`;
                wrap.appendChild(tailLine);

                const expandBtn = headLine.querySelector('.expand-btn');
                const collapseBtn = headLine.querySelector('.collapse-btn');
                const placeholder = headLine.querySelector('.fold-placeholder');
                const toggleArrow = headLine.querySelector('.fold-toggle');

                function doCollapse() {
                    wrap.classList.add('collapsed');
                    wrap.classList.remove('expanded');
                    body.style.display = 'none';
                    tailLine.style.display = 'none';
                    placeholder.style.display = 'inline';
                    expandBtn.style.display = 'inline-flex';
                    collapseBtn.style.display = 'none';
                    toggleArrow.textContent = '▶';
                    toggleArrow.classList.remove('expanded');
                    toggleArrow.classList.add('collapsed');
                }
                function doExpand() {
                    wrap.classList.remove('collapsed');
                    wrap.classList.add('expanded');
                    body.style.display = '';
                    tailLine.style.display = '';
                    placeholder.style.display = 'none';
                    expandBtn.style.display = 'none';
                    collapseBtn.style.display = 'inline-flex';
                    toggleArrow.textContent = '▼';
                    toggleArrow.classList.remove('collapsed');
                    toggleArrow.classList.add('expanded');
                }

                collapseBtn.addEventListener('click', doCollapse);
                expandBtn.addEventListener('click', doExpand);
                toggleArrow.addEventListener('click', () => {
                    if (wrap.classList.contains('collapsed')) doExpand();
                    else doCollapse();
                });

                // 默认展开
                placeholder.style.display = 'none';
                expandBtn.style.display = 'none';
                collapseBtn.style.display = 'inline-flex';
            }

            parent.appendChild(wrap);
        } else {
            const line = document.createElement('div');
            line.className = 'jl';
            line.dataset.jsonPath = JSON.stringify(path);
            line.innerHTML = `<span class="pad">${pad}</span>${keyPrefixHTML}${valueHTML(value)}${comma}<span class="jl-del-btn" title="删除">✕</span>`;
            parent.appendChild(line);
        }
    }

    // 删除按钮事件委托
    output.addEventListener('click', (e) => {
        const delBtn = e.target.closest('.jl-del-btn');
        if (!delBtn) return;
        e.stopPropagation();
        // 向上查找有 data-json-path 的元素（基础值在 .jl 上，对象/数组在 .fold-block 上）
        let el = delBtn.parentElement;
        while (el && el !== output) {
            if (el.dataset.jsonPath) break;
            el = el.parentElement;
        }
        if (!el || !el.dataset.jsonPath) return;
        const pathStr = el.dataset.jsonPath;
        const path = JSON.parse(pathStr);
        if (path.length === 0) {
            showToast('无法删除根元素', 'error');
            return;
        }
        // 从 currentObj 中按 path 删除
        let obj = currentObj;
        for (let i = 0; i < path.length - 1; i++) {
            obj = obj[path[i]];
        }
        const lastKey = path[path.length - 1];
        if (Array.isArray(obj)) {
            obj.splice(lastKey, 1);
        } else {
            delete obj[lastKey];
        }
        renderFoldable(currentObj, false);
        buildTree(currentObj);
        showToast('已删除', 'success');
    });

    // 点击 value 进入编辑模式
    output.addEventListener('click', (e) => {
        const valueSpan = e.target.closest('.jl-value');
        if (!valueSpan) return;
        if (valueSpan.classList.contains('jl-value-editing')) return;
        if (e.target.closest('.link-popup')) return;
        const lineEl = valueSpan.closest('.jl');
        if (!lineEl) return;
        const pathStr = lineEl.dataset.jsonPath;
        if (!pathStr) return;

        // 通过 path 从 currentObj 读取原始值
        const path = JSON.parse(pathStr);
        if (!path.length) return;
        let obj = currentObj;
        for (let i = 0; i < path.length - 1; i++) {
            obj = obj[path[i]];
        }
        const rawVal = obj[path[path.length - 1]];
        const isString = typeof rawVal === 'string';
        const isBigInt = isBigIntStr(rawVal);
        // 字符串类型：编辑时去掉双引号，保存时自动加回；大整数：显示原始数字
        const editStr = isString ? rawVal : (isBigInt ? rawVal.v : JSON.stringify(rawVal));

        // 进入编辑模式：隐藏原始值，插入 input 到旁边
        valueSpan.classList.add('jl-value-editing');
        valueSpan.style.display = 'none';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'jl-value-edit';
        input.value = editStr;
        // 精确测量文本宽度
        const _mc = document.createElement('canvas').getContext('2d');
        _mc.font = '14px monospace';
        const textW = _mc.measureText(editStr).width;
        input.style.width = Math.max(60, textW + 24) + 'px';
        valueSpan.parentNode.insertBefore(input, valueSpan.nextSibling);
        input.focus();
        input.select();

        function finishEdit() {
            const newVal = input.value;
            let parsed;
            if (isString) {
                parsed = newVal;
            } else if (isBigInt) {
                // 大整数：检查编辑后是否仍为大整数
                const trimmed = newVal.trim();
                const num = Number(trimmed);
                if (/^-?\d+$/.test(trimmed) && (String(num) !== trimmed || Math.abs(num) > Number.MAX_SAFE_INTEGER)) {
                    parsed = BigIntStr(trimmed);
                } else {
                    try { parsed = JSON.parse(trimmed); } catch { parsed = trimmed; }
                }
            } else {
                try {
                    parsed = JSON.parse(newVal.trim());
                } catch {
                    parsed = newVal.trim();
                }
            }
            let obj = currentObj;
            for (let i = 0; i < path.length - 1; i++) {
                obj = obj[path[i]];
            }
            obj[path[path.length - 1]] = parsed;
            renderFoldable(currentObj, false);
            buildTree(currentObj);
        }

        function cancelEdit() {
            input.remove();
            valueSpan.classList.remove('jl-value-editing');
            valueSpan.style.display = '';
        }

        input.addEventListener('blur', finishEdit);
        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
            if (ev.key === 'Escape') { cancelEdit(); }
        });
    });

    // ---------- Tree view ----------
    function buildTree(data) {
        tree.innerHTML = '';
        tree.appendChild(makeNode('root', data, true));
    }

    function makeNode(key, value, isRoot) {
        const t = typeOf(value);
        const node = document.createElement('div');
        node.className = 'tree-node';

        const keyHTML = isRoot ? '' : (
            typeof key === 'number'
                ? `<span class="tk-num">${key}</span><span class="tk-punc">: </span>`
                : `<span class="tk-key">"${escapeHTML(key)}"</span><span class="tk-punc">: </span>`
        );

        if (t === 'object' || t === 'array') {
            const keys = t === 'array' ? value.map((_, i) => i) : Object.keys(value);
            const open = t === 'array' ? '[' : '{';
            const close = t === 'array' ? ']' : '}';

            const toggle = document.createElement('span');
            toggle.className = 'tree-toggle expanded';
            node.appendChild(toggle);

            const head = document.createElement('span');
            head.innerHTML = `${keyHTML}<span class="tk-punc">${open}</span><span class="tree-summary">${keys.length} ${t === 'array' ? '项' : '键'}</span>`;
            node.appendChild(head);

            const children = document.createElement('div');
            children.className = 'tree-children';
            keys.forEach(k => {
                children.appendChild(makeNode(k, value[k], false));
            });
            node.appendChild(children);

            const tail = document.createElement('div');
            tail.innerHTML = `<span class="tk-punc">${close}</span>`;
            node.appendChild(tail);

            toggle.addEventListener('click', () => {
                const collapsed = children.classList.toggle('hidden');
                toggle.classList.toggle('expanded', !collapsed);
                toggle.classList.toggle('collapsed', collapsed);
            });
        } else {
            node.style.paddingLeft = '16px';
            node.innerHTML = `${keyHTML}${valueHTML(value)}`;
        }
        return node;
    }

    function toggleAllTree(expand) {
        tree.querySelectorAll('.tree-toggle').forEach(t => {
            const children = t.parentElement.querySelector(':scope > .tree-children');
            if (!children) return;
            if (expand) {
                children.classList.remove('hidden');
                t.classList.remove('collapsed');
                t.classList.add('expanded');
            } else if (t.parentElement !== tree.firstChild) {
                children.classList.add('hidden');
                t.classList.add('collapsed');
                t.classList.remove('expanded');
            }
        });
    }

    function toggleAllFoldable(expand) {
        output.querySelectorAll('.fold-block').forEach((wrap, idx) => {
            const body = wrap.querySelector(':scope > .fold-body');
            const tail = wrap.querySelector(':scope > .jl-tail');
            const expandBtn = wrap.querySelector(':scope > .jl-head > .expand-btn');
            const collapseBtn = wrap.querySelector(':scope > .jl-head > .collapse-btn');
            const placeholder = wrap.querySelector(':scope > .jl-head > .fold-placeholder');
            const arrow = wrap.querySelector(':scope > .jl-head > .fold-toggle');
            if (!body || !placeholder) return;
            if (expand || idx === 0) {
                wrap.classList.remove('collapsed');
                wrap.classList.add('expanded');
                body.style.display = '';
                if (tail) tail.style.display = '';
                placeholder.style.display = 'none';
                if (expandBtn) expandBtn.style.display = 'none';
                if (collapseBtn) collapseBtn.style.display = 'inline-flex';
                if (arrow) { arrow.textContent = '▼'; arrow.classList.remove('collapsed'); arrow.classList.add('expanded'); }
            } else {
                wrap.classList.add('collapsed');
                wrap.classList.remove('expanded');
                body.style.display = 'none';
                if (tail) tail.style.display = 'none';
                placeholder.style.display = 'inline';
                if (expandBtn) expandBtn.style.display = 'inline-flex';
                if (collapseBtn) collapseBtn.style.display = 'none';
                if (arrow) { arrow.textContent = '▶'; arrow.classList.remove('expanded'); arrow.classList.add('collapsed'); }
            }
        });
    }

    // ---------- View switch ----------
    function showView(view) {
        document.querySelectorAll('.switch-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.view === view);
        });
        if (view === 'text') {
            output.hidden = false;
            tree.hidden = true;
        } else {
            output.hidden = true;
            tree.hidden = false;
        }
        // 折叠/展开按钮在两种视图下均可用
        treeActions.hidden = false;
        treeActions.dataset.target = view;
    }

    // ---------- Button actions（保留手动操作） ----------
    function doFormat() { autoProcess(); }

    function doCompress() {
        const raw = input.value.trim();
        if (!raw) { showToast('请先输入 JSON'); return; }
        try {
            const obj = safeJSONParse(raw);
            const min = safeJSONStringify(obj);
            input.value = min; // 直接替换到输入框，保持"所见即所得"
            updateGutter();
            autoProcess();
            setStatus('ok', `已压缩为 ${min.length} 字符`);
        } catch (err) {
            const info = parseJSONError(err.message, raw);
            setStatus('err', info.message);
            showToast(info.message, 'error');
        }
    }

    function doEscape() {
        const raw = input.value;
        if (!raw) { showToast('请先输入内容'); return; }
        const escaped = JSON.stringify(raw).slice(1, -1);
        input.value = escaped;
        updateGutter();
        autoProcess();
        setStatus('ok', '已生成转义字符串');
    }

    function doUnescape() {
        const raw = input.value;
        if (!raw) { showToast('请先输入内容'); return; }
        try {
            const unesc = JSON.parse('"' + raw.replace(/^"|"$/g, '').replace(/\n/g, '\\n') + '"');
            input.value = unesc;
            updateGutter();
            autoProcess();
            setStatus('ok', '已去转义');
        } catch (e) {
            setStatus('err', '去转义失败：' + e.message);
            showToast('去转义失败', 'error');
        }
    }

    function doUnicodeToChinese() {
        const raw = input.value;
        input.value = raw.replace(/\\u([\dA-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
        updateGutter();
        autoProcess();
        setStatus('ok', 'Unicode 已转为中文');
    }

    function doChineseToUnicode() {
        const raw = input.value;
        input.value = raw.replace(/[\u4e00-\u9fa5]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
        updateGutter();
        autoProcess();
        setStatus('ok', '中文已转为 Unicode');
    }

    function doSample() {
        const sample = {
            "name": "张三",
            "age": 28,
            "email": "zhangsan@example.com",
            "isActive": true,
            "roles": ["admin", "editor"],
            "profile": {
                "city": "北京",
                "hobbies": ["阅读", "跑步", "摄影"],
                "score": 98.5
            },
            "children": null,
            "createdAt": "2026-04-27T10:00:00Z"
        };
        input.value = JSON.stringify(sample, null, getIndent());
        updateGutter();
        autoProcess();
    }

    function doClear() {
        input.value = '';
        updateGutter();
        autoProcess();
    }

    function getOutputPlainText() {
        if (currentObj !== null) return safeJSONStringify(currentObj, getIndent());
        return output.innerText || '';
    }

    // ---------- 删除空元素 ----------
    function removeEmpty(v) {
        if (Array.isArray(v)) {
            return v
                .map(removeEmpty)
                .filter(x => !isEmpty(x));
        }
        if (v && typeof v === 'object') {
            const out = {};
            for (const k of Object.keys(v)) {
                const cleaned = removeEmpty(v[k]);
                if (!isEmpty(cleaned)) out[k] = cleaned;
            }
            return out;
        }
        return v;
    }

    function isEmpty(v) {
        if (v === null || v === undefined) return true;
        if (v === '') return true;
        if (Array.isArray(v) && v.length === 0) return true;
        if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return true;
        return false;
    }

    document.getElementById('btnRemoveEmpty').addEventListener('click', () => {
        if (currentObj === null) { showToast('请先输入有效 JSON'); return; }
        const cleaned = removeEmpty(currentObj);
        currentObj = cleaned;
        renderFoldable(cleaned);
        buildTree(cleaned);
        showToast('已删除空元素（仅修改结果，原始数据不变）', 'success');
    });

    // ---------- 复制结果 ----------
    document.getElementById('btnCopyResult').addEventListener('click', () => {
        copyText(getOutputPlainText(), '结果');
    });

    async function copyText(text, label) {
        if (!text) { showToast('内容为空'); return; }
        try {
            await navigator.clipboard.writeText(text);
            showToast(label + ' 已复制', 'success');
        } catch {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); showToast(label + ' 已复制', 'success'); }
            catch { showToast('复制失败', 'error'); }
            document.body.removeChild(ta);
        }
    }

    // ---------- Event wiring ----------
    document.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const a = btn.dataset.action;
            switch (a) {
                case 'format': doFormat(); break;
                case 'compress': doCompress(); break;
                case 'escape': doEscape(); break;
                case 'unescape': doUnescape(); break;
                case 'unicode': doUnicodeToChinese(); break;
                case 'tochinese': doChineseToUnicode(); break;
                case 'sample': doSample(); break;
                case 'clear': doClear(); break;
                case 'copy-input': copyText(input.value, '输入内容'); break;
                case 'copy-output': copyText(getOutputPlainText(), '结果'); break;
            }
        });
    });

    document.querySelectorAll('.switch-btn').forEach(b => {
        b.addEventListener('click', () => showView(b.dataset.view));
    });

    document.querySelectorAll('[data-tree]').forEach(b => {
        b.addEventListener('click', () => {
            const expand = b.dataset.tree === 'expand';
            // 根据当前激活视图决定折叠哪边
            const textActive = !output.hidden;
            if (textActive) toggleAllFoldable(expand);
            else toggleAllTree(expand);
        });
    });

    indentSel.addEventListener('change', () => {
        if (input.value.trim()) autoProcess();
    });

    // Ctrl/Cmd+Enter to format（仍保留）
    input.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            doFormat();
        }
    });

    // ---------- Init ----------
    updateGutter();
    setStatus('idle', '等待输入...');
    // 树形折叠按钮默认显示（文本视图同样可用）
    treeActions.hidden = false;

    // ---------- 子标签页管理 ----------
    const subTabList = $('#jsonSubTabList');
    const subTabAdd = $('#jsonSubTabAdd');
    let _jsonTabs = [{ id: 1, label: '标签 1', inputValue: '' }];
    let _activeTabId = 1;
    let _nextTabId = 2;

    function saveActiveTab() {
        const tab = _jsonTabs.find(t => t.id === _activeTabId);
        if (tab) tab.inputValue = input.value;
    }

    function renderSubTabs() {
        subTabList.innerHTML = _jsonTabs.map(t => {
            const cls = t.id === _activeTabId ? ' sub-tab active' : 'sub-tab';
            return `<button class="${cls}" data-tab-id="${t.id}">${escapeHTML(t.label)}${_jsonTabs.length > 1 ? '<span class="sub-tab-close">×</span>' : ''}</button>`;
        }).join('') + '<button class="sub-tab-add" id="jsonSubTabAdd" title="新增标签">+</button>';
        // 重新绑定 + 按钮事件（innerHTML 会销毁旧 DOM）
        const newAddBtn = $('#jsonSubTabAdd');
        if (newAddBtn) newAddBtn.addEventListener('click', () => addNewTab());
    }

    function switchToTab(tabId) {
        if (tabId === _activeTabId) return;
        saveActiveTab();
        const tab = _jsonTabs.find(t => t.id === tabId);
        if (!tab) return;
        _activeTabId = tabId;
        input.value = tab.inputValue;
        renderSubTabs();
        updateGutter();
        if (input.value.trim()) autoProcess();
        else {
            output.innerHTML = '';
            tree.innerHTML = '';
            tree.hidden = true; output.hidden = false;
            treeActions.hidden = false;
            setStatus('idle', '等待输入...');
            inputInfo.textContent = '0 行 · 0 字符';
            outputInfo.textContent = '0 行 · 0 字符';
            currentObj = null;
        }
    }

    function addNewTab() {
        saveActiveTab();
        const id = _nextTabId++;
        _jsonTabs.push({ id, label: `标签 ${id}`, inputValue: '' });
        _activeTabId = id;
        input.value = '';
        renderSubTabs();
        updateGutter();
        output.innerHTML = '';
        tree.innerHTML = '';
        tree.hidden = true; output.hidden = false;
        treeActions.hidden = false;
        setStatus('idle', '等待输入...');
        inputInfo.textContent = '0 行 · 0 字符';
        outputInfo.textContent = '0 行 · 0 字符';
        currentObj = null;
    }

    function closeTab(tabId) {
        if (_jsonTabs.length <= 1) return; // 至少保留一个
        const idx = _jsonTabs.findIndex(t => t.id === tabId);
        if (idx === -1) return;
        _jsonTabs.splice(idx, 1);
        if (tabId === _activeTabId) {
            // 激活相邻标签
            const newIdx = Math.min(idx, _jsonTabs.length - 1);
            _activeTabId = _jsonTabs[newIdx].id;
            const tab = _jsonTabs[newIdx];
            input.value = tab.inputValue;
            renderSubTabs();
            updateGutter();
            if (input.value.trim()) autoProcess();
            else {
                output.innerHTML = '';
                tree.innerHTML = '';
                tree.hidden = true; output.hidden = false;
                treeActions.hidden = false;
                setStatus('idle', '等待输入...');
                inputInfo.textContent = '0 行 · 0 字符';
                outputInfo.textContent = '0 行 · 0 字符';
                currentObj = null;
            }
        } else {
            renderSubTabs();
        }
    }

    subTabList.addEventListener('click', (e) => {
        const btn = e.target.closest('.sub-tab');
        if (!btn) return;
        const tabId = parseInt(btn.dataset.tabId, 10);
        if (isNaN(tabId)) return;
        // 检查是否点了关闭按钮
        if (e.target.closest('.sub-tab-close')) {
            closeTab(tabId);
            return;
        }
        switchToTab(tabId);
    });

    subTabAdd.addEventListener('click', () => addNewTab());

    // ================================================================
    // ===================== 通用工具 =====================
    // ================================================================
    function copyTextSimple(text, label) {
        if (!text) { showToast('内容为空'); return; }
        navigator.clipboard.writeText(text).then(
            () => showToast((label || '内容') + ' 已复制', 'success'),
            () => showToast('复制失败', 'error')
        );
    }

    // data-copy="#selector" / data-copy-from="md5"
    document.addEventListener('click', (e) => {
        const a = e.target.closest('[data-copy]');
        if (a) {
            const sel = a.getAttribute('data-copy');
            const el = document.querySelector(sel);
            if (el) copyTextSimple(el.value !== undefined ? el.value : el.textContent);
            return;
        }
        const b = e.target.closest('[data-copy-from]');
        if (b) {
            const key = b.getAttribute('data-copy-from');
            const el = document.querySelector(`[data-hash="${key}"]`);
            if (el) copyTextSimple(el.textContent);
        }
    });

    // ================================================================
    // ===================== Tab 切换 =====================
    // ================================================================
    const mainNav = document.getElementById('mainNav');
    const panels = document.querySelectorAll('.tab-panel');

    function switchTab(tab) {
        mainNav.querySelectorAll('.nav-item').forEach(a => {
            a.classList.toggle('active', a.dataset.tab === tab);
        });
        panels.forEach(p => {
            p.classList.toggle('active', p.dataset.panel === tab);
        });
        localStorage.setItem('dev-tool-tab', tab);
        window.dispatchEvent(new CustomEvent('devtool:tabchange', { detail: { tab } }));
    }

    mainNav.addEventListener('click', (e) => {
        const a = e.target.closest('.nav-item');
        if (!a) return;
        e.preventDefault();
        switchTab(a.dataset.tab);
    });

    const savedTab = localStorage.getItem('dev-tool-tab');
    if (savedTab) switchTab(savedTab);

    // ================================================================
    // ===================== 时间戳转换 =====================
    // ================================================================
    const tsNowDate = document.getElementById('tsNowDate');
    const tsNowSec = document.getElementById('tsNowSec');
    const tsNowMs = document.getElementById('tsNowMs');

    function pad(n, len = 2) { return String(n).padStart(len, '0'); }
    function fmtDate(d) {
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
    function fmtUTC(d) {
        return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    }

    function refreshNow() {
        const d = new Date();
        tsNowDate.textContent = fmtDate(d);
        const s = Math.floor(d.getTime() / 1000);
        tsNowSec.textContent = s;
        tsNowMs.textContent = d.getTime();
    }
    setInterval(refreshNow, 1000);
    refreshNow();

    // ========== 时间戳 → 日期（自动转换） ==========
    const tsInput = document.getElementById('tsInput');
    const tsUnit = document.getElementById('tsUnit');
    const tsLocal = document.getElementById('tsLocal');
    const tsUtc = document.getElementById('tsUtc');
    const tsIso = document.getElementById('tsIso');

    function tsToDate() {
        const raw = tsInput.value.trim();
        if (!raw) { tsLocal.textContent = '-'; tsUtc.textContent = '-'; tsIso.textContent = '-'; return; }
        const unit = tsUnit.value;
        let n = Number(raw);
        if (isNaN(n) || raw === '') { tsLocal.textContent = '-'; tsUtc.textContent = '-'; tsIso.textContent = '-'; return; }
        let ms;
        if (unit === 's') ms = n * 1000;
        else if (unit === 'ms') ms = n;
        else ms = raw.length >= 13 ? n : n * 1000; // auto
        const d = new Date(ms);
        if (isNaN(d.getTime())) { tsLocal.textContent = '-'; tsUtc.textContent = '-'; tsIso.textContent = '-'; return; }
        tsLocal.textContent = fmtDate(d);
        tsUtc.textContent = fmtUTC(d) + ' (UTC)';
        tsIso.textContent = d.toISOString();
    }

    let tsInputTimer;
    tsInput.addEventListener('input', () => {
        clearTimeout(tsInputTimer);
        tsInputTimer = setTimeout(tsToDate, 300);
    });
    tsUnit.addEventListener('change', tsToDate);
    document.querySelector('[data-action="ts-to-date"]').addEventListener('click', tsToDate);

    // ========== 日期 → 时间戳（支持粘贴 + 自动识别格式 + 日历） ==========

    const dtInput = document.getElementById('dtInput');
    const dtPicker = document.getElementById('dtPicker');
    const dtTsSec = document.getElementById('dtTsSec');
    const dtTsMs = document.getElementById('dtTsMs');

    // 格式自动识别
    function parseDateInput(str) {
        if (!str || !str.trim()) return null;
        str = str.trim();

        // 0a) ISO 8601 含时区信息（T...Z / T...+08:00），直接解析，无需后续处理
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str)) {
            const d = new Date(str);
            if (!isNaN(d.getTime())) return d;
        }

        // 0b) 提取末尾时区信息（人工标注或偏移量）
        let tzOffset = 0;
        let tzKnown = false;
        const tzMatch = str.match(/\s*[\(（]?\s*(UTC|GMT)\s*[\)）]?\s*$/i);
        if (tzMatch) {
            tzOffset = 0;
            tzKnown = true;
            str = str.slice(0, str.length - tzMatch[0].length).trim();
        } else {
            const offsetMatch = str.match(/\s*([+-])(\d{1,2}):?(\d{2})?\s*$/);
            if (offsetMatch) {
                const sign = offsetMatch[1] === '+' ? 1 : -1;
                const hours = parseInt(offsetMatch[2], 10);
                const mins = parseInt(offsetMatch[3] || '0', 10);
                tzOffset = sign * (hours * 60 + mins);
                tzKnown = true;
                str = str.slice(0, str.length - offsetMatch[0].length).trim();
            }
        }

        function adjustTz(d) {
            if (!d || isNaN(d.getTime())) return d;
            if (!tzKnown) return d;
            // d 是浏览器按本地时区解析得到的；校正到用户指定的时区
            return new Date(d.getTime() + (-d.getTimezoneOffset() - tzOffset) * 60000);
        }

        // 1) Unix 时间戳（纯数字）
        if (/^\d+$/.test(str)) {
            const n = parseInt(str, 10);
            if (n > 1e14 && n < 2e14) return new Date(n);           // 微秒
            if (n > 1e11 && n < 1e14) return new Date(n);            // 毫秒
            if (n > 1e8  && n < 1e11) return new Date(n * 1000);    // 秒
            if (n < 1e8)                return new Date(n * 1000);   // 秒（较早时间）
            // 否则不是有效时间戳，往下走
        }

        // 2) 中文字符格式：YYYY年MM月DD日 HH:mm:ss
        const cnMatch = str.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
        if (cnMatch) {
            let rest = str.slice(cnMatch.index + cnMatch[0].length);
            const timeMatch = rest.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
            return adjustTz(new Date(+cnMatch[1], +cnMatch[2] - 1, +cnMatch[3],
                timeMatch ? +timeMatch[1] : 0,
                timeMatch ? +timeMatch[2] : 0,
                timeMatch ? +(timeMatch[3] || 0) : 0));
        }

        // 3) 英文月份缩写：Jan 15, 2025 14:30、15 Jan 2025
        const enMatch = str.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
        if (enMatch) {
            const d = new Date(str);
            if (!isNaN(d.getTime())) return adjustTz(d);
        }

        // 5) 标准化分隔符：将常见分隔符统一为 -
        let normalized = str
            .replace(/\//g, '-')       // 2025/01/15 → 2025-01-15
            .replace(/\s+/g, 'T');     // 2025-01-15 14:30 → 2025-01-15T14:30

        // 处理点号分隔：仅替换日期中的点（如 2025.01.15），不影响毫秒中的点
        if (!/\d{2}:\d{2}:\d{2}\.\d/.test(str)) {
            normalized = normalized.replace(/\./g, '-');
        }

        let d = new Date(normalized);
        if (!isNaN(d.getTime())) return adjustTz(d);

        // 6) 移除 "T" 再试（处理已含 T 但需要空格分隔的情况）
        normalized = str.replace(/\//g, '-').replace(/\s+/g, ' ');
        if (!/\d{2}:\d{2}:\d{2}\.\d/.test(str)) {
            normalized = normalized.replace(/\./g, '-');
        }
        d = new Date(normalized);
        if (!isNaN(d.getTime())) return adjustTz(d);

        // 7) 尝试 YYYYMMDD / YYYYMMDDHHmmss
        const compactMatch = str.match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?$/);
        if (compactMatch) {
            return adjustTz(new Date(+compactMatch[1], +compactMatch[2] - 1, +compactMatch[3],
                + (compactMatch[4] || 0), + (compactMatch[5] || 0), + (compactMatch[6] || 0)));
        }

        return null;
    }

    // 执行日期 → 时间戳转换
    function dateToTs(v) {
        if (!v || !v.trim()) {
            dtTsSec.textContent = '-';
            dtTsMs.textContent = '-';
            return;
        }
        const d = parseDateInput(v);
        if (!d || isNaN(d.getTime())) {
            dtTsSec.textContent = '-';
            dtTsMs.textContent = '-';
            return;
        }
        dtTsSec.textContent = Math.floor(d.getTime() / 1000);
        dtTsMs.textContent = d.getTime();
    }

    // 转换按钮
    document.querySelector('[data-action="date-to-ts"]').addEventListener('click', () => {
        const v = dtInput.value;
        if (!v.trim()) { showToast('请粘贴或输入日期'); return; }
        const d = parseDateInput(v);
        if (!d || isNaN(d.getTime())) { showToast('无法识别日期格式，支持：2025-07-09 14:30、2025/07/09、2025年7月9日、时间戳 等', 'warning'); return; }
        dateToTs(v);
    });

    // 实时输入时自动转换（300ms 防抖）
    let dtDebounce;
    dtInput.addEventListener('input', () => {
        clearTimeout(dtDebounce);
        dtDebounce = setTimeout(() => dateToTs(dtInput.value), 300);
    });

    // Enter 键立即转换
    dtInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { clearTimeout(dtDebounce); dateToTs(dtInput.value); }
    });

    // 日历按钮：触发隐藏的 datetime-local 选择器
    document.getElementById('dtCalendarBtn').addEventListener('click', () => {
        if (dtPicker.showPicker) {
            // 先设当前值映射到 picker
            const cur = parseDateInput(dtInput.value) || new Date();
            dtPicker.value = `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}T${pad(cur.getHours())}:${pad(cur.getMinutes())}:${pad(cur.getSeconds())}`;
            dtPicker.showPicker();
        } else {
            dtPicker.focus();
            dtPicker.click();
        }
    });
    dtPicker.addEventListener('change', () => {
        if (dtPicker.value) {
            const d = new Date(dtPicker.value);
            dtInput.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
            dateToTs(dtInput.value);
        }
    });

    // 初始化当前时间
    (function initDt() {
        const d = new Date();
        dtInput.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        dateToTs(dtInput.value);
    })();

    // ---------- 自由字段时间 → Unix 时间戳 ----------
    const tsFieldIds = ['tsYear', 'tsMonth', 'tsDay', 'tsHour', 'tsMin', 'tsSec'];
    const tsFieldsResult = document.getElementById('tsFieldsResult');
    const tsFieldsUnit = document.getElementById('tsFieldsUnit');

    document.getElementById('tsFieldsNow').addEventListener('click', () => {
        const d = new Date();
        document.getElementById('tsYear').value = d.getFullYear();
        document.getElementById('tsMonth').value = d.getMonth() + 1;
        document.getElementById('tsDay').value = d.getDate();
        document.getElementById('tsHour').value = d.getHours();
        document.getElementById('tsMin').value = d.getMinutes();
        document.getElementById('tsSec').value = d.getSeconds();
    });

    document.getElementById('tsFieldsConvert').addEventListener('click', () => {
        const y = parseInt(document.getElementById('tsYear').value, 10) || 0;
        const mo = parseInt(document.getElementById('tsMonth').value, 10) || 1;
        const day = parseInt(document.getElementById('tsDay').value, 10) || 1;
        const h = parseInt(document.getElementById('tsHour').value, 10) || 0;
        const mi = parseInt(document.getElementById('tsMin').value, 10) || 0;
        const s = parseInt(document.getElementById('tsSec').value, 10) || 0;

        if (y < 1970 || y > 2099) { showToast('年份范围 1970-2099', 'error'); return; }

        const d = new Date(y, mo - 1, day, h, mi, s);
        if (isNaN(d.getTime())) { showToast('日期不合法', 'error'); return; }

        const unit = tsFieldsUnit.value;
        if (unit === 'ms') {
            tsFieldsResult.value = d.getTime();
        } else {
            tsFieldsResult.value = Math.floor(d.getTime() / 1000);
        }
    });

    // ================================================================
    // ===================== Base64 =====================
    // ================================================================
    const b64Left = document.getElementById('b64Left');
    const b64Right = document.getElementById('b64Right');
    const b64UrlSafe = document.getElementById('b64UrlSafe');
    const b64NoPad = document.getElementById('b64NoPad');
    const b64Status = document.getElementById('b64Status');

    function b64Encode(str) {
        // UTF-8 安全编码
        const bytes = new TextEncoder().encode(str);
        let bin = '';
        bytes.forEach(b => bin += String.fromCharCode(b));
        let out = btoa(bin);
        if (b64UrlSafe.checked) out = out.replace(/\+/g, '-').replace(/\//g, '_');
        if (b64NoPad.checked) out = out.replace(/=+$/, '');
        return out;
    }
    function b64Decode(str) {
        let s = str.trim();
        if (b64UrlSafe.checked) s = s.replace(/-/g, '+').replace(/_/g, '/');
        // 补齐 padding
        const pad = s.length % 4;
        if (pad === 2) s += '==';
        else if (pad === 3) s += '=';
        else if (pad === 1) throw new Error('非法的 Base64 字符串');
        const bin = atob(s);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder().decode(bytes);
    }

    document.querySelector('[data-action="b64-encode"]').addEventListener('click', () => {
        try {
            b64Right.value = b64Encode(b64Left.value);
            b64Status.textContent = `编码成功，${b64Right.value.length} 字符`;
            b64Status.style.color = 'var(--success)';
        } catch (e) {
            b64Status.textContent = '编码失败：' + e.message;
            b64Status.style.color = 'var(--danger)';
        }
    });
    document.querySelector('[data-action="b64-decode"]').addEventListener('click', () => {
        try {
            b64Left.value = b64Decode(b64Right.value);
            b64Status.textContent = `解码成功，${b64Left.value.length} 字符`;
            b64Status.style.color = 'var(--success)';
        } catch (e) {
            b64Status.textContent = '解码失败：' + e.message;
            b64Status.style.color = 'var(--danger)';
        }
    });
    document.querySelector('[data-action="b64-clear"]').addEventListener('click', () => {
        b64Left.value = ''; b64Right.value = ''; b64Status.textContent = '就绪';
        b64Status.style.color = '';
    });

    // ================================================================
    // ===================== URL 编解码 =====================
    // ================================================================
    const urlLeft = document.getElementById('urlLeft');
    const urlRight = document.getElementById('urlRight');
    const urlStatus = document.getElementById('urlStatus');

    function urlMode() {
        const r = document.querySelector('input[name="urlMode"]:checked');
        return r ? r.value : 'component';
    }

    document.querySelector('[data-action="url-encode"]').addEventListener('click', () => {
        try {
            const fn = urlMode() === 'uri' ? encodeURI : encodeURIComponent;
            urlRight.value = fn(urlLeft.value);
            urlStatus.textContent = '编码成功';
            urlStatus.style.color = 'var(--success)';
        } catch (e) {
            urlStatus.textContent = '编码失败：' + e.message;
            urlStatus.style.color = 'var(--danger)';
        }
    });
    document.querySelector('[data-action="url-decode"]').addEventListener('click', () => {
        try {
            const fn = urlMode() === 'uri' ? decodeURI : decodeURIComponent;
            urlLeft.value = fn(urlRight.value);
            urlStatus.textContent = '解码成功';
            urlStatus.style.color = 'var(--success)';
        } catch (e) {
            urlStatus.textContent = '解码失败：' + e.message;
            urlStatus.style.color = 'var(--danger)';
        }
    });
    document.querySelector('[data-action="url-clear"]').addEventListener('click', () => {
        urlLeft.value = ''; urlRight.value = ''; urlStatus.textContent = '就绪';
        urlStatus.style.color = '';
    });

    document.querySelector('[data-action="url-parse"]').addEventListener('click', () => {
        const raw = document.getElementById('urlParseInput').value.trim();
        const out = document.getElementById('urlParseResult');
        if (!raw) { out.innerHTML = ''; return; }
        try {
            const u = new URL(raw);
            const items = [
                ['协议 Protocol', u.protocol],
                ['用户名 Username', u.username || '-'],
                ['密码 Password', u.password || '-'],
                ['主机名 Hostname', u.hostname],
                ['端口 Port', u.port || '-'],
                ['路径 Pathname', u.pathname],
                ['查询 Search', u.search || '-'],
                ['哈希 Hash', u.hash || '-'],
                ['源 Origin', u.origin]
            ];
            let html = items.map(([k, v]) => `<div><span class="kv-key">${k}</span><span class="kv-val mono">${escapeHTML(v)}</span></div>`).join('');
            // query params
            if (u.search) {
                html += '<div><span class="kv-key">Query 参数</span><span class="kv-val mono"></span></div>';
                u.searchParams.forEach((val, key) => {
                    html += `<div><span class="kv-key" style="padding-left:16px">• ${escapeHTML(key)}</span><span class="kv-val mono">${escapeHTML(val)}</span></div>`;
                });
            }
            out.innerHTML = html;
        } catch (e) {
            out.innerHTML = `<div style="color:var(--danger)">解析失败：${escapeHTML(e.message)}</div>`;
        }
    });

    // ================================================================
    // ===================== 哈希计算 =====================
    // ================================================================
    const hashInput = document.getElementById('hashInput');
    const hashStatus = document.getElementById('hashStatus');

    function bytesToHex(buf) {
        const b = new Uint8Array(buf);
        let s = '';
        for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
        return s;
    }
    async function sha(algo, str) {
        const data = new TextEncoder().encode(str);
        const buf = await crypto.subtle.digest(algo, data);
        return bytesToHex(buf);
    }

    document.querySelector('[data-action="hash-calc"]').addEventListener('click', async () => {
        const text = hashInput.value;
        const setVal = (name, v) => {
            const el = document.querySelector(`[data-hash="${name}"]`);
            if (el) el.textContent = v;
        };
        if (!text) { ['md5', 'sha1', 'sha256', 'sha512'].forEach(k => setVal(k, '-')); return; }
        try {
            hashStatus.textContent = '计算中...';
            // MD5 使用 spark-md5
            if (window.SparkMD5) setVal('md5', SparkMD5.hash(text));
            else setVal('md5', '（SparkMD5 未加载）');
            const [s1, s256, s512] = await Promise.all([
                sha('SHA-1', text),
                sha('SHA-256', text),
                sha('SHA-512', text)
            ]);
            setVal('sha1', s1);
            setVal('sha256', s256);
            setVal('sha512', s512);
            hashStatus.textContent = '完成 ✓';
            hashStatus.style.color = 'var(--success)';
        } catch (e) {
            hashStatus.textContent = '失败：' + e.message;
            hashStatus.style.color = 'var(--danger)';
        }
    });
    document.querySelector('[data-action="hash-clear"]').addEventListener('click', () => {
        hashInput.value = '';
        ['md5', 'sha1', 'sha256', 'sha512'].forEach(k => {
            const el = document.querySelector(`[data-hash="${k}"]`);
            if (el) el.textContent = '-';
        });
        hashStatus.textContent = '就绪'; hashStatus.style.color = '';
    });

    // ================================================================
    // ===================== UUID =====================
    // ================================================================
    const uuidVersionEl = document.getElementById('uuidVersion');
    const uuidNsRow = document.getElementById('uuidNsRow');
    const uuidNamespaceEl = document.getElementById('uuidNamespace');
    const uuidCustomNs = document.getElementById('uuidCustomNs');
    const uuidNameEl = document.getElementById('uuidName');

    // 版本切换时显示/隐藏命名空间行
    function syncNsRow() {
        const v = uuidVersionEl.value;
        const needNs = (v === '3' || v === '5');
        uuidNsRow.hidden = !needNs;
        uuidNsRow.style.display = needNs ? 'flex' : 'none';
    }
    uuidVersionEl.addEventListener('change', syncNsRow);
    syncNsRow(); // 初始化

    uuidNamespaceEl.addEventListener('change', () => {
        const isCustom = uuidNamespaceEl.value === 'custom';
        uuidCustomNs.hidden = !isCustom;
        uuidCustomNs.style.display = isCustom ? '' : 'none';
    });

    // 辅助：bytes → hex UUID 字符串
    function bytesToUUID(b) {
        const h = Array.from(b, x => x.toString(16).padStart(2, '0'));
        return `${h.slice(0,4).join('')}-${h.slice(4,6).join('')}-${h.slice(6,8).join('')}-${h.slice(8,10).join('')}-${h.slice(10,16).join('')}`;
    }

    // v4: 完全随机
    function uuidv4() {
        if (crypto.randomUUID) return crypto.randomUUID();
        const b = crypto.getRandomValues(new Uint8Array(16));
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        return bytesToUUID(b);
    }

    // v1: 时间戳 + 随机节点（浏览器无法获取真实 MAC，用随机替代）
    function uuidv1() {
        // 100ns intervals since 1582-10-15
        const epoch = Date.UTC(1582, 9, 15);
        const now = Date.now();
        const ticks = BigInt(now - epoch) * 10000n + BigInt(Math.floor(Math.random() * 10000));
        const timeLow = Number(ticks & 0xFFFFFFFFn);
        const timeMid = Number((ticks >> 32n) & 0xFFFFn);
        const timeHi = Number((ticks >> 48n) & 0x0FFFn) | 0x1000;
        const clockSeq = (Math.random() * 0x3FFF | 0) | 0x8000;
        const node = crypto.getRandomValues(new Uint8Array(6));
        node[0] |= 0x01; // multicast bit

        const b = new Uint8Array(16);
        // time_low
        b[0] = (timeLow >> 24) & 0xFF; b[1] = (timeLow >> 16) & 0xFF;
        b[2] = (timeLow >> 8) & 0xFF; b[3] = timeLow & 0xFF;
        // time_mid
        b[4] = (timeMid >> 8) & 0xFF; b[5] = timeMid & 0xFF;
        // time_hi_and_version
        b[6] = (timeHi >> 8) & 0xFF; b[7] = timeHi & 0xFF;
        // clock_seq
        b[8] = (clockSeq >> 8) & 0xFF; b[9] = clockSeq & 0xFF;
        // node
        for (let i = 0; i < 6; i++) b[10 + i] = node[i];
        return bytesToUUID(b);
    }

    // v7: 时间有序 + 随机（RFC 9562）
    function uuidv7() {
        const b = crypto.getRandomValues(new Uint8Array(16));
        const ts = Date.now();
        // 48-bit timestamp in ms
        b[0] = (ts / 2**40) & 0xFF;
        b[1] = (ts / 2**32) & 0xFF;
        b[2] = (ts / 2**24) & 0xFF;
        b[3] = (ts / 2**16) & 0xFF;
        b[4] = (ts / 2**8) & 0xFF;
        b[5] = ts & 0xFF;
        // version 7
        b[6] = (b[6] & 0x0f) | 0x70;
        // variant 10xx
        b[8] = (b[8] & 0x3f) | 0x80;
        return bytesToUUID(b);
    }

    // v3 / v5: 命名空间 + 名称
    async function uuidv3or5(version, nsUuid, name) {
        // 解析命名空间 UUID 为 16 字节
        const nsHex = nsUuid.replace(/-/g, '');
        const nsBytes = new Uint8Array(16);
        for (let i = 0; i < 16; i++) nsBytes[i] = parseInt(nsHex.substr(i * 2, 2), 16);
        // 拼接 namespace + name
        const nameBytes = new TextEncoder().encode(name);
        const data = new Uint8Array(nsBytes.length + nameBytes.length);
        data.set(nsBytes); data.set(nameBytes, nsBytes.length);

        let hashBytes;
        if (version === 3) {
            // MD5
            if (window.SparkMD5) {
                const hex = SparkMD5.ArrayBuffer.hash(data.buffer);
                hashBytes = new Uint8Array(16);
                for (let i = 0; i < 16; i++) hashBytes[i] = parseInt(hex.substr(i * 2, 2), 16);
            } else {
                throw new Error('SparkMD5 未加载，v3 不可用');
            }
        } else {
            // SHA-1
            const buf = await crypto.subtle.digest('SHA-1', data);
            hashBytes = new Uint8Array(buf).slice(0, 16);
        }
        // 设置版本和变体
        hashBytes[6] = (hashBytes[6] & 0x0f) | (version === 3 ? 0x30 : 0x50);
        hashBytes[8] = (hashBytes[8] & 0x3f) | 0x80;
        return bytesToUUID(hashBytes);
    }

    document.querySelector('[data-action="uuid-gen"]').addEventListener('click', async () => {
        const ver = uuidVersionEl.value;
        const n = Math.max(1, Math.min(1000, parseInt(document.getElementById('uuidCount').value, 10) || 1));
        const upper = document.getElementById('uuidUpper').checked;
        const noDash = document.getElementById('uuidNoDash').checked;
        const arr = [];

        try {
            for (let i = 0; i < n; i++) {
                let id;
                if (ver === '4') {
                    id = uuidv4();
                } else if (ver === '1') {
                    id = uuidv1();
                } else if (ver === '7') {
                    id = uuidv7();
                } else if (ver === '3' || ver === '5') {
                    let ns = uuidNamespaceEl.value;
                    if (ns === 'custom') ns = uuidCustomNs.value.trim();
                    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ns)) {
                        showToast('命名空间 UUID 格式不正确', 'error'); return;
                    }
                    const name = uuidNameEl.value;
                    if (!name) { showToast('请输入名称', 'error'); return; }
                    // v3/v5 同输入同输出，批量时加序号区分
                    id = await uuidv3or5(parseInt(ver), ns, n > 1 ? name + i : name);
                }
                if (noDash) id = id.replace(/-/g, '');
                if (upper) id = id.toUpperCase();
                arr.push(id);
            }
            document.getElementById('uuidOutput').value = arr.join('\n');
        } catch (e) {
            showToast('生成失败：' + e.message, 'error');
        }
    });
    document.querySelector('[data-action="uuid-copy"]').addEventListener('click', () => {
        copyTextSimple(document.getElementById('uuidOutput').value, 'UUID 列表');
    });
    document.querySelector('[data-action="uuid-clear"]').addEventListener('click', () => {
        document.getElementById('uuidOutput').value = '';
    });

    // ================================================================
    // ===================== 字符串格式化 =====================
    // ================================================================
    const strfmtLeft = document.getElementById('strfmtLeft');
    const strfmtRight = document.getElementById('strfmtRight');
    const strfmtStatus = document.getElementById('strfmtStatus');
    const strfmtTab2Space = document.getElementById('strfmtTab2Space');
    const strfmtTrimLines = document.getElementById('strfmtTrimLines');
    const strfmtRemoveEmpty = document.getElementById('strfmtRemoveEmpty');
    const strfmtAuto = document.getElementById('strfmtAuto');

    function doStrFormat() {
        let s = strfmtLeft.value;
        if (!s) { strfmtRight.value = ''; strfmtStatus.textContent = '就绪'; return; }

        // 替换转义字符为真实字符
        s = s.replace(/\\n/g, '\n');
        s = s.replace(/\\t/g, '\t');
        s = s.replace(/\\r/g, '\r');
        s = s.replace(/\\\\/g, '\\');

        // 选项
        if (strfmtTab2Space.checked) s = s.replace(/\t/g, '    ');
        if (strfmtTrimLines.checked) s = s.split('\n').map(l => l.trim()).join('\n');
        if (strfmtRemoveEmpty.checked) s = s.replace(/\n{3,}/g, '\n\n');

        strfmtRight.value = s;
        const lineCount = s.split('\n').length;
        strfmtStatus.textContent = `已格式化，${lineCount} 行 · ${s.length} 字符`;
        strfmtStatus.style.color = 'var(--success)';
    }

function doStrReverse() {
        let s = strfmtRight.value;
        if (!s) { strfmtLeft.value = ''; strfmtStatus.textContent = '就绪'; return; }

        // 反向：真实换行/制表符转回转义字符
        s = s.replace(/\\/g, '\\\\');
        s = s.replace(/\t/g, '\\t');
        s = s.replace(/\r/g, '\\r');
        s = s.replace(/\n/g, '\\n');

        strfmtLeft.value = s;
        strfmtStatus.textContent = `已逆向转换，${s.length} 字符`;
        strfmtStatus.style.color = 'var(--success)';
    }

    // 去转义：去除反斜杠（\' → '、\" → "、\\ → \ 等），不转换为换行/制表符
    function doStrUnescape() {
        let s = strfmtLeft.value;
        if (!s) { strfmtRight.value = ''; strfmtStatus.textContent = '就绪'; return; }

        // 先将 \\ 还原为 \（避免后续把 \\' 误判为 \'）
        s = s.replace(/\\\\/g, '\u0000'); // 临时占位
        // 去除常见转义字符前的反斜杠
        s = s.replace(/\\(['"`\\/bfnrtv])/g, '$1');
        s = s.replace(/\\(.)/g, '$1');    // 兜底：其余反斜杠+字符 去反斜杠
        s = s.replace(/\u0000/g, '\\');   // 还原被占位的 \\ 为一个 \

        strfmtRight.value = s;
        const lineCount = s.split('\n').length;
        strfmtStatus.textContent = `已去转义，${lineCount} 行 · ${s.length} 字符`;
        strfmtStatus.style.color = 'var(--success)';
    }

    document.getElementById('strfmtFormat').addEventListener('click', doStrFormat);
    document.getElementById('strfmtReverse').addEventListener('click', doStrReverse);
    document.getElementById('strfmtUnescape').addEventListener('click', doStrUnescape);
    document.getElementById('strfmtClear').addEventListener('click', () => {
        strfmtLeft.value = '';
        strfmtRight.value = '';
        strfmtStatus.textContent = '就绪';
        strfmtStatus.style.color = '';
    });

    // 选项变化时重新格式化
    [strfmtTab2Space, strfmtTrimLines, strfmtRemoveEmpty].forEach(el => {
        el.addEventListener('change', () => { if (strfmtLeft.value) doStrFormat(); });
    });

    // 自动格式化（输入时）
    let strfmtTimer;
    strfmtLeft.addEventListener('input', () => {
        if (!strfmtAuto.checked) return;
        clearTimeout(strfmtTimer);
        strfmtTimer = setTimeout(doStrFormat, 200);
    });

    // ---- Markdown 预览 ----
    let _strfmtMdMode = false;
    const strfmtMdPreview = document.getElementById('strfmtMdPreview');
    const strfmtMdToggle = document.getElementById('strfmtMdToggle');

    // 初始化 Mermaid
    let _mermaidReady = false;
    try { mermaid.initialize({ startOnLoad: false, theme: 'default' }); _mermaidReady = true; } catch(e) {}

    let _mermaidCounter = 0;

    async function renderMdPreview() {
        const text = strfmtRight.value;
        if (!text) { strfmtMdPreview.innerHTML = '<p style="color:var(--text-muted)">暂无内容</p>'; return; }
        try {
            let html = marked.parse(text, { breaks: true, gfm: true });
            // 渲染 Mermaid 代码块
            if (_mermaidReady) {
                const mermaidRegex = /<code class="language-mermaid">([\s\S]*?)<\/code>/g;
                const matches = [];
                let m;
                while ((m = mermaidRegex.exec(html)) !== null) {
                    matches.push({ full: m[0], code: m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') });
                }
                if (matches.length) {
                    for (const match of matches) {
                        const id = `mermaid-${++_mermaidCounter}`;
                        try {
                            const { svg } = await mermaid.render(id, match.code);
                            html = html.replace(match.full, svg);
                        } catch (e) {
                            html = html.replace(match.full, `<div style="color:var(--danger);font-size:13px;">Mermaid 渲染失败: ${e.message || e}</div>`);
                        }
                    }
                }
            }
            strfmtMdPreview.innerHTML = html;
        } catch (e) {
            strfmtMdPreview.innerHTML = '<p style="color:var(--danger)">Markdown 解析失败</p>';
        }
    }

    strfmtMdToggle.addEventListener('click', () => {
        _strfmtMdMode = !_strfmtMdMode;
        if (_strfmtMdMode) {
            renderMdPreview();
            strfmtRight.style.display = 'none';
            strfmtMdPreview.hidden = false;
            strfmtMdToggle.textContent = '纯文本';
        } else {
            strfmtRight.style.display = '';
            strfmtMdPreview.hidden = true;
            strfmtMdToggle.textContent = 'Markdown 预览';
        }
    });

    // 格式化后自动刷新 Markdown 预览
    const _origDoStrFormat = doStrFormat;
    doStrFormat = function() {
        _origDoStrFormat();
        if (_strfmtMdMode) renderMdPreview();
    };

    // ---- 字符串拼接与切割（复用 strfmtLeft / strfmtRight） ----
    const strJoinSep = document.getElementById('strJoinSep');
    const strJoinCustomSep = document.getElementById('strJoinCustomSep');
    const strJoinTrim = document.getElementById('strJoinTrim');
    const strJoinSkipEmpty = document.getElementById('strJoinSkipEmpty');
    const strJoinQuote = document.getElementById('strJoinQuote');

    strJoinSep.addEventListener('change', () => {
        strJoinCustomSep.style.display = strJoinSep.value === 'custom' ? '' : 'none';
    });

    function getJoinSep() {
        return strJoinSep.value === 'custom' ? strJoinCustomSep.value : strJoinSep.value;
    }

    // 拼接：多行 → 单行，用分隔符连接
    function doStrJoin() {
        const raw = strfmtLeft.value;
        if (!raw) { strfmtRight.value = ''; strfmtStatus.textContent = '就绪'; return; }
        const sep = getJoinSep();
        let items = raw.split('\n');
        if (strJoinTrim.checked) items = items.map(s => s.trim());
        if (strJoinSkipEmpty.checked) items = items.filter(s => s.length > 0);
        if (strJoinQuote.checked) items = items.map(s => '"' + s.replace(/"/g, '\\"') + '"');
        const result = items.join(sep);
        strfmtRight.value = result;
        strfmtStatus.textContent = `已拼接，${items.length} 项 · ${result.length} 字符 · 分隔符 "${sep}"`;
        strfmtStatus.style.color = 'var(--success)';
    }

    // 切割：单行 → 多行，按分隔符拆分
    function doStrSplit() {
        const raw = strfmtLeft.value;
        if (!raw) { strfmtRight.value = ''; strfmtStatus.textContent = '就绪'; return; }
        const sep = getJoinSep();
        let items = raw.split(sep);
        if (strJoinTrim.checked) items = items.map(s => s.trim());
        if (strJoinSkipEmpty.checked) items = items.filter(s => s.length > 0);
        // 去除引号包裹
        if (strJoinQuote.checked) items = items.map(s => {
            if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
                return s.slice(1, -1);
            }
            return s;
        });
        const result = items.join('\n');
        strfmtRight.value = result;
        strfmtStatus.textContent = `已切割，${items.length} 项 · 分隔符 "${sep}"`;
        strfmtStatus.style.color = 'var(--success)';
    }

    document.getElementById('strfmtJoin').addEventListener('click', doStrJoin);
    document.getElementById('strfmtSplit').addEventListener('click', doStrSplit);

    // ================================================================
    // ===================== 常用导航 =====================
    // ================================================================
    const navSearchInput = document.getElementById('navSearchInput');
    const navList = document.getElementById('navList');
    if (navSearchInput) {
        navSearchInput.addEventListener('input', () => {
            const q = navSearchInput.value.trim().toLowerCase();
            const groups = navList.querySelectorAll('.nav-group');
            groups.forEach(g => {
                if (!q) { g.style.display = ''; return; }
                const cards = g.querySelectorAll('.nav-card');
                let anyMatch = false;
                cards.forEach(c => {
                    const name = (c.querySelector('.nav-card-name')?.textContent || '').toLowerCase();
                    const desc = (c.querySelector('.nav-card-desc')?.textContent || '').toLowerCase();
                    const match = name.includes(q) || desc.includes(q);
                    c.style.display = match ? '' : 'none';
                    if (match) anyMatch = true;
                });
                g.style.display = anyMatch ? '' : 'none';
            });
        });
    }

    // ================================================================
    // ===================== 正则测试 =====================
    // ================================================================
    const regexPattern = document.getElementById('regexPattern');
    const regexFlags = document.getElementById('regexFlags');
    const regexInput = document.getElementById('regexInput');
    const regexHL = document.getElementById('regexHighlight');
    const regexList = document.getElementById('regexMatches');
    const regexStatus = document.getElementById('regexStatus');
    const flagBoxes = document.querySelectorAll('.rf');

    function syncFlagsFromBoxes() {
        let s = '';
        flagBoxes.forEach(b => { if (b.checked) s += b.value; });
        regexFlags.value = s;
    }
    function syncBoxesFromFlags() {
        const s = regexFlags.value;
        flagBoxes.forEach(b => { b.checked = s.includes(b.value); });
    }
    flagBoxes.forEach(b => b.addEventListener('change', () => { syncFlagsFromBoxes(); runRegex(); }));
    regexFlags.addEventListener('input', () => { syncBoxesFromFlags(); runRegex(); });
    regexPattern.addEventListener('input', runRegex);
    regexInput.addEventListener('input', runRegex);

    function runRegex() {
        const pat = regexPattern.value;
        const flagsRaw = regexFlags.value;
        const text = regexInput.value;
        if (!pat) {
            regexHL.innerHTML = escapeHTML(text).replace(/\n/g, '<br/>');
            regexList.innerHTML = '';
            regexStatus.textContent = '就绪';
            regexStatus.style.color = '';
            return;
        }
        let re;
        try {
            // 确保含 g 以便 matchAll 等工作
            const flags = flagsRaw.includes('g') ? flagsRaw : flagsRaw + 'g';
            re = new RegExp(pat, flags);
        } catch (e) {
            regexStatus.textContent = '正则无效：' + e.message;
            regexStatus.style.color = 'var(--danger)';
            regexHL.textContent = text;
            regexList.innerHTML = '';
            return;
        }
        const matches = [...text.matchAll(re)];
        // 高亮
        let html = '';
        let last = 0;
        matches.forEach(m => {
            const start = m.index;
            const end = start + m[0].length;
            html += escapeHTML(text.slice(last, start));
            html += `<span class="hl">${escapeHTML(m[0])}</span>`;
            last = end;
            if (m[0].length === 0) last++; // 防止零宽匹配死循环
        });
        html += escapeHTML(text.slice(last));
        regexHL.innerHTML = html.replace(/\n/g, '<br/>') || '&nbsp;';
        // 匹配列表
        if (matches.length === 0) {
            regexList.innerHTML = '<div style="color:var(--text-muted);padding:8px">无匹配</div>';
        } else {
            regexList.innerHTML = matches.map((m, i) => {
                const groups = m.slice(1).map((g, j) => g !== undefined
                    ? `<span class="kv-key" style="width:auto;margin-left:8px">组${j + 1}</span><span class="match-val">${escapeHTML(g)}</span>`
                    : '').join('');
                return `<div class="match-row"><span class="match-idx">#${i + 1}</span><span class="match-val">${escapeHTML(m[0])}</span>${groups}</div>`;
            }).join('');
        }
        regexStatus.textContent = `匹配 ${matches.length} 次`;
        regexStatus.style.color = matches.length ? 'var(--success)' : 'var(--text-muted)';
    }

    // ================================================================
    // ===================== HTTP 请求（Postman 风格） =====================
    // ================================================================
    const httpMethodEl = document.getElementById('httpMethod');
    const httpUrlEl = document.getElementById('httpUrl');
    const httpSendBtn = document.getElementById('httpSend');
    const httpSaveBtn = document.getElementById('httpSave');
    const httpParamsEl = document.getElementById('httpParams');
    const httpHeadersEl = document.getElementById('httpHeaders');
    const httpBodyEl = document.getElementById('httpBody');
    const httpFormEditor = document.getElementById('httpFormEditor');
    const httpFormAddBtn = document.getElementById('httpFormAdd');
    const httpRespStatus = document.getElementById('httpRespStatus');
    const httpRespTime = document.getElementById('httpRespTime');
    const httpRespSize = document.getElementById('httpRespSize');
    const httpRespBody = document.getElementById('httpRespBody');
    const httpRespHeaders = document.getElementById('httpRespHeaders');
    const httpRespRaw = document.getElementById('httpRespRaw');
    const httpHistoryEl = document.getElementById('httpHistory');

    let lastRespText = '';
    let lastRespContentType = '';

    // 默认代理地址：当前网页同源的 /proxy/ 路径（同源不触发 CORS 预检）
    (function initProxyUrl() {
        const el = document.getElementById('httpProxyUrl');
        if (!el.value) {
            const loc = window.location;
            el.value = `${loc.protocol}//${loc.host}/proxy/`;
        }
    })();

    // ---- 子 tab 切换（请求 / 响应） ----
    document.getElementById('httpReqTabs').addEventListener('click', (e) => {
        const b = e.target.closest('.http-tab');
        if (!b) return;
        const name = b.dataset.httpsub;
        document.querySelectorAll('#httpReqTabs .http-tab').forEach(x => x.classList.toggle('active', x === b));
        document.querySelectorAll('.http-subpanel[data-httpsub]').forEach(p => p.classList.toggle('active', p.dataset.httpsub === name));
    });

    document.querySelectorAll('.http-tabs.sub').forEach(grp => {
        grp.addEventListener('click', (e) => {
            const b = e.target.closest('.http-tab');
            if (!b) return;
            const name = b.dataset.httpresp;
            grp.querySelectorAll('.http-tab').forEach(x => x.classList.toggle('active', x === b));
            document.querySelectorAll('.http-subpanel[data-httpresp]').forEach(p => p.classList.toggle('active', p.dataset.httpresp === name));
        });
    });

    // ---- KV 编辑器 ----
    function kvRow(key = '', val = '', enabled = true) {
        const row = document.createElement('div');
        row.className = 'kv-row';
        row.innerHTML = `
            <input type="checkbox" ${enabled ? 'checked' : ''} />
            <input type="text" class="kv-k" placeholder="Key" value="${escapeHTML(key)}" />
            <input type="text" class="kv-v" placeholder="Value" value="${escapeHTML(val)}" />
            <button class="kv-del" title="删除">×</button>
        `;
        row.querySelector('.kv-del').addEventListener('click', () => row.remove());
        return row;
    }

    function kvRead(container) {
        const out = [];
        container.querySelectorAll('.kv-row').forEach(r => {
            const on = r.querySelector('input[type=checkbox]').checked;
            const k = r.querySelector('.kv-k').value.trim();
            const v = r.querySelector('.kv-v').value;
            if (on && k) out.push([k, v]);
        });
        return out;
    }

    function kvWrite(container, list) {
        container.innerHTML = '';
        (list || []).forEach(([k, v]) => container.appendChild(kvRow(k, v, true)));
        if (!list || !list.length) container.appendChild(kvRow());
    }

    document.querySelectorAll('[data-kvadd]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-kvadd');
            document.getElementById(id).appendChild(kvRow());
        });
    });
    httpFormAddBtn.addEventListener('click', () => httpFormEditor.appendChild(kvRow()));

    // 初始空行
    kvWrite(httpParamsEl, []);
    kvWrite(httpHeadersEl, [['Content-Type', 'application/json']]);
    kvWrite(httpFormEditor, []);

    // ---- Body 类型切换 ----
    document.querySelectorAll('input[name="bodyType"]').forEach(r => {
        r.addEventListener('change', () => {
            const v = document.querySelector('input[name="bodyType"]:checked').value;
            httpBodyEl.hidden = (v === 'none' || v === 'form');
            httpFormEditor.hidden = (v !== 'form');
            httpFormAddBtn.hidden = (v !== 'form');
        });
    });

    // ---- Auth 类型切换 ----
    document.getElementById('httpAuthType').addEventListener('change', (e) => {
        const v = e.target.value;
        document.getElementById('httpAuthBearer').hidden = (v !== 'bearer');
        document.getElementById('httpAuthBasic').hidden = (v !== 'basic');
    });

    // ---- URL <-> Params 双向同步（发送前会从 UI 收集） ----
    httpUrlEl.addEventListener('blur', () => {
        const raw = httpUrlEl.value.trim();
        if (!raw) return;
        try {
            const u = new URL(raw);
            const list = [];
            u.searchParams.forEach((v, k) => list.push([k, v]));
            if (list.length) kvWrite(httpParamsEl, list);
        } catch {}
    });

    // ---- 构建最终 URL + Options ----
    function buildRequest() {
        let url = httpUrlEl.value.trim();
        if (!url) throw new Error('请先输入请求 URL');
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

        // 合并 Params 到 URL
        const params = kvRead(httpParamsEl);
        if (params.length) {
            const u = new URL(url);
            params.forEach(([k]) => u.searchParams.delete(k));
            params.forEach(([k, v]) => u.searchParams.append(k, v));
            url = u.toString();
        }

        // CORS 代理
        const useProxy = document.getElementById('httpCorsProxy').checked;
        let fetchUrl = url;
        if (useProxy) {
            const defaultProxy = `${location.protocol}//${location.host}/proxy/`;
            const proxyPrefix = document.getElementById('httpProxyUrl').value.trim() || defaultProxy;
            fetchUrl = proxyPrefix + url;
        }

        const headers = new Headers();
        kvRead(httpHeadersEl).forEach(([k, v]) => headers.set(k, v));

        // Auth
        const at = document.getElementById('httpAuthType').value;
        if (at === 'bearer') {
            const t = document.getElementById('httpAuthToken').value.trim();
            if (t) headers.set('Authorization', 'Bearer ' + t);
        } else if (at === 'basic') {
            const u = document.getElementById('httpAuthUser').value;
            const p = document.getElementById('httpAuthPass').value;
            headers.set('Authorization', 'Basic ' + btoa(u + ':' + p));
        }

        const method = httpMethodEl.value;
        const useCreds = document.getElementById('httpCreds').checked && !useProxy;
        const opts = {
            method,
            headers,
            cache: document.getElementById('httpNoCache').checked ? 'no-store' : 'default',
            credentials: useCreds ? 'include' : 'same-origin',
        };

        // Body
        if (!['GET', 'HEAD'].includes(method)) {
            const bt = document.querySelector('input[name="bodyType"]:checked').value;
            if (bt === 'json') {
                opts.body = httpBodyEl.value;
                if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
            } else if (bt === 'raw') {
                opts.body = httpBodyEl.value;
            } else if (bt === 'form') {
                const body = new URLSearchParams();
                kvRead(httpFormEditor).forEach(([k, v]) => body.append(k, v));
                opts.body = body.toString();
                if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/x-www-form-urlencoded');
            }
        }

        return { url, fetchUrl, opts, method };
    }

    // ---- 发送请求 ----
    async function sendRequest() {
        let req;
        try { req = buildRequest(); }
        catch (e) { showToast(e.message, 'error'); return; }

        httpRespStatus.textContent = '请求中...';
        httpRespStatus.className = 'resp-status resp-warn';
        httpRespTime.textContent = '-';
        httpRespSize.textContent = '-';
        httpRespBody.textContent = '';
        httpRespHeaders.innerHTML = '';
        httpRespRaw.textContent = '';

        const timeoutMs = parseInt(document.getElementById('httpTimeout').value, 10) || 30000;
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort('timeout'), timeoutMs);
        req.opts.signal = ac.signal;

        const t0 = performance.now();
        try {
            const resp = await fetch(req.fetchUrl, req.opts);
            clearTimeout(timer);
            const text = await resp.text();
            const ms = Math.round(performance.now() - t0);

            lastRespText = text;
            lastRespContentType = resp.headers.get('content-type') || '';

            // 状态徽章
            const cls = resp.status >= 500 ? 'resp-err'
                : resp.status >= 400 ? 'resp-warn'
                : resp.status >= 200 ? 'resp-ok' : 'resp-idle';
            httpRespStatus.className = 'resp-status ' + cls;
            httpRespStatus.textContent = `${resp.status} ${resp.statusText || ''}`.trim();
            httpRespTime.textContent = `耗时 ${ms} ms`;
            httpRespSize.textContent = `大小 ${formatBytes(text.length)}`;

            // Headers
            const hs = [];
            resp.headers.forEach((v, k) => hs.push([k, v]));
            httpRespHeaders.innerHTML = hs.map(([k, v]) =>
                `<div><span class="kv-key">${escapeHTML(k)}</span><span class="kv-val mono">${escapeHTML(v)}</span></div>`
            ).join('') || '<div style="color:var(--text-muted)">无</div>';

            // Body
            renderRespBody();
            httpRespRaw.textContent = text;

            // 保存到历史
            pushHistory(req.method, req.url, resp.status, ms);
        } catch (err) {
            clearTimeout(timer);
            const isTimeout = err.name === 'AbortError' && ac.signal.reason === 'timeout';
            httpRespStatus.className = 'resp-status resp-err';
            httpRespStatus.textContent = isTimeout ? '超时' : '请求失败';
            httpRespRaw.textContent = String(err);

            // 检测是否为 CORS 错误（fetch 被浏览器拦截时 err.message 通常为空或含 "Failed to fetch" / "signal is aborted without reason"）
            const errMsg = err.message || '';
            const isCors = !isTimeout && !document.getElementById('httpCorsProxy').checked &&
                (errMsg === 'Failed to fetch' || errMsg === '' || /network/i.test(errMsg) || /signal.*aborted/i.test(errMsg));

            if (isCors) {
                httpRespBody.textContent = '请求失败，可能是 CORS 跨域被拦截。\n\n请切换到「选项」标签，勾选「使用 CORS 代理」后重试。';
                // 自动切换到选项 tab
                const optsPanel = document.querySelector('.http-subpanel[data-httpsub="opts"]');
                const optsBtn = document.querySelector('#httpReqTabs .http-tab[data-httpsub="opts"]');
                if (optsPanel && optsBtn) {
                    document.querySelectorAll('#httpReqTabs .http-tab').forEach(x => x.classList.remove('active'));
                    document.querySelectorAll('.http-subpanel[data-httpsub]').forEach(p => p.classList.remove('active'));
                    optsBtn.classList.add('active');
                    optsPanel.classList.add('active');
                }
                showToast('⚠ 请求被 CORS 拦截，请勾选「使用 CORS 代理」', 'warning');
            } else if (isTimeout) {
                httpRespBody.textContent = `请求超时（超过 ${timeoutMs / 1000} 秒）\n\n可在「选项」中调整超时时间。`;
            } else {
                httpRespBody.textContent = (errMsg || '未知错误') + '\n\n可能原因：\n  · 网络不通 / DNS 解析失败 / 证书错误\n  · 被浏览器或插件拦截\n  · 请求超时';
            }
        }
    }

    function renderRespBody() {
        const view = document.querySelector('input[name="respView"]:checked').value;
        if (!lastRespText) { httpRespBody.textContent = ''; httpRespBody.innerHTML = ''; return; }
        if (view === 'pretty') {
            const maybeJson = /json/i.test(lastRespContentType) || /^\s*[\[{]/.test(lastRespText);
            if (maybeJson) {
                try {
                    const obj = JSON.parse(lastRespText);
                    httpRespBody.innerHTML = '';
                    const frag = document.createDocumentFragment();
                    renderValueLines(frag, obj, 0, '  ', '', false);
                    httpRespBody.appendChild(frag);
                    return;
                } catch {}
            }
        }
        httpRespBody.innerHTML = '';
        httpRespBody.textContent = lastRespText;
    }

    document.querySelectorAll('input[name="respView"]').forEach(r => {
        r.addEventListener('change', renderRespBody);
    });

    document.getElementById('httpRespCopy').addEventListener('click', () => {
        copyTextSimple(lastRespText, '响应体');
    });

    function formatBytes(n) {
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(2) + ' KB';
        return (n / 1024 / 1024).toFixed(2) + ' MB';
    }

    httpSendBtn.addEventListener('click', sendRequest);
    httpUrlEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); sendRequest(); }
    });

    // ---- 导入 curl ----
    const curlImportOverlay = document.getElementById('curlImportOverlay');
    const curlImportInput = document.getElementById('curlImportInput');

    document.getElementById('httpImportCurl').addEventListener('click', () => {
        curlImportOverlay.hidden = false;
        curlImportInput.focus();
    });
    document.getElementById('curlImportCancel').addEventListener('click', () => {
        curlImportOverlay.hidden = true;
    });
    curlImportOverlay.addEventListener('click', (e) => {
        if (e.target === curlImportOverlay) curlImportOverlay.hidden = true;
    });

    function parseCurl(cmd) {
        const result = { url: '', method: 'GET', headers: [], body: '', bodyType: 'none', params: [] };
        if (!cmd.trim().startsWith('curl')) return null;

        // 简单 tokenizer：把命令拆成参数列表（处理引号包裹的值）
        const tokens = [];
        let i = 0;
        while (i < cmd.length) {
            while (i < cmd.length && /\s/.test(cmd[i])) i++;
            if (i >= cmd.length) break;
            let quote = null;
            if (cmd[i] === "'" || cmd[i] === '"') { quote = cmd[i]; i++; }
            let val = '';
            while (i < cmd.length) {
                if (quote) {
                    if (cmd[i] === quote) { i++; break; }
                    val += cmd[i];
                } else {
                    if (/\s/.test(cmd[i])) break;
                    val += cmd[i];
                }
                i++;
            }
            tokens.push(val);
        }

        let urlFound = false;
        for (let idx = 0; idx < tokens.length; idx++) {
            const t = tokens[idx];
            const low = t.toLowerCase();
            if (low === '-x' || low === '--request') {
                result.method = (tokens[++idx] || 'GET').toUpperCase();
            } else if (low === '-h' || low === '--header') {
                const h = tokens[++idx] || '';
                const colon = h.indexOf(':');
                if (colon > 0) {
                    const k = h.slice(0, colon).trim();
                    const v = h.slice(colon + 1).trim();
                    if (k.toLowerCase() === 'content-type') {
                        if (v.includes('application/x-www-form-urlencoded')) result.bodyType = 'form';
                        else if (v.includes('application/json')) result.bodyType = 'json';
                        else result.bodyType = 'raw';
                    }
                    result.headers.push([k, v]);
                }
            } else if (low === '-d' || low === '--data' || low === '--data-raw' || low === '--data-binary') {
                result.body = tokens[++idx] || '';
                if (!result.bodyType || result.bodyType === 'none') result.bodyType = 'raw';
            } else if (low === '-b' || low === '--cookie') {
                const cookieVal = tokens[++idx] || '';
                result.headers.push(['Cookie', cookieVal]);
            } else if (low === '-u' || low === '--user') {
                const auth = tokens[++idx] || '';
                result.headers.push(['Authorization', 'Basic ' + btoa(auth)]);
            } else if (low === '--url') {
                result.url = tokens[++idx] || '';
                urlFound = true;
            } else if (!urlFound && !t.startsWith('-') && (t.startsWith('http://') || t.startsWith('https://'))) {
                result.url = t;
                urlFound = true;
            }
        }

        // 如果 URL 没找到，可能是第一个非选项 token
        if (!urlFound) {
            for (const t of tokens) {
                if (!t.startsWith('-') && (t.startsWith('http://') || t.startsWith('https://'))) {
                    result.url = t;
                    break;
                }
            }
        }

        // 从 URL 提取 query params
        try {
            const u = new URL(result.url);
            u.searchParams.forEach((v, k) => result.params.push([k, v]));
            result.url = u.origin + u.pathname;
        } catch {}

        return result;
    }

    document.getElementById('curlImportConfirm').addEventListener('click', () => {
        const cmd = curlImportInput.value;
        if (!cmd.trim()) { curlImportOverlay.hidden = true; return; }
        const parsed = parseCurl(cmd);
        if (!parsed || !parsed.url) {
            showToast('无法解析 curl 命令，请检查格式', 'error');
            return;
        }
        httpMethodEl.value = parsed.method;
        httpUrlEl.value = parsed.url;
        kvWrite(httpParamsEl, parsed.params);
        kvWrite(httpHeadersEl, parsed.headers);
        if (parsed.body) {
            httpBodyEl.value = parsed.body;
            if (!parsed.bodyType) parsed.bodyType = 'raw';
            const r = document.querySelector(`input[name="bodyType"][value="${parsed.bodyType}"]`);
            if (r) { r.checked = true; r.dispatchEvent(new Event('change')); }
        }
        curlImportOverlay.hidden = true;
        showToast('curl 命令已导入', 'success');
    });

    // ---- 历史记录 ----
    const HIST_KEY = 'http-history-v1';
    function loadHistory() {
        try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch { return []; }
    }
    function saveHistory(list) { localStorage.setItem(HIST_KEY, JSON.stringify(list.slice(0, 30))); }

    function pushHistory(method, url, status, ms) {
        const list = loadHistory();
        const item = {
            method, url, status, ms,
            ts: Date.now(),
            params: kvRead(httpParamsEl),
            headers: kvRead(httpHeadersEl),
            body: httpBodyEl.value,
            bodyType: document.querySelector('input[name="bodyType"]:checked').value,
        };
        // 去重：同 method+url 最新一条替换旧的
        const filtered = list.filter(x => !(x.method === method && x.url === url));
        filtered.unshift(item);
        saveHistory(filtered);
        renderHistory();
    }

    function renderHistory() {
        const list = loadHistory();
        if (!list.length) {
            httpHistoryEl.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px 0">暂无历史</div>';
            return;
        }
        httpHistoryEl.innerHTML = list.map((h, i) =>
            `<div class="history-item" data-hidx="${i}">
                <span class="m">${h.method}</span>
                <span class="u" title="${escapeHTML(h.url)}">${escapeHTML(h.url)}</span>
                <span class="s">${h.status} · ${h.ms}ms</span>
                <button class="del" data-hdel="${i}" title="删除">×</button>
            </div>`
        ).join('');
    }

    httpHistoryEl.addEventListener('click', (e) => {
        const delBtn = e.target.closest('[data-hdel]');
        if (delBtn) {
            e.stopPropagation();
            const i = parseInt(delBtn.getAttribute('data-hdel'), 10);
            const list = loadHistory();
            list.splice(i, 1);
            saveHistory(list);
            renderHistory();
            return;
        }
        const row = e.target.closest('.history-item');
        if (!row) return;
        const idx = parseInt(row.getAttribute('data-hidx'), 10);
        const h = loadHistory()[idx];
        if (!h) return;
        httpMethodEl.value = h.method;
        httpUrlEl.value = h.url;
        kvWrite(httpParamsEl, h.params || []);
        kvWrite(httpHeadersEl, h.headers || []);
        httpBodyEl.value = h.body || '';
        const bt = h.bodyType || 'none';
        const r = document.querySelector(`input[name="bodyType"][value="${bt}"]`);
        if (r) { r.checked = true; r.dispatchEvent(new Event('change')); }
        showToast('已载入历史', 'success');
    });

    document.getElementById('httpHistoryClear').addEventListener('click', () => {
        if (!confirm('确定清空全部历史？')) return;
        localStorage.removeItem(HIST_KEY);
        renderHistory();
    });

    httpSaveBtn.addEventListener('click', () => {
        try {
            const req = buildRequest();
            pushHistory(req.method, req.url, 0, 0);
            showToast('已保存', 'success');
        } catch (e) { showToast(e.message, 'error'); }
    });

    renderHistory();

    // ================================================================
    // ===================== JSON Diff =====================
    // ================================================================
    const diffLeftEl = document.getElementById('diffLeft');
    const diffRightEl = document.getElementById('diffRight');
    // 输入框本身就是结果展示区（contenteditable），二者为同一元素
    const diffLeftPreview = diffLeftEl;
    const diffRightPreview = diffRightEl;

    // 从 contenteditable 中提取纯文本：跳过 pad 占位行、还原 &nbsp; 空行
    function getDiffText(el) {
        if (!el.querySelector('.dline')) {
            return (el.innerText || '').replace(/\n$/, '');
        }
        const lines = [];
        el.childNodes.forEach(node => {
            if (node.nodeType === 1 && node.classList && node.classList.contains('dline')) {
                let t = node.textContent;
                if (t === '\u00a0') t = '';
                if (node.classList.contains('pad')) {
                    // pad 占位行：无真实内容则跳过；若用户在其中输入了内容则保留
                    t = t.replace(/\u00a0/g, '');
                    if (!t) return;
                }
                lines.push(...t.split('\n'));
            } else {
                const t = node.textContent;
                if (t) lines.push(...t.split('\n'));
            }
        });
        return lines.join('\n');
    }
    // 让 div 兼容 textarea 的 .value 读写（复制按钮等通用逻辑可直接复用）
    [diffLeftEl, diffRightEl].forEach(el => {
        Object.defineProperty(el, 'value', {
            get() { return getDiffText(el); },
            set(v) { el.textContent = v; }
        });
    });
    const diffStatus = document.getElementById('diffStatus');
    const diffSummary = document.getElementById('diffSummary');
    const diffJsonOpts = document.getElementById('diffJsonOpts');

    function normalize(v, ignoreOrder, ignoreCase) {
        if (Array.isArray(v)) {
            const arr = v.map(x => normalize(x, ignoreOrder, ignoreCase));
            if (ignoreOrder) arr.sort((a, b) => {
                const sa = JSON.stringify(a), sb = JSON.stringify(b);
                return sa < sb ? -1 : sa > sb ? 1 : 0;
            });
            return arr;
        }
        if (v && typeof v === 'object') {
            const out = {};
            Object.keys(v).sort().forEach(k => { out[k] = normalize(v[k], ignoreOrder, ignoreCase); });
            return out;
        }
        if (typeof v === 'string' && ignoreCase) return v.toLowerCase();
        return v;
    }

    function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
    function isArr(v) { return Array.isArray(v); }

    function escJsonStr(s) {
        return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
    }
    function valRepr(v) {
        if (v === undefined) return '';
        if (typeof v === 'string') return `"${escJsonStr(v)}"`;
        if (v === null) return 'null';
        return String(v);
    }
    function keyPart(key, isArrayIdx) {
        if (key === null || isArrayIdx) return '';
        return `"${key}": `;
    }

    // 核心：生成 {leftLines, rightLines, stats}
    // 每行：{ type: 'same'|'add'|'del'|'mod', text, indent }
    function diffBothSides(a, b) {
        const leftLines = [];
        const rightLines = [];
        const stats = { add: 0, del: 0, mod: 0, same: 0 };

        function pushBoth(type, indent, text) {
            leftLines.push({ type, indent, text });
            rightLines.push({ type, indent, text });
            if (type === 'same') stats.same++;
        }
        function pushLeft(type, indent, text) {
            leftLines.push({ type, indent, text });
            rightLines.push({ type: 'pad', indent, text: '' });
        }
        function pushRight(type, indent, text) {
            rightLines.push({ type, indent, text });
            leftLines.push({ type: 'pad', indent, text: '' });
        }

        // 把一个完整子树 flat 成行：只给一侧用（标记为 del / add / mod）
        function expandFull(v, indent, key, isArrayIdx, lineType, trailingComma, pushFn) {
            const kp = keyPart(key, isArrayIdx);
            const comma = trailingComma ? ',' : '';
            if (isObj(v)) {
                const keys = Object.keys(v);
                pushFn(lineType, indent, `${kp}{`);
                keys.forEach((k, i) => expandFull(v[k], indent + 1, k, false, lineType, i < keys.length - 1, pushFn));
                pushFn(lineType, indent, `}${comma}`);
            } else if (isArr(v)) {
                pushFn(lineType, indent, `${kp}[`);
                v.forEach((x, i) => expandFull(x, indent + 1, i, true, lineType, i < v.length - 1, pushFn));
                pushFn(lineType, indent, `]${comma}`);
            } else {
                pushFn(lineType, indent, `${kp}${valRepr(v)}${comma}`);
            }
        }

        function walk(a, b, indent, key, isArrayIdx, trailingComma) {
            const kp = keyPart(key, isArrayIdx);
            const comma = trailingComma ? ',' : '';

            // 都是对象
            if (isObj(a) && isObj(b)) {
                pushBoth('same', indent, `${kp}{`);
                // 合并两侧 key 并按字母序排序，确保行对齐
                const allKeys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
                allKeys.forEach((k, idx) => {
                    const last = idx === allKeys.length - 1;
                    if (k in a && k in b) {
                        walk(a[k], b[k], indent + 1, k, false, !last);
                    } else if (k in b) {
                        // 只在右侧有：右侧展示为 add，左侧跳过这些行（保持视觉行数不对齐也没关系）
                        expandFull(b[k], indent + 1, k, false, 'add', !last, pushRight);
                        stats.add++;
                    } else {
                        expandFull(a[k], indent + 1, k, false, 'del', !last, pushLeft);
                        stats.del++;
                    }
                });
                pushBoth('same', indent, `}${comma}`);
                return;
            }

            // 都是数组
            if (isArr(a) && isArr(b)) {
                pushBoth('same', indent, `${kp}[`);
                const ml = Math.max(a.length, b.length);
                for (let i = 0; i < ml; i++) {
                    const last = i === ml - 1;
                    if (i < a.length && i < b.length) {
                        walk(a[i], b[i], indent + 1, i, true, !last);
                    } else if (i < b.length) {
                        expandFull(b[i], indent + 1, i, true, 'add', !last, pushRight);
                        stats.add++;
                    } else {
                        expandFull(a[i], indent + 1, i, true, 'del', !last, pushLeft);
                        stats.del++;
                    }
                }
                pushBoth('same', indent, `]${comma}`);
                return;
            }

            // 基础值或类型不同
            const sameVal = (typeof a === typeof b)
                && (a === b || (a !== a && b !== b));
            if (sameVal && !isObj(a) && !isArr(a)) {
                pushBoth('same', indent, `${kp}${valRepr(a)}${comma}`);
            } else if (!isObj(a) && !isArr(a) && !isObj(b) && !isArr(b)) {
                // 两边都是基础值但不同：成对 push，保持行对齐
                leftLines.push({ type: 'mod', indent, text: `${kp}${valRepr(a)}${comma}` });
                rightLines.push({ type: 'mod', indent, text: `${kp}${valRepr(b)}${comma}` });
                stats.mod++;
            } else {
                // 至少一侧是对象/数组，展开到多行并用 pad 占位
                if (isObj(a) || isArr(a)) {
                    expandFull(a, indent, key, isArrayIdx, 'mod', trailingComma, pushLeft);
                } else {
                    pushLeft('mod', indent, `${kp}${valRepr(a)}${comma}`);
                }
                if (isObj(b) || isArr(b)) {
                    expandFull(b, indent, key, isArrayIdx, 'mod', trailingComma, pushRight);
                } else {
                    pushRight('mod', indent, `${kp}${valRepr(b)}${comma}`);
                }
                stats.mod++;
            }
        }

        walk(a, b, 0, null, false, false);
        return { leftLines, rightLines, stats };
    }

    // 语法高亮：用单次扫描的 tokenizer 避免多次 replace 互相污染
    function diffHighlight(s) {
        const re = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}\[\]:,]/g;
        let out = '';
        let lastIndex = 0;
        let m;
        while ((m = re.exec(s)) !== null) {
            const match = m[0];
            const offset = m.index;
            if (offset > lastIndex) out += escapeHTML(s.slice(lastIndex, offset));
            lastIndex = offset + match.length;

            if (match[0] === '"') {
                const rest = s.slice(lastIndex);
                if (/^\s*:/.test(rest)) {
                    out += `<span class="tk-key">${escapeHTML(match)}</span>`;
                } else {
                    out += `<span class="tk-str">${escapeHTML(match)}</span>`;
                }
            } else if (/^-?\d/.test(match)) {
                out += `<span class="tk-num">${match}</span>`;
            } else if (match === 'true' || match === 'false') {
                out += `<span class="tk-bool">${match}</span>`;
            } else if (match === 'null') {
                out += `<span class="tk-null">null</span>`;
            } else {
                out += `<span class="tk-punc">${match}</span>`;
            }
            // 防止零宽匹配死循环
            if (match.length === 0) re.lastIndex++;
        }
        if (lastIndex < s.length) out += escapeHTML(s.slice(lastIndex));
        return out;
    }

    function linesToHTML(lines) {
        const indentChar = '  ';
        return lines.map(l => {
            const text = indentChar.repeat(l.indent) + l.text;
            const body = l.html !== undefined ? (l.html || '&nbsp;') : (diffHighlight(text) || '&nbsp;');
            return `<div class="dline ${l.type}">${body}</div>`;
        }).join('');
    }

    function linesToText(lines) {
        const indentChar = '  ';
        return lines.map(l => indentChar.repeat(l.indent) + l.text).join('\n');
    }

    // ---- 光标保存/恢复（以"提取文本的行/列"为坐标） ----
    function saveCaret(el) {
        const sel = window.getSelection();
        if (!sel.rangeCount) return null;
        const range = sel.getRangeAt(0);
        if (!el.contains(range.startContainer)) return null;
        if (!el.querySelector('.dline')) {
            // 纯文本状态：按全文偏移换算行/列
            const r = document.createRange();
            r.selectNodeContents(el);
            r.setEnd(range.startContainer, range.startOffset);
            const before = r.toString().split('\n');
            return { line: before.length - 1, col: before[before.length - 1].length };
        }
        // 渲染状态：定位所在 dline，行号按提取文本计（跳过 pad 行）
        let node = range.startContainer;
        while (node !== el && node.parentNode !== el) node = node.parentNode;
        if (node === el) return { line: 0, col: 0 };
        let line = 0;
        for (let ch = el.firstChild; ch && ch !== node; ch = ch.nextSibling) {
            if (ch.nodeType === 1 && ch.classList.contains('dline') && !ch.classList.contains('pad')) line++;
        }
        const r = document.createRange();
        r.selectNodeContents(node);
        r.setEnd(range.startContainer, range.startOffset);
        return { line, col: r.toString().length };
    }

    function restoreCaret(el, caret) {
        if (!caret) return;
        let target = null;
        let line = 0;
        for (let ch = el.firstChild; ch; ch = ch.nextSibling) {
            if (ch.nodeType === 1 && ch.classList.contains('dline') && !ch.classList.contains('pad')) {
                if (line === caret.line) { target = ch; break; }
                target = ch;  // 记录最后一个有效行，行号超界时落在末行
                line++;
            }
        }
        if (!target) return;
        // 在 target 内按列偏移定位文本节点
        let remain = caret.col;
        const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
        let tn = null, offset = 0;
        while (walker.nextNode()) {
            tn = walker.currentNode;
            const t = tn.textContent === '\u00a0' ? '' : tn.textContent;
            if (remain <= t.length) { offset = Math.min(remain, tn.textContent.length); remain = -1; break; }
            remain -= t.length;
            offset = tn.textContent.length;
        }
        const sel = window.getSelection();
        const r = document.createRange();
        if (tn) r.setStart(tn, offset);
        else r.setStart(target, 0);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
    }

    // 输入框始终可编辑，输入时防抖自动触发对比
    let _diffAutoTimer = null;
    function detectJsonMode() {
        const lv = diffLeftEl.value.trim();
        const rv = diffRightEl.value.trim();
        const bothJson = lv && rv && (() => {
            try { JSON.parse(lv); return true; } catch (_) { return false; }
        })() && (() => {
            try { JSON.parse(rv); return true; } catch (_) { return false; }
        })();
        diffJsonOpts.style.display = bothJson ? '' : 'none';
        return bothJson;
    }
    // 把渲染后的 diff 结果还原为纯文本（保持可编辑内容不丢失）
    function clearRender(el) {
        if (!el.querySelector('.dline')) return;
        const caret = el === document.activeElement ? saveCaret(el) : null;
        const v = getDiffText(el);
        el.textContent = v;
        el.classList.remove('has-diff');
        if (caret) {
            // 纯文本状态下按行/列恢复
            const linesArr = v.split('\n');
            let pos = 0;
            for (let i = 0; i < caret.line && i < linesArr.length; i++) pos += linesArr[i].length + 1;
            pos += Math.min(caret.col, (linesArr[caret.line] || '').length);
            const sel = window.getSelection();
            const r = document.createRange();
            const tn = el.firstChild;
            if (tn) r.setStart(tn, Math.min(pos, tn.textContent.length));
            else r.setStart(el, 0);
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
        }
    }

    function scheduleAutoDiff() {
        if (_diffAutoTimer) clearTimeout(_diffAutoTimer);
        _diffAutoTimer = setTimeout(() => {
            _diffAutoTimer = null;
            const l = diffLeftEl.value.trim();
            const r = diffRightEl.value.trim();
            if (!l || !r) {
                // 任一侧为空时不自动对比，并撤掉已有的高亮渲染
                clearRender(diffLeftEl);
                clearRender(diffRightEl);
                diffSummary.hidden = true;
                document.getElementById('diffUnified').hidden = true;
                document.getElementById('diffNav').style.display = 'none';
                diffJsonOpts.style.display = 'none';
                diffStatus.textContent = (!l && !r) ? '就绪' : '请先在两侧都输入内容';
                diffStatus.style.color = '';
                return;
            }
            detectJsonMode();
            runDiff();
        }, 300);
    }
    diffLeftEl.addEventListener('input', scheduleAutoDiff);
    diffRightEl.addEventListener('input', scheduleAutoDiff);

    // ---- 文本 Diff（行级 LCS + 字符级 LCS） ----
    function charDiff(a, b) {
        // 快速剥离共同前缀/后缀，减小 LCS 规模
        let pre = 0;
        const minLen = Math.min(a.length, b.length);
        while (pre < minLen && a[pre] === b[pre]) pre++;
        let suf = 0;
        while (suf < minLen - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;

        const aMid = a.slice(pre, a.length - suf);
        const bMid = b.slice(pre, b.length - suf);
        const commonPre = a.slice(0, pre);
        const commonSuf = suf > 0 ? a.slice(a.length - suf) : '';

        function coreDiff(x, y) {
            const mx = x.length, my = y.length;
            if (mx === 0 && my === 0) return { htmlA: '', htmlB: '' };
            if (mx === 0) return { htmlA: '', htmlB: `<span class="diff-char">${escapeHTML(y)}</span>` };
            if (my === 0) return { htmlA: `<span class="diff-char">${escapeHTML(x)}</span>`, htmlB: '' };
            // LCS 表超过 4,000,000 单元时降级：整行标记
            if (mx * my > 4000000) {
                return {
                    htmlA: `<span class="diff-char">${escapeHTML(x)}</span>`,
                    htmlB: `<span class="diff-char">${escapeHTML(y)}</span>`
                };
            }
            const dp = new Array(mx + 1);
            for (let i = 0; i <= mx; i++) dp[i] = new Int32Array(my + 1);
            for (let i = 1; i <= mx; i++) {
                for (let j = 1; j <= my; j++) {
                    dp[i][j] = x[i - 1] === y[j - 1]
                        ? dp[i - 1][j - 1] + 1
                        : Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
            const revA = [], revB = [];
            let i = mx, j = my;
            while (i > 0 || j > 0) {
                if (i > 0 && j > 0 && x[i - 1] === y[j - 1]) {
                    revA.push({ same: true, c: x[i - 1] });
                    revB.push({ same: true, c: y[j - 1] });
                    i--; j--;
                } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
                    revA.push({ same: false, c: '' });
                    revB.push({ same: false, c: y[j - 1] });
                    j--;
                } else {
                    revA.push({ same: false, c: x[i - 1] });
                    revB.push({ same: false, c: '' });
                    i--;
                }
            }
            revA.reverse(); revB.reverse();
            function mergeSegs(segs) {
                const m = [];
                for (const s of segs) {
                    const last = m[m.length - 1];
                    if (last && last.same === s.same) last.c += s.c;
                    else m.push({ same: s.same, c: s.c });
                }
                return m;
            }
            function toHTML(segs) {
                return segs.map(s => s.same ? escapeHTML(s.c) : `<span class="diff-char">${escapeHTML(s.c)}</span>`).join('');
            }
            return { htmlA: toHTML(mergeSegs(revA)), htmlB: toHTML(mergeSegs(revB)) };
        }

        const mid = coreDiff(aMid, bMid);
        const preEsc = escapeHTML(commonPre);
        const sufEsc = escapeHTML(commonSuf);
        const htmlA = (preEsc + mid.htmlA + sufEsc) || '&nbsp;';
        const htmlB = (preEsc + mid.htmlB + sufEsc) || '&nbsp;';
        return { htmlA, htmlB };
    }

    function textDiff(aText, bText) {
        const a = aText.split('\n');
        const b = bText.split('\n');
        const m = a.length, n = b.length;

        // 行级 LCS
        const dp = new Array(m + 1);
        for (let i = 0; i <= m; i++) dp[i] = new Int32Array(n + 1);
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                dp[i][j] = a[i - 1] === b[j - 1]
                    ? dp[i - 1][j - 1] + 1
                    : Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }

        // 回朔 → 左右对齐行
        const leftLines = [], rightLines = [];
        let i = m, j = n;
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
                leftLines.unshift({ type: 'same', text: a[i - 1] });
                rightLines.unshift({ type: 'same', text: b[j - 1] });
                i--; j--;
            } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
                leftLines.unshift({ type: 'pad', text: '' });
                rightLines.unshift({ type: 'add', text: b[j - 1] });
                j--;
            } else {
                leftLines.unshift({ type: 'del', text: a[i - 1] });
                rightLines.unshift({ type: 'pad', text: '' });
                i--;
            }
        }

        // 合并交错 del/add：del/pad + pad/add 或 pad/add + del/pad → 合并为 del/add
        const mergedL = [], mergedR = [];
        let stats = { add: 0, del: 0, same: 0 };
        for (let k = 0; k < leftLines.length; k++) {
            const L = leftLines[k], R = rightLines[k];
            // 尝试合并：左 del 右空 + 下一步左空右 add → 合并（旧→新）
            if (L.type === 'del' && R.type === 'pad' &&
                k + 1 < leftLines.length && leftLines[k + 1].type === 'pad' && rightLines[k + 1].type === 'add') {
                const diff = charDiff(L.text, rightLines[k + 1].text);
                L.type = 'del'; L.html = diff.htmlA; L.inline = true;
                rightLines[k + 1].type = 'add'; rightLines[k + 1].html = diff.htmlB; rightLines[k + 1].inline = true;
                mergedL.push(L); mergedR.push(rightLines[k + 1]);
                stats.del++; stats.add++; k++;
            }
            // 尝试合并：左空 右 add + 下一步左 del 右空 → 合并（新→旧）
            else if (L.type === 'pad' && R.type === 'add' &&
                k + 1 < leftLines.length && leftLines[k + 1].type === 'del' && rightLines[k + 1].type === 'pad') {
                const diff = charDiff(leftLines[k + 1].text, R.text);
                leftLines[k + 1].type = 'del'; leftLines[k + 1].html = diff.htmlA; leftLines[k + 1].inline = true;
                R.type = 'add'; R.html = diff.htmlB; R.inline = true;
                mergedL.push(leftLines[k + 1]); mergedR.push(R);
                stats.del++; stats.add++; k++;
            }
            // 未合并的 del
            else if (L.type === 'del') {
                L.html = `<span class="diff-char">${escapeHTML(L.text)}</span>` || '&nbsp;';
                R.html = '&nbsp;';
                mergedL.push(L); mergedR.push(R);
                stats.del++;
            }
            // 未合并的 add
            else if (R.type === 'add') {
                L.html = '&nbsp;';
                R.html = `<span class="diff-char">${escapeHTML(R.text)}</span>` || '&nbsp;';
                mergedL.push(L); mergedR.push(R);
                stats.add++;
            }
            // same 或双 pad
            else {
                L.html = L.type === 'same' ? (escapeHTML(L.text) || '&nbsp;') : '&nbsp;';
                R.html = R.type === 'same' ? (escapeHTML(R.text) || '&nbsp;') : '&nbsp;';
                mergedL.push(L); mergedR.push(R);
                if (L.type === 'same') stats.same++;
            }
        }

        // 结果直接渲染回输入框，必须保留全部行（裁剪会丢失用户内容）
        const L = [], R = [];
        stats = { add: 0, del: 0, same: 0 };
        for (let k = 0; k < mergedL.length; k++) {
            L.push(mergedL[k]);
            R.push(mergedR[k]);
            if (mergedL[k].type === 'del') stats.del++;
            if (mergedR[k].type === 'add') stats.add++;
            if (mergedL[k].type === 'same') stats.same++;
        }

        return { leftLines: L, rightLines: R, stats };
    }

    function textLineToHTML(lines) {
        return lines.map(l => {
            const extra = l.inline ? ' dline-inline' : '';
            return `<div class="dline dline-txt${extra} ${l.type}">${l.html}</div>`;
        }).join('');
    }

    function runDiff() {
        const lraw = diffLeftEl.value.trim();
        const rraw = diffRightEl.value.trim();
        _diffLeftRaw = diffLeftEl.value;
        _diffRightRaw = diffRightEl.value;

        const isJsonMode = detectJsonMode();

        // 清空所有结果区
        diffSummary.hidden = true;
        document.getElementById('diffNav').style.display = 'none';
        document.getElementById('diffUnified').hidden = true;
        _diffNavItems = [];
        _diffNavIndex = -1;

        if (!lraw || !rraw) {
            clearRender(diffLeftEl);
            clearRender(diffRightEl);
            diffStatus.textContent = isJsonMode ? '请在左右两侧粘贴 JSON' : '请在左右两侧粘贴文本';
            diffStatus.style.color = '';
            return;
        }

        // 保存当前聚焦侧的光标位置，渲染后恢复，保证连续输入不中断
        const focusEl = document.activeElement === diffLeftEl ? diffLeftEl
            : document.activeElement === diffRightEl ? diffRightEl : null;
        const caret = focusEl ? saveCaret(focusEl) : null;

        function renderInPlace(leftHTML, rightHTML) {
            diffLeftEl.innerHTML = leftHTML || '<div class="dline">&nbsp;</div>';
            diffRightEl.innerHTML = rightHTML || '<div class="dline">&nbsp;</div>';
            diffLeftEl.classList.add('has-diff');
            diffRightEl.classList.add('has-diff');
            if (focusEl && caret) restoreCaret(focusEl, caret);
        }

        if (!isJsonMode) {
            // ---- 文本 Diff 模式：双栏并排 ----
            const { leftLines, rightLines, stats } = textDiff(lraw, rraw);

            renderInPlace(textLineToHTML(leftLines), textLineToHTML(rightLines));

            document.getElementById('diffAddCnt').textContent = stats.add;
            document.getElementById('diffDelCnt').textContent = stats.del;
            document.getElementById('diffModCnt').textContent = '0';
            document.getElementById('diffSameCnt').textContent = stats.same;
            diffSummary.hidden = false;

            collectDiffNavItems();

            const totalDiff = stats.add + stats.del;
            if (totalDiff === 0) {
                diffStatus.textContent = '两份文本完全一致 ✓';
                diffStatus.style.color = 'var(--success)';
            } else {
                diffStatus.textContent = `发现 ${totalDiff} 处差异（+${stats.add} −${stats.del}）`;
                diffStatus.style.color = 'var(--warning)';
            }
            return;
        }

        // ---- JSON Diff 模式（原逻辑） ----
        let left, right;
        try { left = lraw ? JSON.parse(lraw) : null; }
        catch (e) {
            diffStatus.textContent = '左侧 JSON 无效：' + e.message;
            diffStatus.style.color = 'var(--danger)';
            return;
        }
        try { right = rraw ? JSON.parse(rraw) : null; }
        catch (e) {
            diffStatus.textContent = '右侧 JSON 无效：' + e.message;
            diffStatus.style.color = 'var(--danger)';
            return;
        }

        const ignoreOrder = document.getElementById('diffIgnoreOrder').checked;
        const ignoreCase = document.getElementById('diffIgnoreCase').checked;

        const a = normalize(left, ignoreOrder, ignoreCase);
        const b = normalize(right, ignoreOrder, ignoreCase);

        const { leftLines, rightLines, stats } = diffBothSides(a, b);

        // mod 行成对做字符级对比，细化到单个字符
        const indentChar = '  ';
        for (let i = 0; i < leftLines.length; i++) {
            if (leftLines[i].type === 'mod' && rightLines[i] && rightLines[i].type === 'mod') {
                const lt = indentChar.repeat(leftLines[i].indent) + leftLines[i].text;
                const rt = indentChar.repeat(rightLines[i].indent) + rightLines[i].text;
                const d = charDiff(lt, rt);
                leftLines[i].html = d.htmlA;
                rightLines[i].html = d.htmlB;
            }
        }

        diffLeftPreview.className = 'plain-area diff-preview diff-editbox side-left';
        diffRightPreview.className = 'plain-area diff-preview diff-editbox side-right';
        renderInPlace(linesToHTML(leftLines), linesToHTML(rightLines));

        document.getElementById('diffAddCnt').textContent = stats.add;
        document.getElementById('diffDelCnt').textContent = stats.del;
        document.getElementById('diffModCnt').textContent = stats.mod;
        document.getElementById('diffSameCnt').textContent = stats.same;
        diffSummary.hidden = false;

        collectDiffNavItems();

        const totalDiff = stats.add + stats.del + stats.mod;
        if (totalDiff === 0) {
            diffStatus.textContent = '两份 JSON 完全一致 ✓';
            diffStatus.style.color = 'var(--success)';
        } else {
            diffStatus.textContent = `发现 ${totalDiff} 处差异`;
            diffStatus.style.color = 'var(--warning)';
        }
    }

    document.getElementById('diffRun').addEventListener('click', runDiff);
    document.getElementById('diffSwap').addEventListener('click', () => {
        const tmp = diffLeftEl.value;
        diffLeftEl.value = diffRightEl.value;
        diffRightEl.value = tmp;
        runDiff();
    });
    document.getElementById('diffClear').addEventListener('click', () => {
        diffLeftEl.value = '';
        diffRightEl.value = '';
        diffLeftEl.classList.remove('has-diff');
        diffRightEl.classList.remove('has-diff');
        diffSummary.hidden = true;
        document.getElementById('diffUnified').hidden = true;
        diffStatus.textContent = '就绪';
        diffStatus.style.color = '';
        _diffNavItems = [];
        _diffNavIndex = -1;
        _diffLeftRaw = '';
        _diffRightRaw = '';
        document.getElementById('diffNav').style.display = 'none';
        updateDiffNavIndex();
    });

    document.getElementById('diffIgnoreOrder').addEventListener('change', runDiff);
    document.getElementById('diffIgnoreCase').addEventListener('change', runDiff);

    // ---- Diff 导航：上一个/下一个差异 ----
    let _diffNavIndex = -1;
    let _diffNavItems = []; // { leftEls, rightEls } 有差异的行组
    let _diffLeftRaw = '';  // 对比前的原始输入
    let _diffRightRaw = '';

    function collectDiffNavItems() {
        _diffNavItems = [];
        _diffNavIndex = -1;
        const leftDlines = diffLeftPreview.querySelectorAll('.dline');
        const rightDlines = diffRightPreview.querySelectorAll('.dline');
        const len = Math.min(leftDlines.length, rightDlines.length);
        let inGroup = false;
        for (let i = 0; i < len; i++) {
            const lt = leftDlines[i].classList.contains('add') || leftDlines[i].classList.contains('del') || leftDlines[i].classList.contains('mod');
            const rt = rightDlines[i].classList.contains('add') || rightDlines[i].classList.contains('del') || rightDlines[i].classList.contains('mod');
            const isDiff = lt || rt;
            if (isDiff && !inGroup) {
                // 新差异组的起始行
                _diffNavItems.push({
                    leftEls: [leftDlines[i]],
                    rightEls: [rightDlines[i]]
                });
                inGroup = true;
            } else if (isDiff && inGroup) {
                // 同一差异组，追加
                _diffNavItems[_diffNavItems.length - 1].leftEls.push(leftDlines[i]);
                _diffNavItems[_diffNavItems.length - 1].rightEls.push(rightDlines[i]);
            } else {
                // same 行，结束当前组
                inGroup = false;
            }
        }
        const nav = document.getElementById('diffNav');
        nav.style.display = _diffNavItems.length > 0 ? 'inline-flex' : 'none';
        updateDiffNavIndex();
    }

    function clearDiffNavHighlight() {
        diffLeftPreview.querySelectorAll('.dline.nav-active').forEach(el => el.classList.remove('nav-active'));
        diffRightPreview.querySelectorAll('.dline.nav-active').forEach(el => el.classList.remove('nav-active'));
    }

    function updateDiffNavIndex() {
        const idx = document.getElementById('diffNavIndex');
        if (_diffNavItems.length === 0) {
            idx.textContent = '0 / 0';
        } else {
            idx.textContent = `${_diffNavIndex + 1} / ${_diffNavItems.length}`;
        }
    }

    function scrollToDiffItem(index) {
        if (index < 0 || index >= _diffNavItems.length) return;
        clearDiffNavHighlight();
        _diffNavIndex = index;
        const item = _diffNavItems[index];
        // 只给差异块的第一行加高亮，不再每行都标框
        item.leftEls[0].classList.add('nav-active');
        item.rightEls[0].classList.add('nav-active');
        item.leftEls[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => item.rightEls[0].scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
        updateDiffNavIndex();
    }

    document.getElementById('diffPrev').addEventListener('click', () => {
        if (_diffNavItems.length === 0) return;
        if (_diffNavIndex <= 0) _diffNavIndex = _diffNavItems.length;
        scrollToDiffItem(_diffNavIndex - 1);
    });

    document.getElementById('diffNext').addEventListener('click', () => {
        if (_diffNavItems.length === 0) return;
        if (_diffNavIndex >= _diffNavItems.length - 1) _diffNavIndex = -1;
        scrollToDiffItem(_diffNavIndex + 1);
    });

    // ================================================================
    // ===================== 二维码生成 =====================
    // ================================================================
    const qrInput = document.getElementById('qrInput');
    const qrOutput = document.getElementById('qrOutput');
    const qrStatus = document.getElementById('qrStatus');
    const qrErrorLevel = document.getElementById('qrErrorLevel');
    const qrSize = document.getElementById('qrSize');
    const qrFgColor = document.getElementById('qrFgColor');
    const qrBgColor = document.getElementById('qrBgColor');

    function generateQR() {
        const text = qrInput.value.trim();
        if (!text) {
            qrStatus.textContent = '请输入文本';
            qrStatus.style.color = 'var(--warning)';
            return;
        }
        const typeNumber = 0; // 自动选择
        const errorLevel = qrErrorLevel.value;
        // 将文本转为 UTF-8 字节字符串，确保中文等多字节字符正确编码
        const utf8Text = unescape(encodeURIComponent(text));
        let qr;
        try {
            qr = qrcode(typeNumber, errorLevel);
            qr.addData(utf8Text, 'Byte');
            qr.make();
        } catch (e) {
            qrStatus.textContent = '生成失败：文本过长或包含不支持的字符';
            qrStatus.style.color = 'var(--danger)';
            return;
        }

        const size = parseInt(qrSize.value, 10);
        const moduleCount = qr.getModuleCount();
        const quietZone = 4; // QR 规范要求至少 4 模块宽的白色静区
        const totalModules = moduleCount + quietZone * 2;
        const cellSize = Math.floor(size / totalModules);
        const realSize = cellSize * totalModules;
        const offset = cellSize * quietZone; // 二维码内容偏移量

        const canvas = document.createElement('canvas');
        canvas.width = realSize;
        canvas.height = realSize;
        canvas.style.maxWidth = '100%';
        canvas.style.imageRendering = 'pixelated';
        canvas.style.border = '1px solid var(--border)';
        canvas.style.borderRadius = '6px';
        const ctx = canvas.getContext('2d');

        // 先填充整个背景（包含静区）
        ctx.fillStyle = qrBgColor.value;
        ctx.fillRect(0, 0, realSize, realSize);

        for (let row = 0; row < moduleCount; row++) {
            for (let col = 0; col < moduleCount; col++) {
                if (qr.isDark(row, col)) {
                    ctx.fillStyle = qrFgColor.value;
                    ctx.fillRect(offset + col * cellSize, offset + row * cellSize, cellSize, cellSize);
                }
            }
        }

        qrOutput.innerHTML = '';
        qrOutput.appendChild(canvas);
        qrStatus.textContent = `生成成功 · ${moduleCount}×${moduleCount} 模块 · ${realSize}×${realSize}px`;
        qrStatus.style.color = 'var(--success)';
    }

    document.getElementById('qrGenerate').addEventListener('click', generateQR);
    document.getElementById('qrDownload').addEventListener('click', () => {
        const canvas = qrOutput.querySelector('canvas');
        if (!canvas) { showToast('请先生成二维码', 'warning'); return; }
        const a = document.createElement('a');
        a.download = 'qrcode.png';
        a.href = canvas.toDataURL('image/png');
        a.click();
    });
    document.getElementById('qrClear').addEventListener('click', () => {
        document.getElementById('qrInput').value = '';
        qrOutput.innerHTML = '<span class="text-muted" style="color:var(--text-muted)">点击"生成"按钮</span>';
        document.getElementById('qrStatus').textContent = '就绪';
        document.getElementById('qrStatus').style.color = '';
    });

    // 输入时自动生成（防抖 300ms）
    let qrDebounce = null;
    document.getElementById('qrInput').addEventListener('input', () => {
        clearTimeout(qrDebounce);
        qrDebounce = setTimeout(() => {
            const text = qrInput.value.trim();
            if (text) generateQR();
        }, 300);
    });

    // ================================================================
    // ===================== 二维码解析 =====================
    // ================================================================
    const qrDecodeFile = document.getElementById('qrDecodeFile');
    const qrDecodeFileName = document.getElementById('qrDecodeFileName');
    const qrDecodeCanvas = document.getElementById('qrDecodeCanvas');
    const qrDecodeText = document.getElementById('qrDecodeText');
    const qrDecodeStatus = document.getElementById('qrDecodeStatus');
    const qrDecodePlaceholder = document.getElementById('qrDecodePlaceholder');
    const qrDecodeKv = document.getElementById('qrDecodeKv');
    const qrDecodeResultPlaceholder = document.getElementById('qrDecodeResultPlaceholder');

    // 保存当前解析用的 File 对象，供 html5-qrcode 使用
    let _currentQrFile = null;

    async function decodeQRFromImage(img) {
        const canvas = qrDecodeCanvas;
        const ctx = canvas.getContext('2d');
        const origW = img.naturalWidth || img.width;
        const origH = img.naturalHeight || img.height;

        // 显示 canvas，隐藏占位符
        canvas.style.display = '';
        qrDecodePlaceholder.style.display = 'none';
        qrDecodeResultPlaceholder.style.display = 'none';
        qrDecodeKv.style.display = '';

        // 展示用：将图片绘制到可见 canvas（固定适配尺寸）
        const displayW = Math.min(Math.max(origW, 200), 600);
        const displayH = Math.round(origH * displayW / origW);
        canvas.width = displayW;
        canvas.height = displayH;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, 0, 0, displayW, displayH);

        let decodedText = null;

        // -------- 辅助：离屏 canvas --------
        const offCanvas = document.createElement('canvas');
        const offCtx = offCanvas.getContext('2d');

        // 绘制带白色边框的图到离屏 canvas（解决缺少 quiet zone 的问题）
        function offDrawWithBorder(targetW, smooth) {
            const targetH = Math.round(origH * targetW / origW);
            const border = Math.max(Math.round(targetW * 0.15), 20); // 15% 边框或至少 20px
            const totalW = targetW + border * 2;
            const totalH = targetH + border * 2;
            offCanvas.width = totalW;
            offCanvas.height = totalH;
            offCtx.imageSmoothingEnabled = !!smooth;
            // 填充白色背景（quiet zone）
            offCtx.fillStyle = '#ffffff';
            offCtx.fillRect(0, 0, totalW, totalH);
            // 在中间绘制图片
            offCtx.drawImage(img, border, border, targetW, targetH);
            return { w: totalW, h: totalH };
        }

        function tryJsQR(imageData, w, h) {
            try {
                const code = jsQR(imageData.data, w, h, { inversionAttempts: 'attemptBoth' });
                return code ? code.data : null;
            } catch (e) { return null; }
        }

        function binarize(imageData, threshold, invert) {
            const d = imageData.data;
            const out = new Uint8ClampedArray(d.length);
            for (let i = 0; i < d.length; i += 4) {
                const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                const val = invert ? (gray < threshold ? 255 : 0) : (gray < threshold ? 0 : 255);
                out[i] = out[i + 1] = out[i + 2] = val;
                out[i + 3] = 255;
            }
            return new ImageData(out, imageData.width, imageData.height);
        }

        // -------- 方法1：html5-qrcode (基于 zxing) --------
        if (!decodedText && typeof Html5Qrcode !== 'undefined' && _currentQrFile) {
            try {
                const html5QrCode = new Html5Qrcode('qrHtml5Reader');
                const result = await html5QrCode.scanFileV2(_currentQrFile, false);
                if (result && result.decodedText) decodedText = result.decodedText;
                html5QrCode.clear();
            } catch (e) { /* 继续 */ }
        }

        // -------- 方法1b：html5-qrcode + 带边框版本 --------
        if (!decodedText && typeof Html5Qrcode !== 'undefined') {
            try {
                offDrawWithBorder(origW, false);
                const blob = await new Promise(r => offCanvas.toBlob(r, 'image/png'));
                if (blob) {
                    const borderedFile = new File([blob], 'qr_bordered.png', { type: 'image/png' });
                    const html5QrCode = new Html5Qrcode('qrHtml5Reader');
                    const result = await html5QrCode.scanFileV2(borderedFile, false);
                    if (result && result.decodedText) decodedText = result.decodedText;
                    html5QrCode.clear();
                }
            } catch (e) { /* 继续 */ }
        }

        // -------- 方法2：BarcodeDetector (原生 API) --------
        if (!decodedText && 'BarcodeDetector' in window) {
            try {
                const detector = new BarcodeDetector({ formats: ['qr_code'] });
                const results = await detector.detect(img);
                if (results.length > 0 && results[0].rawValue) {
                    decodedText = results[0].rawValue;
                }
            } catch (e) { /* 忽略 */ }
            // 带边框再试
            if (!decodedText) {
                try {
                    offDrawWithBorder(origW, false);
                    const detector = new BarcodeDetector({ formats: ['qr_code'] });
                    const results = await detector.detect(offCanvas);
                    if (results.length > 0 && results[0].rawValue) {
                        decodedText = results[0].rawValue;
                    }
                } catch (e) { /* 忽略 */ }
            }
        }

        // -------- 方法3：jsQR 多尺寸 + 带白色边框 --------
        if (!decodedText) {
            const sizes = [origW];
            if (origW < 300) sizes.push(400, 600);
            else if (origW < 500) sizes.push(600);

            for (const sz of sizes) {
                if (decodedText) break;
                for (const smooth of [false, true]) {
                    if (decodedText) break;
                    const { w, h } = offDrawWithBorder(sz, smooth);
                    const imgData = offCtx.getImageData(0, 0, w, h);

                    decodedText = tryJsQR(imgData, w, h);
                    if (decodedText) break;

                    for (const thr of [100, 128, 160]) {
                        decodedText = tryJsQR(binarize(imgData, thr, false), w, h);
                        if (decodedText) break;
                        decodedText = tryJsQR(binarize(imgData, thr, true), w, h);
                        if (decodedText) break;
                    }
                }
            }
        }

        // -------- 显示结果 --------
        if (decodedText) {
            qrDecodeText.textContent = decodedText;
            qrDecodeStatus.textContent = '解析成功';
            qrDecodeStatus.style.color = 'var(--success)';
            if ('BarcodeDetector' in window) {
                try {
                    const detector = new BarcodeDetector({ formats: ['qr_code'] });
                    const results = await detector.detect(canvas);
                    if (results.length > 0 && results[0].boundingBox) {
                        const bb = results[0].boundingBox;
                        ctx.strokeStyle = '#10b981';
                        ctx.lineWidth = 3;
                        ctx.strokeRect(bb.x, bb.y, bb.width, bb.height);
                    }
                } catch (e) { /* 忽略 */ }
            }
        } else {
            qrDecodeText.textContent = '-';
            qrDecodeStatus.textContent = '未识别到二维码，请确认图片中包含有效的二维码';
            qrDecodeStatus.style.color = 'var(--danger)';
        }
    }

    function loadQRImageFile(file) {
        if (!file || !file.type.startsWith('image/')) {
            qrDecodeStatus.textContent = '请选择图片文件';
            qrDecodeStatus.style.color = 'var(--warning)';
            return;
        }
        _currentQrFile = file; // 保存 File 供 html5-qrcode 使用
        qrDecodeFileName.textContent = file.name;
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => decodeQRFromImage(img);
            img.onerror = () => {
                qrDecodeStatus.textContent = '图片加载失败';
                qrDecodeStatus.style.color = 'var(--danger)';
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    qrDecodeFile.addEventListener('change', () => {
        if (qrDecodeFile.files.length > 0) {
            loadQRImageFile(qrDecodeFile.files[0]);
        }
    });

    // 粘贴图片：监听全局 paste 事件
    document.getElementById('qrDecodePaste').addEventListener('click', () => {
        qrDecodeStatus.textContent = '请按 Ctrl+V / Cmd+V 粘贴图片...';
        qrDecodeStatus.style.color = 'var(--text-muted)';
    });
    document.addEventListener('paste', (e) => {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                loadQRImageFile(file);
                return;
            }
        }
    });

    document.getElementById('qrDecodeClear').addEventListener('click', () => {
        qrDecodeFile.value = '';
        qrDecodeFileName.textContent = '未选择文件';
        qrDecodeCanvas.style.display = 'none';
        qrDecodePlaceholder.style.display = '';
        qrDecodeResultPlaceholder.style.display = '';
        qrDecodeKv.style.display = 'none';
        qrDecodeText.textContent = '-';
        qrDecodeStatus.textContent = '就绪';
        qrDecodeStatus.style.color = '';
    });

    // ---------- 回到顶部 ----------
    document.addEventListener('click', function (e) {
        if (e.target.closest('#backToTop')) {
            e.preventDefault();
            e.stopPropagation();
            window.scrollTo({ top: 0, behavior: 'smooth' });
            document.documentElement.scrollTo({ top: 0, behavior: 'smooth' });
            document.body.scrollTop = 0;
        }
    });
})();
