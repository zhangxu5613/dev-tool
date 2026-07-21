(function () {
  var DAY_MS = 86400000;
  var DAY_OVERRIDE_PREFIX = "zyyadGmDayOverride:";
  var AVATAR_COUNT = 16;
  var WEAPON_COPY_COUNT = 32;
  var DEFAULT_DATA = {
    _nick: "",
    _gameAvatar: 1,
    _avatarUrl: "",
    _province: "",
    _registerTime: Date.now(),
    _saveTime: Date.now(),
    _gold: 0,
    _win: 0,
    _lose: 0,
    _weaponFragments: [],
    _equip: [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
    _isGetLastRankReward: 0,
    _props: [],
    _winDay: 0,
    _loseDay: 0,
    _lastLoseDifficulty: 0,
    _setting: { showDamageNum: true, musicVolume: 1, soundVolume: 1 },
    _openProps: false,
    _lowPrProps: [],
    _stamina: 30,
    _lastRecoverStaminaTime: Date.now(),
    _staminaAdCountToday: 0,
    _lastShareStaminaTime: 0,
    _staminaShareCountToday: 0,
    _winStreak: 0,
    _consecutiveLoginDays: 1,
    _weaponFree: false,
    _hasUsedFreeShovel: false,
    _hasUsedFreeBulldozer: false,
    _isAdFreeUser: false,
    _newWeaponIds: [],
    _avatarUnlocks: [1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0],
    _sidebarState: 0,
    _followDouyinState: 0,
    _hasPlacedActivePropThisBattle: false,
    _weaponSceneDragGuideDone: false,
    _curStar: 1,
    _rankCorrected: 1,
    _lastStar: 0,
    _mergedGenerals: []
  };

  function ready(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback);
    } else {
      callback();
    }
  }

  function readData() {
    var raw = localStorage.getItem("playerData");
    var data;
    if (!raw) {
      data = clone(DEFAULT_DATA);
      return applyDayOverride(data);
    }

    try {
      data = Object.assign(clone(DEFAULT_DATA), JSON.parse(raw));
      return applyDayOverride(data);
    } catch (error) {
      console.warn("[local] playerData parse failed, using default", error);
      data = clone(DEFAULT_DATA);
      return applyDayOverride(data);
    }
  }

  function writeData(data, reload) {
    applyDayOverride(data);
    data._saveTime = Date.now();
    var serialized = JSON.stringify(data);
    if (window.__ZYYAD_AUTH && typeof window.__ZYYAD_AUTH.withoutSaveSync === "function") {
      window.__ZYYAD_AUTH.withoutSaveSync(function () {
        localStorage.setItem("playerData", serialized);
      });
    } else {
      localStorage.setItem("playerData", serialized);
    }
    applyRuntimeData(data);
    showToast(reload ? "保存中，正在同步云端..." : "已保存，正在同步云端...");

    cloudSave(serialized).then(function () {
      showToast(reload ? "云端已保存，正在刷新" : "云端已保存");
      if (reload) {
        setTimeout(function () {
          location.reload();
        }, 120);
      }
    }).catch(function () {
      showToast(reload ? "本地已保存，云同步失败，稍后刷新" : "本地已保存，云同步失败");
      if (reload) {
        setTimeout(function () {
          location.reload();
        }, 900);
      }
    });
  }

  function cloudSave(serialized) {
    if (window.__ZYYAD_AUTH && window.__ZYYAD_AUTH.gmAuthorized === true && typeof window.__ZYYAD_AUTH.saveNow === "function") {
      return window.__ZYYAD_AUTH.saveNow(serialized, { gmWrite: true });
    }
    return fetch("/api/save", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerData: serialized, gmWrite: true })
    }).then(function (response) {
      if (!response.ok) {
        throw new Error("save failed");
      }
      return response.json().catch(function () {
        return {};
      });
    });
  }

  function applyRuntimeData(data) {
    if (window.__gmSetGold && typeof data._gold === "number") {
      try {
        window.__gmSetGold(data._gold);
      } catch (error) {}
    }
    if (window.__gmSetStamina && typeof data._stamina === "number") {
      try {
        window.__gmSetStamina(data._stamina);
      } catch (error) {}
    }
    if (window.__gmApplyFlags) {
      try {
        window.__gmApplyFlags(data);
      } catch (error) {}
    }
    if (window.__gmApplyRank) {
      try {
        window.__gmApplyRank(data);
      } catch (error) {}
    }
    if (window.__gmApplyWeapons) {
      try {
        window.__gmApplyWeapons(data);
      } catch (error) {}
    }
    if (window.__gmApplyAvatar) {
      try {
        window.__gmApplyAvatar(data);
      } catch (error) {}
    }
    window.__gmLastSavedPlayerData = data;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function intValue(id, fallback) {
    var input = document.getElementById(id);
    var value = parseInt(input && input.value, 10);
    return Number.isFinite(value) ? value : fallback;
  }

  function boolValue(id) {
    var input = document.getElementById(id);
    return !!(input && input.checked);
  }

  function setDay(data, day) {
    var normalized = Math.max(1, day || 1);
    saveDayOverride(normalized);
    applyDayFields(data, normalized);
  }

  function getDay(data) {
    var registerDay = Math.max(1, Math.floor((Date.now() - (data._registerTime || Date.now())) / DAY_MS) + 1);
    return Math.max(registerDay, Number(data._consecutiveLoginDays) || 1, getDayOverride());
  }

  function applyDayFields(data, day) {
    var normalized = Math.max(1, day || 1);
    data._registerTime = Date.now() - (normalized - 1) * DAY_MS;
    data._consecutiveLoginDays = normalized;
    return data;
  }

  function dayOverrideKey() {
    var user = "";
    try {
      user = window.__ZYYAD_AUTH && window.__ZYYAD_AUTH.user && window.__ZYYAD_AUTH.user.username;
    } catch (error) {}
    user = user || localStorage.getItem("zyyadActiveUser") || "guest";
    return DAY_OVERRIDE_PREFIX + user;
  }

  function getDayOverride() {
    var value = parseInt(localStorage.getItem(dayOverrideKey()), 10);
    return Number.isFinite(value) && value > 1 ? value : 0;
  }

  function saveDayOverride(day) {
    var normalized = Math.max(1, day || 1);
    if (normalized > 1) {
      localStorage.setItem(dayOverrideKey(), String(normalized));
    } else {
      localStorage.removeItem(dayOverrideKey());
    }
  }

  function applyDayOverride(data) {
    var override = getDayOverride();
    if (override > 1) {
      applyDayFields(data, override);
    }
    return data;
  }

  function enforceDayOverrideString(value) {
    var override = getDayOverride();
    if (override <= 1) {
      return value;
    }
    try {
      var data = JSON.parse(String(value || ""));
      applyDayFields(data, override);
      return JSON.stringify(data);
    } catch (error) {
      return value;
    }
  }

  function installDayOverrideSync() {
    if (!window.Storage || !window.localStorage || Storage.prototype.__gmDayOverridePatched) {
      return;
    }
    var originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === window.localStorage && String(key) === "playerData") {
        value = enforceDayOverrideString(value);
      }
      return originalSetItem.call(this, key, value);
    };
    Storage.prototype.__gmDayOverridePatched = true;
  }

  function enforceStoredDayOverride() {
    var override = getDayOverride();
    var raw = localStorage.getItem("playerData");
    if (override <= 1 || !raw) {
      return;
    }
    try {
      var data = JSON.parse(raw);
      var registerDay = Math.max(1, Math.floor((Date.now() - (data._registerTime || Date.now())) / DAY_MS) + 1);
      if (registerDay >= override && Number(data._consecutiveLoginDays) === override) {
        return;
      }
      applyDayFields(data, override);
      var serialized = JSON.stringify(data);
      localStorage.setItem("playerData", serialized);
      cloudSave(serialized).catch(function () {});
    } catch (error) {}
  }

  function field(label, id, value, type) {
    return (
      '<label class="gm-field"><span>' + label + '</span>' +
      '<input id="' + id + '" type="' + (type || "number") + '" value="' + value + '">' +
      '</label>'
    );
  }

  function check(label, id, checked) {
    return (
      '<label class="gm-check"><input id="' + id + '" type="checkbox" ' +
      (checked ? "checked" : "") + "><span>" + label + "</span></label>"
    );
  }

  function renderPanel() {
    var data = readData();
    var panel = document.getElementById("local-gm-panel");
    if (panel) {
      panel.remove();
      return;
    }

    panel = document.createElement("div");
    panel.id = "local-gm-panel";
    panel.innerHTML = [
      '<div class="gm-head"><strong>GM 工具箱</strong><button id="gm-close">×</button></div>',
      '<div class="gm-grid">',
      field("金币", "gm-gold", data._gold || 0),
      field("体力", "gm-stamina", data._stamina || 0),
      field("天数", "gm-day", getDay(data)),
      field("星级/段位", "gm-star", data._curStar || 1),
      field("胜场", "gm-win", data._win || 0),
      field("败场", "gm-lose", data._lose || 0),
      field("连胜", "gm-win-streak", data._winStreak || 0),
      field("头像ID", "gm-avatar", data._gameAvatar || 1),
      "</div>",
      '<div class="gm-checks">',
      check("开启道具", "gm-open-props", !!data._openProps),
      check("免广告", "gm-ad-free", !!data._isAdFreeUser),
      check("武器免费", "gm-weapon-free", !!data._weaponFree),
      check("保存后刷新", "gm-reload", true),
      "</div>",
      '<div class="gm-actions">',
      '<button id="gm-save">保存参数</button>',
      '<button id="gm-gold-plus">金币 +1000</button>',
      '<button id="gm-stamina-plus">体力 +100</button>',
      '<button id="gm-unlock-weapons">武器装备全满</button>',
      '<button id="gm-unlock-generals">武将图鉴全开</button>',
      '<button id="gm-unlock-avatar">解锁头像</button>',
      '<button id="gm-reset-battle">重置战斗限制</button>',
      '<button id="gm-stamina-max">体力拉满</button>',
      '<button id="gm-mantou">战斗满馒头(征兵)</button>',
      '<button id="gm-nocd">征兵/道具无CD：' + (window.__gmNoCd ? "开" : "关") + '</button>',
      '<button id="gm-general-only">只征武将(战斗中)：' + (window.__gmGeneralOnly ? "开" : "关") + '</button>',
      '<button id="gm-adou-invincible">阿斗无敌(战斗不掉血)：' + (window.__gmAdouInvincible ? "开" : "关") + '</button>',
      '<button id="gm-enemy-adou-invincible">敌斗无敌(锁对方阿斗)：' + (window.__gmEnemyAdouInvincible ? "开" : "关") + '</button>',
      '<button id="gm-auto">自动托管(合成)：' + (window.__gmAutoTimer ? "开" : "关") + '</button>',
      '<button id="gm-logout">退出登录/换号</button>',
      '<button id="gm-hide-ball">隐藏球(收到边上)</button>',
      "</div>"
    ].join("");

    document.body.appendChild(panel);
    bindPanel(panel);
  }

  function collectForm() {
    var data = readData();
    data._gold = intValue("gm-gold", data._gold || 0);
    data._stamina = intValue("gm-stamina", data._stamina || 0);
    data._curStar = Math.max(1, intValue("gm-star", data._curStar || 1));
    data._lastStar = Math.max(0, data._curStar - 1);
    data._rankCorrected = 1;
    data._win = intValue("gm-win", data._win || 0);
    data._lose = intValue("gm-lose", data._lose || 0);
    data._winDay = data._win;
    data._loseDay = data._lose;
    data._winStreak = intValue("gm-win-streak", data._winStreak || 0);
    data._gameAvatar = intValue("gm-avatar", data._gameAvatar || 1);
    data._openProps = boolValue("gm-open-props");
    data._isAdFreeUser = boolValue("gm-ad-free");
    data._weaponFree = boolValue("gm-weapon-free");
    data._lastRecoverStaminaTime = Date.now();
    setDay(data, intValue("gm-day", getDay(data)));
    return data;
  }

  function bindPanel(panel) {
    panel.querySelector("#gm-close").onclick = renderPanel;
    panel.querySelector("#gm-save").onclick = function () {
      writeData(collectForm(), boolValue("gm-reload"));
    };
    panel.querySelector("#gm-gold-plus").onclick = function () {
      var data = collectForm();
      data._gold = Math.max(0, Number(data._gold || 0) + 1000);
      document.getElementById("gm-gold").value = data._gold;
      writeData(data, false);
    };
    panel.querySelector("#gm-stamina-plus").onclick = function () {
      var data = collectForm();
      data._stamina = Math.max(0, Number(data._stamina || 0) + 100);
      data._lastRecoverStaminaTime = Date.now();
      document.getElementById("gm-stamina").value = data._stamina;
      writeData(data, false);
    };
    panel.querySelector("#gm-stamina-max").onclick = function () {
      var data = collectForm();
      data._stamina = 999999999;
      data._lastRecoverStaminaTime = Date.now();
      document.getElementById("gm-stamina").value = data._stamina;
      writeData(data, false);
    };
    panel.querySelector("#gm-mantou").onclick = function () {
      if (window.__gmSetGold && window.__gmSetGold(999999999)) {
        showToast("馒头已拉满 (999999999)");
      } else {
        showToast("请在战斗中点");
      }
    };
    panel.querySelector("#gm-nocd").onclick = function () {
      window.__gmNoCd = !window.__gmNoCd;
      if (window.__gmNoCd && window.__gmSetGold) {
        window.__gmSetGold(999999999);
      }
      this.textContent = "征兵/道具无CD：" + (window.__gmNoCd ? "开" : "关");
      showToast(window.__gmNoCd ? "已开启无CD" : "已关闭无CD");
    };
    panel.querySelector("#gm-general-only").onclick = function () {
      window.__gmGeneralOnly = !window.__gmGeneralOnly;
      if (window.__gmSetGeneralsOnly) {
        window.__gmSetGeneralsOnly(window.__gmGeneralOnly);
      }
      this.textContent = "只征武将(战斗中)：" + (window.__gmGeneralOnly ? "开" : "关");
      showToast(window.__gmGeneralOnly ? "已开启只征武将" : "已关闭只征武将");
    };
    panel.querySelector("#gm-adou-invincible").onclick = function () {
      window.__gmAdouInvincible = !window.__gmAdouInvincible;
      if (window.__gmSetAdouInvincible) {
        window.__gmSetAdouInvincible(window.__gmAdouInvincible);
      }
      this.textContent = "阿斗无敌(战斗不掉血)：" + (window.__gmAdouInvincible ? "开" : "关");
      showToast(window.__gmAdouInvincible ? "已开启阿斗无敌" : "已关闭阿斗无敌");
    };
    panel.querySelector("#gm-enemy-adou-invincible").onclick = function () {
      window.__gmEnemyAdouInvincible = !window.__gmEnemyAdouInvincible;
      if (window.__gmSetEnemyAdouInvincible) {
        window.__gmSetEnemyAdouInvincible(window.__gmEnemyAdouInvincible);
      }
      this.textContent = "敌斗无敌(锁对方阿斗)：" + (window.__gmEnemyAdouInvincible ? "开" : "关");
      showToast(window.__gmEnemyAdouInvincible ? "已锁定敌方阿斗" : "已解除敌方阿斗锁定");
    };
    panel.querySelector("#gm-auto").onclick = function () {
      var on = !window.__gmAutoTimer;
      if (window.__gmAutoBattle) {
        window.__gmAutoBattle(on);
        this.textContent = "自动托管(合成)：" + (window.__gmAutoTimer ? "开" : "关");
        showToast(window.__gmAutoTimer ? "已开启自动托管" : "已关闭自动托管");
      } else {
        showToast("请进入战斗后再开");
      }
    };
    panel.querySelector("#gm-logout").onclick = function () {
      if (window.__ZYYAD_AUTH && typeof window.__ZYYAD_AUTH.logout === "function") {
        window.__ZYYAD_AUTH.logout();
      } else {
        location.href = "gameIndex.html?logout=1";
      }
    };
    panel.querySelector("#gm-hide-ball").onclick = function () {
      if (window.__gmHideBall) {
        window.__gmHideBall();
      }
    };
    panel.querySelector("#gm-unlock-avatar").onclick = function () {
      var data = collectForm();
      data._avatarUnlocks = Array(AVATAR_COUNT).fill(1);
      writeData(data, boolValue("gm-reload"));
    };
    panel.querySelector("#gm-reset-battle").onclick = function () {
      var data = collectForm();
      data._hasUsedFreeShovel = false;
      data._hasUsedFreeBulldozer = false;
      data._hasPlacedActivePropThisBattle = false;
      data._staminaAdCountToday = 0;
      data._staminaShareCountToday = 0;
      writeData(data, boolValue("gm-reload"));
    };
    panel.querySelector("#gm-unlock-weapons").onclick = unlockWeapons;
    panel.querySelector("#gm-unlock-generals").onclick = unlockGenerals;
  }

  function unlockWeapons() {
    fetch("data/weapon.json")
      .then(function (response) {
        return response.json();
      })
      .then(function (weapons) {
        weapons = weapons.slice().sort(function (a, b) {
          return a.id - b.id;
        });

        var data = collectForm();
        data._weaponFragments = weapons.map(function (weapon) {
          return [weapon.id, Math.max(weapon.fragmentNum || 1, 1) * WEAPON_COPY_COUNT];
        });
        data._equip = buildRecommendedEquip(weapons);
        data._newWeaponIds = [];
        data._weaponFree = true;
        data._weaponSceneDragGuideDone = true;
        var weaponFree = document.getElementById("gm-weapon-free");
        if (weaponFree) {
          weaponFree.checked = true;
        }
        writeData(data, boolValue("gm-reload"));
      })
      .catch(function () {
        showToast("读取 weapon.json 失败");
      });
  }

  function unlockGenerals() {
    var data = collectForm();
    data._mergedGenerals = range(12);
    writeData(data, boolValue("gm-reload"));
  }

  function buildRecommendedEquip(weapons) {
    var preferredWeaponIds = [7, 8, 9, 18, 19, 29, 30, 40, 41, 42, 43, 17];
    var equip = [];
    var weaponIds = weapons.map(function (weapon) {
      return weapon.id;
    });

    preferredWeaponIds.forEach(function (weaponId) {
      if (weaponIds.indexOf(weaponId) >= 0) {
        equip.push(weaponId);
      }
    });

    while (equip.length < 12) {
      equip.push(-1);
    }

    return equip.slice(0, 12);
  }

  function range(count) {
    return Array.from({ length: count }, function (_, index) {
      return index;
    });
  }

  function findByName(node, name) {
    if (!node) {
      return null;
    }
    if (node.name === name) {
      return node;
    }

    var count = node.numChildren || 0;
    for (var i = 0; i < count; i += 1) {
      var found = findByName(node.getChildAt(i), name);
      if (found) {
        return found;
      }
    }
    return null;
  }

  function closeNativeGM(target) {
    var scene = target || window.__activeGMScene;
    if (!scene || scene.destroyed) {
      window.__activeGMScene = null;
      return;
    }

    if (typeof scene.removeSelf === "function") {
      scene.removeSelf();
    }
    if (typeof scene.destroy === "function") {
      scene.destroy(true);
    }
    if (window.__activeGMScene === scene) {
      window.__activeGMScene = null;
    }
  }

  function wireNativeClose(scene) {
    var xButton = scene && (scene.xBtn || findByName(scene, "xBtn"));
    if (!xButton || xButton.__localGMCloseBound) {
      return;
    }

    xButton.__localGMCloseBound = true;
    xButton.on(Laya.Event.CLICK, null, function () {
      closeNativeGM(scene);
    });
  }

  function openNativeGM() {
    if (!window.Laya || !Laya.Scene) {
      return;
    }

    if (window.__activeGMScene && !window.__activeGMScene.destroyed) {
      closeNativeGM(window.__activeGMScene);
      return;
    }

    Laya.Scene.open("scene/GMScene.ls", false).then(function (scene) {
      window.__activeGMScene = scene;
      wireNativeClose(scene);
    });
  }

  function showToast(text) {
    var toast = document.getElementById("local-gm-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "local-gm-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.className = "show";
    setTimeout(function () {
      toast.className = "";
    }, 1400);
  }

  function gameRect() {
    var canvas = visibleCanvas();
    if (!canvas) {
      return { left: 0, top: 0, right: window.innerWidth, width: window.innerWidth, height: window.innerHeight };
    }

    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return { left: 0, top: 0, right: window.innerWidth, width: window.innerWidth, height: window.innerHeight };
    }

    return rect;
  }

  function visibleCanvas() {
    var canvases = Array.prototype.slice.call(document.querySelectorAll("canvas"));
    var best = null;
    var bestArea = 0;
    for (var i = 0; i < canvases.length; i += 1) {
      var rect = canvases[i].getBoundingClientRect();
      var style = window.getComputedStyle(canvases[i]);
      var area = rect.width * rect.height;
      var onscreen = rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight;
      if (area > bestArea && onscreen && style.display !== "none" && style.visibility !== "hidden") {
        best = canvases[i];
        bestArea = area;
      }
    }
    return best || document.getElementById("layaCanvas") || canvases[0] || null;
  }

  function syncLayout() {
    var rect = gameRect();
    var right = Math.max(10, window.innerWidth - rect.right + 10);
    document.documentElement.style.setProperty("--local-game-right", right + "px");
    document.documentElement.style.setProperty("--local-game-top", Math.max(10, rect.top + 10) + "px");
    document.documentElement.style.setProperty("--local-gm-panel-top", Math.max(54, rect.top + 54) + "px");
    document.documentElement.style.setProperty("--local-gm-panel-max-height", Math.max(220, rect.height - 70) + "px");
    document.documentElement.style.setProperty("--local-gm-panel-width", Math.max(300, Math.min(380, rect.width - 20)) + "px");
  }

  function injectStyle() {
    if (document.getElementById("local-gm-style")) {
      return;
    }
    var style = document.createElement("style");
    style.id = "local-gm-style";
    style.textContent = [
      "#local-gm-button{position:fixed;left:0;top:40%;z-index:2147483647;width:48px;height:48px;display:flex;align-items:center;justify-content:center;border:2px solid rgba(255,255,255,.6);border-radius:50%;background:rgba(20,20,20,.62);color:#ffd76a;font:700 15px Arial,sans-serif;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.42);user-select:none;-webkit-user-select:none;touch-action:none}",
      "#local-gm-panel{position:fixed;right:var(--local-game-right,10px);top:var(--local-gm-panel-top,54px);z-index:2147483647;width:var(--local-gm-panel-width,min(380px,calc(100vw - 20px)));max-height:var(--local-gm-panel-max-height,calc(100vh - 70px));overflow:auto;background:rgba(22,24,28,.96);color:#fff;border:1px solid rgba(255,255,255,.16);border-radius:8px;box-shadow:0 14px 36px rgba(0,0,0,.38);font:14px Arial,'Microsoft YaHei',sans-serif}",
      ".gm-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.12)}.gm-head button{width:30px;height:30px;border:0;border-radius:5px;background:#3a3d44;color:#fff;font-size:20px;cursor:pointer}",
      ".gm-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px}.gm-field span{display:block;margin-bottom:4px;color:#cfd3dc}.gm-field input{box-sizing:border-box;width:100%;height:34px;border:1px solid #4b5260;border-radius:5px;background:#11141a;color:#fff;padding:0 8px;font-size:15px}",
      ".gm-checks{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 12px 10px}.gm-check{display:flex;gap:6px;align-items:center;color:#e4e6eb}.gm-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 12px 12px}.gm-actions button{height:34px;border:0;border-radius:5px;background:#b4472f;color:#fff;font-weight:700;cursor:pointer}.gm-actions button:nth-child(2n){background:#3f6f9f}",
      "#local-gm-toast{position:fixed;left:50%;top:18px;z-index:2147483647;transform:translateX(-50%);background:rgba(0,0,0,.76);color:#fff;padding:8px 12px;border-radius:6px;opacity:0;pointer-events:none;transition:opacity .18s}#local-gm-toast.show{opacity:1}"
    ].join("");
    document.head.appendChild(style);
  }

  ready(function () {
    if (!window.__ZYYAD_AUTH || window.__ZYYAD_AUTH.gmAuthorized !== true) {
      return;
    }
    installDayOverrideSync();
    enforceStoredDayOverride();
    injectStyle();
    syncLayout();
    window.addEventListener("resize", syncLayout);
    setTimeout(syncLayout, 500);
    makeBall();
    setInterval(trackBattleScene, 500);

    window.openGM = renderPanel;
    window.openNativeGM = openNativeGM;
    window.closeGM = closeNativeGM;
  });

  function trackBattleScene() {
    if (!window.Laya || !Laya.stage) {
      return;
    }
    var found = null;
    (function walk(node) {
      if (!node || found) {
        return;
      }
      if ((node.url || node._url || "") === "scene/BattleScene.ls") {
        found = node;
        return;
      }
      var count = node.numChildren || 0;
      for (var i = 0; i < count; i += 1) {
        walk(node.getChildAt(i));
      }
    })(Laya.stage);
    if (found) {
      window.__gmScene = found;
      try {
        if (window.__gmPatchBattleCheats) {
          window.__gmPatchBattleCheats();
        }
        if (window.__gmRefreshAdouLocks) {
          window.__gmRefreshAdouLocks();
        }
      } catch (error) {}
    }
  }

  function makeBall() {
    var ball = document.getElementById("local-gm-button");
    if (ball) {
      return;
    }
    ball = document.createElement("div");
    ball.id = "local-gm-button";
    ball.textContent = "GM";
    ball.title = "GM 工具箱";
    document.body.appendChild(ball);

    var size = 48;
    var state;
    try {
      state = JSON.parse(localStorage.getItem("zyd_gm_ball") || "null");
    } catch (error) {
      state = null;
    }
    if (!state || typeof state.side === "undefined") {
      state = { side: "r", y: 80 };
    }
    var side = state.side === "l" ? "l" : "r";
    var y = state.y || 80;
    var peeked = false;
    var curX = 0;

    function clampY() {
      y = Math.max(4, Math.min(window.innerHeight - size - 4, y));
    }

    function place() {
      clampY();
      var margin = 6;
      if (peeked) {
        curX = side === "l" ? -Math.round(size * 0.55) : window.innerWidth - Math.round(size * 0.45);
        ball.style.opacity = "0.5";
      } else {
        curX = side === "l" ? margin : window.innerWidth - size - margin;
        ball.style.opacity = "1";
      }
      ball.style.left = curX + "px";
      ball.style.top = y + "px";
      ball.style.right = "auto";
    }

    function save() {
      try {
        localStorage.setItem("zyd_gm_ball", JSON.stringify({ side: side, y: y }));
      } catch (error) {}
    }

    window.__gmHideBall = function () {
      peeked = true;
      ball.style.transition = "left .18s ease, top .18s ease, opacity .18s";
      place();
      save();
      var panel = document.getElementById("local-gm-panel");
      if (panel) {
        panel.remove();
      }
    };

    var dragging = false;
    var moved = false;
    var sx = 0;
    var sy = 0;
    var ox = 0;
    var oy = 0;

    function down(event) {
      var point = event.touches ? event.touches[0] : event;
      dragging = true;
      moved = false;
      sx = point.clientX;
      sy = point.clientY;
      ox = curX;
      oy = y;
      ball.style.transition = "none";
      event.preventDefault();
    }

    function move(event) {
      if (!dragging) {
        return;
      }
      var point = event.touches ? event.touches[0] : event;
      var dx = point.clientX - sx;
      var dy = point.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 6) {
        moved = true;
      }
      curX = ox + dx;
      y = oy + dy;
      clampY();
      ball.style.left = curX + "px";
      ball.style.top = y + "px";
      ball.style.right = "auto";
      ball.style.opacity = "1";
      event.preventDefault();
    }

    function up() {
      if (!dragging) {
        return;
      }
      dragging = false;
      ball.style.transition = "left .18s ease, top .18s ease, opacity .18s";
      if (!moved) {
        peeked = false;
        place();
        save();
        renderPanel();
        return;
      }
      side = curX + size / 2 < window.innerWidth / 2 ? "l" : "r";
      peeked = false;
      place();
      save();
    }

    place();
    ball.addEventListener("mousedown", down);
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    ball.addEventListener("touchstart", down, { passive: false });
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", up);
    window.addEventListener("resize", place);
  }
})();
