/* ═══════════════════════════════════════════
   赵云与阿斗 - 对战塔防游戏
   上下两个 8×5 战场，玩家 / AI，比谁坚持更久
   ═══════════════════════════════════════════ */

(function () {
    'use strict';

    // ─────────── 常量 ───────────
    const COLS = 8;
    const ROWS = 5;
    const CELL = 48;                 // 战场单格逻辑像素
    const BOARD_W = COLS * CELL;     // 战场画布宽
    const BOARD_H = ROWS * CELL;     // 战场画布高
    const FLAG_SIZE = CELL * 5;      // 骑（旗枪）挥砍绘制尺寸

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

    // 武将碎片池：每个字出现的次数 = 该武将最多可被征召出的数量（超出后不再出现）
    const GENERAL_POOL = ['刘','赵','赵','云','关','羽','平','兴','马','马','超','张','张','飞','苞','翼','黄','黄','忠','盖','祖','备'];
    const GENERAL_CHARS = Array.from(new Set(GENERAL_POOL)); // 去重（保序）
    const GENERAL_MAX = {};
    GENERAL_POOL.forEach(ch => { GENERAL_MAX[ch] = (GENERAL_MAX[ch] || 0) + 1; });

    // 武将合成组合：左右相邻（左=a、右=b）才合成；weapon 决定攻击方式，skill 决定武将技能
    const GENERAL_COMBOS = [
        { a: '赵', b: '云', name: '赵云', weapon: '枪', skill: 'illusion' },     // 幻象突进
        { a: '关', b: '羽', name: '关羽', weapon: '刀', skill: 'leap' },         // 跳斩溅射
        { a: '张', b: '飞', name: '张飞', weapon: '枪', skill: 'shout' },        // 大喝眩晕
        { a: '马', b: '超', name: '马超', weapon: '枪', skill: 'stunHit' },      // 普攻眩晕
        { a: '黄', b: '忠', name: '黄忠', weapon: '弓', skill: 'fireBarrage' },  // 火箭轰炸
        { a: '刘', b: '备', name: '刘备', weapon: '刀', skill: 'holySword' },    // 圣剑击倒
        { a: '关', b: '兴', name: '关兴', weapon: '刀', skill: 'stunHit' },      // 普攻眩晕
        { a: '黄', b: '盖', name: '黄盖', weapon: '刀', skill: 'none' },         // 无技能
        { a: '张', b: '苞', name: '张苞', weapon: '枪', skill: 'stunHit' },      // 普攻眩晕
        { a: '关', b: '平', name: '关平', weapon: '刀', skill: 'shout' },        // 大喝眩晕
        { a: '张', b: '翼', name: '张翼', weapon: '刀', skill: 'leap' },         // 跳斩溅射
        { a: '黄', b: '祖', name: '黄祖', weapon: '弓', skill: 'arrowRain' }     // 箭雨
    ];
    // 顺序无关（用于"同格叠放合成"：一张碎片落到另一张碎片上）
    function comboFor(ch1, ch2) {
        for (const c of GENERAL_COMBOS) {
            if ((c.a === ch1 && c.b === ch2) || (c.a === ch2 && c.b === ch1)) return c;
        }
        return null;
    }
    // 严格左=a、右=b（用于"左右相邻合成"：仅水平相邻、且顺序为左→右才合成）
    function comboForExact(ch1, ch2) {
        for (const c of GENERAL_COMBOS) {
            if (c.a === ch1 && c.b === ch2) return c;
        }
        return null;
    }

    // 武将技能参数
    const SKILL_NAME = { illusion: '幻象突进', leap: '跳斩溅射', shout: '大喝眩晕', fireBarrage: '火箭轰炸', holySword: '圣剑击倒', arrowRain: '箭雨', stunHit: '普攻眩晕', none: '无' };
    const SKILL_CD = { illusion: 9, leap: 11, shout: 10, fireBarrage: 9, holySword: 12, arrowRain: 8, stunHit: 0, none: 0 };
    const STUN_HIT_CHANCE = 0.28;   // 关兴/张苞/马超：普攻概率眩晕
    const STUN_HIT_DUR = 1.2;
    const SHOUT_RADIUS = 2.4, SHOUT_DUR = 2.0;   // 张飞/关平：大喝一圈眩晕
    const LEAP_CHARGES = 4, LEAP_SPLASH = 0.5;   // 关羽/张翼：接下来数次跳斩，50% 溅射
    const HOLY_RADIUS = 2.4, HOLY_DUR = 1.0;     // 刘备：圣剑范围伤害+击倒
    const BARRAGE_COUNT = 8;                     // 黄忠/黄祖：箭/火雨数量

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

    // ─────────── 贴图缓存（canvas 绘制用）───────────
    const _img = {};
    const _imgKeys = ['daolu', 'huangdi', 'kongdi', 'diying', 'adou', 'mu', 'cang', 'dao', 'daobing', 'gong', 'gong2', 'zu'];
    _imgKeys.forEach((k) => {
        const im = new Image();
        im.onload = () => { _img[k] = im; };
        im.src = 'canvas/' + k + '.png';
    });

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
            this.skillFx = [];        // 武将技能特效（幻象/大喝/圣剑/箭雨等）
            this.cards = [];
            this.odouHP = 3;
            this.grain = 20;
            this.recruitCost = 10;
            this.gridEl = null;
            this.enemyLayer = null;
            this.effectLayer = null;
            this.odouEl = null;
            this.cardSlotsEl = null;
            this.canvas = null;
            this.ctx = null;
            this.rangeDef = null;    // 选中士兵（画射程圈）
            this.infoDef = null;     // 选中士兵（画信息框）
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
            // 纯 canvas 战场
            const canvas = document.createElement('canvas');
            canvas.className = 'zyad-canvas';
            canvas.width = BOARD_W;
            canvas.height = BOARD_H;
            canvas.dataset.side = this.side;
            board.appendChild(canvas);
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.gridEl = null;        // 不再使用 DOM 网格
            this.enemyLayer = null;
            this.effectLayer = null;
            this.rangeLayer = null;
            this.infoTip = null;
            this.boardEl = board;
            container.appendChild(board);

            // 右侧（AI）状态条
            if (this.isAI) {
                const aiBar = document.createElement('div');
                aiBar.className = 'zyad-ai-bar';
                aiBar.innerHTML = '<span class="zyad-ai-label">🤖 对手</span> 馒头 <b class="zyad-ai-grain">20</b> | 斗 <b class="zyad-ai-odou">3</b>♥';
                container.appendChild(aiBar);
                this.aiBar = aiBar;
            }
        }

        refillCards() {
            while (this.cards.length < 5) {
                const rc = this.rollCard();
                this.cards.push({ type: rc.type, level: 1, used: false, char: rc.char || null });
            }
        }

        rollCard() {
            // 征兵概率（%）：刀 19.1 / 弓 17.3 / 枪 16.4 / 骑 15.5 / 武将碎片池 20 / 铲子 11.7
            const r = Math.random() * 100;
            if (r < 19.1) return { type: '刀' };
            if (r < 36.4) return { type: '弓' };   // 19.1 + 17.3
            if (r < 52.8) return { type: '枪' };   // 36.4 + 16.4
            if (r < 68.3) return { type: '骑' };   // 52.8 + 15.5
            if (r < 88.3) {                          // 20% 武将碎片池
                if (this.isAI) return { type: 'shovel' };  // AI 不抽武将池
                const ch = drawGeneral();
                if (ch) return { type: 'general', char: ch };
                return { type: 'shovel' };          // 池已空 → 归铲子
            }
            return { type: 'shovel' };              // 剩余 11.7
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
                    } else if (card.type === 'general') {
                        slot.classList.add('general');
                        slot.textContent = card.char;   // 武将碎片：显示单字
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
                        const lv = document.createElement('span');
                        lv.className = 'zyad-card-level';
                        lv.textContent = 'Lv' + card.level;
                        slot.appendChild(lv);
                    } else if (card.type === '骑') {
                        // 骑（旗枪）：卡牌也用旗标替换文字
                        const cv = document.createElement('canvas');
                        cv.width = 160; cv.height = 160;
                        cv.className = 'zyad-qi-card-canvas';
                        slot.appendChild(cv);
                        new QiFlag(160).attach(cv);
                        const lv = document.createElement('span');
                        lv.className = 'zyad-card-level';
                        lv.textContent = 'Lv' + card.level;
                        slot.appendChild(lv);
                    } else {
                        slot.textContent = card.type;
                        const lv = document.createElement('span');
                        lv.className = 'zyad-card-level';
                        lv.textContent = 'Lv' + card.level;
                        slot.appendChild(lv);
                    }
                    if (game.selectedCard && game.selectedCard.idx === idx && game.selectedCard.bf === this) {
                        slot.classList.add('selected');
                    }
                    // ── 卡牌拖动上场：在卡牌上按下并拖到战场格子松手即部署 ──
                    slot.addEventListener('pointerdown', (e) => {
                        if (card.used) return;
                        e.preventDefault();
                        game.selectedDefender = null;
                        const t = card.type, lv = card.level;
                        let ghost = null;
                        if (t === '骑') ghost = { type: '骑', level: lv, qiFlag: new QiFlag(UNIT_QI) };
                        else if (t === 'general') ghost = { type: 'general', level: lv, isFragment: true, char: card.char };
                        else ghost = { type: t, level: lv }; // 刀/弓/枪均按图片渲染，无需 canvas 组件
                        const p = (game.leftBF && game.leftBF.canvas) ? canvasPoint(game.leftBF.canvas, e) : { x: 0, y: 0 };
                        game.cardDrag = {
                            card, idx, bf: this, type: t, level: lv,
                            startX: e.clientX, startY: e.clientY,
                            mx: p.x, my: p.y, moved: false, ghost
                        };
                    });

                    slot.addEventListener('click', () => {
                        if (card.used) return;
                        if (game._justDragged) { game._justDragged = false; return; }
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
                const rc = this.rollCard();
                this.cards.push({ type: rc.type, level: 1, used: false, char: rc.char || null });
            }
            return true;
        }

        useCard(idx) {
            this.cards[idx].used = true;
            if (!this.isAI) this.renderCards();
        }

        placeDefender(r, c, type, level = 1, char = null) {
            const cfg = DEFENDERS[type];
            const hp = cfg ? cfg.hp : 1;
            const d = {
                r, c, type, level, hp, maxHp: hp, atkTimer: 0,
                el: null, levelEl: null, dragging: false, attackFlash: 0, qiFlag: null, side: this.side
            };
            if (type === 'general') {
                d.isFragment = true;
                d.char = char;
            } else if (type === '骑') {
                // 骑（旗枪）：用 QiFlag 状态对象，绘制时由 drawFrame 调度
                d.qiFlag = new QiFlag(FLAG_SIZE);
            }
            this.defenders.push(d);
            return d;
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

        // 选中守护者：记录用于绘制射程圆圈
        showDefenderRange(d) {
            this.rangeDef = d;
        }

        // 选中守护者：记录用于绘制信息框
        showDefenderInfo(d) {
            this.infoDef = d;
            this.rangeDef = d;
        }

        // 清除选中可视（射程圈 + 信息）
        clearDefenderSelectionVisuals() {
            this.rangeDef = null;
            this.infoDef = null;
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
                speed: cfg.speed, atkCooldown: 0, stun: 0,
                el: null, elHp: null
            };
            this.enemies.push(e);
        }

        updateEnemy(e, dt) {
            // 眩晕：原地不动、不攻击
            if (e.stun > 0) {
                e.stun -= dt;
                return;
            }
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
            const i = this.enemies.indexOf(e);
            if (i >= 0) this.enemies.splice(i, 1);
        }

        updateDefender(d, dt) {
            if (d.isFragment) return; // 武将碎片占位、不攻击
            // 武将技能：冷却到点自动释放大招（被动型 stunHit / none 不在此触发）
            if (d.isGeneral && d.skill && SKILL_CD[d.skill] > 0) {
                d.skillCd -= dt;
                if (d.skillCd <= 0) {
                    this.castSkill(d);
                    d.skillCd = d.skillCdMax;
                }
            }
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
                                this.applyHitSkill(d, t);
                                if (t.hp <= 0) {
                                    this.grain += 1;
                                    this.removeEnemy(t);
                                }
                            }
                        }
                        if (targets.length) this.applyLeapSplash(d, targets[0]);
                    } else if (stats.atkType === 'pierce') {
                        const targets = this.findEnemiesInLine(d.r, d.c, target, stats.range);
                        for (const t of targets) {
                            if (isRanged) {
                                this.spawnProjectile(d.r, d.c, t, stats.damage, d.type);
                            } else {
                                t.hp -= stats.damage;
                                this.updateEnemyHP(t);
                                this.showFloat(t.x, t.y, '-' + Math.round(stats.damage), 'crit');
                                this.applyHitSkill(d, t);
                                if (t.hp <= 0) {
                                    this.grain += 1;
                                    this.removeEnemy(t);
                                }
                            }
                        }
                        this.applyLeapSplash(d, target);
                    } else {
                        if (isRanged) {
                            this.spawnProjectile(d.r, d.c, target, stats.damage, d.type);
                        } else {
                            target.hp -= stats.damage;
                            this.updateEnemyHP(target);
                            this.showFloat(target.x, target.y, '-' + Math.round(stats.damage), 'crit');
                            this.applyHitSkill(d, target);
                            this.applyLeapSplash(d, target);
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
            if (d.type === '骑' && d.qiFlag) {
                d.qiFlag.swing(); // 旗枪挥砍动效
                return;
            }
            // 近战/远程：闪白反馈（drawFrame 读取 attackFlash）
            d.attackFlash = 0.28;
        }

        /* ─────────── 武将技能系统 ─────────── */
        // 普攻命中后：概率眩晕（关兴/张苞/马超）
        applyHitSkill(d, t) {
            if (d.skill === 'stunHit' && t && t.hp > 0 && Math.random() < STUN_HIT_CHANCE) {
                t.stun = STUN_HIT_DUR;
                this.showFloat(t.x, t.y, '眩晕', 'crit');
            }
        }
        // 跳斩溅射：对主目标周围 1 格敌人造成 50% 伤害（关羽/张翼），消耗一次充能
        applyLeapSplash(d, t) {
            if (d.leapCharges <= 0 || !t || t.hp <= 0) return;
            d.leapCharges--;
            const stats = this.getEffectiveStats(d);
            const splash = stats.damage * LEAP_SPLASH;
            const near = this.findAllEnemiesInRange(t.y, t.x, 1.0);
            for (const e of near) {
                if (e === t) continue;
                e.hp -= splash;
                this.updateEnemyHP(e);
                this.showFloat(e.x, e.y, '-' + Math.round(splash), 'crit');
                if (e.hp <= 0) { this.grain += 1; this.removeEnemy(e); }
            }
            this.spawnSlashFX(t.y, t.x);
        }
        // 大招分发（按技能冷却自动触发）
        castSkill(d) {
            const cx = d.c, cy = d.r;
            const stats = this.getEffectiveStats(d);
            switch (d.skill) {
                case 'illusion': this.castIllusion(d, stats); break;
                case 'leap': d.leapCharges = LEAP_CHARGES; this.spawnSlashFX(cy, cx); this.showFloat(cx, cy, '跳斩！', 'crit'); break;
                case 'shout': this.castShout(d, cx, cy); break;
                case 'fireBarrage': this.castBarrage(d, cx, cy, stats, 'fire'); break;
                case 'holySword': this.castHolySword(d, cx, cy, stats); break;
                case 'arrowRain': this.castBarrage(d, cx, cy, stats, 'arrow'); break;
            }
        }
        // 赵云：幻象冲进敌群，来回突进七次
        castIllusion(d, stats) {
            this.skillFx.push({
                kind: 'illusion', x: d.c, y: d.r,
                dashes: 7, dmg: stats.damage * 1.3,
                state: 'seek', target: null, life: 0
            });
            this.showFloat(d.c, d.r, '幻象突进！', 'crit');
        }
        // 张飞/关平：大喝一声，砸晕一圈敌人 2 秒
        castShout(d, cx, cy) {
            const hit = this.findAllEnemiesInRange(cy, cx, SHOUT_RADIUS);
            for (const e of hit) e.stun = SHOUT_DUR;
            this.skillFx.push({ kind: 'ring', x: cx, y: cy, r: 0, maxR: SHOUT_RADIUS, t: 0, life: 0.5, color: 'rgba(250,204,21,0.9)' });
            this.showFloat(cx, cy, '大喝！', 'crit');
        }
        // 刘备：释放圣剑，范围伤害并击倒（眩晕）敌人
        castHolySword(d, cx, cy, stats) {
            const hit = this.findAllEnemiesInRange(cy, cx, HOLY_RADIUS);
            const dmg = stats.damage * 2.2;
            for (const e of hit) {
                e.hp -= dmg; this.updateEnemyHP(e);
                this.showFloat(e.x, e.y, '-' + Math.round(dmg), 'crit');
                e.stun = HOLY_DUR;
                if (e.hp <= 0) { this.grain += 1; this.removeEnemy(e); }
            }
            this.skillFx.push({ kind: 'sword', x: cx, y: cy, r: 0, maxR: HOLY_RADIUS, t: 0, life: 0.45 });
            this.showFloat(cx, cy, '圣剑！', 'crit');
        }
        // 黄忠(火)/黄祖(箭)：从天而降的大量箭/火箭轰炸
        castBarrage(d, cx, cy, stats, mode) {
            const dmg = stats.damage * (mode === 'fire' ? 1.4 : 1.1);
            const pool = this.enemies.slice();
            for (let i = 0; i < BARRAGE_COUNT; i++) {
                let tx, ty;
                if (pool.length) {
                    const e = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
                    tx = e.x; ty = e.y;
                } else {
                    const [pr, pc] = this.path[Math.floor(Math.random() * this.path.length)];
                    tx = pc - this.colOffset + Math.random() * 0.6 - 0.3;
                    ty = pr + Math.random() * 0.6 - 0.3;
                }
                this.skillFx.push({ kind: 'rain', fire: mode === 'fire', p: { x: tx, y: ty - 3, target: { x: tx, y: ty }, damage: dmg }, t: 0 });
            }
            this.showFloat(cx, cy, mode === 'fire' ? '火箭轰炸！' : '箭雨！', 'crit');
        }
        spawnSlashFX(r, c) {
            this.skillFx.push({ kind: 'slash', x: c, y: r, t: 0, life: 0.3 });
        }
        removeSkillFx(fx) {
            const i = this.skillFx.indexOf(fx);
            if (i >= 0) this.skillFx.splice(i, 1);
        }
        updateSkillFx(dt) {
            for (let i = this.skillFx.length - 1; i >= 0; i--) {
                const fx = this.skillFx[i];
                fx.t = (fx.t || 0) + dt;
                if (fx.kind === 'illusion') {
                    if (fx.state === 'seek') {
                        let best = null, bd = Infinity;
                        for (const e of this.enemies) {
                            const dd = Math.hypot(e.x - fx.x, e.y - fx.y);
                            if (dd < bd) { bd = dd; best = e; }
                        }
                        if (best) { fx.target = best; fx.state = 'dash'; }
                        else { fx.life += dt; if (fx.life > 0.6) this.skillFx.splice(i, 1); }
                    } else {
                        const tg = fx.target;
                        if (!tg || !this.enemies.includes(tg) || tg.hp <= 0) {
                            fx.dashes--; fx.state = 'seek'; fx.target = null;
                            if (fx.dashes <= 0) this.skillFx.splice(i, 1);
                        } else {
                            const dx = tg.x - fx.x, dy = tg.y - fx.y, dist = Math.hypot(dx, dy);
                            const mv = 11 * dt;
                            if (dist < 0.35) {
                                tg.hp -= fx.dmg; this.updateEnemyHP(tg);
                                this.showFloat(tg.x, tg.y, '-' + Math.round(fx.dmg), 'crit');
                                if (tg.hp <= 0) { this.grain += 1; this.removeEnemy(tg); }
                                this.spawnSpearHitFX(tg.x, tg.y);
                                fx.dashes--; fx.state = 'seek'; fx.target = null;
                                if (fx.dashes <= 0) this.skillFx.splice(i, 1);
                            } else { fx.x += dx / dist * mv; fx.y += dy / dist * mv; }
                        }
                    }
                } else if (fx.kind === 'rain') {
                    const p = fx.p;
                    const dx = p.target.x - p.x, dy = p.target.y - p.y, dist = Math.hypot(dx, dy);
                    const mv = 12 * dt;
                    if (dist < 0.3) {
                        const tg = this.enemies.find(e => Math.hypot(e.x - p.target.x, e.y - p.target.y) < 0.5);
                        if (tg) {
                            tg.hp -= p.damage; this.updateEnemyHP(tg);
                            this.showFloat(tg.x, tg.y, '-' + Math.round(p.damage), 'crit');
                            if (tg.hp <= 0) { this.grain += 1; this.removeEnemy(tg); }
                        }
                        this.skillFx.push({ kind: 'boom', x: p.target.x, y: p.target.y, t: 0, life: 0.35, fire: fx.fire });
                        this.skillFx.splice(i, 1);
                    } else { p.x += dx / dist * mv; p.y += dy / dist * mv; }
                } else if (fx.kind === 'ring' || fx.kind === 'sword') {
                    fx.r = fx.maxR * Math.min(1, fx.t / fx.life);
                    if (fx.t >= fx.life) this.skillFx.splice(i, 1);
                } else { // slash / boom
                    if (fx.t >= fx.life) this.skillFx.splice(i, 1);
                }
            }
        }
        drawSkillFx(ctx, fx) {
            const S = CELL;
            const toX = (gx) => (gx + 0.5) * S;
            const toY = (gy) => (gy + 0.5) * S;
            ctx.save();
            if (fx.kind === 'illusion') {
                const x = toX(fx.x), y = toY(fx.y);
                ctx.globalAlpha = 0.5;
                ctx.fillStyle = '#67e8f9';
                ctx.beginPath();
                ctx.ellipse(x, y, S * 0.28, S * 0.4, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 0.95; ctx.fillStyle = '#0e7490';
                ctx.font = 'bold 16px "STKaiti", serif';
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText('云', x, y);
            } else if (fx.kind === 'ring') {
                const x = toX(fx.x), y = toY(fx.y), r = fx.r * S;
                ctx.globalAlpha = Math.max(0, 1 - fx.t / fx.life);
                ctx.strokeStyle = fx.color; ctx.lineWidth = 3;
                ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
            } else if (fx.kind === 'sword') {
                const x = toX(fx.x), y = toY(fx.y), r = fx.r * S;
                ctx.globalAlpha = Math.max(0, 1 - fx.t / fx.life);
                ctx.strokeStyle = '#fde68a'; ctx.lineWidth = 4;
                ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke();
                ctx.strokeStyle = 'rgba(253,230,138,0.5)'; ctx.lineWidth = 10;
                ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
            } else if (fx.kind === 'rain') {
                const x = toX(fx.p.x), y = toY(fx.p.y);
                const ang = Math.atan2(fx.p.target.y - fx.p.y, fx.p.target.x - fx.p.x);
                ctx.translate(x, y); ctx.rotate(ang);
                ctx.strokeStyle = fx.fire ? '#f97316' : '#fbbf24';
                ctx.shadowBlur = fx.fire ? 8 : 4;
                ctx.shadowColor = fx.fire ? '#f97316' : '#fbbf24';
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(-S * 0.3, 0); ctx.lineTo(S * 0.3, 0); ctx.stroke();
                ctx.restore(); return;
            } else if (fx.kind === 'boom') {
                const x = toX(fx.x), y = toY(fx.y);
                const r = (fx.t / fx.life) * S * 0.6;
                ctx.globalAlpha = Math.max(0, 1 - fx.t / fx.life);
                ctx.fillStyle = fx.fire ? 'rgba(249,115,22,0.8)' : 'rgba(251,191,36,0.7)';
                ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
            } else if (fx.kind === 'slash') {
                const x = toX(fx.x), y = toY(fx.y);
                ctx.globalAlpha = Math.max(0, 1 - fx.t / fx.life) * 0.9;
                ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
                ctx.beginPath(); ctx.arc(x, y, S * 0.4, -0.6, 0.9); ctx.stroke();
            }
            ctx.restore();
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
            // 枪：飞矛特效（"木"字飞出再收回）
            if (defType === '枪') {
                const p = { x: c, y: r, target, damage, defType, speed: 14,
                    startX: c, startY: r, phase: 'out', hitDone: false };
                this.projectiles.push(p);
                return;
            }
            // 其他：标准投射物
            const p = { x: c, y: r, target, damage, speed: 8, defType: defType || null };
            this.projectiles.push(p);
        }

        /* 矛击命中粒子爆发 */
        spawnSpearHitFX(x, y) {
            for (let i = 0; i < 10; i++) {
                const angle = Math.random() * Math.PI * 2;
                const spd = 1.5 + Math.random() * 3;
                this.effects.push({
                    x, y, t: 0,
                    vx: Math.cos(angle) * spd,
                    vy: Math.sin(angle) * spd,
                    life: 0.4 + Math.random() * 0.3,
                    isSpark: true
                });
            }
        }

        updateProjectile(p, dt) {
            // ── 飞矛特殊逻辑（飞出 → 命中 → 收回）──
            if (p.defType === '枪') {
                const dx = p.target.x - p.x;
                const dy = p.target.y - p.y;
                const dist = Math.hypot(dx, dy);
                if (p.phase === 'out') {
                    if (dist < 0.35 || !this.enemies.includes(p.target)) {
                        if (this.enemies.includes(p.target) && !p.hitDone) {
                            p.hitDone = true;
                            p.target.hp -= p.damage;
                            this.updateEnemyHP(p.target);
                            this.showFloat(p.target.x, p.target.y, '-' + p.damage, 'crit');
                            this.spawnSpearHitFX(p.target.x, p.target.y);
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
                    const bx = p.startX - p.x;
                    const by = p.startY - p.y;
                    const bd = Math.hypot(bx, by);
                    if (bd < 0.3) {
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
                const i = this.projectiles.indexOf(p);
                if (i >= 0) this.projectiles.splice(i, 1);
                return;
            }
            const move = p.speed * dt;
            p.x += (dx / dist) * move;
            p.y += (dy / dist) * move;
        }

        showFloat(x, y, text, cls) {
            this.effects.push({ x, y, t: 0, text: String(text), cls: cls || '' });
        }

        updateEffects(dt) {
            for (let i = this.effects.length - 1; i >= 0; i--) {
                const ef = this.effects[i];
                ef.t += dt;
                if (ef.isSpark) {
                    ef.x += (ef.vx || 0) * dt * 2;
                    ef.y += (ef.vy || 0) * dt * 2;
                    if (ef.t >= ef.life) this.effects.splice(i, 1);
                } else if (ef.t > 0.8) {
                    this.effects.splice(i, 1);
                }
            }
        }

        syncDOM() {
            // 已改为 canvas 每帧绘制
            this.drawFrame();
        }

        updateDefenderHP(d) {
            // 血条已移除，无需更新
        }

        updateEnemyHP(e) {
            // 血条改为 canvas 绘制（drawFrame），此处无需操作
        }

        removeDefender(d) {
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

        // ─────────── canvas 绘制 ───────────
        drawFrame() {
            const ctx = this.ctx;
            if (!ctx) return;
            const S = CELL;
            ctx.clearRect(0, 0, BOARD_W, BOARD_H);

            // 1) 地块
            for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c < COLS; c++) {
                    const st = this.grid[r][c];
                    const key = st === TILE.PATH ? 'daolu'
                              : st === TILE.LOCKED ? 'huangdi'
                              : st === TILE.CLEARED ? 'kongdi'
                              : st === TILE.ENTRY ? 'diying'
                              : st === TILE.ODOU ? 'adou' : null;
                    const img = key && _img[key];
                    if (img) ctx.drawImage(img, c * S, r * S, S, S);
                    else { ctx.fillStyle = '#222'; ctx.fillRect(c * S, r * S, S, S); }
                }
            }

            // 2) 选中士兵的射程圈
            if (game.selectedDefender && game.selectedDefender.defender.side === this.side) {
                const d = game.selectedDefender.defender;
                const stats = this.getEffectiveStats(d);
                const cx = d.c * S + S / 2, cy = d.r * S + S / 2;
                const radius = (stats.range + 0.5) * S;
                ctx.save();
                ctx.strokeStyle = 'rgba(120,200,255,0.7)';
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
                ctx.restore();
            }

            // 3) 拖拽落点高亮
            if (game.drag && game.drag.d.side === this.side) {
                const cell = cellAt(this, game.drag.mx, game.drag.my);
                if (cell) {
                    ctx.save();
                    ctx.fillStyle = 'rgba(80,220,120,0.22)';
                    ctx.fillRect(cell.c * S, cell.r * S, S, S);
                    ctx.restore();
                }
            }

            // 3b) 征兵卡牌拖拽落点高亮
            if (game.cardDrag && game.cardDrag.moved && game.cardDrag.bf === this) {
                const cell = cellAt(this, game.cardDrag.mx, game.cardDrag.my);
                if (cell) {
                    const ok = cardDropValid(this, game.cardDrag.card, cell.r, cell.c);
                    ctx.save();
                    ctx.fillStyle = ok ? 'rgba(80,220,120,0.22)' : 'rgba(220,80,80,0.25)';
                    ctx.fillRect(cell.c * S, cell.r * S, S, S);
                    ctx.restore();
                }
            }

            // 4) 防守者（拖拽中的单独画在鼠标处）
            for (const d of this.defenders) {
                if (d.dragging) continue;
                const cx = d.c * S + S / 2, cy = d.r * S + S / 2;
                this.drawDefender(ctx, d, cx, cy);
            }

            // 5) 敌人
            for (const e of this.enemies) {
                const cx = e.x * S + S / 2, cy = e.y * S + S / 2;
                const img = _img['zu'];
                if (img) {
                    const w = S * 0.85, h = S * 0.85;
                    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
                } else {
                    ctx.fillStyle = '#c33';
                    ctx.beginPath(); ctx.arc(cx, cy, S * 0.3, 0, Math.PI * 2); ctx.fill();
                }
                const bw = S * 0.8, bh = 4;
                const bx = cx - bw / 2, by = cy - S * 0.55;
                ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(bx, by, bw, bh);
                ctx.fillStyle = '#5f5'; ctx.fillRect(bx, by, bw * Math.max(0, e.hp / e.maxHp), bh);
                // 眩晕标记
                if (e.stun > 0) {
                    ctx.save();
                    ctx.fillStyle = '#fde047';
                    ctx.font = 'bold 12px sans-serif';
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.fillText('★', cx, cy - S * 0.55 - 6);
                    ctx.restore();
                }
            }

            // 6) 投射物
            for (const p of this.projectiles) this.drawProjectile(ctx, p);

            // 7) 特效（飘字 / 火花）
            for (const ef of this.effects) {
                if (ef.isSpark) {
                    ctx.save();
                    ctx.globalAlpha = Math.max(0, 1 - ef.t / ef.life);
                    ctx.fillStyle = '#ffd24a';
                    ctx.beginPath(); ctx.arc(ef.x * S + S / 2, ef.y * S + S / 2, 3, 0, Math.PI * 2); ctx.fill();
                    ctx.restore();
                } else {
                    const a = Math.max(0, 1 - ef.t / 0.8);
                    ctx.save();
                    ctx.globalAlpha = a;
                    ctx.fillStyle = ef.cls === 'crit' ? '#ff5555' : '#ffffff';
                    ctx.font = 'bold 14px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(ef.text, ef.x * S + S / 2, ef.y * S + S / 2 - ef.t * 30);
                    ctx.restore();
                }
            }

            // 7b) 武将技能特效
            for (const fx of this.skillFx) this.drawSkillFx(ctx, fx);

            // 8) 拖动中的士兵（跟随鼠标）
            if (game.drag && game.drag.d.side === this.side) {
                const d = game.drag.d;
                ctx.save();
                ctx.globalAlpha = 0.85;
                this.drawDefender(ctx, d, game.drag.mx, game.drag.my);
                ctx.restore();
            }

            // 8b) 征兵卡牌拖拽幽灵（跟随鼠标）
            if (game.cardDrag && game.cardDrag.moved && game.cardDrag.bf === this && game.cardDrag.ghost) {
                ctx.save();
                ctx.globalAlpha = 0.85;
                this.drawDefender(ctx, game.cardDrag.ghost, game.cardDrag.mx, game.cardDrag.my);
                ctx.restore();
            }

            // 9) 选中信息框
            if (game.selectedDefender && game.selectedDefender.defender.side === this.side && this.infoDef) {
                this.drawInfoBox(ctx, this.infoDef);
            }
        }

        drawDefender(ctx, d, cx, cy) {
            const S = CELL;
            if (d.isFragment) {
                // 武将碎片：金边方块底 + 单字
                const s = S * 0.7;
                ctx.save();
                ctx.fillStyle = 'rgba(60,48,26,0.92)';
                ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
                ctx.strokeStyle = '#f0d088'; ctx.lineWidth = 1.5;
                ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
                ctx.fillStyle = '#f5d77a';
                ctx.font = 'bold 24px "STKaiti", serif';
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(d.char, cx, cy);
                ctx.restore();
                return;
            }
            if (d.generalName) {
                // 合成武将：淡黄底（合并后的单元格）+ 武将姓名居中，明确区别于普通士兵
                const pad = S * 0.08;
                ctx.save();
                ctx.fillStyle = 'rgba(255, 236, 150, 0.96)';
                ctx.fillRect(cx - S / 2 + pad, cy - S / 2 + pad, S - 2 * pad, S - 2 * pad);
                ctx.strokeStyle = '#caa84a'; ctx.lineWidth = 1.5;
                ctx.strokeRect(cx - S / 2 + pad, cy - S / 2 + pad, S - 2 * pad, S - 2 * pad);
                ctx.fillStyle = '#7a3b00';
                ctx.font = 'bold 18px "STKaiti", serif';
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(d.generalName, cx, cy - 2);
                ctx.fillStyle = '#9a6b1f';
                ctx.font = 'bold 9px sans-serif';
                ctx.fillText(DEFENDERS[d.type] ? DEFENDERS[d.type].name : d.type, cx, cy + S * 0.26);
                if (d.attackFlash > 0) {
                    d.attackFlash = Math.max(0, d.attackFlash - 0.05);
                    ctx.save();
                    ctx.globalAlpha = d.attackFlash;
                    ctx.fillStyle = '#fff';
                    ctx.beginPath(); ctx.arc(cx, cy, S * 0.5, 0, Math.PI * 2); ctx.fill();
                    ctx.restore();
                }
                ctx.restore();
                return;
            }
            if (d.type === '骑') {
                if (d.qiFlag) { d.qiFlag.update(); d.qiFlag.drawAt(ctx, cx, cy); }
            } else if (d.type === '枪') {
                // 原DOM：木(mu)与仓(cang)并排横置，cang translate(-2px,6px)
                const mu = _img['mu'], cang = _img['cang'];
                const sc = S * 0.0224; // 整体缩放（0.028 × 0.8 = 缩小20%）
                const mw = 16 * sc, mh = 39 * sc;
                const cw = 16 * sc, ch = 31 * sc;
                const totalW = mw + cw - 2 * sc;
                const sx = cx - totalW / 2;
                if (mu) ctx.drawImage(mu, sx, cy - mh / 2, mw, mh);
                if (cang) ctx.drawImage(cang, sx + mw - 2 * sc, cy - ch / 2 + 6 * sc, cw, ch);
            } else if (d.type === '刀') {
                const im = _img['dao'] || _img['daobing'];
                if (im) { const w = S * 1.1, h = S * 1.1; ctx.drawImage(im, cx - w / 2, cy - h / 2, w, h); }
                else { ctx.fillStyle = '#ddd'; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('刀', cx, cy); }
            } else if (d.type === '弓') {
                const im = _img['gong'] || _img['gong2'];
                if (im) { const w = S * 1.0, h = S * 1.2; ctx.drawImage(im, cx - w / 2, cy - h / 2, w, h); }
                else { ctx.fillStyle = '#ddc'; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('弓', cx, cy); }
            }
            // 已合成武将：叠加姓名金标
            if (d.generalName) {
                ctx.save();
                ctx.fillStyle = '#f5d77a';
                ctx.font = 'bold 12px "STKaiti", serif';
                ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
                ctx.shadowBlur = 3; ctx.shadowColor = 'rgba(0,0,0,0.8)';
                ctx.fillText(d.generalName, cx, cy - S * 0.42);
                ctx.restore();
            }
            // 攻击闪白
            if (d.attackFlash > 0) {
                d.attackFlash = Math.max(0, d.attackFlash - 0.05);
                ctx.save();
                ctx.globalAlpha = d.attackFlash;
                ctx.fillStyle = '#fff';
                ctx.beginPath(); ctx.arc(cx, cy, S * 0.5, 0, Math.PI * 2); ctx.fill();
                ctx.restore();
            }
            // 等级角标
            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            const tw = S * 0.44, th = S * 0.32;
            const lx = cx + S * 0.16, ly = cy - S * 0.42;
            ctx.fillRect(lx, ly, tw, th);
            ctx.fillStyle = '#ffd24a';
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('Lv' + d.level, lx + tw / 2, ly + th / 2);
            ctx.restore();
        }

        drawProjectile(ctx, p) {
            const S = CELL;
            const x = p.x * S + S / 2, y = p.y * S + S / 2;
            if (p.defType === '枪') {
                const mu = _img['mu'];
                const ang = Math.atan2(p.target.y - p.y, p.target.x - p.x) + Math.PI / 2;
                ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
                if (mu) ctx.drawImage(mu, -S * 0.1, -S * 0.4, S * 0.2, S * 0.8);
                else { ctx.fillStyle = '#cba'; ctx.fillRect(-2, -S * 0.4, 4, S * 0.8); }
                ctx.restore();
            } else if (p.defType === '弓') {
                const ang = Math.atan2(p.target.y - p.y, p.target.x - p.x);
                ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
                ctx.strokeStyle = '#eee'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(-S * 0.3, 0); ctx.lineTo(S * 0.3, 0); ctx.stroke();
                ctx.restore();
            } else {
                ctx.fillStyle = '#ffec8b';
                ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
            }
        }

        drawInfoBox(ctx, d) {
            const S = CELL;
            const stats = this.getEffectiveStats(d);
            const cx = d.c * S + S / 2, cy = d.r * S;
            const lines = [
                `${d.generalName ? d.generalName : DEFENDERS[d.type].name} · Lv${d.level}`,
                `攻击 ${stats.damage.toFixed(1)}  范围 ${stats.range}`,
                `频率 ${(1 / stats.atkInterval).toFixed(2)}/s`
            ];
            if (d.generalName) lines.push(`技能 ${SKILL_NAME[d.skill]}`);
            ctx.save();
            ctx.font = '11px sans-serif';
            let w = 0; for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
            w += 12; const h = lines.length * 14 + 8;
            let bx = cx - w / 2, by = cy - h - 6;
            if (by < 0) by = cy + S * 0.5;
            ctx.fillStyle = 'rgba(0,0,0,0.78)';
            ctx.fillRect(bx, by, w, h);
            ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
            lines.forEach((l, i) => ctx.fillText(l, bx + 6, by + 4 + i * 14));
            ctx.restore();
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
                        this.grid[r][c] = TILE.CLEARED;   // drawFrame 会按 grid 重绘地块
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
        drag: null,
        result: null,
        generalPool: [],            // 武将碎片剩余池（每局重置）
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
        constructor(size = 160) {
            this.size = size;
            this.initialAngle = -10;     // 旗枪初始微抬角度
            this.angle = this.initialAngle;
            this.targetAngle = this.initialAngle;
            this.state = 'IDLE';
            this.widthScale = 1;
            this.heightScale = 1;
            this.shake = 0;
            this.canvas = null;
            this.ctx = null;
            this._layout();
        }
        _layout() {
            const S = this.size;
            this.baseW = S * 0.28;   // 旗杆显示宽
            this.baseH = S * 0.30;   // 旗杆显示高
            this.flagW = S;          // 旗面基础宽（×4 后仍可容纳）
            this.flagH = this.flagW * 72 / 822 * 8;   // 旗面高度加倍
            this.pivotX = S / 2;
            this.pivotY = S * 0.36;  // 旗杆顶部（旗面挂载点）
        }
        attach(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            _qiFlags.push(this);
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
        // 推进挥砍动画状态（每帧调用，与是否挂载到 DOM 无关）
        update() {
            if (this.state !== 'ATTACK') return;
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
        // 在本地坐标系（以 size×size 方框左上角为原点）绘制旗枪
        _drawShape(ctx) {
            if (!_qiImgCache.base || !_qiImgCache.flag) return;
            let sx = 0, sy = 0;
            if (this.shake > 0.3) {
                sx = (Math.random() - 0.5) * this.shake;
                sy = (Math.random() - 0.5) * this.shake;
                this.shake *= 0.85;
            } else { this.shake = 0; }
            ctx.drawImage(_qiImgCache.base, this.pivotX - this.baseW / 2 + sx, this.pivotY + sy, this.baseW, this.baseH);
            const fw = this.flagW * this.widthScale;
            const fh = this.flagH * this.heightScale;
            ctx.save();
            ctx.translate(this.pivotX + sx, this.pivotY + sy + this.size * 0.072);
            ctx.rotate(this.angle * Math.PI / 180);
            ctx.drawImage(_qiImgCache.flag, 0, -fh / 2, fw, fh);
            ctx.restore();
        }
        // 征兵卡牌：绘制到自身 canvas
        renderCard() {
            if (!this.ctx) return;
            this.ctx.clearRect(0, 0, this.size, this.size);
            this._drawShape(this.ctx);
        }
        // 战场：以 (cx, cy) 为方框中心绘制
        drawAt(ctx, cx, cy) {
            ctx.save();
            ctx.translate(cx - this.size / 2, cy - this.size / 2);
            this._drawShape(ctx);
            ctx.restore();
        }
    }

    // 共享渲染循环：驱动征兵卡牌的旗枪 canvas（自动剔除已脱离 DOM 的实例）
    const _qiFlags = [];
    function _qiRenderLoop() {
        for (let i = _qiFlags.length - 1; i >= 0; i--) {
            const qf = _qiFlags[i];
            if (!qf.canvas || !qf.canvas.isConnected) { _qiFlags.splice(i, 1); continue; }
            qf.update();
            qf.renderCard();
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
            game.leftBF.updateSkillFx(dt);
            game.rightBF.updateSkillFx(dt);
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

    // ─────────── 坐标换算 / 格子命中 ───────────
    function canvasPoint(canvas, evt) {
        const rect = canvas.getBoundingClientRect();
        const sx = canvas.width / rect.width;
        const sy = canvas.height / rect.height;
        return { x: (evt.clientX - rect.left) * sx, y: (evt.clientY - rect.top) * sy };
    }
    function cellAt(bf, x, y) {
        const c = Math.floor(x / CELL), r = Math.floor(y / CELL);
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
        return { r, c };
    }

    // 卡牌拖到战场某格是否合法（用于拖拽高亮与落地判定）
        function cardDropValid(bf, card, r, c) {
            if (card.type === 'shovel') return bf.grid[r][c] === TILE.LOCKED;
            if (card.type === 'general') {
                const existing = bf.getDefenderAt(r, c);
                if (existing && existing.isFragment) return !!comboFor(card.char, existing.char); // 可叠合成
                return bf.grid[r][c] === TILE.CLEARED && !existing; // 仅空开垦地
            }
            const existing = bf.getDefenderAt(r, c);
        if (existing) return true; // 同类同级→升级 / 异型异级→换位
            return bf.grid[r][c] === TILE.CLEARED; // 仅空的开垦地可落
        }

        // 从武将碎片池随机抽一个（抽后即从池中移除，保证不重复超出数量）
        function drawGeneral() {
            const pool = game.generalPool;
            if (!pool || pool.length === 0) return null;
            const i = Math.floor(Math.random() * pool.length);
            return pool.splice(i, 1)[0];
        }

        // 合成武将：在 (r,c) 放置一个已成形武将（按 weapon 类型攻击，等级 3 强度）
        function formGeneralAt(bf, r, c, combo) {
            bf.placeDefender(r, c, combo.weapon, 3);
            const d = bf.getDefenderAt(r, c);
            if (d) {
                d.isGeneral = true;
                d.generalName = combo.name;
                d.skill = combo.skill;
                d.char = null;
                d.skillCd = d.skillCdMax = SKILL_CD[d.skill] || 0;
                d.leapCharges = 0;
            }
            return d;
        }

        // 碎片落位/移动后，仅检测"左右相邻"且严格 左=a、右=b 的合成（上下、右左均不合成）
        function tryCombineAround(bf, r, c) {
            const d = bf.getDefenderAt(r, c);
            if (!d || !d.isFragment) return false;
            // 情形1：当前碎片是左片(a)，右侧是它的右片(b)
            const right = bf.getDefenderAt(r, c + 1);
            if (right && right.isFragment) {
                const combo = comboForExact(d.char, right.char);
                if (combo) {
                    bf.removeDefender(right);
                    bf.removeDefender(d);
                    formGeneralAt(bf, r, c, combo);
                    bf.showFloat(c, r, combo.name + ' 现！', 'crit');
                    return true;
                }
            }
            // 情形2：当前碎片是右片(b)，左侧是它的左片(a)
            const left = bf.getDefenderAt(r, c - 1);
            if (left && left.isFragment) {
                const combo = comboForExact(left.char, d.char);
                if (combo) {
                    bf.removeDefender(d);
                    bf.removeDefender(left);
                    formGeneralAt(bf, r, c - 1, combo);
                    bf.showFloat(c - 1, r, combo.name + ' 现！', 'crit');
                    return true;
                }
            }
            return false;
        }

        // 选中的卡牌点击落点部署（合并 / 换位 / 清地）
    function placeSelectedCard(bf, r, c) {
        const card = game.selectedCard;
        if (!card) return;
        if (card.type === 'shovel') {
            if (bf.grid[r][c] === TILE.LOCKED) {
                bf.grid[r][c] = TILE.CLEARED;
                bf.useCard(card.idx);
                game.selectedCard = null;
                bf.renderCards();
            }
            return;
        }
        if (card.type === 'general') {
            const existingDef = bf.getDefenderAt(r, c);
            if (existingDef && existingDef.isFragment) {
                const combo = comboFor(card.char, existingDef.char);
                if (combo) {
                    bf.removeDefender(existingDef);
                    formGeneralAt(bf, r, c, combo);
                    bf.useCard(card.idx);
                    game.selectedCard = null;
                    bf.renderCards();
                    bf.showFloat(c, r, combo.name + ' 现！', 'crit');
                }
            } else if (bf.grid[r][c] === TILE.CLEARED && !existingDef) {
                bf.placeDefender(r, c, 'general', 1, card.char);
                bf.useCard(card.idx);
                game.selectedCard = null;
                bf.renderCards();
                tryCombineAround(bf, r, c);
            }
            return;
        }
        const existingDef = bf.getDefenderAt(r, c);
        if (existingDef && existingDef.type === card.type && existingDef.level === card.level && existingDef.level < 5) {
            bf.levelUpDefender(existingDef);
            bf.showFloat(c, r, 'Lv' + existingDef.level, 'crit');
            bf.useCard(card.idx);
            game.selectedCard = null;
            bf.renderCards();
        } else if (existingDef) {
            // 已占用且不可合并 → 卡牌上场，被挤下的士兵退回卡牌槽（used=false），等效换位
            const displaced = { type: existingDef.type, level: existingDef.level, used: false };
            bf.removeDefender(existingDef);
            bf.placeDefender(r, c, card.type, card.level);
            bf.cards[card.idx] = displaced;
            game.selectedCard = null;
            bf.renderCards();
            bf.showFloat(c, r, '换位', 'crit');
        } else if (bf.grid[r][c] === TILE.CLEARED && !existingDef) {
            bf.placeDefender(r, c, card.type, card.level);
            bf.useCard(card.idx);
            game.selectedCard = null;
            bf.renderCards();
        }
    }

    // ─────────── 拖动移动士兵（左半战场）───────────
    function onPointerDown(e) {
        const bf = game.leftBF;
        if (!bf || !bf.canvas) return;
        if (e.target !== bf.canvas) return;   // 只响应左战场画布（避免点到右侧敌营误触）
        const p = canvasPoint(bf.canvas, e);
        const cell = cellAt(bf, p.x, p.y);
        if (!cell) { bf.clearDefenderSelectionVisuals(); game.selectedDefender = null; return; }
        const { r, c } = cell;

        // 情况 1：已选卡牌 → 放置 / 合成（点击即生效）
        if (game.selectedCard) {
            placeSelectedCard(bf, r, c);
            return;
        }

        // 情况 2：点中已放置士兵 → 起拖
        const d = bf.getDefenderAt(r, c);
        if (d) {
            game.drag = { d, sx: p.x, sy: p.y, mx: p.x, my: p.y, moved: false };
            d.dragging = true;
            bf.clearDefenderSelectionVisuals();
            game.selectedDefender = null;
        }
    }

    function onPointerMove(e) {
        // 卡牌拖拽上场（优先于士兵拖动判定）
        if (game.cardDrag && !game.drag) {
            const bf = game.leftBF;
            if (bf && bf.canvas) {
                const p = canvasPoint(bf.canvas, e);
                game.cardDrag.mx = p.x; game.cardDrag.my = p.y;
            }
            const dx = e.clientX - game.cardDrag.startX, dy = e.clientY - game.cardDrag.startY;
            if (Math.hypot(dx, dy) > 5) game.cardDrag.moved = true;
            return;
        }
        if (!game.drag) return;
        const bf = game.leftBF;
        if (!bf || !bf.canvas) return;
        const p = canvasPoint(bf.canvas, e);
        game.drag.mx = p.x; game.drag.my = p.y;
        const dx = p.x - game.drag.sx, dy = p.y - game.drag.sy;
        if (Math.hypot(dx, dy) > 5) game.drag.moved = true;
    }

    function onPointerUp() {
        // 卡牌拖拽上场落地
        if (game.cardDrag && !game.drag) {
            const cd = game.cardDrag;
            game.cardDrag = null;
            if (!cd.moved) return; // 纯点击 → 交给 click 处理选中
            const cell = (cd.bf && cd.bf.canvas) ? cellAt(cd.bf, cd.mx, cd.my) : null;
            if (cell) {
                game.selectedCard = { type: cd.type, level: cd.level, idx: cd.idx, bf: cd.bf, char: cd.card ? cd.card.char : null };
                placeSelectedCard(cd.bf, cell.r, cell.c);
            }
            game.selectedCard = null;
            game._justDragged = true; // 抑制随后触发的 click 选中
            return;
        }
        if (!game.drag) return;
        const drag = game.drag;
        const d = drag.d;
        const bf = game.leftBF;
        game.drag = null;
        d.dragging = false;

        // 纯点击（未拖动）→ 选中并展示射程/信息
        if (!drag.moved) {
            if (game.selectedDefender && game.selectedDefender.defender === d) {
                game.selectedDefender = null;            // 再次点击取消
                bf.clearDefenderSelectionVisuals();
            } else {
                game.selectedDefender = { defender: d, r: d.r, c: d.c };
                bf.showDefenderRange(d);
                bf.showDefenderInfo(d);
            }
            return;
        }

        // 拖动 → 落点判定
        const cell = bf.canvas ? cellAt(bf, drag.mx, drag.my) : null;
        if (!cell) return;                               // 落到棋盘外 → 弹回
        const { r: r2, c: c2 } = cell;
        if (r2 === d.r && c2 === d.c) return;            // 原地

        const target = bf.getDefenderAt(r2, c2);
        if (!target && bf.grid[r2][c2] === TILE.CLEARED) {
            // 移动到空格
            d.r = r2; d.c = c2;
            tryCombineAround(bf, r2, c2);  // 移动后检测相邻合成
        } else if (d.isFragment && target && target.isFragment) {
            // 碎片拖到碎片上：可合成则合成，否则弹回
            const combo = comboFor(d.char, target.char);
            if (combo) {
                bf.removeDefender(target);
                bf.removeDefender(d);
                formGeneralAt(bf, r2, c2, combo);
                bf.showFloat(c2, r2, combo.name + ' 现！', 'crit');
            }
        } else if (target && target !== d && target.type === d.type && target.level === d.level && target.level < 5) {
            // 同型同级 → 合成升级（拖入的被消耗）
            bf.levelUpDefender(target);
            bf.showFloat(c2, r2, 'Lv' + target.level, 'crit');
            bf.removeDefender(d);
        } else if (target && target !== d) {
            // 异型/异级 → 交换位置
            const tr = d.r, tc = d.c;
            d.r = target.r; d.c = target.c;
            target.r = tr; target.c = tc;
        }
        // 其它（荒地 / 敌营 / 阿斗 / 非法）→ 弹回原位
        bf.clearDefenderSelectionVisuals();
        game.selectedDefender = null;
    }

    arenaEl.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

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

        // 武将碎片池：每局重置
        game.generalPool = GENERAL_POOL.slice();

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
        game.drag = null;
        game.aiTimer = 1;
        pauseBtn.textContent = '⏸';
        resultEl.classList.add('hidden');
        updateGrainDisplay();
        // 先画一帧空棋盘，启动前也能看到布局
        game.leftBF.drawFrame();
        game.rightBF.drawFrame();
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
