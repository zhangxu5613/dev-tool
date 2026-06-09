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
        if (Array.isArray(v)) return 'array';
        return typeof v;
    }

    function valueHTML(v) {
        const t = typeOf(v);
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
                return `<span class="tk-str jl-link">"${escaped}"${popup}</span>`;
            }
            return `<span class="tk-str">"${escapeHTML(v)}"</span>`;
        }
        if (t === 'number') return `<span class="tk-num">${v}</span>`;
        if (t === 'boolean') return `<span class="tk-bool">${v}</span>`;
        if (t === 'null') return `<span class="tk-null">null</span>`;
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

        // 优先尝试标准解析
        let strictOk = false;
        let parsed = null;
        try {
            parsed = JSON.parse(raw);
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
        const indent = getIndent();
        const frag = document.createDocumentFragment();
        renderValueLines(frag, data, 0, indent, '', false);
        output.appendChild(frag);
        const pretty = JSON.stringify(data, null, indent);
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
     */
    function renderValueLines(parent, value, depth, indentStr, keyPrefixHTML, trailingComma) {
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
                    : `<span class="tk-punc">${close}</span>${comma}`);
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
                    renderValueLines(body, value[k], depth + 1, indentStr, childKeyHTML, !isLast);
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
            line.innerHTML = `<span class="pad">${pad}</span>${keyPrefixHTML}${valueHTML(value)}${comma}`;
            parent.appendChild(line);
        }
    }

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
            const obj = JSON.parse(raw);
            const min = JSON.stringify(obj);
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
        if (currentObj !== null) return JSON.stringify(currentObj, null, getIndent());
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

    document.querySelector('[data-action="ts-to-date"]').addEventListener('click', () => {
        const raw = document.getElementById('tsInput').value.trim();
        if (!raw) return;
        const unit = document.getElementById('tsUnit').value;
        let n = Number(raw);
        if (isNaN(n)) { showToast('时间戳不合法', 'error'); return; }
        let ms;
        if (unit === 's') ms = n * 1000;
        else if (unit === 'ms') ms = n;
        else ms = raw.length >= 13 ? n : n * 1000; // auto
        const d = new Date(ms);
        if (isNaN(d.getTime())) { showToast('无法解析为日期', 'error'); return; }
        document.getElementById('tsLocal').textContent = fmtDate(d);
        document.getElementById('tsUtc').textContent = fmtUTC(d) + ' (UTC)';
        document.getElementById('tsIso').textContent = d.toISOString();
    });

    document.querySelector('[data-action="date-to-ts"]').addEventListener('click', () => {
        const v = document.getElementById('dtInput').value;
        if (!v) { showToast('请先选择日期'); return; }
        const d = new Date(v);
        if (isNaN(d.getTime())) { showToast('日期不合法', 'error'); return; }
        document.getElementById('dtTsSec').textContent = Math.floor(d.getTime() / 1000);
        document.getElementById('dtTsMs').textContent = d.getTime();
    });

    // 初始化当前时间到 datetime-local 输入
    (function initDt() {
        const d = new Date();
        const v = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        document.getElementById('dtInput').value = v;
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

    document.getElementById('strfmtFormat').addEventListener('click', doStrFormat);
    document.getElementById('strfmtReverse').addEventListener('click', doStrReverse);
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

    function renderMdPreview() {
        const text = strfmtRight.value;
        if (!text) { strfmtMdPreview.innerHTML = '<p style="color:var(--text-muted)">暂无内容</p>'; return; }
        try {
            strfmtMdPreview.innerHTML = marked.parse(text, { breaks: true, gfm: true });
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
    const diffLeftPreview = document.getElementById('diffLeftPreview');
    const diffRightPreview = document.getElementById('diffRightPreview');
    const diffStatus = document.getElementById('diffStatus');
    const diffSummary = document.getElementById('diffSummary');

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
            return `<div class="dline ${l.type}">${diffHighlight(text) || '&nbsp;'}</div>`;
        }).join('');
    }

    function linesToText(lines) {
        const indentChar = '  ';
        return lines.map(l => indentChar.repeat(l.indent) + l.text).join('\n');
    }

    function showPreview(side) {
        const editor = document.querySelector(`.diff-editor[data-side="${side}"]`);
        if (!editor) return;
        const ta = editor.querySelector('textarea');
        const pv = editor.querySelector('.diff-preview');
        ta.style.display = 'none';
        pv.hidden = false;
    }
    function hidePreview(side) {
        const editor = document.querySelector(`.diff-editor[data-side="${side}"]`);
        if (!editor) return;
        const ta = editor.querySelector('textarea');
        const pv = editor.querySelector('.diff-preview');
        ta.style.display = '';
        pv.hidden = true;
    }

    // "编辑"按钮：回到编辑模式（恢复原始输入）
    document.getElementById('diffEdit').addEventListener('click', () => {
        hidePreview('left');
        hidePreview('right');
        diffLeftEl.value = _diffLeftRaw;
        diffRightEl.value = _diffRightRaw;
        diffLeftEl.focus();
        document.getElementById('diffEdit').style.display = 'none';
    });

    // 用户编辑 textarea 时，隐藏预览层
    diffLeftEl.addEventListener('input', () => hidePreview('left'));
    diffRightEl.addEventListener('input', () => hidePreview('right'));

    function runDiff() {
        const lraw = diffLeftEl.value.trim();
        const rraw = diffRightEl.value.trim();
        _diffLeftRaw = diffLeftEl.value;
        _diffRightRaw = diffRightEl.value;
        if (!lraw && !rraw) {
            hidePreview('left'); hidePreview('right');
            diffSummary.hidden = true;
            diffStatus.textContent = '请在左右两侧粘贴 JSON';
            diffStatus.style.color = '';
            return;
        }
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

        diffLeftPreview.className = 'diff-preview side-left';
        diffRightPreview.className = 'diff-preview side-right';
        diffLeftPreview.innerHTML = linesToHTML(leftLines) || '<div class="dline">&nbsp;</div>';
        diffRightPreview.innerHTML = linesToHTML(rightLines) || '<div class="dline">&nbsp;</div>';
        showPreview('left');
        showPreview('right');
        document.getElementById('diffEdit').style.display = '';

        document.getElementById('diffAddCnt').textContent = stats.add;
        document.getElementById('diffDelCnt').textContent = stats.del;
        document.getElementById('diffModCnt').textContent = stats.mod;
        document.getElementById('diffSameCnt').textContent = stats.same;
        diffSummary.hidden = false;

        // 收集差异行，用于导航
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
        hidePreview('left'); hidePreview('right');
        const tmp = _diffLeftRaw || diffLeftEl.value;
        diffLeftEl.value = _diffRightRaw || diffRightEl.value;
        diffRightEl.value = tmp;
        runDiff();
    });
    document.getElementById('diffClear').addEventListener('click', () => {
        hidePreview('left'); hidePreview('right');
        diffLeftEl.value = '';
        diffRightEl.value = '';
        diffSummary.hidden = true;
        diffStatus.textContent = '就绪';
        diffStatus.style.color = '';
        _diffNavItems = [];
        _diffNavIndex = -1;
        _diffLeftRaw = '';
        _diffRightRaw = '';
        document.getElementById('diffNav').style.display = 'none';
        document.getElementById('diffEdit').style.display = 'none';
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
