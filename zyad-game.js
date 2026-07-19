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
        枪: { name: '枪', range: 2.0, damage: 2, atkInterval: 0.8, hp: 5, atkType: 'pierce' },
        刀: { name: '刀', range: 1.0, damage: 3, atkInterval: 0.8, hp: 3, atkType: 'single' },
        骑: { name: '骑', range: 1.5, damage: 2, atkInterval: 0.8, hp: 4, atkType: 'aoe' },
        弓: { name: '弓', range: 3.0, damage: 2, atkInterval: 0.8, hp: 3, atkType: 'single' }
    };

    const ENEMIES = {
        兵: { name: '兵', speed: 0.55, damage: 1, reward: 1 },
        卒: { name: '卒', speed: 0.45, damage: 1, reward: 2 },
        将: { name: '将', speed: 0.35, damage: 2, reward: 5 }
    };

    const CARD_TYPES = Object.keys(DEFENDERS);

    // 己方地图（5行×8列）：A=道路 B=荒地 C=空地
    const MY_MAP = [
        'ABAAAABA',
        'ABABBABA',
        'ABACCABA',
        'AAACCAAA',
        'BBBCCBBB'
    ];
    // 敌方地图 = 己方中心对称（行反转+列反转；每行回文故仅行反转）
    const FOE_MAP = MY_MAP.slice().reverse().map(r => r.split('').reverse().join(''));

    // 玩家路径：敌营(0,0) → 沿道路A蜿蜒 → 阿斗(0,7)
    const LEFT_PATH = [
        [0,0],[1,0],[2,0],[3,0],[3,1],[3,2],[2,2],[1,2],[0,2],
        [0,3],[0,4],[0,5],[1,5],[2,5],[3,5],[3,6],[3,7],[2,7],[1,7],[0,7]
    ];
    // AI 路径（中心对称）：敌营(4,7) → 阿斗(4,0)
    const RIGHT_PATH = LEFT_PATH.map(([r, c]) => [4 - r, 7 - c]);

    // ─────────── 战场类 ───────────
    class Battlefield {
        constructor(side, colOffset, path, mapData) {
            this.side = side; // 'left' | 'right'
            this.colOffset = colOffset; // 0 or 6
            this.path = path;
            this.mapData = mapData;
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
                for (let c = 0; c < COLS; c++) {
                    const ch = this.mapData[r][c];
                    row.push(ch === 'A' ? TILE.PATH : ch === 'C' ? TILE.CLEARED : TILE.LOCKED);
                }
                this.grid.push(row);
            }
            // 入口（敌营）= path 起点
            const [er, ec] = this.path[0];
            this.grid[er][ec - this.colOffset] = TILE.ENTRY;
            // 阿斗 = path 终点
            const [or, oc] = this.path[this.path.length - 1];
            this.grid[or][oc - this.colOffset] = TILE.ODOU;
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
                    const TILE_IMG = {
                        [TILE.PATH]: 'canvas/daolu.png',
                        [TILE.LOCKED]: 'canvas/huangdi.png',
                        [TILE.CLEARED]: 'canvas/kongdi.png',
                        [TILE.ENTRY]: 'canvas/diying.png',
                        [TILE.ODOU]: 'canvas/adou.png'
                    };
                    cell.style.backgroundImage = `url(${TILE_IMG[st]})`;
                    cell.style.backgroundSize = 'cover';
                    cell.style.backgroundPosition = 'center';
                    if (st === TILE.ENTRY) cell.classList.add('entry');
                    else if (st === TILE.ODOU) cell.classList.add('odou');
                    else if (st === TILE.PATH) cell.classList.add('path');
                    else if (st === TILE.LOCKED) cell.classList.add('locked');
                    else if (st === TILE.CLEARED) cell.classList.add('cleared');
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
                this.cards.push({ type: this.rollCard(), level: 1, used: false });
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
            // 始终渲染 5 个征兵格：有可用卡显示卡面，已用/空则显示空白格
            for (let idx = 0; idx < 5; idx++) {
                const card = this.cards[idx];
                const slot = document.createElement('div');
                slot.className = 'zyad-card-slot';
                if (card && !card.used) {
                    if (card.type === 'shovel') {
                        slot.classList.add('shovel');
                        slot.textContent = '铲';
                    } else if (card.type === '枪') {
                        // 枪兵卡牌：木+仓双图
                        const mu = document.createElement('img');
                        mu.className = 'zyad-gun-mu';
                        mu.src = 'canvas/mu.png';
                        const cang = document.createElement('img');
                        cang.className = 'zyad-gun-cang';
                        cang.src = 'canvas/cang.png';
                        slot.appendChild(mu);
                        slot.appendChild(cang);
                        if (card.level > 1) {
                            const lv = document.createElement('span');
                            lv.className = 'zyad-card-level';
                            lv.textContent = 'Lv' + card.level;
                            slot.appendChild(lv);
                        }
                    } else if (card.type === '骑') {
                        // 骑（旗枪）：卡牌也用旗标替换文字
                        const cv = document.createElement('canvas');
                        cv.width = 160; cv.height = 160;
                        cv.className = 'zyad-qi-card-canvas';
                        slot.appendChild(cv);
                        new QiFlag(cv);
                        if (card.level > 1) {
                            const lv = document.createElement('span');
                            lv.className = 'zyad-card-level';
                            lv.textContent = 'Lv' + card.level;
                            slot.appendChild(lv);
                        }
                    } else {
                        slot.textContent = card.type;
                        if (card.level > 1) {
                            const lv = document.createElement('span');
                            lv.className = 'zyad-card-level';
                            lv.textContent = 'Lv' + card.level;
                            slot.appendChild(lv);
                        }
                    }
                    if (game.selectedCard && game.selectedCard.idx === idx && game.selectedCard.bf === this) {
                        slot.classList.add('selected');
                    }
                    slot.addEventListener('click', () => {
                        if (card.used) return;
                        if (game.selectedCard && game.selectedCard.idx === idx) {
                            // 再次点击同一张 → 取消选中
                            game.selectedCard = null;
                        } else if (game.selectedCard && game.selectedCard.bf === this) {
                            const sel = game.selectedCard;
                            const selCard = this.cards[sel.idx];
                            // 同类同级且未达上限 → 在征兵栏内直接合并升级
                            if (selCard && !selCard.used && selCard.type === card.type &&
                                selCard.level === card.level && card.level < 5) {
                                card.level += 1;               // 目标卡升级
                                this.cards.splice(sel.idx, 1); // 消耗选中的卡
                                game.selectedCard = null;
                            } else {
                                // 否则切换选中到这张卡
                                game.selectedCard = { ...card, idx, bf: this };
                                game.selectedDefender = null;
                            }
                        } else {
                            game.selectedCard = { ...card, idx, bf: this };
                            game.selectedDefender = null;
                        }
                        this.renderCards();
                    });
                }
                // 已用或空：保持空白格（不显示任何内容）
                slotsEl.appendChild(slot);
            }
            // 卡牌渲染后高度变化，触发重新适配
            if (window.fitZyadGame) window.fitZyadGame();
        }

        recruit() {
            if (this.grain < this.recruitCost) return false;
            this.grain -= this.recruitCost;
            this.recruitCost += 2; // 每次递增 2
            // 每次随机征兵 5 个，替换整手手牌
            this.cards = [];
            for (let i = 0; i < 5; i++) {
                this.cards.push({ type: this.rollCard(), level: 1, used: false });
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
                if (type === '枪') {
                    // 枪兵：木+仓双图拼合
                    const mu = document.createElement('img');
                    mu.className = 'zyad-gun-mu';
                    mu.src = 'canvas/mu.png';
                    const cang = document.createElement('img');
                    cang.className = 'zyad-gun-cang';
                    cang.src = 'canvas/cang.png';
                    defEl.appendChild(mu);
                    defEl.appendChild(cang);
                } else if (type === '骑') {
                    // 骑（旗枪）：用 canvas 旗枪动效替换文字
                    const cv = document.createElement('canvas');
                    cv.width = 320; cv.height = 320;
                    cv.className = 'zyad-qi-canvas';
                    defEl.classList.add('zyad-defender-qi');
                    defEl.appendChild(cv);
                    d.qiFlag = new QiFlag(cv);
                } else {
                    defEl.textContent = cfg.name;
                }
                defEl.dataset.type = type;
                defEl.dataset.level = level;
                const lvl = document.createElement('div');
                lvl.className = 'zyad-defender-level';
                lvl.textContent = 'Lv' + level;
                defEl.appendChild(lvl);
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

        spawnEnemy(type, wave = 1) {
            const cfg = ENEMIES[type];
            const hp = 20 + (wave - 1) * 20;
            const [sr, sc] = this.path[0];
            const e = {
                type, cfg, stepIdx: 0,
                x: sc - this.colOffset,
                y: sr,
                hp: hp, maxHp: hp,
                speed: cfg.speed, atkCooldown: 0,
                el: null, elHp: null
            };
            const el = document.createElement('div');
            el.className = 'zyad-enemy';
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
                    // 触发攻击动画
                    this.triggerAttackAnim(d);
                    if (stats.atkType === 'aoe') {
                        const targets = this.findAllEnemiesInRange(d.r, d.c, stats.range);
                        for (const t of targets) {
                            if (isRanged) {
                                this.spawnProjectile(d.r, d.c, t, stats.damage, d.type);
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
                        const targets = this.findEnemiesInLine(d.r, d.c, target, stats.range);
                        for (const t of targets) {
                            if (isRanged) {
                                this.spawnProjectile(d.r, d.c, t, stats.damage, d.type);
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
                        if (isRanged) {
                            this.spawnProjectile(d.r, d.c, target, stats.damage, d.type);
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

        /* 触发守护者攻击动画 */
        triggerAttackAnim(d) {
            if (!d.el) return;
            if (d.type === '骑' && d.qiFlag) {
                d.qiFlag.swing(); // 旗枪挥砍动效
                return;
            }
            const map = { '弓': 'attacking-bow', '枪': 'attacking-spear', '刀': 'attacking-blade', '骑': 'attacking-cavalry' };
            const cls = map[d.type];
            if (!cls) return;
            d.el.classList.remove(cls);
            void d.el.offsetWidth; // 强制回流以重播动画
            d.el.classList.add(cls);
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

        spawnProjectile(r, c, target, damage, defType) {
            const el = document.createElement('div');
            // 枪：飞矛特效（"木"字飞出再收回）
            if (defType === '枪') {
                el.className = 'zyad-spear';
                const img = document.createElement('img');
                img.src = 'canvas/mu.png';
                el.appendChild(img);
                this.effectLayer.appendChild(el);
                // 隐藏原地木字，让它"飞出去"
                let origMu = null;
                const def = this.defenders.find(d => d.r === r && d.c === c);
                if (def && def.el) {
                    origMu = def.el.querySelector('.zyad-gun-mu');
                    if (origMu) origMu.style.visibility = 'hidden';
                }
                const p = { x: c, y: r, target, damage, el, defType, speed: 14,
                    startX: c, startY: r, phase: 'out', hitDone: false, origMu };
                this.projectiles.push(p);
                return;
            }
            // 其他：标准投射物
            el.className = 'zyad-projectile';
            if (defType === '弓') el.classList.add('arrow');
            this.effectLayer.appendChild(el);
            const p = { x: c, y: r, target, damage, el, speed: 8, defType: defType || null };
            if (defType === '弓') {
                const angle = Math.atan2(target.y - r, target.x - c) * 180 / Math.PI;
                el.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
            }
            this.projectiles.push(p);
        }

        /* 矛击命中粒子爆发 */
        spawnSpearHitFX(x, y) {
            for (let i = 0; i < 10; i++) {
                const spark = document.createElement('div');
                spark.className = 'zyad-spear-spark';
                spark.style.left = '0px'; spark.style.top = '0px';
                this.effectLayer.appendChild(spark);
                const angle = Math.random() * Math.PI * 2;
                const spd = 1.5 + Math.random() * 3;
                this.effects.push({
                    el: spark, x, y, t: 0,
                    vx: Math.cos(angle) * spd,
                    vy: Math.sin(angle) * spd,
                    life: 0.4 + Math.random() * 0.3,
                    isSpark: true
                });
            }
        }

        updateProjectile(p, dt) {
            // ── 飞矛特殊逻辑（旋转指向目标 + 飞出收回）──
            if (p.defType === '枪') {
                const dx = p.target.x - p.x;
                const dy = p.target.y - p.y;
                const dist = Math.hypot(dx, dy);
                // 攻击方向角度（mu 图立着，尖头朝上，需 +90°）
                const atkAngle = Math.atan2(dy, dx) * 180 / Math.PI + 90;
                if (p.phase === 'out') {
                    // 实时旋转指向目标
                    p.el.style.transform = `translate(-50%, -50%) rotate(${atkAngle}deg)`;
                    if (dist < 0.35 || !this.enemies.includes(p.target)) {
                        if (this.enemies.includes(p.target) && !p.hitDone) {
                            p.hitDone = true;
                            p.target.hp -= p.damage;
                            this.updateEnemyHP(p.target);
                            this.showFloat(p.target.x, p.target.y, '-' + p.damage, 'crit');
                            this.spawnSpearHitFX(p.target.x, p.target.y);
                            // 仓字受击抖动
                            const def = this.defenders.find(d => d.r === p.startY && d.c === p.startX);
                            if (def && def.el) {
                                const cangEl = def.el.querySelector('.zyad-gun-cang');
                                if (cangEl) {
                                    cangEl.classList.add('shaking');
                                    setTimeout(() => cangEl.classList.remove('shaking'), 350);
                                }
                            }
                            if (p.target.hp <= 0) {
                                this.grain += 1;
                                this.removeEnemy(p.target);
                            }
                        }
                        p.phase = 'back';
                    } else {
                        const move = p.speed * dt;
                        p.x += (dx / dist) * move;
                        p.y += (dy / dist) * move;
                    }
                } else {
                    // 飞回（保持旋转方向）
                    p.el.style.transform = `translate(-50%, -50%) rotate(${atkAngle + 180}deg)`;
                    const bx = p.startX - p.x;
                    const by = p.startY - p.y;
                    const bd = Math.hypot(bx, by);
                    if (bd < 0.3) {
                        // 飞回原位，恢复原地木字
                        if (p.origMu) p.origMu.style.visibility = '';
                        p.el.remove();
                        const i = this.projectiles.indexOf(p);
                        if (i >= 0) this.projectiles.splice(i, 1);
                        return;
                    }
                    const backMove = p.speed * 0.7 * dt;
                    p.x += (bx / bd) * backMove;
                    p.y += (by / bd) * backMove;
                }
                return;
            }

            // ── 标准投射物 ──
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
            if (p.defType === '弓') {
                const angle = Math.atan2(dy, dx) * 180 / Math.PI;
                p.el.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
            }
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
                const ef = this.effects[i];
                if (ef.isSpark) {
                    ef.t += dt;
                    ef.x += (ef.vx || 0) * dt * 60;
                    ef.y += (ef.vy || 0) * dt * 60;
                    ef.el.style.opacity = Math.max(0, 1 - ef.t / ef.life);
                    if (ef.t >= ef.life) {
                        ef.el.remove();
                        this.effects.splice(i, 1);
                    }
                } else {
                    ef.t += dt;
                    if (ef.t > 0.8) {
                        ef.el.remove();
                        this.effects.splice(i, 1);
                    }
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
            // 血条已移除，无需更新
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
                        if (cell) { cell.className = 'zyad-cell cleared'; cell.style.backgroundImage = "url('canvas/kongdi.png')"; cell.dataset.r = r; cell.dataset.c = c; }
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
        const count = 10 + (wave - 1);
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
                    game.leftBF.spawnEnemy(type, game.wave);
                    game.spawnIndex++;
                    game.spawnTimer = 1.2;
                }
            } else if (game.leftBF.enemies.length === 0) {
                game.waveActive = false;
                game.wave++;
                game.waveCooldown = 5;
                if (game.wave > game.maxWaves) {
                    endGame('win', '成功守住所有波次！');
                }
            }
        } else if (game.waveCooldown > 0) {
            game.waveCooldown -= dt;
            if (game.waveCooldown <= 0) startNextWave();
        }
    }

    // ─────────── 骑（旗枪）挥旗动效组件 ───────────
    // 复用 canvas/qi.html 的逻辑：以旗面左端为轴，逆时针挥砍一圈，
    // 攻击时宽度放大 FLAG_ATTACK_SCALE 倍，末段 progressive 缩回原样。
    const FLAG_ATTACK_SCALE = 4;   // 攻击时宽度扩大倍数
    const FLAG_ATTACK_HEIGHT_SCALE = 2;  // 攻击时高度扩大倍数
    const FLAG_SWING_TURNS = 360;  // 逆时针挥砍一圈

    // 图片只加载一次（缓存）
    const _qiImgCache = { base: null, flag: null, loaded: 0 };
    (function _loadQiImages() {
        const a = new Image(), b = new Image();
        a.onload = () => { _qiImgCache.base = a; _qiImgCache.loaded++; };
        b.onload = () => { _qiImgCache.flag = b; _qiImgCache.loaded++; };
        a.src = 'canvas/qi.png';
        b.src = 'canvas/qi_qiang.png';
    })();

    class QiFlag {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.size = canvas.width || 160;
            this.initialAngle = -10;     // 旗枪初始微抬角度
            this.angle = this.initialAngle;
            this.targetAngle = this.initialAngle;
            this.state = 'IDLE';
            this.widthScale = 1;
            this.heightScale = 1;
            this.shake = 0;
            // 布局（pivot 居中，保证 360° 挥砍不裁切）
            this.baseW = this.size * 0.28;   // 旗杆显示宽
            this.baseH = this.size * 0.30;   // 旗杆显示高
            this.flagW = this.size ;   // 旗面基础宽（×4 后仍可容纳）
            this.flagH = this.flagW * 72 / 822 * 8;   // 旗面高度加倍
            this.pivotX = this.size / 2;
            this.pivotY = this.size * 0.36;  // 旗杆顶部（旗面挂载点）——上移使杆+旗面整体居中
            _qiFlags.push(this);
            this.render();
        }
        swing() {
            if (this.state === 'ATTACK') return;
            this.angle = this.initialAngle;
            this.targetAngle = this.initialAngle - FLAG_SWING_TURNS; // 逆时针一圈
            this.widthScale = FLAG_ATTACK_SCALE;
            this.heightScale = FLAG_ATTACK_HEIGHT_SCALE;
            this.shake = this.size * 0.08;
            this.state = 'ATTACK';
        }
        render() {
            const ctx = this.ctx, S = this.size;
            ctx.clearRect(0, 0, S, S);
            if (!this.canvas.isConnected) return; // 单位已移除，跳过
            if (!_qiImgCache.base || !_qiImgCache.flag) return;

            // 旗杆（底座 qi.png）抖动
            let sx = 0, sy = 0;
            if (this.shake > 0.3) {
                sx = (Math.random() - 0.5) * this.shake;
                sy = (Math.random() - 0.5) * this.shake;
                this.shake *= 0.85;
            } else { this.shake = 0; }

            ctx.drawImage(
                _qiImgCache.base,
                this.pivotX - this.baseW / 2 + sx, this.pivotY + sy,
                this.baseW, this.baseH
            );

            // 旗面（qi_qiang.png）挥砍推进：逆时针，末段渐进缩回宽度
            if (this.state === 'ATTACK') {
                const angleDiff = this.targetAngle - this.angle;
                if (Math.abs(angleDiff) > 1) {
                    this.angle += angleDiff * 0.25;
                    const traveled = Math.abs(this.angle - this.initialAngle);
                    const progress = Math.min(traveled / FLAG_SWING_TURNS, 1);
                    if (progress < 0.6) {
                        this.widthScale = FLAG_ATTACK_SCALE;
                        this.heightScale = FLAG_ATTACK_HEIGHT_SCALE;
                    } else {
                        const t = (progress - 0.6) / 0.4;
                        const ease = t * t * (3 - 2 * t); // smoothstep
                        this.widthScale = FLAG_ATTACK_SCALE - (FLAG_ATTACK_SCALE - 1) * ease;
                        this.heightScale = FLAG_ATTACK_HEIGHT_SCALE - (FLAG_ATTACK_HEIGHT_SCALE - 1) * ease;
                    }
                } else {
                    this.angle = this.initialAngle;
                    this.widthScale = 1;
                    this.heightScale = 1;
                    this.state = 'IDLE';
                }
            }

            // 旗面 pivot 在左端，挂在旗杆顶部
            const fw = this.flagW * this.widthScale;
            const fh = this.flagH * this.heightScale;
            ctx.save();
            ctx.translate(this.pivotX + sx, this.pivotY + sy + this.size * 0.072);   // 旗面按比例下移（往上调3px，约7px显示）
            ctx.rotate(this.angle * Math.PI / 180);
            ctx.drawImage(_qiImgCache.flag, 0, -fh / 2, fw, fh);
            ctx.restore();
        }
    }

    // 共享渲染循环：驱动所有旗枪 canvas（自动剔除已脱离 DOM 的实例）
    const _qiFlags = [];
    function _qiRenderLoop() {
        for (let i = _qiFlags.length - 1; i >= 0; i--) {
            const qf = _qiFlags[i];
            if (!qf.canvas.isConnected) { _qiFlags.splice(i, 1); continue; }
            qf.render();
        }
        requestAnimationFrame(_qiRenderLoop);
    }
    requestAnimationFrame(_qiRenderLoop);

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
                    cell.style.backgroundImage = "url('canvas/kongdi.png')";
                    cell.dataset.r = r; cell.dataset.c = c; cell.dataset.side = 'left';
                    bf.useCard(card.idx);
                    game.selectedCard = null;
                    bf.renderCards();
                }
            } else {
                // 已放置的同级同型号守护者 → 直接合成升级
                if (existingDef && existingDef.type === card.type && existingDef.level === card.level && existingDef.level < 5) {
                    bf.levelUpDefender(existingDef);
                    bf.showFloat(c, r, 'Lv' + existingDef.level, 'crit');
                    bf.useCard(card.idx);
                    game.selectedCard = null;
                    bf.renderCards();
                } else if (bf.grid[r][c] === TILE.CLEARED && !existingDef) {
                    // 否则放到空白格（按卡牌等级放置）
                    bf.placeDefender(r, c, card.type, card.level);
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
        game.leftBF = new Battlefield('left', 0, LEFT_PATH, MY_MAP);
        game.rightBF = new Battlefield('right', 0, RIGHT_PATH, FOE_MAP);
        game.leftBF.buildGrid();
        game.rightBF.buildGrid();

        // 渲染
        const leftArena = $('#zyadLeftArena');
        const rightArena = $('#zyadRightArena');
        game.leftBF.render(leftArena);
        game.rightBF.render(rightArena);

        // 战局开始：玩家征兵栏为空，需点击「征兵」获取将士
        game.leftBF.cards = [];
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
