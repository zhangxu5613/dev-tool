(function () {
  var DESIGN_WIDTH = 640;
  var DESIGN_HEIGHT = 1386;
  var START_BUTTON = { x1: 130, y1: 900, x2: 510, y2: 1080 };
  var socket = null;
  var currentRoom = "";
  var currentHost = "";
  var allowStartUntil = 0;
  var intentionalClose = false;
  var reconnectTimer = null;
  var reconnectAttempts = 0;
  var wasMatching = false;
  var currentRoomAction = "";
  var RECONNECT_MAX = 6;
  var activePanel = null;
  var roomState = {
    id: "",
    room: "",
    seat: -1,
    seed: "",
    state: "",
    source: "",
    clients: [],
    mode: ""
  };
  var applyingRemote = false;
  var pendingBattleMessages = [];
  var battleSyncTimer = null;
  var battlePresenceTimer = null;
  var matchProfileTimer = null;
  var battleResultSent = false;
  var roomBattleFinished = false;
  var battleFlushScheduled = false;
  var battleRetryTimer = null;
  var startClickRetryTimer = null;
  var lastSentByKind = {};
  var latestRemoteEnemyStateStamp = 0;
  var originalRandom = Math.random;
  var randomState = 1;
  var MAX_PENDING_BATTLE_MESSAGES = 500;
  var MAX_BATTLE_QUEUE_PER_FLUSH = 25;
  var MAX_BATTLE_MESSAGE_RETRIES = 12;
  var MAX_SOCKET_BUFFERED_BYTES = 512 * 1024;
  var ENEMY_STATE_SEND_INTERVAL = 900;

  function ready(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback);
    } else {
      callback();
    }
  }

  function pointFromEvent(event) {
    var touch = event.changedTouches && event.changedTouches[0];
    return {
      x: touch ? touch.clientX : event.clientX,
      y: touch ? touch.clientY : event.clientY
    };
  }

  function canvasBox() {
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

  function gameRect() {
    var canvas = canvasBox();
    if (!canvas) {
      return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight, right: window.innerWidth };
    }

    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight, right: window.innerWidth };
    }

    return rect;
  }

  function layoutPanel() {
    var panel = activePanel || document.getElementById("local-room-panel");
    if (!panel) {
      return;
    }

    var rect = gameRect();
    var width = Math.max(300, Math.min(390, rect.width - 24));
    panel.style.width = width + "px";
    panel.style.left = rect.left + rect.width / 2 + "px";
    panel.style.top = rect.top + rect.height * 0.48 + "px";
    panel.style.maxHeight = Math.max(260, rect.height - 24) + "px";
  }

  function isStartPoint(event) {
    var canvas = canvasBox();
    if (!canvas) {
      return false;
    }

    var point = pointFromEvent(event);
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return false;
    }

    var x = (point.x - rect.left) * DESIGN_WIDTH / rect.width;
    var y = (point.y - rect.top) * DESIGN_HEIGHT / rect.height;
    return x >= START_BUTTON.x1 && x <= START_BUTTON.x2 && y >= START_BUTTON.y1 && y <= START_BUTTON.y2;
  }

  function captureStart(event) {
    if (Date.now() < allowStartUntil || closestLocalUi(event.target)) {
      return;
    }
    if (!isMainScene()) {
      return;
    }
    if (!isStartPoint(event)) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    showPanel();
  }

  function isMainScene() {
    if (!window.Laya || !Laya.stage) {
      return false;
    }

    var urls = [];
    collectSceneUrls(Laya.stage, urls);
    return urls.length > 0 && urls[urls.length - 1] === "scene/MainScene.ls";
  }

  function collectSceneUrls(node, urls) {
    if (!node || node.visible === false) {
      return;
    }

    var url = node.url || node._url || "";
    if (/scene\/.+\.ls$/.test(url)) {
      urls.push(url);
    }

    var count = node.numChildren || 0;
    for (var i = 0; i < count; i += 1) {
      collectSceneUrls(node.getChildAt(i), urls);
    }
  }

  function closestLocalUi(target) {
    return target && target.closest && target.closest("#local-room-panel,#local-room-toast,#local-gm-panel,#local-gm-button,#zyyad-auth,#zyyad-rank-panel");
  }

  function showPanel() {
    var existing = document.getElementById("local-room-panel");
    if (existing) {
      existing.remove();
    }

    var queryRoom = new URLSearchParams(location.search).get("room") || "";
    var panel = document.createElement("div");
    panel.id = "local-room-panel";
    panel.innerHTML = [
      '<div class="room-head"><strong>开始游戏</strong><button id="room-close">×</button></div>',
      '<div class="room-body">',
      '<label class="room-field"><span>房间号</span><input id="room-id" maxlength="16" value="' + escapeHtml(queryRoom || currentRoom) + '"></label>',
      '<label class="room-field"><span>服务器</span><input id="room-host" value="' + escapeHtml(location.host) + '"></label>',
      '<div class="room-actions">',
      '<button id="room-random">创建房间</button>',
      '<button id="room-match">开始匹配</button>',
      '<button id="room-join">进入房间</button>',
      '<button id="room-robot">机器人对战</button>',
      '</div>',
      '<div id="room-status">未连接</div>',
      '<div id="room-invite"></div>',
      "</div>"
    ].join("");
    document.body.appendChild(panel);
    activePanel = panel;
    layoutPanel();

    panel.querySelector("#room-close").onclick = function () {
      disconnectRoom();
      activePanel = null;
      panel.remove();
    };
    panel.querySelector("#room-join").onclick = function () {
      var room = normalizeRoom(panel.querySelector("#room-id").value);
      if (!room) {
        setStatus("房间号为空或者房间不存在！");
        return;
      }
      panel.querySelector("#room-id").value = room;
      connectRoom(room, panel.querySelector("#room-host").value, false, "join");
    };
    panel.querySelector("#room-random").onclick = function () {
      panel.querySelector("#room-id").value = "";
      connectRoom("", panel.querySelector("#room-host").value, false, "create");
    };
    panel.querySelector("#room-robot").onclick = function () {
      disconnectRoom();
      beginGame("robot");
    };
    panel.querySelector("#room-match").onclick = function () {
      if (wasMatching) {
        disconnectRoom();
        currentRoom = "";
        updateMatchButton(false);
        setStatus("已取消匹配");
        return;
      }
      connectMatch(panel.querySelector("#room-host").value);
    };

    if (queryRoom) {
      var inviteRoom = normalizeRoom(queryRoom);
      if (inviteRoom) {
        connectRoom(inviteRoom, panel.querySelector("#room-host").value, false, "join");
      } else {
        setStatus("房间号为空或者房间不存在！");
      }
    }
  }

  function normalizeRoom(value) {
    return String(value || "").trim().replace(/[^0-9a-zA-Z_-]/g, "").slice(0, 16);
  }

  function clientCid() {
    var cid = localStorage.getItem("zyd_cid");
    if (!cid) {
      cid = "c" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
      localStorage.setItem("zyd_cid", cid);
    }
    return cid;
  }

  function stopReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect() {
    if (intentionalClose) {
      return;
    }
    if (reconnectAttempts >= RECONNECT_MAX) {
      setStatus("重连失败，请重新开始");
      return;
    }
    reconnectAttempts += 1;
    var delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 8000);
    setStatus("连接断开，" + Math.round(delay / 1000) + "s 后重连(" + reconnectAttempts + "/" + RECONNECT_MAX + ")…");
    stopReconnectTimer();
    reconnectTimer = setTimeout(function () {
      if (intentionalClose) {
        return;
      }
      if (currentRoom) {
        connectRoom(currentRoom, currentHost || location.host, true, "reconnect");
      } else if (wasMatching) {
        connectMatch(currentHost || location.host, true);
      }
    }, delay);
  }

  function closeSocketOnly() {
    if (socket) {
      try {
        socket.onclose = null;
        socket.onerror = null;
        socket.onmessage = null;
        socket.close();
      } catch (error) {}
    }
    socket = null;
  }

  function connectRoom(room, host, isReconnect, action) {
    action = isReconnect ? "reconnect" : (action || "join");
    if (!isReconnect) {
      intentionalClose = false;
      reconnectAttempts = 0;
      cleanupRoomState();
    }
    stopReconnectTimer();
    closeSocketOnly();
    clearInvite();
    currentRoom = room;
    currentRoomAction = action;
    currentHost = host || currentHost || location.host;
    wasMatching = false;
    updateMatchButton(false);
    setStatus(isReconnect ? "重连房间 " + room + " …" : (action === "create" ? "正在创建随机房间…" : "正在进入房间 " + room + " ..."));

    var protocol = location.protocol === "https:" ? "wss:" : "ws:";
    var url = protocol + "//" + (currentHost || location.host) + "/local-room" + (room ? "?room=" + encodeURIComponent(room) : "");
    try {
      socket = new WebSocket(url);
    } catch (error) {
      setStatus("连接失败");
      scheduleReconnect();
      return;
    }

    var roomSocket = socket;
    roomSocket.onopen = function () {
      reconnectAttempts = 0;
      roomSocket.send(JSON.stringify({
        type: "join",
        action: action,
        room: room,
        cid: clientCid(),
        name: clientName(),
        profile: clientProfile(),
        save: localStorage.getItem("playerData") || ""
      }));
      setStatus(isReconnect ? "正在恢复房间 " + room + " …" : (action === "create" ? "正在创建随机房间…" : "正在进入房间 " + room + " ..."));
    };
    roomSocket.onmessage = function (event) {
      var message;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        return;
      }
      handleRoomMessage(message);
    };
    roomSocket.onclose = function () {
      if (socket !== roomSocket) {
        return;
      }
      socket = null;
      if (intentionalClose) {
        setStatus("房间已断开");
        return;
      }
      if (!currentRoom && currentRoomAction === "create") {
        setStatus("创建房间失败，请重试");
        return;
      }
      scheduleReconnect();
    };
    roomSocket.onerror = function () {
      setStatus("连接异常");
    };
  }

  function connectMatch(host, isReconnect) {
    if (!isReconnect) {
      intentionalClose = false;
      reconnectAttempts = 0;
      cleanupRoomState();
    }
    stopReconnectTimer();
    closeSocketOnly();
    clearInvite();
    currentRoom = "";
    currentRoomAction = "match";
    currentHost = host || currentHost || location.host;
    wasMatching = true;
    updateMatchButton(true);
    setStatus("匹配中，正在寻找对手…");

    var protocol = location.protocol === "https:" ? "wss:" : "ws:";
    var url = protocol + "//" + (currentHost || location.host) + "/local-room?match=1";
    try {
      socket = new WebSocket(url);
    } catch (error) {
      setStatus("连接失败");
      scheduleReconnect();
      return;
    }

    var matchSocket = socket;
    matchSocket.onopen = function () {
      reconnectAttempts = 0;
      matchSocket.send(JSON.stringify({
        type: "join",
        action: "match",
        match: true,
        room: "",
        cid: clientCid(),
        name: clientName(),
        profile: clientProfile(),
        save: localStorage.getItem("playerData") || ""
      }));
      setStatus("匹配中，正在寻找对手…");
    };
    matchSocket.onmessage = function (event) {
      var message;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        return;
      }
      if (message.type === "matching") {
        setStatus("匹配中，正在寻找对手…");
        return;
      }
      handleRoomMessage(message);
    };
    matchSocket.onclose = function () {
      if (socket !== matchSocket) {
        return;
      }
      socket = null;
      if (intentionalClose) {
        setStatus("匹配已断开");
        return;
      }
      scheduleReconnect();
    };
    matchSocket.onerror = function () {
      setStatus("连接异常");
    };
  }

  function disconnectRoom() {
    intentionalClose = true;
    stopReconnectTimer();
    reconnectAttempts = 0;
    wasMatching = false;
    currentRoomAction = "";
    updateMatchButton(false);
    closeSocketOnly();
    cleanupRoomState();
  }

  function cleanupRoomState() {
    stopReconnectTimer();
    stopMatchProfileSync();
    reconnectAttempts = 0;
    wasMatching = false;
    currentRoomAction = "";
    roomBattleFinished = true;
    roomState.id = "";
    roomState.room = "";
    roomState.seat = -1;
    roomState.seed = "";
    roomState.state = "";
    roomState.source = "";
    roomState.clients = [];
    roomState.mode = "";
    currentRoom = "";
    updateMatchButton(false);
    pendingBattleMessages.length = 0;
    battleFlushScheduled = false;
    if (battleRetryTimer) {
      clearTimeout(battleRetryTimer);
      battleRetryTimer = null;
    }
    if (startClickRetryTimer) {
      clearInterval(startClickRetryTimer);
      startClickRetryTimer = null;
    }
    lastSentByKind = {};
    latestRemoteEnemyStateStamp = 0;
    battleResultSent = false;
    stopBattleSync();
    stopBattlePresenceSync();
    configureBattleRuntime(false);
    restoreRandom();
    var badge = document.getElementById("local-room-badge");
    if (badge) {
      badge.remove();
    }
    updateRoomInput("");
    clearInvite();
  }

  function handleRoomMessage(message) {
    if (message.type === "hello") {
      updateRoomState(message);
      wasMatching = false;
      currentRoomAction = "join";
      updateMatchButton(false);
      updateRoomInput(message.room);
      setInvite(message.room, currentHost || location.host);
      setStatus(message.state === "started" ? "正在恢复对战：" + message.room : "等待对手进入：" + message.room);
      return;
    }
    if (message.type === "room") {
      updateRoomState(message);
      var count = message.players || 1;
      setStatus(count >= 2 ? "对手已进入，准备开局：" + playerNames() : "等待对手进入：" + message.room);
    }
    if (message.type === "start") {
      updateRoomState(message);
      if (roomState.mode.indexOf("room:") === 0 && findBattleScene()) {
        configureBattleRuntime(true);
        startBattleSync();
        startBattlePresenceSync();
        setStatus("已重连房间，继续对战");
        updateBattleBadge();
        return;
      }
      setStatus("开始对战");
      beginGame("room:" + (message.room || currentRoom), message);
    }
    if (message.type === "battle") {
      handleBattleMessage(message);
    }
    if (message.type === "peerleft") {
      setStatus("对手已离开");
      handlePeerLeft(message);
    }
    if (message.type === "peeroffline") {
      setOpponentOffline(true);
      setStatus("对手暂时离线，已转为自动战斗");
      toast("对手离线，自动战斗已接管");
    }
    if (message.type === "peeronline") {
      setOpponentOffline(false);
      setStatus("对手已重新连接");
      toast("对手已重新连接");
    }
    if (message.type === "settled") {
      handleSettledRoom(message);
      return;
    }
    if (message.type === "roomclosed") {
      handleClosedRoom(message);
      return;
    }
    if (message.type === "error") {
      var errorText = message.message || "房间连接失败";
      if (message.code === "ROOM_NOT_FOUND" || message.code === "ROOM_UNAVAILABLE") {
        localStorage.removeItem("localBattleMode");
        localStorage.removeItem("localRoomMeta");
      }
      disconnectRoom();
      currentRoom = "";
      clearInvite();
      setStatus(errorText);
    }
  }

  function updateRoomState(message) {
    roomState.id = message.id || roomState.id;
    roomState.room = message.room || roomState.room || currentRoom;
    roomState.seat = typeof message.seat === "number" ? message.seat : roomState.seat;
    roomState.seed = message.seed || roomState.seed;
    roomState.state = message.state || roomState.state;
    roomState.source = message.source || roomState.source;
    roomState.clients = Array.isArray(message.clients) ? message.clients : roomState.clients;
    currentRoom = roomState.room || currentRoom;
    syncOpponentPresence();
    if (currentRoom) {
      updateRoomInput(currentRoom);
    }
  }

  function updateRoomInput(room) {
    var input = document.getElementById("room-id");
    if (input) {
      input.value = room || "";
    }
  }

  function updateMatchButton(matching) {
    var button = document.getElementById("room-match");
    if (button) {
      button.textContent = matching ? "取消匹配" : "开始匹配";
    }
  }

  function syncOpponentPresence() {
    if (roomState.mode.indexOf("room:") !== 0 || !roomState.id) {
      return;
    }
    var peer = null;
    for (var index = 0; index < roomState.clients.length; index += 1) {
      if (roomState.clients[index] && roomState.clients[index].id !== roomState.id) {
        peer = roomState.clients[index];
        break;
      }
    }
    setOpponentOffline(Boolean(peer && peer.connected === false));
  }

  function setOpponentOffline(offline) {
    var runtime = window.__LocalBattleRuntime;
    if (runtime && typeof runtime.setOpponentOffline === "function") {
      runtime.setOpponentOffline(!!offline);
    }
  }

  function handleSettledRoom(message) {
    var save = String(message && message.save || "");
    var runtime = window.__LocalBattleRuntime;
    if (runtime && runtime.pvp && typeof runtime.result === "function" && findBattleScene()) {
      try {
        runtime.result([!Boolean(message && message.won)]);
      } catch (error) {
        console.warn("[local-room] authoritative result apply failed", error);
      }
    }
    var key = roomBattleStorageKey();
    if (save) {
      setPlayerDataWithoutAccountSync(save);
    }
    localStorage.removeItem(key + ":own");
    localStorage.removeItem(key + ":base");
    sessionStorage.removeItem("localRoomBackupPlayerData");
    withoutRoomBattleSaveSync(function () {
      localStorage.removeItem("localBattleMode");
      localStorage.removeItem("localRoomMeta");
    });
    roomState.mode = "";
    roomBattleFinished = true;
    stopBattleSync();
    stopBattlePresenceSync();
    configureBattleRuntime(false);
    restoreRandom();
    toast(message && message.won ? "离线战斗已胜利结算" : "离线战斗已失败结算");
    clearRoomQuery();
    disconnectRoom();
  }

  function handleClosedRoom(message) {
    withoutRoomBattleSaveSync(function () {
      localStorage.removeItem("localBattleMode");
      localStorage.removeItem("localRoomMeta");
    });
    clearRoomQuery();
    disconnectRoom();
    setStatus(message && message.reason === "settled" ? "对战已结算，房间已销毁" : "房间已关闭");
  }

  function clearRoomQuery() {
    try {
      var url = new URL(location.href);
      if (!url.searchParams.has("room")) {
        return;
      }
      url.searchParams.delete("room");
      history.replaceState(history.state, document.title, url.pathname + (url.search ? url.search : "") + url.hash);
    } catch (error) {}
  }

  function playerNames() {
    return roomState.clients.slice().sort(function (a, b) {
      return (a.seat || 0) - (b.seat || 0);
    }).map(function (client) {
      return (client.seat + 1) + "P " + (client.name || "player");
    }).join(" / ");
  }

  function setInvite(room, host) {
    var invite = document.getElementById("room-invite");
    if (!invite) {
      return;
    }
    var url = location.protocol + "//" + host + location.pathname + "?room=" + encodeURIComponent(room);
    invite.innerHTML = '<button id="room-copy">复制邀请地址</button><div>' + escapeHtml(url) + "</div>";
    invite.querySelector("#room-copy").onclick = function () {
      copyInviteUrl(url).then(function () {
        toast("已复制邀请地址");
      }).catch(function () {
        toast("复制失败，请长按地址复制");
      });
    };
  }

  function clearInvite() {
    var invite = document.getElementById("room-invite");
    if (invite) {
      invite.innerHTML = "";
    }
  }

  function copyInviteUrl(url) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(url).catch(function () {
        if (legacyCopy(url)) {
          return;
        }
        return Promise.reject(new Error("copy failed"));
      });
    }
    return legacyCopy(url) ? Promise.resolve() : Promise.reject(new Error("copy failed"));
  }

  function legacyCopy(text) {
    var input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "readonly");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.top = "0";
    document.body.appendChild(input);
    input.focus();
    input.select();
    input.setSelectionRange(0, input.value.length);
    var copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (error) {}
    input.remove();
    return copied;
  }

  function setStatus(text) {
    var status = document.getElementById("room-status");
    if (status) {
      status.textContent = text;
    }
  }

  function beginGame(mode, meta) {
    if (meta) {
      updateRoomState(meta);
    }
    roomState.mode = mode;
    if (mode.indexOf("room:") === 0) {
      roomBattleFinished = false;
    }
    localStorage.setItem("localBattleMode", mode);
    localStorage.setItem("localRoomMeta", JSON.stringify(roomState));
    if (mode.indexOf("room:") === 0) {
      configureBattleRuntime(true);
      applyRoomSave(meta && meta.save);
      installSeededRandom(roomState.seed || roomState.room || mode);
      startMatchProfileSync();
      startBattleSync();
      startBattlePresenceSync();
    } else {
      configureBattleRuntime(false);
    }
    var panel = document.getElementById("local-room-panel");
    if (panel) {
      activePanel = null;
      panel.remove();
    }
    allowStartUntil = Date.now() + 1200;
    if (isMainScene()) {
      simulateStartClick();
    } else {
      waitForMainScene(simulateStartClick);
    }
  }

  function simulateStartClick() {
    var canvas = canvasBox();
    if (!canvas) {
      return;
    }
    if (startClickRetryTimer) {
      clearInterval(startClickRetryTimer);
      startClickRetryTimer = null;
    }

    var startedAt = Date.now();
    var clickStart = function () {
      if (findBattleScene() || Date.now() - startedAt >= 8000) {
        clearInterval(startClickRetryTimer);
        startClickRetryTimer = null;
        return;
      }
      var rect = canvas.getBoundingClientRect();
      var x = rect.left + rect.width * 320 / DESIGN_WIDTH;
      var y = rect.top + rect.height * 985 / DESIGN_HEIGHT;
      ["pointerdown", "mousedown", "mouseup", "click"].forEach(function (type) {
        var EventConstructor = type.indexOf("pointer") === 0 && window.PointerEvent ? window.PointerEvent : MouseEvent;
        var event = new EventConstructor(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: 0,
          pointerId: 1,
          isPrimary: true
        });
        canvas.dispatchEvent(event);
      });
    };
    clickStart();
    startClickRetryTimer = setInterval(clickStart, 250);
  }

  function clientName() {
    var data = {};
    try {
      data = JSON.parse(localStorage.getItem("playerData") || "{}");
    } catch (error) {}
    return data._nick || data._gameAvatar || "player";
  }

  function clientProfile() {
    var data = {};
    try {
      data = JSON.parse(localStorage.getItem("playerData") || "{}");
    } catch (error) {}
    var win = Number(data._win || 0);
    var lose = Number(data._lose || 0);
    var total = win + lose;
    return {
      avatar: data._gameAvatar || 1,
      rank: rankNameFromStar(data._curStar),
      winRate: total ? (win * 100 / total).toFixed(1) + "%" : "0.0%"
    };
  }

  function rankNameFromStar(value) {
    var star = Math.max(0, Math.floor(Number(value) || 0));
    if (star >= 250) {
      return "皇帝";
    }
    var ranks = ["军士", "校尉", "少将", "中将", "上将", "大将", "元帅", "诸侯", "霸主", "君主"];
    var levels = ["一", "二", "三", "四", "五"];
    var index = Math.min(49, Math.floor(star / 5));
    return ranks[Math.floor(index / 5)] + "." + levels[index % 5];
  }

  function startMatchProfileSync() {
    stopMatchProfileSync();
    var expiresAt = Date.now() + 10000;
    var appliedAt = 0;
    matchProfileTimer = setInterval(function () {
      if (roomState.mode.indexOf("room:") !== 0 || Date.now() >= expiresAt) {
        stopMatchProfileSync();
        return;
      }
      if (applyMatchProfiles()) {
        appliedAt = Date.now();
      } else if (appliedAt && Date.now() - appliedAt > 500) {
        stopMatchProfileSync();
      }
    }, 50);
  }

  function stopMatchProfileSync() {
    if (matchProfileTimer) {
      clearInterval(matchProfileTimer);
      matchProfileTimer = null;
    }
  }

  function applyMatchProfiles() {
    if (!window.Laya || !Laya.stage || !roomState.id) {
      return false;
    }
    var own = null;
    var peer = null;
    for (var index = 0; index < roomState.clients.length; index += 1) {
      var client = roomState.clients[index];
      if (!client) {
        continue;
      }
      if (client.id === roomState.id) {
        own = client;
      } else if (!peer) {
        peer = client;
      }
    }
    if (!own || !peer) {
      return false;
    }
    var redRank = findLayaNodeByName(Laya.stage, "redRank");
    var blueRank = findLayaNodeByName(Laya.stage, "blueRank");
    if (!redRank || !blueRank) {
      return false;
    }
    applyMatchProfile("red", own.profile || {});
    applyMatchProfile("blue", peer.profile || {});
    return true;
  }

  function applyMatchProfile(side, profile) {
    var rank = findLayaNodeByName(Laya.stage, side + "Rank");
    var winRate = findLayaNodeByName(Laya.stage, side + "WinRate");
    var avatar = findLayaNodeByName(Laya.stage, side + "Avatar");
    var avatarId = Math.max(1, Math.min(16, Math.floor(Number(profile.avatar) || 1)));
    if (rank) {
      rank.text = profile.rank || "军士.一";
    }
    if (winRate) {
      winRate.text = profile.winRate || "0.0%";
    }
    if (avatar) {
      avatar.skin = "resources/img/mainUI/avatar/avatar" + avatarId + ".png";
    }
  }

  function findLayaNodeByName(root, name) {
    if (!root) {
      return null;
    }
    if (root.name === name) {
      return root;
    }
    var count = root.numChildren || 0;
    for (var index = 0; index < count; index += 1) {
      var found = findLayaNodeByName(root.getChildAt(index), name);
      if (found) {
        return found;
      }
    }
    return null;
  }

  function applyRoomSave(save) {
    if (!save) {
      return;
    }
    try {
      JSON.parse(save);
    } catch (error) {
      return;
    }
    var ownSave = localStorage.getItem("playerData") || "";
    var key = roomBattleStorageKey();
    localStorage.setItem(key + ":own", ownSave);
    localStorage.setItem(key + ":base", save);
    sessionStorage.setItem("localRoomBackupPlayerData", ownSave);
    setPlayerDataWithoutAccountSync(save);
  }

  function roomBattleStorageKey() {
    var user = window.__ZYYAD_AUTH && window.__ZYYAD_AUTH.user;
    var name = user && user.username ? user.username : "guest";
    return "localRoomBattleSave:" + String(name).replace(/[^0-9A-Za-z_-]/g, "_");
  }

  function finishRoomBattle(localWin) {
    if (roomBattleFinished) {
      return;
    }
    roomBattleFinished = true;
    var key = roomBattleStorageKey();
    var ownText = localStorage.getItem(key + ":own") || sessionStorage.getItem("localRoomBackupPlayerData") || "";
    var baseText = localStorage.getItem(key + ":base") || "";
    var currentText = localStorage.getItem("playerData") || "";
    var merged = mergeRoomBattleSave(ownText, baseText, currentText, !!localWin);
    var auth = window.__ZYYAD_AUTH;

    withoutRoomBattleSaveSync(function () {
      localStorage.setItem("playerData", merged);
      localStorage.removeItem("localBattleMode");
      localStorage.removeItem("localRoomMeta");
    });
    localStorage.removeItem(key + ":own");
    localStorage.removeItem(key + ":base");
    sessionStorage.removeItem("localRoomBackupPlayerData");
    roomState.mode = "";
    stopBattleSync();
    stopBattlePresenceSync();
    configureBattleRuntime(false);
    restoreRandom();
    if (auth && typeof auth.saveNow === "function") {
      auth.saveNow(merged).catch(function () {
        localStorage.setItem(key + ":own", merged);
      });
    }
  }

  function withoutRoomBattleSaveSync(callback) {
    var auth = window.__ZYYAD_AUTH;
    if (auth && typeof auth.withoutSaveSync === "function") {
      auth.withoutSaveSync(callback);
      return;
    }
    callback();
  }

  function mergeRoomBattleSave(ownText, baseText, currentText, localWin) {
    var own = parseSaveObject(ownText);
    var base = parseSaveObject(baseText);
    var current = parseSaveObject(currentText);
    if (!Object.keys(own).length && Object.keys(current).length) {
      own = current;
    }
    var numericFields = ["_curStar", "_lastStar", "_win", "_lose", "_winDay", "_loseDay", "_winStreak", "_maxWinStreak"];
    var changed = false;
    var starChanged = false;
    var recordChanged = false;
    numericFields.forEach(function (field) {
      var before = Number(base[field]);
      var after = Number(current[field]);
      if (isFinite(before) && isFinite(after) && after !== before) {
        var ownValue = Number(own[field]);
        own[field] = Math.max(0, (isFinite(ownValue) ? ownValue : 0) + after - before);
        changed = true;
        if (field === "_curStar") {
          starChanged = true;
        }
        if (field === "_win" || field === "_lose") {
          recordChanged = true;
        }
      }
    });
    if (!starChanged) {
      var oldStar = Math.max(1, Math.floor(Number(own._curStar) || 1));
      own._lastStar = oldStar;
      own._curStar = Math.max(1, oldStar + (localWin ? 1 : -1));
      changed = true;
    }
    if (!recordChanged) {
      own._win = Math.max(0, Math.floor(Number(own._win) || 0) + (localWin ? 1 : 0));
      own._lose = Math.max(0, Math.floor(Number(own._lose) || 0) + (localWin ? 0 : 1));
      own._winStreak = localWin ? Math.max(0, Math.floor(Number(own._winStreak) || 0) + 1) : 0;
    }
    return JSON.stringify(own);
  }

  function parseSaveObject(text) {
    try {
      var data = JSON.parse(String(text || "{}"));
      return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    } catch (error) {
      return {};
    }
  }

  function setPlayerDataWithoutAccountSync(save) {
    var auth = window.__ZYYAD_AUTH;
    if (auth && typeof auth.withoutSaveSync === "function") {
      auth.withoutSaveSync(function () {
        localStorage.setItem("playerData", save);
      });
      return;
    }
    localStorage.setItem("playerData", save);
  }

  function installSeededRandom(seed) {
    randomState = hashSeed(seed || "room");
    Math.random = function () {
      randomState = (randomState * 1664525 + 1013904223) >>> 0;
      return randomState / 4294967296;
    };
  }

  function restoreRandom() {
    if (Math.random !== originalRandom) {
      Math.random = originalRandom;
    }
  }

  function hashSeed(value) {
    var text = String(value || "room");
    var hash = 2166136261;
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0 || 1;
  }

  function startBattleSync() {
    if (battleSyncTimer) {
      return;
    }
    battleSyncTimer = setInterval(function () {
      var scene = findBattleScene();
      if (scene) {
        attachBattleSync(scene);
      }
    }, 250);
  }

  function stopBattleSync() {
    if (battleSyncTimer) {
      clearInterval(battleSyncTimer);
      battleSyncTimer = null;
    }
  }

  function startBattlePresenceSync() {
    if (battlePresenceTimer) {
      return;
    }
    battlePresenceTimer = setInterval(function () {
      if (roomState.mode.indexOf("room:") !== 0) {
        stopBattlePresenceSync();
        return;
      }
      var scene = findBattleScene();
      if (!scene) {
        return;
      }
      attachBattleSync(scene);
      checkLocalBattleResult();
    }, 300);
  }

  function stopBattlePresenceSync() {
    if (battlePresenceTimer) {
      clearInterval(battlePresenceTimer);
      battlePresenceTimer = null;
    }
  }

  function checkLocalBattleResult() {
    if (battleResultSent || applyingRemote || roomState.mode.indexOf("room:") !== 0) {
      return;
    }
    var qc = null;
    try {
      qc = window.Ct && Ct.instance && Ct.instance().qc;
    } catch (error) {}
    if (!qc) {
      return;
    }
    var ownHp = Number(qc.Zi);
    var enemyHp = Number(qc.Ki);
    var localWin = null;
    if (isFinite(ownHp) && ownHp <= 0) {
      localWin = false;
    } else if (isFinite(enemyHp) && enemyHp <= 0) {
      localWin = true;
    }
    if (localWin === null) {
      return;
    }
    battleResultSent = true;
    sendBattleMessage({
      kind: "result",
      args: [localWin],
      reason: "hp",
      stamp: Date.now()
    });
  }

  function handlePeerLeft(message) {
    if (roomState.mode.indexOf("room:") !== 0) {
      return;
    }
    forceRoomWin("对手已离开，本局按胜利处理");
  }

  function forceRoomWin(text) {
    if (battleResultSent) {
      return;
    }
    var scene = findBattleScene();
    if (!scene) {
      toast(text || "对手已离开");
      return;
    }
    battleResultSent = true;
    toast(text || "对手已离开");
    applyRemoteResult([false]);
  }

  function findBattleScene() {
    if (!window.Laya || !Laya.stage) {
      return null;
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
    return found;
  }

  function attachBattleSync(scene) {
    if (scene.__localRoomSynced) {
      flushBattleQueue(scene);
      updateBattleBadge();
      stopBattleSync();
      return;
    }

    scene.__localRoomSynced = true;
    scene.__localRoomOriginals = {};
    ["iq", "mq", "xN", "cq", "vq", "WN", "jN", "zN", "hq", "kq", "_q", "eq", "Sq", "bq", "xq", "JN", "gameOver"].forEach(function (name) {
      wrapBattleMethod(scene, name);
    });
    updateBattleBadge();
    flushBattleQueue(scene);
    stopBattleSync();
  }

  function wrapBattleMethod(scene, name) {
    if (typeof scene[name] !== "function") {
      return;
    }
    scene.__localRoomOriginals[name] = scene[name];
    scene[name] = function () {
      var args = Array.prototype.slice.call(arguments);
      if (!applyingRemote && shouldCaptureRecruit(name, args)) {
        captureRecruitSpawn();
      }
      var result = scene.__localRoomOriginals[name].apply(scene, args);
      if (!applyingRemote && shouldShareBattleCall(name, args)) {
        sendBattleMessage({
          kind: "call",
          method: name,
          args: safeArgs(args),
          stamp: Date.now()
        });
      }
      return result;
    };
  }

  function shouldShareBattleCall(name, args) {
    if (roomState.mode.indexOf("room:") !== 0) {
      return false;
    }
    if (name === "iq" || name === "zN") {
      return false;
    }
    if (isInternalPropMethod(name)) {
      return false;
    }
    if (hasSideArg(name)) {
      return args[0] === true;
    }
    return name === "xq";
  }

  function shouldCaptureRecruit(name, args) {
    if (roomState.mode.indexOf("room:") !== 0) {
      return false;
    }
    return name === "mq" || name === "xN" || name === "cq" || (name === "iq" && args[0] === true);
  }

  function captureRecruitSpawn() {
    var runtime = window.__LocalBattleRuntime;
    if (runtime && typeof runtime.captureRecruit === "function") {
      runtime.captureRecruit();
    }
  }

  function hasSideArg(name) {
    return name === "iq" || name === "vq" || name === "WN" || name === "jN" || name === "zN" || name === "hq" || name === "kq" || name === "_q" || name === "eq" || name === "Sq" || name === "bq" || name === "JN";
  }

  function isInternalPropMethod(name) {
    return name === "kq" || name === "_q" || name === "Sq" || name === "bq";
  }

  function safeArgs(args) {
    return args.map(function (value) {
      if (value == null || typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
        return value;
      }
      return null;
    });
  }

  function sendBattleMessage(data) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    if (!data) {
      return;
    }
    var buffered = Number(socket.bufferedAmount || 0);
    if (buffered > MAX_SOCKET_BUFFERED_BYTES) {
      return;
    }
    if (data.kind === "enemyState") {
      var now = Date.now();
      if (now - (lastSentByKind.enemyState || 0) < ENEMY_STATE_SEND_INTERVAL) {
        return;
      }
      lastSentByKind.enemyState = now;
    }
    try {
      socket.send(JSON.stringify({ type: "battle", data: data }));
    } catch (error) {}
  }

  function handleBattleMessage(message) {
    if (message.from && message.from === roomState.id) {
      return;
    }
    var data = message.data || {};
    if (data.kind === "enemyState") {
      var stamp = Number(data.stamp || 0);
      if (stamp && stamp <= latestRemoteEnemyStateStamp) {
        return;
      }
      latestRemoteEnemyStateStamp = stamp || Date.now();
    }
    var scene = findBattleScene();
    if (!scene || !scene.__localRoomSynced) {
      queueBattleMessage(data);
      startBattleSync();
      return;
    }
    if (pendingBattleMessages.length) {
      queueBattleMessage(data);
      scheduleBattleFlush(scene, 0);
      return;
    }
    if (!applyBattleMessage(scene, data)) {
      queueBattleMessage(data, true);
      scheduleBattleFlush(scene, 80);
    }
  }

  function queueBattleMessage(data, front) {
    if (!data) {
      return;
    }
    if (data && data.kind === "enemyState") {
      for (var i = pendingBattleMessages.length - 1; i >= 0; i -= 1) {
        if (pendingBattleMessages[i] && pendingBattleMessages[i].kind === "enemyState") {
          pendingBattleMessages.splice(i, 1);
        }
      }
    }
    if (front) {
      pendingBattleMessages.unshift(data);
    } else {
      pendingBattleMessages.push(data);
    }
    if (pendingBattleMessages.length > MAX_PENDING_BATTLE_MESSAGES) {
      pendingBattleMessages.splice(0, pendingBattleMessages.length - MAX_PENDING_BATTLE_MESSAGES);
    }
  }

  function flushBattleQueue(scene) {
    battleFlushScheduled = false;
    var count = 0;
    while (pendingBattleMessages.length && count < MAX_BATTLE_QUEUE_PER_FLUSH) {
      var data = pendingBattleMessages.shift();
      if (!applyBattleMessage(scene, data)) {
        data.__retry = Number(data.__retry || 0) + 1;
        if (data.__retry <= MAX_BATTLE_MESSAGE_RETRIES) {
          pendingBattleMessages.unshift(data);
          scheduleBattleFlush(scene, Math.min(800, 80 * data.__retry));
        } else {
          console.warn("[local-room] battle message dropped after retries", data.kind);
        }
        return;
      }
      count += 1;
    }
    if (pendingBattleMessages.length) {
      scheduleBattleFlush(scene, 0);
    }
  }

  function scheduleBattleFlush(scene, delay) {
    if (battleFlushScheduled || battleRetryTimer) {
      return;
    }
    battleFlushScheduled = true;
    battleRetryTimer = setTimeout(function () {
      battleRetryTimer = null;
      flushBattleQueue(scene);
    }, Math.max(0, Number(delay) || 0));
  }

  function battleResult(value) {
    return value === false ? false : true;
  }

  function applyBattleCall(scene, data) {
    if (data.kind !== "call" || typeof scene[data.method] !== "function") {
      return true;
    }
    applyingRemote = true;
    try {
      scene[data.method].apply(scene, remoteArgs(scene, data.method, data.args));
      return true;
    } catch (error) {
      console.warn("[local-room] battle sync failed", data.method, error);
      return false;
    } finally {
      applyingRemote = false;
    }
  }

  function applyBattleMessage(scene, data) {
    if (!data) {
      return;
    }
    if (data.kind === "spawn") {
      return battleResult(spawnRemoteUnit(data.args));
    }
    if (data.kind === "item") {
      return battleResult(applyRemoteItem(data.args));
    }
    if (data.kind === "wave") {
      return battleResult(applyRemoteWave(data.args));
    }
    if (data.kind === "op") {
      return battleResult(applyRemoteOperation(data.op));
    }
    if (data.kind === "result") {
      applyRemoteResult(data.args);
      return true;
    }
    if (data.kind === "event") {
      return battleResult(applyRemoteEvent(data.name, data.args));
    }
    if (data.kind === "enemyGone") {
      return battleResult(applyRemoteEnemyGone(data.enemy));
    }
    if (data.kind === "enemyState") {
      applyRemoteEnemyState(data.enemies);
      return true;
    }
    if (data.kind === "leave") {
      handlePeerLeft(data);
      return true;
    }
    if (data.kind === "recruit") {
      spawnRemoteRecruit(data.index);
      return true;
    }
    return applyBattleCall(scene, data);
  }

  function remoteArgs(scene, method, args) {
    var result = Array.isArray(args) ? args.slice() : [];
    if (hasSideArg(method)) {
      result[0] = false;
    }
    mirrorSceneArgs(scene, method, result);
    return result;
  }

  function mirrorSceneArgs(scene, method, args) {
    if (method === "WN" || method === "jN") {
      mirrorMapPoint(scene, args, 1, 2);
      return;
    }
    if (method === "vq" && typeof args[3] === "number" && typeof args[4] === "number" && args[3] >= 0 && args[4] >= 0) {
      mirrorMapPoint(scene, args, 3, 4);
    }
  }

  function mirrorMapPoint(scene, args, xIndex, yIndex) {
    var size = mapSize(scene);
    if (!size) {
      return;
    }
    if (typeof args[xIndex] === "number") {
      args[xIndex] = size.width - 1 - args[xIndex];
    }
    if (typeof args[yIndex] === "number") {
      args[yIndex] = size.height - 1 - args[yIndex];
    }
  }

  function mapSize(scene) {
    var pe = scene && scene.zm && scene.zm.map && scene.zm.map.pe;
    if (!pe || !pe.length || !pe[0]) {
      return null;
    }
    return { width: pe.length, height: pe[0].length };
  }

  function configureBattleRuntime(enabled) {
    installRecruitHook();
    var runtime = window.__LocalBattleRuntime;
    if (runtime && typeof runtime.setPvp === "function") {
      runtime.setPvp(enabled);
      if (enabled) {
        syncOpponentPresence();
      } else if (typeof runtime.setOpponentOffline === "function") {
        runtime.setOpponentOffline(false);
      }
    }
  }

  function installRecruitHook() {
    var runtime = window.__LocalBattleRuntime;
    if (!runtime || runtime.__localRoomRecruitHooked) {
      return;
    }
    runtime.__localRoomRecruitHooked = true;
    runtime.onSpawn = function (args) {
      if (!runtime.pvp || applyingRemote || roomState.mode.indexOf("room:") !== 0) {
        return;
      }
      sendBattleMessage({
        kind: "spawn",
        args: safeArgs(Array.isArray(args) ? args : []),
        stamp: Date.now()
      });
    };
    runtime.onItem = function (args) {
      if (!runtime.pvp || applyingRemote || roomState.mode.indexOf("room:") !== 0) {
        return;
      }
      sendBattleMessage({
        kind: "item",
        args: safeArgs(Array.isArray(args) ? args : []),
        stamp: Date.now()
      });
    };
    runtime.onWave = function (args) {
      if (!runtime.pvp || applyingRemote || roomState.mode.indexOf("room:") !== 0) {
        return;
      }
      sendBattleMessage({
        kind: "wave",
        args: safeArgs(Array.isArray(args) ? args : []),
        stamp: Date.now()
      });
    };
    runtime.onOp = function (op) {
      if (!runtime.pvp || applyingRemote || roomState.mode.indexOf("room:") !== 0) {
        return;
      }
      sendBattleMessage({
        kind: "op",
        op: safeOperation(op),
        stamp: Date.now()
      });
    };
    runtime.onResult = function (args) {
      if (!runtime.pvp || applyingRemote || roomState.mode.indexOf("room:") !== 0) {
        return;
      }
      var resultArgs = safeArgs(Array.isArray(args) ? args : []);
      sendBattleMessage({
        kind: "result",
        args: resultArgs,
        save: localStorage.getItem("playerData") || "",
        stamp: Date.now()
      });
      setTimeout(function () {
        finishRoomBattle(Boolean(resultArgs[0]));
      }, 120);
    };
    runtime.onEvent = function (payload) {
      if (!runtime.pvp || applyingRemote || roomState.mode.indexOf("room:") !== 0) {
        return;
      }
      sendBattleMessage({
        kind: "event",
        name: payload && payload.name,
        args: safeArgs(Array.isArray(payload && payload.args) ? payload.args : []),
        stamp: Date.now()
      });
    };
    runtime.onEnemyGone = function (enemy) {
      if (!runtime.pvp || applyingRemote || roomState.mode.indexOf("room:") !== 0) {
        return;
      }
      sendBattleMessage({
        kind: "enemyGone",
        enemy: safeEnemy(enemy),
        stamp: Date.now()
      });
    };
    runtime.onEnemyState = function (enemies) {
      if (!runtime.pvp || applyingRemote || roomState.mode.indexOf("room:") !== 0) {
        return;
      }
      sendBattleMessage({
        kind: "enemyState",
        enemies: safeEnemies(enemies),
        stamp: Date.now()
      });
    };
  }

  function safeOperation(op) {
    var result = {};
    op = op || {};
    ["type", "kY", "_Y", "xY", "mY", "targetX", "targetY", "VL"].forEach(function (key) {
      var value = op[key];
      if (value == null || typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
        result[key] = value;
      }
    });
    return result;
  }

  function safeEnemy(enemy) {
    var result = {};
    enemy = enemy || {};
    ["id", "type", "nm", "vm", "Zi", "x", "y", "curState", "VL"].forEach(function (key) {
      var value = enemy[key];
      if (value == null || typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
        result[key] = value;
      }
    });
    return result;
  }

  function safeEnemies(enemies) {
    if (!Array.isArray(enemies)) {
      return [];
    }
    return enemies.slice(0, 30).map(safeEnemy);
  }

  function spawnRemoteRecruit(index) {
    spawnRemoteUnit([true, 0, 1, Number(index) || 0]);
  }

  function spawnRemoteUnit(args) {
    var runtime = window.__LocalBattleRuntime;
    if (!runtime || typeof runtime.spawn !== "function") {
      return false;
    }
    applyingRemote = true;
    try {
      return runtime.spawn(Array.isArray(args) ? args : []);
    } catch (error) {
      console.warn("[local-room] spawn sync failed", error);
      return false;
    } finally {
      applyingRemote = false;
    }
  }

  function applyRemoteItem(args) {
    var runtime = window.__LocalBattleRuntime;
    if (!runtime || typeof runtime.item !== "function") {
      return false;
    }
    applyingRemote = true;
    try {
      return runtime.item(Array.isArray(args) ? args : []);
    } catch (error) {
      console.warn("[local-room] item sync failed", error);
      return false;
    } finally {
      applyingRemote = false;
    }
  }

  function applyRemoteWave(args) {
    var runtime = window.__LocalBattleRuntime;
    if (!runtime || typeof runtime.wave !== "function") {
      return false;
    }
    applyingRemote = true;
    try {
      return runtime.wave(Array.isArray(args) ? args : []);
    } catch (error) {
      console.warn("[local-room] wave sync failed", error);
      return false;
    } finally {
      applyingRemote = false;
    }
  }

  function applyRemoteOperation(op) {
    var runtime = window.__LocalBattleRuntime;
    if (!runtime || typeof runtime.op !== "function") {
      return false;
    }
    applyingRemote = true;
    try {
      var result = runtime.op(op || {});
      return !result || result.success !== false;
    } catch (error) {
      console.warn("[local-room] operation sync failed", error);
      return false;
    } finally {
      applyingRemote = false;
    }
  }

  function applyRemoteResult(args) {
    var runtime = window.__LocalBattleRuntime;
    if (!runtime || typeof runtime.result !== "function") {
      return;
    }
    applyingRemote = true;
    try {
      runtime.result(Array.isArray(args) ? args : []);
      setTimeout(function () {
        finishRoomBattle(!Boolean(Array.isArray(args) && args[0]));
      }, 120);
    } catch (error) {
      console.warn("[local-room] result sync failed", error);
    } finally {
      applyingRemote = false;
    }
  }

  function applyRemoteEvent(name, args) {
    var runtime = window.__LocalBattleRuntime;
    if (!runtime || typeof runtime.event !== "function") {
      return false;
    }
    applyingRemote = true;
    try {
      runtime.event(name, Array.isArray(args) ? args : []);
      return true;
    } catch (error) {
      console.warn("[local-room] event sync failed", error);
      return false;
    } finally {
      applyingRemote = false;
    }
  }

  function applyRemoteEnemyGone(enemy) {
    var runtime = window.__LocalBattleRuntime;
    if (!runtime || typeof runtime.enemyGone !== "function") {
      return false;
    }
    applyingRemote = true;
    try {
      return runtime.enemyGone(enemy || {});
    } catch (error) {
      console.warn("[local-room] enemy remove sync failed", error);
      return false;
    } finally {
      applyingRemote = false;
    }
  }

  function applyRemoteEnemyState(enemies) {
    var runtime = window.__LocalBattleRuntime;
    if (!runtime || typeof runtime.enemyState !== "function") {
      return;
    }
    applyingRemote = true;
    try {
      runtime.enemyState(Array.isArray(enemies) ? enemies : []);
    } catch (error) {
      console.warn("[local-room] enemy state sync failed", error);
    } finally {
      applyingRemote = false;
    }
  }

  function updateBattleBadge() {
    if (roomState.mode.indexOf("room:") !== 0) {
      return;
    }
    var badge = document.getElementById("local-room-badge");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "local-room-badge";
      document.body.appendChild(badge);
    }
    badge.textContent = "房间 " + (roomState.room || currentRoom) + " | " + playerNames();
  }

  function toast(text) {
    var toastNode = document.getElementById("local-room-toast");
    if (!toastNode) {
      toastNode = document.createElement("div");
      toastNode.id = "local-room-toast";
      document.body.appendChild(toastNode);
    }
    toastNode.textContent = text;
    toastNode.className = "show";
    setTimeout(function () {
      toastNode.className = "";
    }, 1200);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function injectStyle() {
    if (document.getElementById("local-room-style")) {
      return;
    }
    var style = document.createElement("style");
    style.id = "local-room-style";
    style.textContent = [
      "#local-room-panel{position:fixed;left:50%;top:50%;z-index:2147483646;width:min(390px,calc(100vw - 24px));transform:translate(-50%,-50%);background:rgba(20,24,26,.97);border:1px solid rgba(255,255,255,.18);border-radius:8px;color:#fff;box-shadow:0 16px 42px rgba(0,0,0,.45);font:14px Arial,'Microsoft YaHei',sans-serif}",
      ".room-head{display:flex;align-items:center;justify-content:space-between;padding:11px 13px;border-bottom:1px solid rgba(255,255,255,.13)}.room-head button{width:30px;height:30px;border:0;border-radius:5px;background:#394047;color:#fff;font-size:20px;cursor:pointer}",
      ".room-body{padding:13px}.room-field{display:block;margin-bottom:10px}.room-field span{display:block;margin-bottom:4px;color:#ccd4dd}.room-field input{box-sizing:border-box;width:100%;height:36px;border:1px solid #53606b;border-radius:5px;background:#101417;color:#fff;padding:0 9px;font-size:15px}",
      ".room-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}.room-actions button,#room-copy{height:36px;border:0;border-radius:5px;background:#b4472f;color:#fff;font-weight:700;cursor:pointer}.room-actions button:nth-child(2){background:#3f6f9f}.room-actions button:nth-child(3){background:#52764a}",
      "#room-status{min-height:22px;color:#ffe17a;margin-top:8px}#room-invite{margin-top:9px;color:#d8e0e8;word-break:break-all;font-size:12px;line-height:1.45}#room-copy{width:118px;margin-bottom:6px;background:#58606a}",
      "#local-room-badge{position:fixed;left:50%;top:8px;z-index:2147483645;transform:translateX(-50%);max-width:min(560px,calc(100vw - 28px));box-sizing:border-box;padding:6px 10px;border-radius:6px;background:rgba(12,18,22,.72);color:#ffe17a;font:12px Arial,'Microsoft YaHei',sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}",
      "#local-room-toast{position:fixed;left:50%;top:62px;z-index:2147483647;transform:translateX(-50%);background:rgba(0,0,0,.76);color:#fff;padding:8px 12px;border-radius:6px;opacity:0;pointer-events:none;transition:opacity .18s}#local-room-toast.show{opacity:1}"
    ].join("");
    document.head.appendChild(style);
  }

  function resumeStoredRoom() {
    var mode = localStorage.getItem("localBattleMode") || "";
    if (mode.indexOf("room:") !== 0) {
      return false;
    }
    var meta = null;
    try {
      meta = JSON.parse(localStorage.getItem("localRoomMeta") || "null");
    } catch (error) {}
    if (!meta || !meta.room) {
      localStorage.removeItem("localBattleMode");
      localStorage.removeItem("localRoomMeta");
      return false;
    }
    roomState.id = meta.id || "";
    roomState.room = String(meta.room);
    roomState.seat = typeof meta.seat === "number" ? meta.seat : -1;
    roomState.seed = meta.seed || "";
    roomState.state = meta.state || "started";
    roomState.source = meta.source || "";
    roomState.clients = Array.isArray(meta.clients) ? meta.clients : [];
    roomState.mode = mode;
    currentRoom = roomState.room;
    currentHost = location.host;
    intentionalClose = false;
    connectRoom(currentRoom, currentHost, true, "reconnect");
    return true;
  }

  ready(function () {
    injectStyle();
    installRecruitHook();
    window.addEventListener("resize", layoutPanel);
    ["pointerdown", "mousedown", "touchstart", "click"].forEach(function (type) {
      document.addEventListener(type, captureStart, true);
    });

    if (new URLSearchParams(location.search).get("room")) {
      waitForMainScene(showPanel);
    } else {
      resumeStoredRoom();
    }

    window.localRoom = {
      open: showPanel,
      startRobot: function () {
        beginGame("robot");
      },
      state: roomState,
      sendBattle: sendBattleMessage,
      findBattle: findBattleScene
    };
  });

  function waitForMainScene(callback) {
    var start = Date.now();
    var timer = setInterval(function () {
      if (isMainScene()) {
        clearInterval(timer);
        callback();
      } else if (Date.now() - start > 8000) {
        clearInterval(timer);
      }
    }, 250);
  }
})();
