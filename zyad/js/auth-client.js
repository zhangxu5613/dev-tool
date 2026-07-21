(function () {
  var GAME_SCRIPTS = [
    "js/h5api-local.js",
    "libs/laya.core.js",
    "libs/laya.webgl_2D.js",
    "libs/laya.ui.js",
    "libs/laya.trailCommon.js",
    "libs/laya.trail2D.js",
    "libs/spine-core-3.7.js",
    "libs/laya.spine.js",
    "js/bundle.js",
    "js/index.js",
    "js/local-multiplayer.js",
    "js/gm-launcher.js"
  ];
  var GAME_ASSET_VERSION = "20260715-pvp-authoritative-v1";
  var GAME_SCRIPT_URLS = GAME_SCRIPTS.map(versionGameScript);
  var SCRIPT_PREFETCH_LOOKAHEAD = 1;

  var booted = false;
  var scriptTextCache = {};
  var syncInstalled = false;
  var skipSync = 0;
  var pendingSave = "";
  var hasPendingSave = false;
  var pendingTimer = 0;
  var syncTimer = 0;
  var lastSaved = "";
  var QQ_GROUP_URL = "https://qm.qq.com/q/ZfGD6RqqCy";
  var RANK_ID = "default";
  var lastRankScore = 0;
  var rankSubmitTimer = 0;
  var nativeRankTimer = 0;
  var nativeRankScene = null;
  var nativeRankOpening = false;

  window.__ZYYAD_AUTH = window.__ZYYAD_AUTH || {};
  window.__ZYYAD_AUTH.user = null;
  window.__ZYYAD_AUTH.gmAuthorized = false;
  window.__ZYYAD_AUTH.withoutSaveSync = withoutSaveSync;
  window.__ZYYAD_AUTH.flushSave = function () {
    return flushSave(false);
  };
  window.__ZYYAD_AUTH.saveNow = saveNow;
  window.__ZYYAD_AUTH.logout = logout;
  window.__ZYYAD_AUTH.showRankPanel = showRankPanel;
  window.__ZYYAD_AUTH.submitRankScore = function () {
    submitRankScoreFromSave(localStorage.getItem("playerData") || lastSaved, true);
  };

  window.__ZYYAD_BOOT = {
    start: start,
    loadGame: function () {
      start();
    }
  };

  function start() {
    injectStyles();

    if (new URLSearchParams(location.search).get("logout") === "1") {
      api("/api/logout", { method: "POST" }).catch(function () {}).then(function () {
        clearLocalAccount();
        clearLogoutFlag();
        hideSplashForAuth();
        showAuth("login");
      });
      return;
    }

    // 本地离线模式：绕过服务端认证，使用 mock 数据直接启动游戏
    var mockData = { user: { username: "local_player" }, playerData: localStorage.getItem("playerData") || "" };
    bootGame(mockData);
  }

  function bootGame(data) {
    if (booted) {
      return;
    }
    booted = true;
    clearLogoutFlag();
    applyAccount(data);
    installSaveSync();
    installRankUi();
    removeAuth();
    submitRankScoreFromSave(lastSaved, true);
    setSplashMessage("正在加载游戏脚本...");
    window.onSplashProgress = function (progress) {
      var percent = Math.max(0, Math.min(100, Math.floor(Number(progress || 0) * 100)));
      setSplashMessage("正在加载游戏资源 " + percent + "%");
    };

    var chain = Promise.resolve();
    GAME_SCRIPT_URLS.forEach(function (src, index) {
      chain = chain.then(function () {
        prefetchNearbyScripts(index);
        setSplashMessage("正在加载游戏脚本 " + (index + 1) + "/" + GAME_SCRIPT_URLS.length + " " + scriptFileName(src));
        return loadScript(src, 0);
      });
    });
    chain.then(function () {
      installRuntimeSettingsLogoutButton();
    }).catch(function (error) {
      booted = false;
      showAuth("login", "游戏脚本加载失败，请刷新重试");
      console.error(error);
    });
  }

  function clearLogoutFlag() {
    try {
      var url = new URL(location.href);
      if (url.searchParams.has("logout")) {
        url.searchParams.delete("logout");
        history.replaceState(null, document.title, url.pathname + url.search + url.hash);
      }
    } catch (error) {}
  }

  function setSplashMessage(text) {
    var splash = document.getElementById("splash");
    if (!splash) {
      return;
    }
    var node = splash.querySelector(".powered-by p");
    if (node) {
      node.textContent = text;
    }
  }

  function hideSplashForAuth() {
    var splash = document.getElementById("splash");
    if (splash) {
      splash.style.opacity = 0;
      setTimeout(function () {
        if (splash.parentElement) {
          splash.parentElement.removeChild(splash);
        }
      }, 320);
    }
  }

  function applyAccount(data) {
    var payload = data || {};
    var user = payload.user || null;
    var playerData = String(payload.playerData || "");
    window.__ZYYAD_AUTH.user = user;
    window.__ZYYAD_AUTH.gmAuthorized = !!(user && user.gmAuthorized);
    window.__ZYYAD_AUTH.playerData = playerData;
    lastSaved = playerData;
    lastRankScore = Number(localStorage.getItem(rankScoreKey(user)) || 0);
    var previousActiveUser = localStorage.getItem("zyyadActiveUser") || "";
    var storedBattleMode = localStorage.getItem("localBattleMode") || "";
    var storedRoomMeta = localStorage.getItem("localRoomMeta") || "";
    var preserveRoom = Boolean(user && previousActiveUser === user.username && /^room:/.test(storedBattleMode) && storedRoomMeta);

    withoutSaveSync(function () {
      localStorage.setItem("zyyadActiveUser", user && user.username ? user.username : "");
      if (!preserveRoom) {
        localStorage.removeItem("localBattleMode");
        localStorage.removeItem("localRoomMeta");
      }
      if (playerData) {
        localStorage.setItem("playerData", playerData);
      } else {
        localStorage.removeItem("playerData");
      }
    });
  }

  function clearLocalAccount() {
    window.__ZYYAD_AUTH.user = null;
    lastSaved = "";
    lastRankScore = 0;
    pendingSave = "";
    hasPendingSave = false;
    clearTimeout(rankSubmitTimer);
    clearTimeout(pendingTimer);
    withoutSaveSync(function () {
      localStorage.removeItem("zyyadActiveUser");
      localStorage.removeItem("playerData");
      localStorage.removeItem("localBattleMode");
      localStorage.removeItem("localRoomMeta");
    });
  }

  function showAuth(mode, message) {
    mode = mode === "register" ? "register" : "login";
    removeAuth();
    removeRankUi();

    var overlay = document.createElement("div");
    overlay.id = "zyyad-auth";
    overlay.innerHTML = [
      '<div class="auth-bg"></div>',
      '<form class="auth-panel" id="zyyad-auth-form">',
      '<div class="auth-title">赵云与阿斗</div>',
      '<div class="auth-tabs">',
      '<button type="button" class="' + (mode === "login" ? "active" : "") + '" id="auth-tab-login">登录</button>',
      '<button type="button" class="' + (mode === "register" ? "active" : "") + '" id="auth-tab-register">注册</button>',
      "</div>",
      '<label><span>角色名(游戏内显示这个名字)</span><input id="auth-username" autocomplete="username" maxlength="24"></label>',
      '<label><span>密码</span><input id="auth-password" type="password" autocomplete="' + (mode === "login" ? "current-password" : "new-password") + '" maxlength="72"></label>',
      '<button class="auth-submit" id="auth-submit" type="submit">' + (mode === "login" ? "登录" : "注册并进入") + "</button>",
      '<a class="auth-group-link" href="' + QQ_GROUP_URL + '" target="_blank" rel="noopener">加入群聊</a>',
      '<div class="auth-message" id="auth-message">' + escapeHtml(message || "") + "</div>",
      "</form>"
    ].join("");
    document.body.appendChild(overlay);

    var username = overlay.querySelector("#auth-username");
    var password = overlay.querySelector("#auth-password");
    var savedName = localStorage.getItem("zyyadActiveUser") || "";
    username.value = savedName;
    setTimeout(function () {
      (savedName ? password : username).focus();
    }, 50);

    overlay.querySelector("#auth-tab-login").onclick = function () {
      showAuth("login");
    };
    overlay.querySelector("#auth-tab-register").onclick = function () {
      showAuth("register");
    };
    overlay.querySelector("#zyyad-auth-form").onsubmit = function (event) {
      event.preventDefault();
      submitAuth(mode, username.value, password.value);
    };
  }

  function submitAuth(mode, username, password) {
    var submit = document.getElementById("auth-submit");
    var message = document.getElementById("auth-message");
    if (submit) {
      submit.disabled = true;
      submit.textContent = mode === "login" ? "登录中..." : "注册中...";
    }
    if (message) {
      message.textContent = "";
    }

    api(mode === "login" ? "/api/login" : "/api/register", {
      method: "POST",
      body: { username: username, password: password }
    }).then(function (data) {
      bootGame(data);
    }).catch(function (error) {
      if (submit) {
        submit.disabled = false;
        submit.textContent = mode === "login" ? "登录" : "注册并进入";
      }
      if (message) {
        message.textContent = error.message || "操作失败";
      }
    });
  }

  function api(url, options) {
    options = options || {};
    var fetchOptions = {
      method: options.method || "GET",
      credentials: "same-origin",
      headers: {}
    };
    if (options.body !== undefined) {
      fetchOptions.headers["Content-Type"] = "application/json";
      fetchOptions.body = JSON.stringify(options.body);
    }
    return fetch(url, fetchOptions).then(function (response) {
      return response.json().catch(function () {
        return {};
      }).then(function (payload) {
        if (!response.ok || payload.success === false) {
          throw new Error(payload.message || "请求失败");
        }
        return payload.data || {};
      });
    });
  }

  function loadScript(src, attempt) {
    var prefetched = prefetchScript(src, attempt);
    if (prefetched) {
      return withTimeout(prefetched, scriptTimeoutMs(src), src).then(function (entry) {
        executeScript(entry.src, entry.code);
      }).catch(function (error) {
        delete scriptTextCache[scriptCacheKey(src, attempt)];
        if (attempt < 1) {
          setSplashMessage("资源较慢，正在重试 " + scriptFileName(src));
          return loadScript(src, attempt + 1);
        }
        throw error;
      });
    }

    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.async = false;
      var timeoutMs = scriptTimeoutMs(src);
      var timeout = setTimeout(function () {
        script.onload = null;
        script.onerror = null;
        try {
          script.remove();
        } catch (error) {}
        if (attempt < 1) {
          setSplashMessage("资源较慢，正在重试 " + scriptFileName(src));
          loadScript(src, attempt + 1).then(resolve, reject);
        } else {
          reject(new Error("Timeout loading " + src));
        }
      }, timeoutMs);
      script.onload = function () {
        clearTimeout(timeout);
        resolve();
      };
      script.onerror = function () {
        clearTimeout(timeout);
        if (attempt < 1) {
          setSplashMessage("资源加载失败，正在重试 " + scriptFileName(src));
          loadScript(src, attempt + 1).then(resolve, reject);
        } else {
          reject(new Error("Failed to load " + src));
        }
      };
      script.src = attempt ? src + (src.indexOf("?") >= 0 ? "&" : "?") + "retry=" + Date.now() : src;
      document.body.appendChild(script);
    });
  }

  function prefetchNearbyScripts(index) {
    if (document.visibilityState === "hidden") {
      return;
    }
    for (var offset = 0; offset <= SCRIPT_PREFETCH_LOOKAHEAD; offset += 1) {
      var src = GAME_SCRIPT_URLS[index + offset];
      if (src) {
        prefetchScript(src, 0);
      }
    }
  }

  function prefetchScript(src, attempt) {
    if (!window.fetch || !window.Promise) {
      return null;
    }
    var requestSrc = scriptCacheKey(src, attempt);
    if (scriptTextCache[requestSrc]) {
      return scriptTextCache[requestSrc];
    }
    scriptTextCache[requestSrc] = fetch(requestSrc, {
      cache: attempt ? "reload" : "default",
      credentials: "same-origin"
    }).then(function (response) {
      if (!response.ok) {
        throw new Error("HTTP " + response.status + " loading " + requestSrc);
      }
      return response.text();
    }).then(function (code) {
      return { code: code, src: requestSrc };
    });
    return scriptTextCache[requestSrc];
  }

  function executeScript(src, code) {
    var script = document.createElement("script");
    script.async = false;
    script.setAttribute("data-zyyad-src", src);
    script.text = String(code || "") + "\n//# sourceURL=" + absoluteScriptUrl(src);
    document.body.appendChild(script);
  }

  function withTimeout(promise, timeoutMs, src) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timeout = setTimeout(function () {
        if (done) {
          return;
        }
        done = true;
        reject(new Error("Timeout loading " + src));
      }, timeoutMs);
      promise.then(function (value) {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timeout);
        resolve(value);
      }, function (error) {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  function scriptCacheKey(src, attempt) {
    return attempt ? src + (src.indexOf("?") >= 0 ? "&" : "?") + "retry=" + Date.now() : src;
  }

  function scriptFileName(src) {
    return String(src || "").split("?")[0].split("/").pop();
  }

  function absoluteScriptUrl(src) {
    var link = document.createElement("a");
    link.href = src;
    return link.href;
  }

  function versionGameScript(src) {
    if (String(src).indexOf("libs/") === 0) {
      return src;
    }
    return src + (src.indexOf("?") >= 0 ? "&" : "?") + "v=" + encodeURIComponent(GAME_ASSET_VERSION);
  }

  function scriptTimeoutMs(src) {
    var normalized = String(src || "").split("?")[0].toLowerCase();
    if (normalized === "js/bundle.js" || normalized.indexOf("libs/") === 0) {
      return 150000;
    }
    return 60000;
  }

  function installSaveSync() {
    if (syncInstalled || !window.Storage || !window.localStorage) {
      return;
    }
    syncInstalled = true;
    var originalSetItem = Storage.prototype.setItem;
    var originalRemoveItem = Storage.prototype.removeItem;

    Storage.prototype.setItem = function (key, value) {
      var result = originalSetItem.apply(this, arguments);
      if (this === window.localStorage && String(key) === "playerData") {
        scheduleSave(String(value || ""));
      }
      return result;
    };

    Storage.prototype.removeItem = function (key) {
      var result = originalRemoveItem.apply(this, arguments);
      if (this === window.localStorage && String(key) === "playerData") {
        scheduleSave("");
      }
      return result;
    };

    syncTimer = setInterval(function () {
      syncCurrentLocalSave(false);
    }, 5000);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        syncCurrentLocalSave(true);
        flushSave(true);
      }
    });
    window.addEventListener("pagehide", function () {
      syncCurrentLocalSave(true);
      flushSave(true);
    });
    window.addEventListener("beforeunload", function () {
      syncCurrentLocalSave(true);
      flushSave(true);
    });
  }

  function syncCurrentLocalSave(force) {
    if (!window.__ZYYAD_AUTH.user || isRoomBattleMode()) {
      return;
    }
    var value = localStorage.getItem("playerData");
    if (value === null) {
      return;
    }
    value = String(value || "");
    if (!force && value === lastSaved) {
      return;
    }
    scheduleSave(value);
  }

  function scheduleSave(value) {
    if (skipSync > 0 || !window.__ZYYAD_AUTH.user || isRoomBattleMode()) {
      return;
    }
    if (value === lastSaved) {
      return;
    }
    pendingSave = value;
    hasPendingSave = true;
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(function () {
      flushSave(false);
    }, 700);
  }

  function flushSave(useBeacon) {
    if (!hasPendingSave) {
      return Promise.resolve({ skipped: true });
    }
    if (!window.__ZYYAD_AUTH.user || pendingSave === lastSaved) {
      pendingSave = "";
      hasPendingSave = false;
      return Promise.resolve({ skipped: true });
    }

    var value = pendingSave;
    pendingSave = "";
    hasPendingSave = false;
    var body = JSON.stringify({ playerData: value });

    if (useBeacon && navigator.sendBeacon) {
      var blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon("/api/save", blob);
      lastSaved = value;
      return Promise.resolve({ beacon: true });
    }

    return fetch("/api/save", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: body
    }).then(function () {
      lastSaved = value;
      submitRankScoreFromSave(value, false);
    }).catch(function () {
      pendingSave = value;
      hasPendingSave = true;
    });
  }

  function saveNow(value, options) {
    if (!window.__ZYYAD_AUTH.user || isRoomBattleMode()) {
      return Promise.resolve({ skipped: true });
    }
    value = String(value == null ? localStorage.getItem("playerData") || "" : value);
    if (value === lastSaved && !hasPendingSave) {
      return Promise.resolve({ skipped: true });
    }
    clearTimeout(pendingTimer);
    pendingSave = "";
    hasPendingSave = false;
    return fetch("/api/save", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ playerData: value }, options || {}))
    }).then(function (response) {
      return response.json().catch(function () {
        return {};
      }).then(function (payload) {
        if (!response.ok || payload.success === false) {
          throw new Error(payload.message || "保存失败");
        }
        lastSaved = value;
        submitRankScoreFromSave(value, false);
        return payload.data || {};
      });
    }).catch(function (error) {
      pendingSave = value;
      hasPendingSave = true;
      throw error;
    });
  }

  function logout() {
    var currentSave = localStorage.getItem("playerData");
    var beforeLogout = currentSave === null ? Promise.resolve({ skipped: true }) : saveNow(currentSave);
    beforeLogout.catch(function () {}).then(function () {
      return api("/api/logout", { method: "POST" }).catch(function () {});
    }).then(function () {
      clearLocalAccount();
      location.href = "gameIndex.html?logout=1";
    });
  }

  function installRuntimeSettingsLogoutButton() {
    function findNodeByName(root, name, depth) {
      if (!root || depth > 6) {
        return null;
      }
      if (root.name === name) {
        return root;
      }
      var count = Number(root.numChildren || 0);
      for (var index = 0; index < count; index += 1) {
        var found = findNodeByName(root.getChildAt(index), name, depth + 1);
        if (found) {
          return found;
        }
      }
      return null;
    }

    function addLogoutButton() {
      if (!window.Laya || !Laya.stage || !Laya.Image || !Laya.Text) {
        return;
      }
      var settingsWindow = findNodeByName(Laya.stage, "settingWnd", 0);
      if (!settingsWindow ||
          !findNodeByName(settingsWindow, "musicSlider", 0) ||
          !findNodeByName(settingsWindow, "soundSlider", 0) ||
          findNodeByName(settingsWindow, "logoutBtn", 0)) {
        return;
      }

      var button = new Laya.Image("resources/img/mainUI/setting/redBtn.png");
      button.name = "logoutBtn";
      button.width = 205;
      button.height = 72;
      button.anchorX = 0.5;
      button.anchorY = 0.5;
      button.pos(271, 432);
      button.sizeGrid = "12,12,12,12,0";
      button.mouseEnabled = true;
      button.zOrder = 1000;

      var label = new Laya.Text();
      label.name = "logoutTxt";
      label.text = "\u9000\u51fa\u8d26\u53f7";
      label.width = 205;
      label.height = 72;
      label.fontSize = 32;
      label.color = "#ffffff";
      label.bold = true;
      label.align = "center";
      label.valign = "middle";
      label.stroke = 5;
      label.strokeColor = "#54241a";
      label.mouseEnabled = false;
      button.addChild(label);

      button.on("click", null, function (event) {
        if (event && event.stopPropagation) {
          event.stopPropagation();
        }
        button.mouseEnabled = false;
        label.text = "\u6b63\u5728\u9000\u51fa...";
        logout();
      });
      settingsWindow.addChild(button);
    }

    addLogoutButton();
    window.setInterval(addLogoutButton, 200);
  }

  function withoutSaveSync(callback) {
    skipSync += 1;
    try {
      return callback();
    } finally {
      skipSync -= 1;
    }
  }

  function isRoomBattleMode() {
    return /^room:/.test(localStorage.getItem("localBattleMode") || "");
  }

  function rankScoreKey(user) {
    return "zyyadRankScore:" + (user && user.username ? user.username : "guest");
  }

  function calculateRankScore(save) {
    var data = {};
    try {
      data = JSON.parse(save || localStorage.getItem("playerData") || "{}");
    } catch (error) {
      data = {};
    }
    var star = Math.max(0, Number(data._curStar || 0));
    var win = Math.max(0, Number(data._win || 0));
    var lose = Math.max(0, Number(data._lose || 0));
    var gold = Math.max(0, Number(data._gold || 0));
    var streak = Math.max(0, Number(data._winStreak || 0));
    var props = Array.isArray(data._props) ? data._props.length : 0;
    var equip = Array.isArray(data._equip) ? data._equip.filter(function (item) {
      return Number(item) >= 0;
    }).length : 0;
    return Math.max(0, Math.floor(star * 10000 + win * 120 + Math.max(0, win - lose) * 60 + streak * 80 + props * 30 + equip * 40 + Math.min(gold, 1000000) / 50));
  }

  function submitRankScoreFromSave(save, immediate) {
    if (!window.__ZYYAD_AUTH.user || isRoomBattleMode()) {
      return;
    }
    var score = calculateRankScore(save);
    if (score <= 0 || score <= lastRankScore) {
      return;
    }
    clearTimeout(rankSubmitTimer);
    rankSubmitTimer = setTimeout(function () {
      api("/api/score", {
        method: "POST",
        body: { rankId: RANK_ID, score: score }
      }).then(function () {
        lastRankScore = score;
        localStorage.setItem(rankScoreKey(window.__ZYYAD_AUTH.user), String(score));
        updateRankButtonScore(score);
      }).catch(function () {});
    }, immediate ? 120 : 900);
  }

  function installRankUi() {
    var legacyButton = document.getElementById("zyyad-rank-button");
    if (legacyButton) {
      legacyButton.remove();
    }
    if (nativeRankTimer) {
      return;
    }

    function findNodeByName(root, name, depth) {
      if (!root || depth > 6) {
        return null;
      }
      if (root.name === name) {
        return root;
      }
      var count = Number(root.numChildren || 0);
      for (var index = 0; index < count; index += 1) {
        var found = findNodeByName(root.getChildAt(index), name, depth + 1);
        if (found) {
          return found;
        }
      }
      return null;
    }

    function bindNativeRankButton() {
      if (!window.Laya || !Laya.stage) {
        return;
      }
      var button = findNodeByName(Laya.stage, "rankBtn", 0);
      if (!button) {
        return;
      }
      button.visible = true;
      button.alpha = 1;
      button.pos(81, 1140);
      button.mouseEnabled = true;
      button.zOrder = 1000;
      if (button.__zyyadRankBound) {
        return;
      }
      button.__zyyadRankBound = true;
      button.offAll("click");
      button.on("click", null, function (event) {
        if (event && event.stopPropagation) {
          event.stopPropagation();
        }
        showRankPanel();
      });
    }

    bindNativeRankButton();
    nativeRankTimer = window.setInterval(bindNativeRankButton, 200);
  }

  function updateRankButtonScore(score) {
    window.__ZYYAD_AUTH.rankScore = Math.floor(Number(score) || 0);
  }

  function showRankPanel() {
    removeRankPanel();
    submitRankScoreFromSave(localStorage.getItem("playerData") || lastSaved, true);
    if (!window.Laya || !Laya.Scene || typeof Laya.Scene.open !== "function") {
      showLegacyRankPanel();
      return;
    }
    if (nativeRankScene && !nativeRankScene.destroyed) {
      configureNativeRankScene(nativeRankScene);
      return;
    }
    if (nativeRankOpening) {
      return;
    }
    nativeRankOpening = true;
    Promise.resolve(Laya.Scene.open("scene/RankScene.ls", false)).then(function (scene) {
      nativeRankOpening = false;
      nativeRankScene = scene;
      configureNativeRankScene(scene);
    }).catch(function (error) {
      nativeRankOpening = false;
      console.error(error);
      showLegacyRankPanel();
    });
  }

  function showLegacyRankPanel() {
    var score = calculateRankScore(localStorage.getItem("playerData") || lastSaved);
    var overlay = document.createElement("div");
    overlay.id = "zyyad-rank-panel";
    overlay.innerHTML = [
      '<div class="rank-card">',
      '<div class="rank-head"><strong>排行榜</strong><button id="rank-close" type="button">×</button></div>',
      '<div class="rank-me">我的战力：<b>' + score + "</b></div>",
      '<div class="rank-list" id="rank-list">加载中...</div>',
      '<button class="rank-refresh" id="rank-refresh" type="button">刷新</button>',
      "</div>"
    ].join("");
    document.body.appendChild(overlay);
    overlay.querySelector("#rank-close").onclick = removeRankPanel;
    overlay.querySelector("#rank-refresh").onclick = loadRankList;
    overlay.onclick = function (event) {
      if (event.target === overlay) {
        removeRankPanel();
      }
    };
    loadRankList();
  }

  function findNativeNode(root, name, depth) {
    if (!root || depth > 8) {
      return null;
    }
    if (root.name === name) {
      return root;
    }
    for (var index = 0; index < Number(root.numChildren || 0); index += 1) {
      var found = findNativeNode(root.getChildAt(index), name, depth + 1);
      if (found) {
        return found;
      }
    }
    return null;
  }

  function findNativeText(root, depth) {
    if (!root || depth > 4) {
      return null;
    }
    if (typeof root.text === "string") {
      return root;
    }
    for (var index = 0; index < Number(root.numChildren || 0); index += 1) {
      var found = findNativeText(root.getChildAt(index), depth + 1);
      if (found) {
        return found;
      }
    }
    return null;
  }

  function configureNativeRankScene(scene) {
    if (!scene || scene.destroyed) {
      return;
    }
    var box = findNativeNode(scene, "box", 0);
    var list = box && findNativeNode(box, "list", 0);
    var closeButton = box && findNativeNode(box, "xBtn", 0);
    var powerButton = box && findNativeNode(box, "provinceBtn", 0);
    var starsButton = box && findNativeNode(box, "countryBtn", 0);
    var originalPlayer = box && findNativeNode(box, "playerRank", 0);
    if (!box || !list || !closeButton || !powerButton || !starsButton) {
      showLegacyRankPanel();
      return;
    }

    scene.__zyyadRankBox = box;
    scene.__zyyadRankList = list;
    scene.__zyyadPowerButton = powerButton;
    scene.__zyyadStarsButton = starsButton;
    if (originalPlayer) {
      originalPlayer.visible = false;
    }

    var powerLabel = findNativeText(powerButton, 0);
    var starsLabel = findNativeText(starsButton, 0);
    if (powerLabel) {
      powerLabel.text = "战力";
    }
    if (starsLabel) {
      starsLabel.text = "段位";
    }

    if (!scene.__zyyadRankConfigured) {
      scene.__zyyadRankConfigured = true;
      closeButton.offAll("click");
      closeButton.on("click", null, function (event) {
        if (event && event.stopPropagation) {
          event.stopPropagation();
        }
        nativeRankScene = null;
        scene.close();
      });
      powerButton.offAll("click");
      powerButton.on("click", null, function (event) {
        if (event && event.stopPropagation) {
          event.stopPropagation();
        }
        loadNativeRankMode(scene, "power");
      });
      starsButton.offAll("click");
      starsButton.on("click", null, function (event) {
        if (event && event.stopPropagation) {
          event.stopPropagation();
        }
        loadNativeRankMode(scene, "stars");
      });
    }
    loadNativeRankMode(scene, scene.__zyyadRankMode || "power");
  }

  function setNativeRankTabState(scene, mode) {
    var powerButton = scene.__zyyadPowerButton;
    var starsButton = scene.__zyyadStarsButton;
    if (!powerButton || !starsButton) {
      return;
    }
    powerButton.skin = mode === "power"
      ? "resources/img/rank/countryBtn.png"
      : "resources/img/rank/provinceBtn.png";
    starsButton.skin = mode === "stars"
      ? "resources/img/rank/countryBtn.png"
      : "resources/img/rank/provinceBtn.png";
  }

  function loadNativeRankMode(scene, mode) {
    if (!scene || scene.destroyed) {
      return;
    }
    scene.__zyyadRankMode = mode;
    setNativeRankTabState(scene, mode);
    showNativeRankMessage(scene, "加载中...");
    var rankId = mode === "stars" ? "stars" : RANK_ID;
    api("/api/rank?rankId=" + encodeURIComponent(rankId) + "&limit=50", { method: "GET" })
      .then(function (rows) {
        if (!scene.destroyed && scene.__zyyadRankMode === mode) {
          renderNativeRankRows(scene, Array.isArray(rows) ? rows : [], mode);
        }
      })
      .catch(function () {
        if (!scene.destroyed && scene.__zyyadRankMode === mode) {
          showNativeRankMessage(scene, "加载失败");
          renderNativeCurrentRow(scene, [], mode);
        }
      });
  }

  function showNativeRankMessage(scene, message) {
    var list = scene.__zyyadRankList;
    if (!list) {
      return;
    }
    list.removeChildren();
    var label = createNativeText(message, 0, 42, 551, 70, 32, "#d8dee0", "center");
    list.addChild(label);
  }

  function renderNativeRankRows(scene, rows, mode) {
    var list = scene.__zyyadRankList;
    if (!list) {
      return;
    }
    list.removeChildren();
    if (!rows.length) {
      list.addChild(createNativeText("暂无排行", 0, 42, 551, 70, 32, "#d8dee0", "center"));
    } else {
      rows.forEach(function (row, index) {
        var item = createNativeRankRow(row, index, mode, false);
        item.y = index * 117;
        list.addChild(item);
      });
    }
    if (typeof list.refresh === "function") {
      list.refresh();
    }
    renderNativeCurrentRow(scene, rows, mode);
  }

  function renderNativeCurrentRow(scene, rows, mode) {
    var box = scene.__zyyadRankBox;
    if (!box) {
      return;
    }
    var existing = box.getChildByName("zyyadCurrentRank");
    if (existing) {
      existing.destroy(true);
    }
    var username = window.__ZYYAD_AUTH.user && window.__ZYYAD_AUTH.user.username || "player";
    var currentIndex = -1;
    for (var index = 0; index < rows.length; index += 1) {
      if (rows[index] && rows[index].username === username) {
        currentIndex = index;
        break;
      }
    }
    var row = currentIndex >= 0 ? rows[currentIndex] : {
      username: username,
      score: currentRankModeScore(mode)
    };
    var item = createNativeRankRow(row, currentIndex, mode, true);
    item.name = "zyyadCurrentRank";
    item.x = 49;
    item.y = 1015;
    box.addChild(item);
  }

  function currentRankModeScore(mode) {
    var save = localStorage.getItem("playerData") || lastSaved || "{}";
    if (mode !== "stars") {
      return calculateRankScore(save);
    }
    try {
      return Math.max(0, Math.floor(Number(JSON.parse(save)._curStar) || 0));
    } catch (error) {
      return 0;
    }
  }

  function createNativeRankRow(row, index, mode, mine) {
    var item = new Laya.Image(mine
      ? "resources/img/rank/rankItem.png"
      : "resources/img/rank/rankItem0.png");
    item.width = 540;
    item.height = 117;
    item.sizeGrid = "15,15,15,15,0";

    var badgeNo = index >= 0 ? index + 1 : 0;
    var badgeSkin = Math.max(0, Math.min(3, badgeNo > 0 ? badgeNo - 1 : 3));
    var badge = new Laya.Image("resources/img/rank/rankImg" + badgeSkin + ".png");
    badge.x = 48;
    badge.y = 54;
    badge.width = 64;
    badge.height = 55;
    badge.anchorX = 0.5;
    badge.anchorY = 0.5;
    var badgeText = createNativeText(badgeNo > 0 ? String(badgeNo) : "--", 0, 2, 64, 55, 30, "#000000", "center");
    badgeText.bold = true;
    badge.addChild(badgeText);
    item.addChild(badge);

    var avatarBg = new Laya.Image("resources/img/rank/avatarBg.png");
    avatarBg.x = 82;
    avatarBg.y = 13;
    avatarBg.width = 90;
    avatarBg.height = 90;
    var avatar = new Laya.Image("resources/img/mainUI/avatar/avatar" + avatarNumber(row.username) + ".png");
    avatar.x = 5;
    avatar.y = 5;
    avatar.width = 80;
    avatar.height = 80;
    avatarBg.addChild(avatar);
    item.addChild(avatarBg);

    var username = createNativeText(String(row.username || "player"), 175, 10, 165, 48, 28, "#111111", "left");
    username.overflow = "shrink";
    item.addChild(username);

    var score = Math.max(0, Math.floor(Number(row.score) || 0));
    if (mode === "stars") {
      item.addChild(createNativeText("总星 " + score, 175, 55, 145, 45, 25, "#303030", "left"));
      addNativeRankStars(item, score);
    } else {
      item.addChild(createNativeText("战力", 175, 55, 100, 45, 25, "#303030", "left"));
      var power = createNativeText(String(score), 315, 27, 205, 62, 34, "#fee641", "center");
      power.stroke = 7;
      power.strokeColor = "#4f2818";
      power.overflow = "shrink";
      item.addChild(power);
    }
    return item;
  }

  function addNativeRankStars(item, totalStars) {
    var info = rankInfoFromStars(totalStars);
    var rankText = createNativeText(info.rank, 315, 12, 210, 45, 27, "#fee641", "center");
    rankText.stroke = 6;
    rankText.strokeColor = "#4f2818";
    rankText.overflow = "shrink";
    item.addChild(rankText);
    if (info.emperor) {
      var bigStar = new Laya.Image("resources/img/gameOverUI/star1.png");
      bigStar.x = 380;
      bigStar.y = 64;
      bigStar.width = 40;
      bigStar.height = 40;
      item.addChild(bigStar);
      item.addChild(createNativeText(String(info.emperorStars), 423, 52, 78, 48, 27, "#ffffff", "left"));
      return;
    }
    for (var index = 0; index < 5; index += 1) {
      var star = new Laya.Image(index < info.stars
        ? "resources/img/gameOverUI/star1.png"
        : "resources/img/gameOverUI/star0.png");
      star.x = 326 + index * 37;
      star.y = 65;
      star.width = 31;
      star.height = 31;
      item.addChild(star);
    }
  }

  function rankInfoFromStars(value) {
    var stars = Math.max(0, Math.floor(Number(value) || 0));
    if (stars >= 250) {
      return { rank: "皇帝", stars: 0, emperor: true, emperorStars: stars - 250 };
    }
    var ranks = ["军士", "校尉", "少将", "中将", "上将", "大将", "元帅", "诸侯", "霸主", "君主"];
    var levels = ["一", "二", "三", "四", "五"];
    var rankIndex = Math.min(49, Math.floor(stars / 5));
    return {
      rank: ranks[Math.floor(rankIndex / 5)] + "." + levels[rankIndex % 5],
      stars: stars % 5,
      emperor: false,
      emperorStars: 0
    };
  }

  function avatarNumber(username) {
    var hash = 0;
    String(username || "").split("").forEach(function (character) {
      hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
    });
    return hash % 16 + 1;
  }

  function createNativeText(text, x, y, width, height, fontSize, color, align) {
    var label = new Laya.Text();
    label.text = text;
    label.x = x;
    label.y = y;
    label.width = width;
    label.height = height;
    label.fontSize = fontSize;
    label.color = color;
    label.align = align || "left";
    label.valign = "middle";
    label.mouseEnabled = false;
    return label;
  }

  function removeRankPanel() {
    var panel = document.getElementById("zyyad-rank-panel");
    if (panel) {
      panel.remove();
    }
  }

  function removeRankUi() {
    removeRankPanel();
    if (nativeRankScene && !nativeRankScene.destroyed) {
      nativeRankScene.close();
    }
    nativeRankScene = null;
    nativeRankOpening = false;
    if (nativeRankTimer) {
      clearInterval(nativeRankTimer);
      nativeRankTimer = 0;
    }
  }

  function loadRankList() {
    var list = document.getElementById("rank-list");
    if (!list) {
      return;
    }
    list.textContent = "加载中...";
    api("/api/rank?rankId=" + encodeURIComponent(RANK_ID) + "&limit=50", { method: "GET" })
      .then(function (rows) {
        renderRankList(Array.isArray(rows) ? rows : []);
      })
      .catch(function () {
        if (list) {
          list.textContent = "加载失败";
        }
      });
  }

  function renderRankList(rows) {
    var list = document.getElementById("rank-list");
    if (!list) {
      return;
    }
    if (!rows.length) {
      list.innerHTML = '<div class="rank-empty">暂无排行</div>';
      return;
    }
    var current = window.__ZYYAD_AUTH.user && window.__ZYYAD_AUTH.user.username;
    list.innerHTML = rows.map(function (row, index) {
      var mine = current && row.username === current;
      return '<div class="rank-row' + (mine ? " mine" : "") + '">' +
        '<span class="rank-no">' + (index + 1) + "</span>" +
        '<span class="rank-name">' + escapeHtml(row.username || "player") + "</span>" +
        '<span class="rank-score">' + Math.floor(Number(row.score) || 0) + "</span>" +
        "</div>";
    }).join("");
  }

  function removeAuth() {
    var existing = document.getElementById("zyyad-auth");
    if (existing) {
      existing.remove();
    }
  }

  function injectStyles() {
    if (document.getElementById("zyyad-auth-style")) {
      return;
    }
    var style = document.createElement("style");
    style.id = "zyyad-auth-style";
    style.textContent = [
      "#zyyad-auth{position:fixed;inset:0;z-index:100000000;display:flex;align-items:center;justify-content:center;overflow:hidden;font-family:Arial,'Microsoft YaHei',sans-serif;color:#2b1b10;}",
      "#zyyad-auth .auth-bg{position:absolute;inset:0;background:#6f7f7a url('resources/loading/bg.png') center/cover no-repeat;filter:saturate(1.05);}",
      "#zyyad-auth .auth-bg:after{content:'';position:absolute;inset:0;background:rgba(20,18,16,.34);}",
      "#zyyad-auth .auth-panel{position:relative;width:min(86vw,360px);padding:22px 22px 20px;border-radius:8px;background:rgba(255,245,218,.94);box-shadow:0 18px 46px rgba(0,0,0,.34);border:1px solid rgba(87,54,29,.35);}",
      "#zyyad-auth .auth-title{font-size:30px;font-weight:800;text-align:center;line-height:1.2;margin-bottom:16px;color:#5c2614;}",
      "#zyyad-auth .auth-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;}",
      "#zyyad-auth button{height:42px;border:0;border-radius:6px;font-size:16px;font-weight:700;cursor:pointer;}",
      "#zyyad-auth .auth-tabs button{background:#e8d3a7;color:#6b4321;}",
      "#zyyad-auth .auth-tabs button.active{background:#7b2d1a;color:#fff;}",
      "#zyyad-auth label{display:block;margin:10px 0 0;font-size:14px;font-weight:700;color:#55351f;}",
      "#zyyad-auth label span{display:block;margin-bottom:6px;}",
      "#zyyad-auth input{box-sizing:border-box;width:100%;height:44px;border-radius:6px;border:1px solid #b58f5a;background:#fffaf0;padding:0 12px;font-size:17px;color:#2b1b10;outline:none;}",
      "#zyyad-auth input:focus{border-color:#7b2d1a;box-shadow:0 0 0 3px rgba(123,45,26,.18);}",
      "#zyyad-auth .auth-submit{width:100%;margin-top:16px;background:#bd3f24;color:#fff;box-shadow:inset 0 -3px rgba(84,24,15,.24);}",
      "#zyyad-auth .auth-submit:disabled{opacity:.72;cursor:wait;}",
      "#zyyad-auth .auth-group-link{display:flex;align-items:center;justify-content:center;height:40px;margin-top:10px;border-radius:6px;background:#1f7fd7;color:#fff;text-decoration:none;font-size:15px;font-weight:800;box-shadow:inset 0 -3px rgba(12,59,112,.24);}",
      "#zyyad-auth .auth-group-link:active{transform:translateY(1px);}",
      "#zyyad-auth .auth-message{min-height:22px;margin-top:10px;font-size:14px;line-height:22px;color:#b3261e;text-align:center;}",
      "#zyyad-rank-panel{position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.42);font-family:Arial,'Microsoft YaHei',sans-serif;color:#2b1b10;}",
      "#zyyad-rank-panel .rank-card{width:min(88vw,420px);max-height:min(78vh,620px);box-sizing:border-box;padding:14px;border-radius:8px;background:rgba(255,245,218,.97);border:1px solid rgba(87,54,29,.32);box-shadow:0 18px 46px rgba(0,0,0,.36);display:flex;flex-direction:column;}",
      "#zyyad-rank-panel .rank-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;color:#5c2614;font-size:22px;font-weight:800;}",
      "#zyyad-rank-panel .rank-head button{width:34px;height:34px;border:0;border-radius:6px;background:#7b2d1a;color:#fff;font-size:24px;line-height:34px;cursor:pointer;}",
      "#zyyad-rank-panel .rank-me{padding:8px 10px;margin-bottom:10px;border-radius:6px;background:#fff7df;color:#6b4321;font-size:15px;font-weight:700;}",
      "#zyyad-rank-panel .rank-list{overflow:auto;min-height:160px;border-radius:6px;background:#fffaf0;border:1px solid rgba(181,143,90,.55);}",
      "#zyyad-rank-panel .rank-row{display:grid;grid-template-columns:42px 1fr 86px;align-items:center;gap:8px;min-height:38px;padding:0 10px;border-bottom:1px solid rgba(181,143,90,.28);font-size:14px;}",
      "#zyyad-rank-panel .rank-row.mine{background:#ffe6ae;color:#7b2d1a;font-weight:800;}",
      "#zyyad-rank-panel .rank-no{font-weight:800;color:#8d5c2d;}",
      "#zyyad-rank-panel .rank-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      "#zyyad-rank-panel .rank-score{text-align:right;font-weight:800;color:#bd3f24;}",
      "#zyyad-rank-panel .rank-empty{padding:34px 10px;text-align:center;color:#8d5c2d;}",
      "#zyyad-rank-panel .rank-refresh{height:40px;margin-top:10px;border:0;border-radius:6px;background:#bd3f24;color:#fff;font-size:15px;font-weight:800;cursor:pointer;}",
      "@media (max-height:560px){#zyyad-auth .auth-panel{padding:16px 18px;}#zyyad-auth .auth-title{font-size:25px;margin-bottom:10px;}#zyyad-auth input,#zyyad-auth button,#zyyad-auth .auth-group-link{height:38px;}}"
    ].join("");
    document.head.appendChild(style);
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, function (char) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[char];
    });
  }
})();
