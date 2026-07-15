/* ═══════════════════════════════════════════
   赵云与阿斗 - 对战塔防游戏
   上下两个 8×5 战场，玩家 / AI，比谁坚持更久
   ═══════════════════════════════════════════ */

(function () {
    'use strict';

    // ─────────── 常量 ───────────
    const COLS = 8;
    const ROWS = 5;

    const TILE = { LOCKED: 0, CLEARED: 1, PATH: 2, ODOU: 3, ENTRY: 4 };

    const DEFENDERS = {
        枪: { name: '枪', range: 3.0, damage: 2, atkInterval: 1.25, hp: 5, atkType: 'pierce' },
        刀: { name: '刀', range: 1.0, damage: 3, atkInterval: 1.25, hp: 3, atkType: 'single' },
        骑: { name: '骑', range: 1.5, damage: 2, atkInterval: 1.25, hp: 4, atkType: 'aoe' },
        弓: { name: '弓', range: 3.0, damage: 2, atkInterval: 1.25, hp: 3, atkType: 'single' }
    };

    const ENEMIES = {
        兵: { name: '兵', hp: 3, speed: 0.55, damage: 1, reward: 1 },
        卒: { name: '卒', hp: 5, speed: 0.45, damage: 1, reward: 2 },
        将: { name: '将', hp: 10, speed: 0.35, damage: 2, reward: 5 }
    };

    const CARD_TYPES = Object.keys(DEFENDERS);

    // 玩家路径（8列×5行），入口在 [0,7] 右上角，阿斗在 [4,7] 右下角
    // S 形：下→左→下→右
    const LEFT_PATH = [
        [0, 7], [1, 7], [2, 7],
        [2, 6], [2, 5], [2, 4], [2, 3], [2, 2], [2, 1], [2, 0],
        [3, 0], [4, 0],
        [4, 1], [4, 2], [4, 3], [4, 4], [4, 5], [4, 6], [4, 7]
    ];

    // AI 路径（镜像），入口在 (0,0) 左上角，阿斗在 (5,0) 左下角
    const RIGHT_PATH = LEFT_PATH.map(([r, c]) => [r, 7 - c]);

    // ─────────── 战场类 ───────────
    class Battlefield {
        constructor(side, colOffset, path) {
            this.side = side; // 'left' | 'right'
            this.colOffset = colOffset; // 0 or 6
            this.path = path;
            this.grid = [];
            this.defenders = [];
            this.enemies = [];
            this.projectiles = [];
            this.effects = [];
            this.cards = [];
            this.odouHP = 3;
            this.grain = 20;
            this.recruitCost = 10;
            this.gridEl = null;
            this.enemyLayer = null;
            this.effectLayer = null;
            this.odouEl = null;
            this.cardSlotsEl = null;
            this.isAI = side === 'right';
        }

        buildGrid() {
            this.grid = [];
            for (let r = 0; r < ROWS; r++) {
                const row = [];
                for (let c = 0; c < COLS; c++) row.push(TILE.LOCKED);
                this.grid.push(row);
            }
            // 标记路径
            for (const [r, c] of this.path) {
                const lc = c - this.colOffset;
                this.grid[r][lc] = TILE.PATH;
            }
            // 入口
            const [er, ec] = this.path[0];
            this.grid[er][ec - this.colOffset] = TILE.ENTRY;
            // 阿斗
            const [or, oc] = this.path[this.path.length - 1];
            this.grid[or][oc - this.colOffset] = TILE.ODOU;
            // 初始已开辟区域：仅 6 个空白格（8×5 网格，避开路径）
            const cleared = [[1, 3], [1, 4], [1, 5],
                             [3, 3], [3, 4], [3, 5]];
            for (const [r, c] of cleared) {
                if (this.grid[r][c] === TILE.LOCKED) this.grid[r][c] = TILE.CLEARED;
            }
        }

        render(container) {
            container.innerHTML = '';
            const board = document.createElement('div');
            board.className = `zyad-board zyad-board-${this.side}`;
            // 网格
            const grid = document.createElement('div');
            grid.className = 'zyad-grid';
            grid.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
            for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c < COLS; c++) {
                    const cell = document.createElement('div');
                    cell.className = 'zyad-cell';
                    cell.dataset.r = r;
                    cell.dataset.c = c;
                    cell.dataset.side = this.side;
                    const st = this.grid[r][c];
                    if (st === TILE.PATH) cell.classList.add('path');
                    else if (st === TILE.LOCKED) cell.classList.add('locked');
                    else if (st === TILE.CLEARED) cell.classList.add('cleared');
                    else if (st === TILE.ENTRY) { cell.classList.add('entry'); cell.textContent = '入'; }
                    else if (st === TILE.ODOU) { cell.classList.add('path'); cell.textContent = '斗'; }
                    grid.appendChild(cell);
                }
            }
            board.appendChild(grid);
            // 敌人层
            const el = document.createElement('div');
            el.className = 'zyad-enemy-layer';
            board.appendChild(el);
            this.enemyLayer = el;
            // 特效层
            const fl = document.createElement('div');
            fl.className = 'zyad-effect-layer';
            board.appendChild(fl);
            this.effectLayer = fl;
            // 射程圈层
            const rl = document.createElement('div');
            rl.className = 'zyad-range-layer';
            board.appendChild(rl);
            this.rangeLayer = rl;
            // 选中信息提示
            const tip = document.createElement('div');
            tip.className = 'zyad-info-tip hidden';
            board.appendChild(tip);
            this.infoTip = tip;
            this.boardEl = board;
            container.appendChild(board);
            this.gridEl = grid;

            if (this.isAI) {
                // AI 状态显示
                const aiBar = document.createElement('div');
                aiBar.className = 'zyad-ai-bar';
                aiBar.innerHTML = '<span class="zyad-ai-label">🤖 对手</span> 馒头 <b class="zyad-ai-grain">20</b> | 斗 <b class="zyad-ai-odou">3</b>♥';
                container.appendChild(aiBar);
                this.aiBar = aiBar;
            }
        }

        refillCards() {
            while (this.cards.length < 5) {
                this.cards.push({ type: this.rollCard(), used: false });
            }
        }

        rollCard() {
            if (Math.random() < 0.05) return 'shovel';
            return CARD_TYPES[Math.floor(Math.random() * CARD_TYPES.length)];
        }

        renderCards() {
            const slotsEl = document.getElementById('zyadCardSlots');
            if (!slotsEl || this.isAI) return;
            slotsEl.innerHTML = '';
            this.cards.forEach((card, idx) => {
                const slot = document.createElement('div');
                slot.className = 'zyad-card-slot';
                if (card.type === 'shovel') {
                    slot.classList.add('shovel');
                    slot.textContent = '铲';
                } else {
                    slot.textContent = card.type;
                }
                if (card.used) slot.classList.add('used');
                if (game.selectedCard && game.selectedCard.idx === idx && game.selectedCard.bf === this) {
                    slot.classList.add('selected');
                }
                slot.addEventListener('click', () => {
                    if (card.used) return;
                    // 切换选中
                    if (game.selectedCard && game.selectedCard.idx === idx) {
                        game.selectedCard = null;
                    } else {
                        game.selectedCard = { ...card, idx, bf: this };
                        game.selectedDefender = null; // 取消守卫选中
                    }
                    this.renderCards();
                });
                slotsEl.appendChild(slot);
            });
        }

        recruit() {
            if (this.grain < this.recruitCost) return false;
            this.grain -= this.recruitCost;
            this.recruitCost += 2; // 每次递增 2
            // 每次随机征兵 5 个，替换整手手牌
            this.cards = [];
            for (let i = 0; i < 5; i++) {
                this.cards.push({ type: this.rollCard(), used: false });
            }
            return true;
        }

        useCard(idx) {
            this.cards[idx].used = true;
            if (!this.isAI) this.renderCards();
        }

        placeDefender(r, c, type, level = 1) {
            const cfg = DEFENDERS[type];
            const d = { r, c, type, level, hp: cfg.hp, maxHp: cfg.hp, atkTimer: 0, el: null, levelEl: null };
            const cell = this.gridEl.querySelector(`[data-r="${r}"][data-c="${c}"]`);
            if (cell) {
                cell.classList.add('has-defender');
                const defEl = document.createElement('div');
                defEl.className = 'zyad-defender';
                defEl.textContent = cfg.name;
                defEl.dataset.type = type;
                defEl.dataset.level = level;
                const lvl = document.createElement('div');
                lvl.className = 'zyad-defender-level';
                lvl.textContent = 'Lv' + level;
                const hp = document.createElement('div');
                hp.className = 'zyad-defender-hp';
                const fill = document.createElement('div');
                fill.className = 'zyad-defender-hp-fill';
                fill.style.width = '100%';
                hp.appendChild(fill);
                defEl.appendChild(lvl);
                defEl.appendChild(hp);
                cell.appendChild(defEl);
                d.el = defEl;
                d.levelEl = lvl;
            }
            this.defenders.push(d);
        }

        // 升级到下一等级（×1.5 攻/速/血，回满血）
        levelUpDefender(d) {
            if (d.level >= 5) return false;
            d.level++;
            const cfg = DEFENDERS[d.type];
            d.maxHp = Math.round(cfg.hp * Math.pow(1.5, d.level - 1));
            d.hp = d.maxHp; // 升级回满血
            if (d.levelEl) {
                d.levelEl.textContent = 'Lv' + d.level;
                d.levelEl.className = 'zyad-defender-level' + (d.level >= 3 ? ' lv' + d.level : '');
            }
            this.updateDefenderHP(d);
            return true;
        }

        // 合并升级：两个同类型同级 → 下一级
        mergeDefenders(d1, d2) {
            if (d1.type !== d2.type || d1.level !== d2.level || d1.level >= 5) return false;
            this.levelUpDefender(d1);
            this.removeDefender(d2);
            return true;
        }

        // 根据等级计算有效伤害和攻速
        getEffectiveStats(d) {
            const cfg = DEFENDERS[d.type];
            const mult = Math.pow(1.5, d.level - 1);
            return {
                damage: cfg.damage * mult,
                atkInterval: cfg.atkInterval / mult,
                range: cfg.range,
                atkType: cfg.atkType
            };
        }

        // 选中守护者：绘制射程圆圈
        showDefenderRange(d) {
            if (!this.rangeLayer) return;
            this.rangeLayer.innerHTML = '';
            const cell = this.gridEl.querySelector(`[data-r="${d.r}"][data-c="${d.c}"]`);
            if (!cell) return;
            const stats = this.getEffectiveStats(d);
            const cellRect = cell.getBoundingClientRect();
            const layerRect = this.rangeLayer.getBoundingClientRect();
            const cx = cellRect.left + cellRect.width / 2 - layerRect.left;
            const cy = cellRect.top + cellRect.height / 2 - layerRect.top;
            const pitch = cellRect.width + 2; // 含格间隙
            // 射程按「可覆盖的格数」理解：守护者自身占 0.5 格，故补 0.5 使圆圈到达第 N 格边缘
            const radius = (stats.range + 0.5) * pitch;
            const circle = document.createElement('div');
            circle.className = 'zyad-range-circle';
            circle.style.width = (radius * 2) + 'px';
            circle.style.height = (radius * 2) + 'px';
            circle.style.left = (cx - radius) + 'px';
            circle.style.top = (cy - radius) + 'px';
            this.rangeLayer.appendChild(circle);
        }

        // 选中守护者：展示基本信息
        showDefenderInfo(d) {
            if (!this.infoTip || !this.boardEl) return;
            const stats = this.getEffectiveStats(d);
            const freq = (1 / stats.atkInterval).toFixed(2);
            this.infoTip.innerHTML =
                `<div class="zyad-info-name">${DEFENDERS[d.type].name} · Lv${d.level}</div>` +
                `<div class="zyad-info-row">攻击力 <b>${stats.damage.toFixed(1)}</b></div>` +
                `<div class="zyad-info-row">范围 <b>${stats.range}</b> 格</div>` +
                `<div class="zyad-info-row">频率 <b>${freq}</b> 次/秒</div>`;
            const cell = this.gridEl.querySelector(`[data-r="${d.r}"][data-c="${d.c}"]`);
            if (cell) {
                const cellRect = cell.getBoundingClientRect();
                const boardRect = this.boardEl.getBoundingClientRect();
                this.infoTip.style.left = (cellRect.left + cellRect.width / 2 - boardRect.left) + 'px';
                this.infoTip.style.top = (cellRect.top - boardRect.top) + 'px';
            }
            this.infoTip.classList.remove('hidden');
        }

        // 清除选中可视（射程圈 + 信息）
        clearDefenderSelectionVisuals() {
            if (this.rangeLayer) this.rangeLayer.innerHTML = '';
            if (this.infoTip) this.infoTip.classList.add('hidden');
        }

        spawnEnemy(type) {
            const cfg = ENEMIES[type];
            const [sr, sc] = this.path[0];
            const e = {
                type, cfg, stepIdx: 0,
                x: sc - this.colOffset,
                y: sr,
                hp: cfg.hp, maxHp: cfg.hp,
                speed: cfg.speed, atkCooldown: 0,
                el: null, elHp: null
            };
            const el = document.createElement('div');
            el.className = `zyad-enemy hp-${Math.min(4, cfg.hp)}`;
            el.textContent = cfg.name;
            const hpBar = document.createElement('div');
            hpBar.className = 'zyad-enemy-hp';
            const fill = document.createElement('div');
            fill.className = 'zyad-enemy-hp-fill';
            fill.style.width = '100%';
            hpBar.appendChild(fill);
            el.appendChild(hpBar);
            this.enemyLayer.appendChild(el);
            e.el = el;
            e.elHp = fill;
            this.enemies.push(e);
        }

        updateEnemy(e, dt) {
            if (e.stepIdx >= this.path.length) return;
            const [tr, tc] = this.path[e.stepIdx];
            const tx = tc - this.colOffset;
            const dx = tx - e.x;
            const dy = tr - e.y;
            const dist = Math.hypot(dx, dy);
            const move = e.speed * dt;
            if (dist <= move) {
                e.x = tx; e.y = tr;
                e.stepIdx++;
                if (e.stepIdx >= this.path.length) {
                    // 到达阿斗
                    this.odouHP -= e.cfg.damage;
                    this.updateOdou();
                    this.removeEnemy(e);
                    this.showFloat(e.x, e.y, '阿斗-' + e.cfg.damage, 'crit');
                    return;
                }
            } else {
                e.x += (dx / dist) * move;
                e.y += (dy / dist) * move;
            }
            // 攻击附近防守者
            e.atkCooldown -= dt;
            if (e.atkCooldown <= 0) {
                const target = this.findDefenderInRange(e.x, e.y, 0.7);
                if (target) {
                    target.hp -= e.cfg.damage;
                    this.updateDefenderHP(target);
                    if (target.hp <= 0) this.removeDefender(target);
                    e.atkCooldown = 0.6;
                }
            }
        }

        removeEnemy(e) {
            if (e.el) e.el.remove();
            const i = this.enemies.indexOf(e);
            if (i >= 0) this.enemies.splice(i, 1);
        }

        updateDefender(d, dt) {
            d.atkTimer -= dt;
            if (d.atkTimer <= 0) {
                const stats = this.getEffectiveStats(d);
                const target = this.findEnemyInRange(d.r, d.c, stats.range);
                if (target) {
                    const isRanged = stats.range >= 2;
                    if (stats.atkType === 'aoe') {
                        // 范围：攻击射程内所有敌人
                        const targets = this.findAllEnemiesInRange(d.r, d.c, stats.range);
                        for (const t of targets) {
                            if (isRanged) {
                                this.spawnProjectile(d.r, d.c, t, stats.damage);
                            } else {
                                t.hp -= stats.damage;
                                this.updateEnemyHP(t);
                                this.showFloat(t.x, t.y, '-' + Math.round(stats.damage), 'crit');
                                if (t.hp <= 0) {
                                    this.grain += 1;
                                    this.removeEnemy(t);
                                }
                            }
                        }
                    } else if (stats.atkType === 'pierce') {
                        // 贯穿：攻击路径上所有敌人
                        const targets = this.findEnemiesInLine(d.r, d.c, target, stats.range);
                        for (const t of targets) {
                            if (isRanged) {
                                this.spawnProjectile(d.r, d.c, t, stats.damage);
                            } else {
                                t.hp -= stats.damage;
                                this.updateEnemyHP(t);
                                this.showFloat(t.x, t.y, '-' + Math.round(stats.damage), 'crit');
                                if (t.hp <= 0) {
                                    this.grain += 1;
                                    this.removeEnemy(t);
                                }
                            }
                        }
                    } else {
                        // 单体
                        if (isRanged) {
                            this.spawnProjectile(d.r, d.c, target, stats.damage);
                        } else {
                            target.hp -= stats.damage;
                            this.updateEnemyHP(target);
                            this.showFloat(target.x, target.y, '-' + Math.round(stats.damage), 'crit');
                            if (target.hp <= 0) {
                                this.grain += 1;
                                this.removeEnemy(target);
                            }
                        }
                    }
                    d.atkTimer = stats.atkInterval;
                } else {
                    d.atkTimer = 0.1;
                }
            }
        }

        findAllEnemiesInRange(r, c, range) {
            const result = [];
            for (const e of this.enemies) {
                if (Math.hypot(e.x - c, e.y - r) <= range) result.push(e);
            }
            return result;
        }

        findEnemiesInLine(r, c, firstTarget, range) {
            // 从防守者到首个目标方向上的所有敌人
            const dx = firstTarget.x - c;
            const dy = firstTarget.y - r;
            const dist = Math.hypot(dx, dy);
            if (dist < 0.01) return [firstTarget];
            const nx = dx / dist, ny = dy / dist;
            const result = [];
            for (const e of this.enemies) {
                const ex = e.x - c, ey = e.y - r;
                const proj = ex * nx + ey * ny; // 投影距离
                if (proj < 0 || proj > range) continue;
                const perp = Math.abs(ex * ny - ey * nx); // 垂直距离
                if (perp < 0.6) result.push(e);
            }
            return result;
        }

        findDefenderInRange(ex, ey, range) {
            for (const d of this.defenders) {
                if (Math.hypot(d.c - ex, d.r - ey) <= range) return d;
            }
            return null;
        }

        findEnemyInRange(r, c, range) {
            let best = null, bestProg = -1;
            for (const e of this.enemies) {
                if (Math.hypot(e.x - c, e.y - r) <= range && e.stepIdx > bestProg) {
                    best = e; bestProg = e.stepIdx;
                }
            }
            return best;
        }

        spawnProjectile(r, c, target, damage) {
            const el = document.createElement('div');
            el.className = 'zyad-projectile';
            this.effectLayer.appendChild(el);
            this.projectiles.push({ x: c, y: r, target, damage, el, speed: 8 });
        }

        updateProjectile(p, dt) {
            const dx = p.target.x - p.x;
            const dy = p.target.y - p.y;
            const dist = Math.hypot(dx, dy);
            if (dist < 0.3 || !this.enemies.includes(p.target)) {
                if (this.enemies.includes(p.target)) {
                    p.target.hp -= p.damage;
                    this.updateEnemyHP(p.target);
                    this.showFloat(p.target.x, p.target.y, '-' + p.damage, 'crit');
                    if (p.target.hp <= 0) {
                        this.grain += 1;
                        this.removeEnemy(p.target);
                    }
                }
                p.el.remove();
                const i = this.projectiles.indexOf(p);
                if (i >= 0) this.projectiles.splice(i, 1);
                return;
            }
            const move = p.speed * dt;
            p.x += (dx / dist) * move;
            p.y += (dy / dist) * move;
        }

        showFloat(x, y, text, cls) {
            const el = document.createElement('div');
            el.className = 'zyad-float ' + (cls || '');
            el.textContent = text;
            this.effectLayer.appendChild(el);
            this.effects.push({ el, x, y, t: 0 });
        }

        updateEffects(dt) {
            for (let i = this.effects.length - 1; i >= 0; i--) {
                this.effects[i].t += dt;
                if (this.effects[i].t > 0.8) {
                    this.effects[i].el.remove();
                    this.effects.splice(i, 1);
                }
            }
        }

        syncDOM() {
            if (!this.enemyLayer) return;
            const w = this.enemyLayer.clientWidth;
            const h = this.enemyLayer.clientHeight;
            const tw = w / COLS;
            const th = h / ROWS;
            for (const e of this.enemies) {
                e.el.style.left = (e.x * tw + tw / 2) + 'px';
                e.el.style.top = (e.y * th + th / 2) + 'px';
            }
            for (const p of this.projectiles) {
                p.el.style.left = (p.x * tw + tw / 2) + 'px';
                p.el.style.top = (p.y * th + th / 2) + 'px';
            }
            for (const ef of this.effects) {
                ef.el.style.left = (ef.x * tw + tw / 2) + 'px';
                ef.el.style.top = (ef.y * th + th / 2) + 'px';
            }
        }

        updateDefenderHP(d) {
            const f = d.el?.querySelector('.zyad-defender-hp-fill');
            if (f) f.style.width = Math.max(0, (d.hp / d.maxHp) * 100) + '%';
        }

        updateEnemyHP(e) {
            e.elHp.style.width = Math.max(0, (e.hp / e.maxHp) * 100) + '%';
        }

        removeDefender(d) {
            if (d.el) d.el.remove();
            const cell = this.gridEl?.querySelector(`[data-r="${d.r}"][data-c="${d.c}"]`);
            if (cell) cell.classList.remove('has-defender');
            const i = this.defenders.indexOf(d);
            if (i >= 0) this.defenders.splice(i, 1);
        }

        updateOdou() {
            if (this.isAI && this.aiBar) {
                this.aiBar.querySelector('.zyad-ai-odou').textContent = Math.max(0, this.odouHP);
            }
        }

        updateAIBar() {
            if (this.aiBar) {
                this.aiBar.querySelector('.zyad-ai-grain').textContent = Math.floor(this.grain);
            }
        }

        getDefenderAt(r, c) {
            return this.defenders.find(d => d.r === r && d.c === c);
        }

        // AI 行动
        aiAct() {
            // 攒够粮就征兵
            if (this.grain >= this.recruitCost && this.cards.filter(c => !c.used).length < 3) {
                this.recruit();
            }
            // 用铲子开路
            for (const card of this.cards) {
                if (!card.used && card.type === 'shovel') {
                    const locked = [];
                    for (let r = 0; r < ROWS; r++) {
                        for (let c = 0; c < COLS; c++) {
                            if (this.grid[r][c] === TILE.LOCKED) locked.push([r, c]);
                        }
                    }
                    if (locked.length) {
                        const [r, c] = locked[Math.floor(Math.random() * locked.length)];
                        this.grid[r][c] = TILE.CLEARED;
                        // 更新 DOM
                        const cell = this.gridEl.querySelector(`[data-r="${r}"][data-c="${c}"]`);
                        if (cell) { cell.className = 'zyad-cell cleared'; cell.dataset.r = r; cell.dataset.c = c; }
                        const idx = this.cards.indexOf(card);
                        this.useCard(idx);
                    }
                    break;
                }
            }
            // 放角色
            for (const card of this.cards) {
                if (!card.used && card.type !== 'shovel') {
                    const spots = [];
                    for (let r = 0; r < ROWS; r++) {
                        for (let c = 0; c < COLS; c++) {
                            if (this.grid[r][c] === TILE.CLEARED && !this.getDefenderAt(r, c)) {
                                spots.push([r, c]);
                            }
                        }
                    }
                    if (spots.length) {
                        const [r, c] = spots[Math.floor(Math.random() * spots.length)];
                        this.placeDefender(r, c, card.type);
                        const idx = this.cards.indexOf(card);
                        this.useCard(idx);
                    }
                    break;
                }
            }
            // 补卡
            this.refillCards();
        }
    }

    // ─────────── 全局游戏状态 ───────────
    const game = {
        leftBF: null,
        rightBF: null,
        wave: 1,
        maxWaves: 15,
        waveActive: false,
        waveCooldown: 2,
        spawnPlan: [],
        spawnIndex: 0,
        spawnTimer: 0,
        paused: false,
        running: false,
        lastTime: 0,
        aiTimer: 0,
        selectedCard: null,
        selectedDefender: null,
        result: null
    };

    // ─────────── DOM ───────────
    const $ = (s) => document.querySelector(s);
    const arenaEl = $('#zyadArena');
    const waveNumEl = $('#zyadWaveNum');
    const recruitBtn = $('#zyadRecruit');
    const pauseBtn = $('#zyadPause');
    const resultEl = $('#zyadResult');
    const resultTitle = $('#zyadResultTitle');
    const resultText = $('#zyadResultText');
    const restartBtn = $('#zyadRestart');

    // ─────────── 波次 ───────────
    function buildWavePlan(wave) {
        const count = 4 + Math.floor(wave * 1.8);
        const plan = [];
        for (let i = 0; i < count; i++) {
            const r = Math.random();
            let t;
            if (wave < 3) t = '兵';
            else if (wave < 7) t = r < 0.7 ? '兵' : '卒';
            else t = r < 0.4 ? '兵' : r < 0.85 ? '卒' : '将';
            plan.push(t);
        }
        return plan;
    }

    function startNextWave() {
        if (game.wave > game.maxWaves) return;
        game.spawnPlan = buildWavePlan(game.wave);
        game.spawnIndex = 0;
        game.spawnTimer = 0;
        game.waveActive = true;
        waveNumEl.textContent = game.wave;
    }

    function updateWave(dt) {
        if (game.waveActive) {
            if (game.spawnIndex < game.spawnPlan.length) {
                game.spawnTimer -= dt;
                if (game.spawnTimer <= 0) {
                    const type = game.spawnPlan[game.spawnIndex];
                    game.leftBF.spawnEnemy(type);
                    // 暂停 AI 出兵，仅玩家侧防守
                    game.spawnIndex++;
                    game.spawnTimer = 0.7;
                }
            } else if (game.leftBF.enemies.length === 0) {
                game.waveActive = false;
                game.wave++;
                game.waveCooldown = 3;
                if (game.wave > game.maxWaves) {
                    endGame('win', '成功守住所有波次！');
                }
            }
        } else if (game.waveCooldown > 0) {
            game.waveCooldown -= dt;
            if (game.waveCooldown <= 0) startNextWave();
        }
    }

    // ─────────── 主循环 ───────────
    function loop(t) {
        if (!game.running) return;
        if (!game.paused) {
            const dt = Math.min(0.05, (t - game.lastTime) / 1000 || 0.016);
            game.lastTime = t;

            updateWave(dt);

            for (const e of [...game.leftBF.enemies]) game.leftBF.updateEnemy(e, dt);
            for (const e of [...game.rightBF.enemies]) game.rightBF.updateEnemy(e, dt);
            for (const d of game.leftBF.defenders) game.leftBF.updateDefender(d, dt);
            for (const d of game.rightBF.defenders) game.rightBF.updateDefender(d, dt);
            for (const p of [...game.leftBF.projectiles]) game.leftBF.updateProjectile(p, dt);
            for (const p of [...game.rightBF.projectiles]) game.rightBF.updateProjectile(p, dt);
            game.leftBF.updateEffects(dt);
            game.rightBF.updateEffects(dt);
            game.leftBF.syncDOM();
            game.rightBF.syncDOM();

            // 馒头仅通过击杀获得，无被动恢复
            updateGrainDisplay();

            // AI 行动（每 2 秒）
            game.aiTimer -= dt;
            if (game.aiTimer <= 0) {
                game.rightBF.aiAct();
                game.rightBF.updateAIBar();
                game.aiTimer = 2;
            }

            // 胜负检测
            if (game.leftBF.odouHP <= 0) {
                endGame('lose', '你的阿斗被敌军掳走了…');
            }
        } else {
            game.lastTime = t;
        }
        requestAnimationFrame(loop);
    }

    function updateGrainDisplay() {
        const costEl = $('#zyadRecruitCost');
        if (costEl) costEl.textContent = game.leftBF.recruitCost;
        if (recruitBtn) recruitBtn.disabled = game.leftBF.grain < game.leftBF.recruitCost;
        const grainEl = $('#zyadGrain');
        if (grainEl) grainEl.textContent = Math.floor(game.leftBF.grain);
    }

    function endGame(result, text) {
        game.running = false;
        game.result = result;
        resultEl.classList.remove('hidden');
        resultTitle.textContent = result === 'win' ? '胜利！' : result === 'lose' ? '失败' : '平局';
        resultTitle.style.color = result === 'win' ? '#15803d' : result === 'lose' ? '#b91c1c' : '#d97706';
        resultText.textContent = text;
    }

    // ─────────── 点击交互（玩家操作左半）───────────
    arenaEl.addEventListener('click', (e) => {
        const cell = e.target.closest('.zyad-cell');
        if (!cell || cell.dataset.side !== 'left') return;
        const r = parseInt(cell.dataset.r);
        const c = parseInt(cell.dataset.c);
        const bf = game.leftBF;
        const existingDef = bf.getDefenderAt(r, c);

        // 情况 1：选中了卡牌 → 放置 / 与布局上的同级同型号直接合成
        if (game.selectedCard) {
            const card = game.selectedCard;
            if (card.type === 'shovel') {
                if (bf.grid[r][c] === TILE.LOCKED) {
                    bf.grid[r][c] = TILE.CLEARED;
                    cell.className = 'zyad-cell cleared';
                    cell.dataset.r = r; cell.dataset.c = c; cell.dataset.side = 'left';
                    bf.useCard(card.idx);
                    game.selectedCard = null;
                    bf.renderCards();
                }
            } else {
                // 已放置的同级同型号守护者（Lv1）→ 直接合成升级
                if (existingDef && existingDef.type === card.type && existingDef.level === 1 && existingDef.level < 5) {
                    bf.levelUpDefender(existingDef);
                    bf.showFloat(c, r, 'Lv' + existingDef.level, 'crit');
                    bf.useCard(card.idx);
                    game.selectedCard = null;
                    bf.renderCards();
                } else if (bf.grid[r][c] === TILE.CLEARED && !existingDef) {
                    // 否则放到空白格
                    bf.placeDefender(r, c, card.type);
                    bf.useCard(card.idx);
                    game.selectedCard = null;
                    bf.renderCards();
                }
            }
            return;
        }

        // 情况 2：选中了守卫 → 合并或移动
        if (game.selectedDefender) {
            const sel = game.selectedDefender;
            if (existingDef && existingDef !== sel.defender) {
                // 合并
                if (sel.defender.type === existingDef.type && sel.defender.level === existingDef.level && existingDef.level < 5) {
                    bf.mergeDefenders(existingDef, sel.defender);
                    bf.showFloat(c, r, 'Lv' + existingDef.level, 'crit');
                }
            } else if (!existingDef && bf.grid[r][c] === TILE.CLEARED) {
                // 移动
                sel.defender.r = r;
                sel.defender.c = c;
                const newCell = bf.gridEl.querySelector(`[data-r="${r}"][data-c="${c}"]`);
                const oldCell = bf.gridEl.querySelector(`[data-r="${sel.r}"][data-c="${sel.c}"]`);
                if (oldCell) {
                    oldCell.classList.remove('has-defender');
                    if (sel.defender.el) oldCell.removeChild(sel.defender.el);
                }
                if (newCell) {
                    newCell.classList.add('has-defender');
                    if (sel.defender.el) newCell.appendChild(sel.defender.el);
                }
            }
            // 取消选中
            if (sel.defender.el) sel.defender.el.classList.remove('selected');
            bf.clearDefenderSelectionVisuals();
            game.selectedDefender = null;
            return;
        }

        // 情况 3：没选中任何东西 → 选中守卫
        if (existingDef) {
            game.selectedDefender = { defender: existingDef, r, c };
            if (existingDef.el) existingDef.el.classList.add('selected');
            bf.showDefenderRange(existingDef);
            bf.showDefenderInfo(existingDef);
        }
    });

    // 点击非信息/非棋盘区域时，自动取消守护者选中
    document.addEventListener('click', (e) => {
        if (!game.selectedDefender) return;
        const t = e.target;
        // 点在左/右战场棋盘内（含信息提示）不取消
        if ((game.leftBF.boardEl && game.leftBF.boardEl.contains(t)) ||
            (game.rightBF.boardEl && game.rightBF.boardEl.contains(t))) return;
        const sel = game.selectedDefender;
        if (sel.defender.el) sel.defender.el.classList.remove('selected');
        game.leftBF.clearDefenderSelectionVisuals();
        game.selectedDefender = null;
    }, true);

    // ─────────── 按钮 ───────────
    recruitBtn?.addEventListener('click', () => {
        if (game.leftBF.recruit()) {
            game.selectedCard = null; // 手牌已整体替换
            game.leftBF.renderCards();
            updateGrainDisplay();
        }
    });

    pauseBtn?.addEventListener('click', () => {
        game.paused = !game.paused;
        pauseBtn.textContent = game.paused ? '▶' : '⏸';
    });

    restartBtn?.addEventListener('click', () => initGame());

    // ─────────── 初始化 ───────────
    function initGame() {
        // 创建两个战场
        game.leftBF = new Battlefield('left', 0, LEFT_PATH);
        game.rightBF = new Battlefield('right', 0, RIGHT_PATH);
        game.leftBF.buildGrid();
        game.rightBF.buildGrid();

        // 渲染
        const leftArena = $('#zyadLeftArena');
        const rightArena = $('#zyadRightArena');
        game.leftBF.render(leftArena);
        game.rightBF.render(rightArena);

        // 玩家初始征兵栏为空（每次点击征兵随机出 5 个）
        game.leftBF.renderCards();

        // AI 初始卡牌
        game.rightBF.refillCards();

        // 重置波次
        game.wave = 1;
        game.waveActive = false;
        game.waveCooldown = 2;
        game.paused = false;
        game.result = null;
        game.selectedCard = null;
        game.selectedDefender = null;
        game.aiTimer = 1;
        pauseBtn.textContent = '⏸';
        resultEl.classList.add('hidden');
        updateGrainDisplay();
    }

    // ─────────── 启动 ───────────
    window.zyadGame = {
        start: () => {
            if (game.running) return;
            if (!game.leftBF) initGame();
            game.running = true;
            game.lastTime = performance.now();
            requestAnimationFrame(loop);
        },
        pause: () => { game.paused = true; pauseBtn.textContent = '▶'; },
        isRunning: () => game.running
    };
})();
