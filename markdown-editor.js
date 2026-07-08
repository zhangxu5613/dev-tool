/* ============================================================
   MarkDown 编辑器逻辑（移植自 lengyi-markdown-editor）
   集成到 dev-tool：复用 marked / mermaid / katex / dom-to-image-more
   ============================================================ */
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);

    const editor = $('mdEditor');
    const preview = $('mdPreview');
    const previewSource = $('mdPreviewSource');
    const filenameInput = $('mdFilename');
    const wordCount = $('mdWordCount');
    const saveHint = $('mdSaveHint');
    const toastEl = $('toast');

    const STORAGE_KEY = 'md_editor_content';
    const FILENAME_KEY = 'md_editor_filename';
    const RATIO_KEY = 'md_editor_ratio';
    const EDITOR_COLLAPSED_KEY = 'md_editor_editor_collapsed';
    const PREVIEW_COLLAPSED_KEY = 'md_editor_preview_collapsed';
    const PREVIEW_MODE_KEY = 'md_editor_preview_mode';
    const LAYOUT_MODE_KEY = 'md_editor_layout_mode';

    let previewMode = 'preview';
    let editorCollapsed = false;
    let previewCollapsed = false;
    let editorRatio = 0.5;
    let isResizing = false;
    let resizeRect = null;

    // 历史记录
    const MAX_HISTORY = 100;
    let historyStack = [];
    let historyIndex = -1;
    let lastHistoryText = null;
    let historyTimer = null;

    let findIndex = 0;

    const WELCOME_DOC = [
        '# 欢迎使用 MarkDown 编辑器',
        '',
        '这是一个**即开即用**的浏览器 Markdown 写作工具，左侧写作，右侧实时预览。',
        '',
        '## 基础语法',
        '',
        '- **加粗**、*斜体*、~~删除线~~、`行内代码`',
        '- 支持 [链接](https://example.com) 与 ![图片](https://picsum.photos/200/120)',
        '- 列表、引用、任务列表：',
        '',
        '- [x] 已完成任务',
        '- [ ] 待办任务',
        '',
        '> 这是一段引用文字。',
        '',
        '```js',
        'function hello() {',
        "  console.log('Hello, Markdown!');",
        '}',
        '```',
        '',
        '## 数学公式',
        '',
        '行内公式 $E = mc^2$，块级公式：',
        '',
        '$$',
        '\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}',
        '$$',
        '',
        '## 流程图（Mermaid）',
        '',
        '```mermaid',
        'flowchart TD',
        '  A[开始] --> B{是否保存?}',
        '  B -->|是| C[导出文档]',
        '  B -->|否| D[继续编辑]',
        '```',
        '',
        '> 内容会自动保存在浏览器本地，刷新或关闭后再打开会自动恢复。',
        ''
    ].join('\n');

    /* ---------------- Toast ---------------- */
    function mdShowToast(msg) {
        if (!toastEl) return;
        toastEl.textContent = msg;
        toastEl.hidden = false;
        toastEl.className = 'toast';
        toastEl.style.backgroundColor = '';
        clearTimeout(mdShowToast._t);
        mdShowToast._t = setTimeout(() => { toastEl.hidden = true; }, 2000);
    }

    /* ---------------- marked / mermaid 配置 ---------------- */
    if (typeof marked !== 'undefined') {
        marked.setOptions({ breaks: true, gfm: true, headerIds: false, mangle: false });
    }

    function getTheme() {
        return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    }

    function initMermaid() {
        if (typeof mermaid === 'undefined') return;
        try {
            mermaid.initialize({ startOnLoad: false, theme: getTheme() === 'dark' ? 'dark' : 'default' });
        } catch (e) { /* ignore */ }
    }
    initMermaid();

    /* ---------------- 渲染预览 ---------------- */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function protectMath(text) {
        const placeholders = [];
        let counter = 0;
        const store = (m) => {
            const key = '<!--MATH' + (counter++) + '-->';
            placeholders.push({ key, value: m });
            return key;
        };
        const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
        const out = parts.map(part => {
            if (part.startsWith('```') || part.startsWith('`')) return part;
            let p = part.replace(/\$\$[\s\S]*?\$\$/g, m => store(m));
            p = p.replace(/(^|[^\\])\$([^$\n]+?)\$/g, (m, p1) => p1 + store(m.slice(p1.length)));
            return p;
        }).join('');
        return { text: out, placeholders };
    }

    function restoreMath(html, placeholders) {
        placeholders.forEach(({ key, value }) => { html = html.split(key).join(value); });
        return html;
    }

    function styleTaskLists() {
        preview.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            const li = cb.closest('li');
            if (!li) return;
            li.classList.add('task-item');
            const ul = li.closest('ul, ol');
            if (ul && ul.tagName === 'UL') ul.classList.add('task-list');
        });
    }

    function renderMermaidBlocks() {
        if (typeof mermaid === 'undefined') return;
        const blocks = preview.querySelectorAll('.markdown-body pre code.language-mermaid');
        if (!blocks.length) return;
        blocks.forEach(code => {
            const pre = code.parentElement;
            const source = code.textContent.trim();
            if (!source) return;
            const container = document.createElement('div');
            container.className = 'mermaid';
            container.textContent = source;
            pre.replaceWith(container);
        });
        try { mermaid.run({ querySelector: '.markdown-body .mermaid' }); }
        catch (err) { console.error('Mermaid render error:', err); }
    }

    function mdRender() {
        let text = editor.value;
        let placeholders = [];
        if (typeof renderMathInElement !== 'undefined') {
            const protectedMath = protectMath(text);
            text = protectedMath.text;
            placeholders = protectedMath.placeholders;
        }
        let html = '';
        if (typeof marked !== 'undefined') {
            html = marked.parse(text);
        } else {
            html = '<pre style="white-space:pre-wrap">' + escapeHtml(text) + '</pre>';
        }
        if (placeholders.length) html = restoreMath(html, placeholders);
        preview.innerHTML = html;
        styleTaskLists();
        if (typeof renderMathInElement !== 'undefined') {
            try {
                renderMathInElement(preview, {
                    delimiters: [
                        { left: '$$', right: '$$', display: true },
                        { left: '$', right: '$', display: false }
                    ],
                    throwOnError: false
                });
            } catch (e) { /* ignore */ }
        }
        renderMermaidBlocks();
    }

    function updateCount() {
        const text = editor.value;
        const count = text.replace(/\s/g, '').length;
        wordCount.textContent = count + ' 字';
    }

    /* ---------------- 自动保存 ---------------- */
    let saveTimer;
    function autoSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            localStorage.setItem(STORAGE_KEY, editor.value);
            localStorage.setItem(FILENAME_KEY, filenameInput.value);
            showSaveHint();
        }, 500);
    }
    function showSaveHint() {
        saveHint.classList.add('show');
        setTimeout(() => saveHint.classList.remove('show'), 1500);
    }
    function saveToLocal() {
        localStorage.setItem(STORAGE_KEY, editor.value);
        localStorage.setItem(FILENAME_KEY, filenameInput.value);
        showSaveHint();
        mdShowToast('已保存到本地');
    }

    /* ---------------- 编辑器辅助 ---------------- */
    function getActiveEditor() {
        if (previewMode === 'source' && document.activeElement === previewSource) return previewSource;
        return editor;
    }
    function syncEditorFromActive() {
        const el = getActiveEditor();
        if (el === previewSource) editor.value = previewSource.value;
        else if (previewMode === 'source') previewSource.value = editor.value;
    }
    function afterEdit() {
        syncEditorFromActive();
        mdRender();
        updateCount();
        autoSave();
    }
    function wrapSelection(before, after) {
        const el = getActiveEditor();
        const start = el.selectionStart, end = el.selectionEnd;
        const selected = el.value.slice(start, end);
        el.setRangeText(before + selected + after, start, end, 'select');
        afterEdit();
        el.focus();
    }
    function prefixLines(prefix) {
        const el = getActiveEditor();
        const start = el.selectionStart, end = el.selectionEnd;
        const before = el.value.slice(0, start);
        const selected = el.value.slice(start, end) || '列表项';
        const firstLineStart = before.lastIndexOf('\n') + 1;
        const lines = selected.split('\n');
        const prefixed = lines.map(line => (line ? prefix + line : line)).join('\n');
        el.setRangeText(prefixed, firstLineStart, end, 'end');
        afterEdit();
        el.focus();
    }
    function insertHeading(level) {
        const el = getActiveEditor();
        const start = el.selectionStart;
        const before = el.value.slice(0, start);
        const lineStart = before.lastIndexOf('\n') + 1;
        const lineEnd = el.value.indexOf('\n', lineStart);
        const end = lineEnd === -1 ? el.value.length : lineEnd;
        const currentLine = el.value.slice(lineStart, end);
        const newLine = '#'.repeat(level) + ' ' + currentLine.replace(/^#{0,6}\s*/, '');
        el.setRangeText(newLine, lineStart, end, 'end');
        afterEdit();
        el.focus();
    }
    function formatQuote() {
        const el = getActiveEditor();
        const start = el.selectionStart, end = el.selectionEnd;
        const selected = el.value.slice(start, end) || '引用内容';
        const quoted = '> ' + selected.replace(/\n/g, '\n> ');
        el.setRangeText(quoted, start, end, 'select');
        afterEdit();
        el.focus();
    }
    function insertCodeBlock() {
        const el = getActiveEditor();
        const start = el.selectionStart, end = el.selectionEnd;
        const selected = el.value.slice(start, end);
        const insert = selected.includes('\n') ? '```\n' + selected + '\n```' : '`' + selected + '`';
        el.setRangeText(insert, start, end, 'select');
        afterEdit();
        el.focus();
    }
    function insertLink() {
        const el = getActiveEditor();
        const start = el.selectionStart, end = el.selectionEnd;
        const selected = el.value.slice(start, end) || '链接文字';
        const url = prompt('请输入链接地址：', 'https://');
        if (!url) return;
        el.setRangeText('[' + selected + '](' + url + ')', start, end, 'end');
        afterEdit();
        el.focus();
    }
    function insertImageMarkdown(alt, url) {
        const safeAlt = String(alt).replace(/\]/g, '\\]');
        const el = getActiveEditor();
        const start = el.selectionStart, end = el.selectionEnd;
        el.setRangeText('![' + (safeAlt || '图片') + '](' + url + ')', start, end, 'end');
        afterEdit();
        el.focus();
    }

    /* ---------------- 表格 ---------------- */
    const TABLE_GRID_ROWS = 8, TABLE_GRID_COLS = 8;
    function initTableGrid() {
        const grid = $('mdTableGrid');
        if (!grid || grid.children.length) return;
        for (let r = 1; r <= TABLE_GRID_ROWS; r++) {
            for (let c = 1; c <= TABLE_GRID_COLS; c++) {
                const cell = document.createElement('div');
                cell.className = 'md-table-grid-cell';
                cell.dataset.row = r; cell.dataset.col = c;
                grid.appendChild(cell);
            }
        }
        grid.addEventListener('mouseover', (e) => {
            if (!e.target.classList.contains('md-table-grid-cell')) return;
            highlightTableCells(parseInt(e.target.dataset.row), parseInt(e.target.dataset.col));
        });
        grid.addEventListener('click', (e) => {
            if (!e.target.classList.contains('md-table-grid-cell')) return;
            insertTable(parseInt(e.target.dataset.row), parseInt(e.target.dataset.col));
            closeDropdown('mdTableDropdown');
        });
        grid.addEventListener('mouseleave', () => highlightTableCells(0, 0));
    }
    function highlightTableCells(rows, cols) {
        document.querySelectorAll('.md-table-grid-cell').forEach(cell => {
            const r = parseInt(cell.dataset.row), c = parseInt(cell.dataset.col);
            cell.classList.toggle('active', r <= rows && c <= cols);
        });
        const label = $('mdTableSizeLabel');
        if (label) label.textContent = rows + ' 行 × ' + cols + ' 列';
    }
    function insertTable(rows, cols) {
        if (!rows || !cols) return;
        const headerCols = Array.from({ length: cols }, (_, i) => ' 列' + (i + 1) + ' ').join('|');
        const separator = '|' + Array.from({ length: cols }, () => ' --- ').join('|') + '|';
        const dataCols = '|' + Array.from({ length: cols }, () => ' 内容 ').join('|') + '|';
        let table = '\n|' + headerCols + '|\n' + separator;
        for (let r = 2; r <= rows; r++) table += '\n' + dataCols;
        table += '\n';
        const el = getActiveEditor();
        const start = el.selectionStart, end = el.selectionEnd;
        el.setRangeText(table, start, end, 'end');
        afterEdit();
        el.focus();
    }

    /* ---------------- 图片模态框 ---------------- */
    let pendingImageDataUrl = '';
    function openImageModal() {
        pendingImageDataUrl = '';
        $('mdImageUrl').value = '';
        $('mdImageAlt').value = '';
        $('mdImageUploadAlt').value = '';
        $('mdImagePreview').innerHTML = '';
        $('mdImageFile').value = '';
        switchImageTab('url');
        showModal('mdImageModal');
    }
    function switchImageTab(tab) {
        document.querySelectorAll('.md-img-tab').forEach(b => b.classList.toggle('active', b.dataset.mdImgtab === tab));
        document.querySelectorAll('.md-img-panel').forEach(p => p.classList.toggle('active', p.id === 'mdImgTab' + tab.charAt(0).toUpperCase() + tab.slice(1)));
    }
    function handleImageFileSelect(input) {
        const file = input.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) { mdShowToast('请选择图片文件'); return; }
        if (file.size > 5 * 1024 * 1024) { mdShowToast('图片过大（>5MB）'); return; }
        const reader = new FileReader();
        reader.onload = (e) => {
            pendingImageDataUrl = e.target.result;
            $('mdImagePreview').innerHTML = '<img src="' + pendingImageDataUrl + '" alt="预览">';
            switchImageTab('upload');
        };
        reader.readAsDataURL(file);
    }
    function confirmImageInsert() {
        const activeTab = document.querySelector('.md-img-tab.active').dataset.mdImgtab;
        let url = '', alt = '';
        if (activeTab === 'url') {
            url = $('mdImageUrl').value.trim();
            alt = $('mdImageAlt').value.trim();
            if (!url) { mdShowToast('请输入图片链接'); return; }
        } else {
            url = pendingImageDataUrl;
            alt = $('mdImageUploadAlt').value.trim();
            if (!url) { mdShowToast('请选择图片'); return; }
        }
        insertImageMarkdown(alt || '图片', url);
        closeModal('mdImageModal');
    }

    /* ---------------- Mermaid 模态框 ---------------- */
    const MERMAID_TEMPLATES = {
        mindmap: 'mindmap\n  root((主题))\n    子主题 A\n      子节点 A1\n      子节点 A2\n    子主题 B\n      子节点 B1',
        flowchart: 'flowchart TD\n  A[开始] --> B{判断}\n  B -->|是| C[执行]\n  B -->|否| D[结束]',
        sequence: 'sequenceDiagram\n  参与者 用户\n  参与者 系统\n  用户->>系统: 请求\n  系统-->>用户: 响应'
    };
    function openMermaidModal() {
        $('mdMermaidType').value = 'mindmap';
        updateMermaidTemplate();
        showModal('mdMermaidModal');
    }
    function updateMermaidTemplate() {
        const type = $('mdMermaidType').value;
        $('mdMermaidCode').value = MERMAID_TEMPLATES[type] || MERMAID_TEMPLATES.mindmap;
    }
    function confirmMermaidInsert() {
        const code = $('mdMermaidCode').value.trim();
        if (!code) { mdShowToast('请输入 Mermaid 源码'); return; }
        const el = getActiveEditor();
        const start = el.selectionStart, end = el.selectionEnd;
        const fenced = '\n```mermaid\n' + code + '\n```\n\n';
        el.setRangeText(fenced, start, end, 'end');
        afterEdit();
        closeModal('mdMermaidModal');
        mdShowToast('已插入 Mermaid 图表');
    }

    /* ---------------- 查找替换 ---------------- */
    function openFindModal() {
        showModal('mdFindModal');
        const findInput = $('mdFindInput');
        const ed = getActiveEditor();
        if (ed.selectionStart !== ed.selectionEnd) findInput.value = ed.value.slice(ed.selectionStart, ed.selectionEnd);
        $('mdFindStatus').textContent = '';
        findInput.focus();
        findInput.select();
    }
    function findNext() {
        const query = $('mdFindInput').value;
        const status = $('mdFindStatus');
        const el = getActiveEditor();
        if (!query) { status.textContent = ''; return; }
        const text = el.value;
        let pos = text.indexOf(query, findIndex);
        if (pos === -1) pos = text.indexOf(query, 0);
        if (pos === -1) { status.textContent = '未找到匹配'; return; }
        findIndex = pos + query.length;
        el.setSelectionRange(pos, findIndex);
        el.focus();
        status.textContent = '已找到匹配';
    }
    function replaceOne() {
        const query = $('mdFindInput').value;
        const replacement = $('mdReplaceInput').value;
        const status = $('mdFindStatus');
        const el = getActiveEditor();
        if (!query) { status.textContent = ''; return; }
        const start = el.selectionStart, end = el.selectionEnd;
        if (el.value.slice(start, end) !== query) { findNext(); return; }
        el.setRangeText(replacement, start, end, 'end');
        syncEditorFromActive();
        findIndex = start + replacement.length;
        afterEdit();
        findNext();
    }
    function replaceAll() {
        const query = $('mdFindInput').value;
        const replacement = $('mdReplaceInput').value;
        const status = $('mdFindStatus');
        const el = getActiveEditor();
        if (!query) { status.textContent = ''; return; }
        let count = 0, text = el.value, pos = text.indexOf(query);
        while (pos !== -1) {
            count++;
            text = text.slice(0, pos) + replacement + text.slice(pos + query.length);
            pos = text.indexOf(query, pos + replacement.length);
        }
        if (count > 0) {
            el.value = text;
            syncEditorFromActive();
            findIndex = 0;
            afterEdit();
        }
        status.textContent = count > 0 ? ('已替换 ' + count + ' 处') : '未找到匹配';
    }

    /* ---------------- 导出 ---------------- */
    function safeName(name, ext) {
        name = (name || '').trim() || '未命名文档';
        if (!new RegExp('\\.' + ext + '$', 'i').test(name)) name += '.' + ext;
        return name;
    }
    function downloadBlob(blob, name) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    function exportMD() {
        const blob = new Blob([editor.value], { type: 'text/markdown;charset=utf-8' });
        downloadBlob(blob, safeName(filenameInput.value, 'md'));
        mdShowToast('已导出 Markdown');
    }
    function exportWord() {
        const name = safeName(filenameInput.value, 'doc');
        let bodyHtml = (typeof marked !== 'undefined') ? marked.parse(editor.value)
            : '<pre style="white-space:pre-wrap">' + escapeHtml(editor.value) + '</pre>';
        const full = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(name)}</title>
<style>
body{font-family:"Microsoft YaHei","SimSun","PingFang SC",sans-serif;font-size:12pt;line-height:1.6;color:#000}
h1{font-size:20pt;font-weight:bold;margin:18pt 0 10pt}h2{font-size:16pt;font-weight:bold;margin:14pt 0 8pt}
h3{font-size:14pt;font-weight:bold;margin:12pt 0 6pt}h4,h5,h6{font-size:12pt;font-weight:bold;margin:10pt 0 6pt}
p{margin:6pt 0}pre,code{font-family:Consolas,"Courier New",monospace}pre{background:#f5f5f5;padding:8pt;border-radius:4px;overflow-x:auto}
code{background:#f5f5f5;padding:1pt 3pt;border-radius:2px}blockquote{border-left:3px solid #ccc;margin:6pt 0;padding:4pt 10pt;color:#555}
table{border-collapse:collapse;width:100%;margin:8pt 0}th,td{border:1px solid #ccc;padding:5pt 8pt}th{background:#f5f5f5;font-weight:bold}
ul,ol{margin:6pt 0;padding-left:24pt}li{margin:3pt 0}img{max-width:100%;height:auto}hr{border:none;border-top:1px solid #ccc;margin:12pt 0}
a{color:#0563c1;text-decoration:underline}
</style></head><body>\n${bodyHtml}\n</body></html>`;
        downloadBlob(new Blob([full], { type: 'application/msword;charset=utf-8' }), name);
        mdShowToast('已导出 Word');
    }
    function exportHTML() {
        const name = safeName(filenameInput.value, 'html');
        let bodyHtml = (typeof marked !== 'undefined') ? marked.parse(editor.value)
            : '<pre style="white-space:pre-wrap">' + escapeHtml(editor.value) + '</pre>';
        const full = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(name)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;font-size:16px;line-height:1.7;max-width:820px;margin:40px auto;padding:0 20px;color:#212529;background:#fff}
h1,h2,h3,h4,h5,h6{margin:24px 0 12px;font-weight:600;line-height:1.25}h1{font-size:2em;border-bottom:1px solid #dee2e6;padding-bottom:8px}h2{font-size:1.5em;border-bottom:1px solid #dee2e6;padding-bottom:6px}h3{font-size:1.25em}
p{margin:0 0 14px}a{color:#0d6efd;text-decoration:none}a:hover{text-decoration:underline}
ul,ol{margin:0 0 14px;padding-left:2em}li{margin:4px 0}li.task-item{list-style:none;margin-left:-1.4em}ul.task-list{padding-left:1.8em}
code{background:#f1f3f5;padding:2px 6px;border-radius:4px;font-family:"SFMono-Regular",Consolas,monospace;font-size:.9em}
pre{background:#f1f3f5;padding:14px;border-radius:8px;overflow-x:auto;margin:0 0 14px}pre code{background:transparent;padding:0;font-size:.9em}
blockquote{margin:0 0 14px;padding:8px 16px;border-left:4px solid #8a93a1;background:#f1f3f5;color:#6c757d;font-size:.95em}
table{border-collapse:collapse;width:100%;margin-bottom:14px}th,td{border:1px solid #dee2e6;padding:8px 12px;text-align:left}th{background:#f1f3f5;font-weight:600}
img{max-width:100%;height:auto;border-radius:6px}hr{border:none;border-top:1px solid #dee2e6;margin:20px 0}.katex{font-size:1.1em}.katex-display{margin:16px 0;overflow-x:auto}
</style></head><body>
${bodyHtml}
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"><\/script>
<script>document.addEventListener('DOMContentLoaded',function(){if(typeof renderMathInElement!=='undefined'){renderMathInElement(document.body,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}],throwOnError:false});}});<\/script>
</body></html>`;
        downloadBlob(new Blob([full], { type: 'text/html;charset=utf-8' }), name);
        mdShowToast('已导出 HTML');
    }
    function exportPDF() {
        const wasSource = previewMode === 'source';
        if (wasSource) setPreviewMode('preview');
        const onAfterPrint = () => {
            if (wasSource) setPreviewMode('source');
            window.removeEventListener('afterprint', onAfterPrint);
        };
        window.addEventListener('afterprint', onAfterPrint);
        window.print();
    }

    /* ---------------- 导出图片 (PNG) ---------------- */
    let currentImageRatio = '9:16';
    let currentImageDataUrl = '';
    const RATIO_PRESETS = {
        '9:16': { width: 1080, height: 1920 },
        '4:5': { width: 1080, height: 1350 },
        '3:4': { width: 1080, height: 1440 },
        '1:1': { width: 1080, height: 1080 },
        '16:9': { width: 1920, height: 1080 }
    };
    const IMAGE_PLACEHOLDER = 'data:image/svg+xml;base64,' + btoa(
        '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#e9ecef"/><text x="60" y="44" text-anchor="middle" font-size="12" fill="#6c757d">Image unavailable</text></svg>'
    );
    function openExportImageModal() {
        if (previewMode !== 'preview') setPreviewMode('preview');
        showModal('mdImageExportModal');
        $('mdImageCropFit').checked = false;
        selectImageRatio(currentImageRatio);
    }
    function selectImageRatio(ratio) {
        currentImageRatio = ratio;
        document.querySelectorAll('.md-ratio-btn').forEach(b => b.classList.toggle('active', b.dataset.mdRatio === ratio));
        renderExportImagePreview();
    }
    function prepareExportImages(root) {
        const imgs = root.querySelectorAll('img');
        return Promise.all(Array.from(imgs).map(img => new Promise(resolve => {
            if (!img.src || img.src.startsWith('data:')) return resolve();
            const test = new Image();
            test.crossOrigin = 'anonymous';
            test.onload = () => { img.crossOrigin = 'anonymous'; img.src = test.src; resolve(); };
            test.onerror = () => { img.src = IMAGE_PLACEHOLDER; resolve(); };
            const sep = img.src.includes('?') ? '&' : '?';
            test.src = img.src + sep + '_cors=' + Date.now();
        })));
    }
    async function renderExportImagePreview() {
        if (typeof domtoimage === 'undefined') { mdShowToast('图片导出库未加载'); return; }
        const preset = RATIO_PRESETS[currentImageRatio];
        const stage = $('mdExportStage');
        const container = $('mdExportContent');
        container.innerHTML = '';
        const clone = document.createElement('div');
        clone.className = 'markdown-body';
        clone.innerHTML = preview.innerHTML;
        clone.style.width = preset.width + 'px';
        clone.style.padding = Math.round(preset.width * 0.04) + 'px ' + Math.round(preset.width * 0.045) + 'px';
        clone.style.fontSize = Math.round(preset.width / 36) + 'px';
        clone.style.lineHeight = '1.7';
        clone.style.boxSizing = 'border-box';
        clone.style.background = getComputedStyle(document.body).getPropertyValue('--bg-elev') || '#fff';
        clone.style.color = getComputedStyle(document.body).getPropertyValue('--text') || '#000';
        clone.style.overflow = 'visible';
        clone.style.maxWidth = 'none';
        clone.style.margin = '0';
        container.appendChild(clone);
        const markdownBody = clone;
        markdownBody.style.maxWidth = 'none';
        markdownBody.style.width = '100%';
        markdownBody.style.margin = '0';
        stage.style.width = preset.width + 'px';
        stage.style.height = 'auto';
        await prepareExportImages(clone);
        const cropFit = $('mdImageCropFit').checked;
        const targetHeight = preset.height;
        const naturalHeight = clone.scrollHeight;
        let captureHeight;
        if (naturalHeight < targetHeight) {
            clone.style.minHeight = targetHeight + 'px';
            clone.style.height = targetHeight + 'px';
            captureHeight = targetHeight;
        } else if (cropFit) {
            clone.style.height = targetHeight + 'px';
            clone.style.overflow = 'hidden';
            captureHeight = targetHeight;
        } else {
            clone.style.height = 'auto';
            clone.style.overflow = 'visible';
            captureHeight = naturalHeight;
        }
        stage.style.height = captureHeight + 'px';
        try {
            const dataUrl = await domtoimage.toPng(clone, {
                width: preset.width,
                height: captureHeight,
                bgcolor: getComputedStyle(clone).backgroundColor || '#ffffff',
                cacheBust: true,
                imagePlaceholder: IMAGE_PLACEHOLDER
            });
            currentImageDataUrl = dataUrl;
            const previewImg = $('mdExportImagePreview');
            previewImg.src = dataUrl;
            previewImg.style.display = 'block';
            mdShowToast('预览已生成');
        } catch (err) {
            console.error(err);
            mdShowToast('图片生成失败：' + err.message);
        } finally {
            clone.style.height = ''; clone.style.minHeight = ''; clone.style.overflow = '';
        }
    }
    function downloadExportImage() {
        if (!currentImageDataUrl) { mdShowToast('请先生成预览'); return; }
        let name = (filenameInput.value || '未命名文档').replace(/\.(md|markdown|txt|html|doc)$/i, '') + '.png';
        const a = document.createElement('a');
        a.href = currentImageDataUrl; a.download = name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        mdShowToast('已下载 PNG');
    }

    /* ---------------- 文件导入 / 拖放 ---------------- */
    function loadFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            editor.value = e.target.result;
            let name = file.name;
            if (!/\.(md|markdown)$/i.test(name)) name += '.md';
            filenameInput.value = name;
            if (previewMode === 'source') previewSource.value = editor.value;
            mdRender(); updateCount(); saveToLocal();
            mdShowToast('已导入文件');
        };
        reader.readAsText(file);
    }
    function importFile(input) {
        const file = input.files[0];
        if (file) loadFile(file);
        input.value = '';
    }

    const dropOverlay = $('mdDropOverlay');
    let dragCounter = 0;
    function showDropOverlay() { if (dropOverlay) dropOverlay.classList.add('show'); }
    function hideDropOverlay() { if (dropOverlay) dropOverlay.classList.remove('show'); }

    /* ---------------- 布局：分栏 + 折叠 ---------------- */
    function applySplit() {
        const editorPane = $('mdEditorPane');
        const previewPane = $('mdPreviewPane');
        const resizer = $('mdResizer');
        if (editorCollapsed || previewCollapsed) {
            editorPane.style.flex = '';
            previewPane.style.flex = '';
            resizer.classList.add('hidden');
        } else {
            editorPane.style.flex = '0 0 ' + (editorRatio * 100) + '%';
            previewPane.style.flex = '1 1 0';
            resizer.classList.remove('hidden');
        }
    }
    function applyPaneStates() {
        const editorPane = $('mdEditorPane');
        const previewPane = $('mdPreviewPane');
        editorPane.classList.toggle('collapsed', editorCollapsed);
        previewPane.classList.toggle('collapsed', previewCollapsed);
        applySplit();
    }
    function togglePane(pane) {
        if (pane === 'editor') {
            if (!editorCollapsed && previewCollapsed) return;
            editorCollapsed = !editorCollapsed;
        } else {
            if (!previewCollapsed && editorCollapsed) return;
            previewCollapsed = !previewCollapsed;
        }
        applyPaneStates();
        localStorage.setItem(EDITOR_COLLAPSED_KEY, editorCollapsed);
        localStorage.setItem(PREVIEW_COLLAPSED_KEY, previewCollapsed);
    }
    function startResize(e) {
        isResizing = true;
        resizeRect = $('mdMain') ? $('mdMain').getBoundingClientRect() : document.querySelector('.md-main').getBoundingClientRect();
        document.body.classList.add('resizing');
        $('mdResizer').classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    }
    function stopResize() {
        if (!isResizing) return;
        isResizing = false; resizeRect = null;
        document.body.classList.remove('resizing');
        $('mdResizer').classList.remove('dragging');
        document.body.style.cursor = ''; document.body.style.userSelect = '';
    }
    function onResizeMove(e) {
        if (!isResizing || !resizeRect) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        let ratio = (clientX - resizeRect.left) / resizeRect.width;
        ratio = Math.max(0.15, Math.min(0.85, ratio));
        editorRatio = ratio;
        localStorage.setItem(RATIO_KEY, editorRatio);
        applySplit();
    }

    /* ---------------- 预览 / 源码模式 ---------------- */
    function setPreviewMode(mode) {
        previewMode = mode;
        localStorage.setItem(PREVIEW_MODE_KEY, previewMode);
        document.querySelectorAll('.md-switch-btn').forEach(b => b.classList.toggle('active', b.dataset.mdMode === mode));
        if (mode === 'preview') {
            editor.value = previewSource.value;
            preview.style.display = '';
            previewSource.style.display = 'none';
            previewSource.hidden = true;
            mdRender(); updateCount(); autoSave();
        } else {
            previewSource.value = editor.value;
            preview.style.display = 'none';
            previewSource.hidden = false;
            previewSource.style.display = 'block';
            previewSource.focus();
        }
    }

    /* ---------------- 布局模式 ---------------- */
    function setLayoutMode(mode) {
        if (mode === 'edit') { editorCollapsed = false; previewCollapsed = true; }
        else if (mode === 'preview') { editorCollapsed = true; previewCollapsed = false; if (previewMode !== 'preview') setPreviewMode('preview'); }
        else { editorCollapsed = false; previewCollapsed = false; }
        applyPaneStates();
        localStorage.setItem(LAYOUT_MODE_KEY, mode);
    }

    /* ---------------- 历史记录 ---------------- */
    function recordHistory() {
        const text = editor.value;
        if (text === lastHistoryText) return;
        historyStack = historyStack.slice(0, historyIndex + 1);
        historyStack.push(text);
        if (historyStack.length > MAX_HISTORY) historyStack.shift();
        historyIndex = historyStack.length - 1;
        lastHistoryText = text;
    }
    function undo() {
        if (historyIndex <= 0) return;
        historyIndex--;
        editor.value = historyStack[historyIndex];
        lastHistoryText = editor.value;
        if (previewMode === 'source') previewSource.value = editor.value;
        mdRender(); updateCount(); autoSave(); getActiveEditor().focus();
    }
    function redo() {
        if (historyIndex >= historyStack.length - 1) return;
        historyIndex++;
        editor.value = historyStack[historyIndex];
        lastHistoryText = editor.value;
        if (previewMode === 'source') previewSource.value = editor.value;
        mdRender(); updateCount(); autoSave(); getActiveEditor().focus();
    }

    /* ---------------- 模态框 / 下拉 ---------------- */
    function showModal(id) { const el = $(id); if (el) { el.classList.add('show'); } }
    function closeModal(id) { const el = $(id); if (el) el.classList.remove('show'); }
    function closeDropdown(id) {
        const el = $(id);
        if (el) { const menu = el.querySelector('.md-dropdown-menu'); if (menu) menu.classList.remove('show'); }
    }
    function toggleDropdown(id) {
        const el = $(id);
        if (!el) return;
        const menu = el.querySelector('.md-dropdown-menu');
        if (menu) menu.classList.toggle('show');
    }

    /* ---------------- 初始化 ---------------- */
    function init() {
        const saved = localStorage.getItem(STORAGE_KEY);
        editor.value = (saved !== null) ? saved : WELCOME_DOC;
        filenameInput.value = localStorage.getItem(FILENAME_KEY) || '未命名文档.md';

        const savedRatio = localStorage.getItem(RATIO_KEY);
        if (savedRatio !== null) { const p = parseFloat(savedRatio); if (!isNaN(p)) editorRatio = p; }
        editorCollapsed = localStorage.getItem(EDITOR_COLLAPSED_KEY) === 'true';
        previewCollapsed = localStorage.getItem(PREVIEW_COLLAPSED_KEY) === 'true';
        const spm = localStorage.getItem(PREVIEW_MODE_KEY);
        if (spm === 'preview' || spm === 'source') previewMode = spm;

        mdRender();
        updateCount();
        applyPaneStates();
        setPreviewMode(previewMode);

        historyStack = [editor.value];
        historyIndex = 0;
        lastHistoryText = editor.value;

        const savedLayout = localStorage.getItem(LAYOUT_MODE_KEY);
        if (savedLayout === 'edit' || savedLayout === 'preview' || savedLayout === 'both') setLayoutMode(savedLayout);
        else setLayoutMode('both');

        bindEvents();
    }

    /* ---------------- 事件绑定 ---------------- */
    function bindEvents() {
        // 输入
        editor.addEventListener('input', () => {
            clearTimeout(historyTimer);
            historyTimer = setTimeout(recordHistory, 400);
            mdRender(); updateCount(); autoSave();
        });
        previewSource.addEventListener('input', () => {
            editor.value = previewSource.value;
            clearTimeout(historyTimer);
            historyTimer = setTimeout(recordHistory, 400);
            updateCount(); autoSave();
        });
        filenameInput.addEventListener('input', autoSave);

        // 顶栏
        $('mdSaveBtn').addEventListener('click', saveToLocal);
        $('mdImportFile').addEventListener('change', (e) => importFile(e.target));
        $('mdClearBtn').addEventListener('click', () => {
            if (confirm('确定清空当前文档？')) {
                editor.value = '';
                if (previewMode === 'source') previewSource.value = '';
                mdRender(); updateCount(); saveToLocal();
            }
        });
        $('mdHelpBtn').addEventListener('click', () => showModal('mdHelpModal'));

        // 导出下拉
        $('mdExportBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleDropdown('mdExportDropdown'); });
        document.querySelectorAll('[data-md-export]').forEach(item => {
            item.addEventListener('click', () => {
                const type = item.dataset.mdExport;
                closeDropdown('mdExportDropdown');
                if (type === 'md') exportMD();
                else if (type === 'word') exportWord();
                else if (type === 'html') exportHTML();
                else if (type === 'pdf') exportPDF();
                else if (type === 'png') openExportImageModal();
            });
        });

        // 格式工具栏
        document.querySelectorAll('[data-md-act]').forEach(btn => {
            btn.addEventListener('click', () => {
                const act = btn.dataset.mdAct;
                switch (act) {
                    case 'undo': undo(); break;
                    case 'redo': redo(); break;
                    case 'bold': wrapSelection('**', '**'); break;
                    case 'italic': wrapSelection('*', '*'); break;
                    case 'underline': wrapSelection('<u>', '</u>'); break;
                    case 'strike': wrapSelection('~~', '~~'); break;
                    case 'sub': wrapSelection('<sub>', '</sub>'); break;
                    case 'sup': wrapSelection('<sup>', '</sup>'); break;
                    case 'quote': formatQuote(); break;
                    case 'ulist': prefixLines('- '); break;
                    case 'olist': prefixLines('1. '); break;
                    case 'task': prefixLines('- [ ] '); break;
                    case 'icode': wrapSelection('`', '`'); break;
                    case 'code': insertCodeBlock(); break;
                    case 'link': insertLink(); break;
                    case 'image': openImageModal(); break;
                    case 'find': openFindModal(); break;
                    case 'mermaid': openMermaidModal(); break;
                }
            });
        });

        // 标题下拉
        document.querySelector('[data-md-heading-toggle]').addEventListener('click', (e) => { e.stopPropagation(); toggleDropdown('mdHeadingDropdown'); });
        document.querySelectorAll('[data-md-heading]').forEach(item => {
            item.addEventListener('click', () => { insertHeading(parseInt(item.dataset.mdHeading)); closeDropdown('mdHeadingDropdown'); });
        });

        // 视图下拉
        document.querySelector('[data-md-view-toggle]').addEventListener('click', (e) => { e.stopPropagation(); toggleDropdown('mdViewDropdown'); });
        document.querySelectorAll('[data-md-view]').forEach(item => {
            item.addEventListener('click', () => { setLayoutMode(item.dataset.mdView); closeDropdown('mdViewDropdown'); });
        });

        // 表格下拉
        document.querySelector('[data-md-table-toggle]').addEventListener('click', (e) => { e.stopPropagation(); initTableGrid(); highlightTableCells(0, 0); toggleDropdown('mdTableDropdown'); });

        // 折叠
        $('mdEditorCollapse').addEventListener('click', () => togglePane('editor'));
        $('mdPreviewCollapse').addEventListener('click', () => togglePane('preview'));

        // 预览/源码切换
        document.querySelectorAll('.md-switch-btn').forEach(b => b.addEventListener('click', () => setPreviewMode(b.dataset.mdMode)));

        // 分栏拖拽
        const resizer = $('mdResizer');
        resizer.addEventListener('mousedown', startResize);
        resizer.addEventListener('touchstart', startResize, { passive: false });
        window.addEventListener('mousemove', onResizeMove);
        window.addEventListener('touchmove', onResizeMove, { passive: false });
        window.addEventListener('mouseup', stopResize);
        window.addEventListener('touchend', stopResize);

        // 同步滚动
        let isSyncing = false;
        function syncScroll(source, target) {
            if (isSyncing) return;
            const sh = source.scrollHeight - source.clientHeight;
            const th = target.scrollHeight - target.clientHeight;
            if (sh <= 0 || th <= 0) return;
            isSyncing = true;
            target.scrollTop = (source.scrollTop / sh) * th;
            isSyncing = false;
        }
        editor.addEventListener('scroll', () => syncScroll(editor, preview));
        preview.addEventListener('scroll', () => syncScroll(preview, editor));

        // 图片模态框
        document.querySelectorAll('.md-img-tab').forEach(t => t.addEventListener('click', () => switchImageTab(t.dataset.mdImgtab)));
        $('mdImageFile').addEventListener('change', (e) => handleImageFileSelect(e.target));
        $('mdImageConfirm').addEventListener('click', confirmImageInsert);

        // Mermaid 模态框
        $('mdMermaidType').addEventListener('change', updateMermaidTemplate);
        $('mdMermaidConfirm').addEventListener('click', confirmMermaidInsert);

        // 查找替换
        $('mdFindNext').addEventListener('click', findNext);
        $('mdReplaceOne').addEventListener('click', replaceOne);
        $('mdReplaceAll').addEventListener('click', replaceAll);

        // 导出图片
        document.querySelectorAll('.md-ratio-btn').forEach(b => b.addEventListener('click', () => selectImageRatio(b.dataset.mdRatio)));
        $('mdImageCropFit').addEventListener('change', renderExportImagePreview);
        $('mdRefreshImagePreview').addEventListener('click', renderExportImagePreview);
        $('mdDownloadImage').addEventListener('click', downloadExportImage);

        // 关闭按钮 / 遮罩点击
        document.querySelectorAll('[data-md-close]').forEach(b => b.addEventListener('click', () => closeModal(b.dataset.mdClose)));
        document.querySelectorAll('.md-modal-overlay').forEach(ov => {
            ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.remove('show'); });
        });

        // 点击外部关闭下拉
        document.addEventListener('click', (e) => {
            ['mdExportDropdown', 'mdHeadingDropdown', 'mdViewDropdown', 'mdTableDropdown'].forEach(id => {
                const el = $(id);
                if (el && !el.contains(e.target)) closeDropdown(id);
            });
        });

        // 拖放
        document.addEventListener('dragenter', (e) => { e.preventDefault(); dragCounter++; showDropOverlay(); });
        document.addEventListener('dragleave', (e) => { e.preventDefault(); dragCounter--; if (dragCounter <= 0) { dragCounter = 0; hideDropOverlay(); } });
        document.addEventListener('dragover', (e) => e.preventDefault());
        document.addEventListener('drop', (e) => {
            e.preventDefault(); dragCounter = 0; hideDropOverlay();
            const files = e.dataTransfer.files;
            if (!files.length) return;
            const file = files[0];
            const ext = file.name.split('.').pop().toLowerCase();
            if (['md', 'markdown', 'txt'].includes(ext)) { loadFile(file); return; }
            if (file.type.startsWith('image/')) {
                if (file.size > 5 * 1024 * 1024) { mdShowToast('图片过大（>5MB）'); return; }
                const reader = new FileReader();
                reader.onload = (ev) => { insertImageMarkdown(file.name, ev.target.result); mdShowToast('已插入图片'); };
                reader.readAsDataURL(file);
                return;
            }
            mdShowToast('不支持的文件类型');
        });

        // 快捷键
        function handleKeydown(e) {
            if (e.ctrlKey || e.metaKey) {
                const k = e.key.toLowerCase();
                if (k === 's') { e.preventDefault(); saveToLocal(); }
                else if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
                else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
                else if (k === 'b') { e.preventDefault(); wrapSelection('**', '**'); }
                else if (k === 'u') { e.preventDefault(); wrapSelection('<u>', '</u>'); }
                else if (k === 'i' && !e.shiftKey) { e.preventDefault(); wrapSelection('*', '*'); }
                else if (k === 'k' && !e.shiftKey) { e.preventDefault(); insertLink(); }
                else if (k === 'k' && e.shiftKey) { e.preventDefault(); openImageModal(); }
                else if (k === 'f') { e.preventDefault(); openFindModal(); }
            }
            if (e.key === 'Tab') {
                e.preventDefault();
                const el = getActiveEditor();
                const start = el.selectionStart, end = el.selectionEnd;
                el.setRangeText('    ', start, end, 'end');
                afterEdit();
            }
        }
        editor.addEventListener('keydown', handleKeydown);
        previewSource.addEventListener('keydown', handleKeydown);

        // tab 切换时重新渲染（可见后才正确计算布局 / 渲染 mermaid）
        window.addEventListener('devtool:tabchange', (e) => {
            if (e.detail && e.detail.tab === 'markdown') {
                mdRender();
                applySplit();
            }
        });

        // 跟随全局主题切换 mermaid
        const themeObserver = new MutationObserver(() => {
            initMermaid();
            if (document.querySelector('.tab-panel[data-panel="markdown"]').classList.contains('active')) mdRender();
        });
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
