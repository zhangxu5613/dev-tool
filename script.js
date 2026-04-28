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
        toast.style.backgroundColor = type === 'error' ? '#ef4444' : (type === 'success' ? '#10b981' : '#1f2937');
        clearTimeout(showToast._t);
        showToast._t = setTimeout(() => { toast.hidden = true; }, 1800);
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
        if (t === 'string') return `<span class="tk-str">"${escapeHTML(v)}"</span>`;
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
            renderFoldable(parsed);
            buildTree(parsed);
            if (strictOk) {
                setStatus('ok', 'JSON 格式正确 ✓');
            } else {
                setStatus('warn', 'JSON 不完整或有小错误，已尽力格式化');
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
    // 每一行是一个 .jl 元素；容器开始行带折叠按钮，点击后隐藏内部行并在该行末尾显示占位符
    function renderFoldable(data) {
        output.innerHTML = '';
        const indent = getIndent();
        const frag = document.createDocumentFragment();
        renderValueLines(frag, data, 0, indent, '', false);
        output.appendChild(frag);
        // 输出字符数用还原后的文本估算
        const pretty = JSON.stringify(data, null, indent);
        outputInfo.textContent = countInfo(pretty);
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
            const summary = `${keys.length} ${t === 'array' ? '项' : '键'}`;

            // 容器包装，便于统一折叠
            const wrap = document.createElement('div');
            wrap.className = 'fold-block expanded';

            // 开始行
            const headLine = document.createElement('div');
            headLine.className = 'jl jl-head';
            // 空内容的对象/数组不显示折叠箭头
            const canFold = keys.length > 0;
            headLine.innerHTML =
                `<span class="pad">${pad}</span>` +
                (canFold ? `<span class="fold-toggle" title="折叠/展开">▼</span>` : `<span class="fold-toggle empty"></span>`) +
                `${keyPrefixHTML}<span class="tk-punc">${open}</span>` +
                (canFold ? `<span class="fold-placeholder"><span class="tk-punc">${close}</span>${comma}<span class="fold-summary">  // ${summary}</span></span>` : `<span class="tk-punc">${close}</span>${comma}`);
            wrap.appendChild(headLine);

            if (canFold) {
                // 子行容器
                const body = document.createElement('div');
                body.className = 'fold-body';
                keys.forEach((k, idx) => {
                    const isLast = idx === keys.length - 1;
                    const childKeyHTML = t === 'array'
                        ? ''
                        : `<span class="tk-key">"${escapeHTML(k)}"</span><span class="tk-punc">: </span>`;
                    renderValueLines(body, value[k], depth + 1, indentStr, childKeyHTML, !isLast);
                });
                wrap.appendChild(body);

                // 结束行
                const tailLine = document.createElement('div');
                tailLine.className = 'jl jl-tail';
                tailLine.innerHTML = `<span class="pad">${pad}</span><span class="tk-punc">${close}</span>${comma}`;
                wrap.appendChild(tailLine);

                // 折叠交互
                const toggle = headLine.querySelector('.fold-toggle');
                const placeholder = headLine.querySelector('.fold-placeholder');
                toggle.addEventListener('click', () => {
                    const collapsed = wrap.classList.toggle('collapsed');
                    wrap.classList.toggle('expanded', !collapsed);
                    toggle.textContent = collapsed ? '▶' : '▼';
                    body.style.display = collapsed ? 'none' : '';
                    tailLine.style.display = collapsed ? 'none' : '';
                    placeholder.style.display = collapsed ? 'inline' : 'none';
                });
                // 默认隐藏折叠占位
                placeholder.style.display = 'none';
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
            const toggle = wrap.querySelector(':scope > .jl-head > .fold-toggle');
            const placeholder = wrap.querySelector(':scope > .jl-head > .fold-placeholder');
            if (!body || !toggle || !placeholder) return;
            if (expand || idx === 0) {
                wrap.classList.remove('collapsed');
                wrap.classList.add('expanded');
                body.style.display = '';
                if (tail) tail.style.display = '';
                placeholder.style.display = 'none';
                toggle.textContent = '▼';
            } else {
                wrap.classList.add('collapsed');
                wrap.classList.remove('expanded');
                body.style.display = 'none';
                if (tail) tail.style.display = 'none';
                placeholder.style.display = 'inline';
                toggle.textContent = '▶';
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
    function uuidv4() {
        if (crypto.randomUUID) return crypto.randomUUID();
        const b = crypto.getRandomValues(new Uint8Array(16));
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        const h = Array.from(b, x => x.toString(16).padStart(2, '0'));
        return `${h.slice(0,4).join('')}-${h.slice(4,6).join('')}-${h.slice(6,8).join('')}-${h.slice(8,10).join('')}-${h.slice(10,16).join('')}`;
    }

    document.querySelector('[data-action="uuid-gen"]').addEventListener('click', () => {
        const n = Math.max(1, Math.min(1000, parseInt(document.getElementById('uuidCount').value, 10) || 1));
        const upper = document.getElementById('uuidUpper').checked;
        const noDash = document.getElementById('uuidNoDash').checked;
        const arr = [];
        for (let i = 0; i < n; i++) {
            let id = uuidv4();
            if (noDash) id = id.replace(/-/g, '');
            if (upper) id = id.toUpperCase();
            arr.push(id);
        }
        document.getElementById('uuidOutput').value = arr.join('\n');
    });
    document.querySelector('[data-action="uuid-copy"]').addEventListener('click', () => {
        copyTextSimple(document.getElementById('uuidOutput').value, 'UUID 列表');
    });
    document.querySelector('[data-action="uuid-clear"]').addEventListener('click', () => {
        document.getElementById('uuidOutput').value = '';
    });

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
            // 清掉 URL 里同名参数，由 UI 为准
            params.forEach(([k]) => u.searchParams.delete(k));
            params.forEach(([k, v]) => u.searchParams.append(k, v));
            url = u.toString();
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
        const opts = {
            method,
            headers,
            cache: document.getElementById('httpNoCache').checked ? 'no-store' : 'default',
            credentials: document.getElementById('httpCreds').checked ? 'include' : 'same-origin',
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

        return { url, opts, method };
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
        const timer = setTimeout(() => ac.abort(), timeoutMs);
        req.opts.signal = ac.signal;

        const t0 = performance.now();
        try {
            const resp = await fetch(req.url, req.opts);
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
            httpRespStatus.className = 'resp-status resp-err';
            httpRespStatus.textContent = err.name === 'AbortError' ? '超时' : '请求失败';
            httpRespBody.textContent = err.message + '\n\n可能原因：\n  · 目标服务器未返回 CORS 响应头（Access-Control-Allow-Origin）\n  · 网络不通 / DNS 解析失败 / 证书错误\n  · 被浏览器或插件拦截';
            httpRespRaw.textContent = String(err);
        }
    }

    function renderRespBody() {
        const view = document.querySelector('input[name="respView"]:checked').value;
        if (!lastRespText) { httpRespBody.textContent = ''; return; }
        if (view === 'pretty' && /json/i.test(lastRespContentType)) {
            try {
                const obj = JSON.parse(lastRespText);
                httpRespBody.innerHTML = highlightJSON(JSON.stringify(obj, null, 2));
                return;
            } catch {}
        }
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
})();
