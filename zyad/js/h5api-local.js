(function () {
  function later(callback, value) {
    if (typeof callback === "function") {
      setTimeout(function () {
        callback(value);
      }, 0);
    }
  }

  function ok(data) {
    return { code: 0, success: true, data: data || {} };
  }

  function request(path, options, callback, fallback) {
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
    fetch(path, fetchOptions)
      .then(function (response) {
        return response.json().catch(function () {
          return {};
        });
      })
      .then(function (payload) {
        later(callback, payload && payload.success !== false ? payload : ok(payload.data || payload));
      })
      .catch(function () {
        later(callback, fallback === undefined ? ok() : fallback);
      });
  }

  function adOk(extra) {
    var result = Object.assign({ code: 10001, success: true, message: "local ad complete" }, extra || {});
    return result;
  }

  window.h5api = {
    initGame: function () {},
    progress: function () {},
    submitScore: function (score, callback) {
      request("/api/score", { method: "POST", body: { score: score, rankId: "default" } }, callback, ok({ score: score }));
    },
    getRank: function (callback) {
      fetch("/api/rank")
        .then(function (response) {
          return response.json();
        })
        .then(function (payload) {
          later(callback, payload.data || []);
        })
        .catch(function () {
          later(callback, []);
        });
    },
    canPlayAd: function (callback) {
      later(callback, true);
      return true;
    },
    playAd: function (callback) {
      later(callback, adOk());
      return adOk();
    },
    playYlhAd: function (placementId, callback) {
      later(callback, adOk({ placementId: placementId }));
      return adOk({ placementId: placementId });
    },
    playInterstitialAd: function (callback) {
      later(callback, adOk());
      return adOk();
    },
    share: function () {},
    isLogin: function () {
      return !!(window.__ZYYAD_AUTH && window.__ZYYAD_AUTH.user);
    },
    login: function (callback) {
      later(callback, ok({ local: true, user: window.__ZYYAD_AUTH && window.__ZYYAD_AUTH.user }));
    },
    getUserAvatar: function () {
      return "";
    },
    getUserSmallAvatar: function () {
      return "";
    },
    getUserBigAvatar: function () {
      return "";
    },
    getUserLargeAvatar: function () {
      return "";
    },
    submitRanking: function (score, callback) {
      request("/api/score", { method: "POST", body: { score: score, rankId: "default" } }, callback, ok({ score: score }));
    },
    submitRankScore: function (rankId, score, callback) {
      request("/api/score", { method: "POST", body: { score: score, rankId: rankId || "default" } }, callback, ok({ rankId: rankId, score: score }));
    },
    getMyRanking: function (callback) {
      later(callback, ok());
    },
    getRanking: function (callback) {
      fetch("/api/rank")
        .then(function (response) {
          return response.json();
        })
        .then(function (payload) {
          later(callback, payload.data || []);
        })
        .catch(function () {
          later(callback, []);
        });
    },
    showRanking: function () {
      if (window.__ZYYAD_AUTH && typeof window.__ZYYAD_AUTH.showRankPanel === "function") {
        window.__ZYYAD_AUTH.showRankPanel();
      }
    },
    showRankList: function () {
      if (window.__ZYYAD_AUTH && typeof window.__ZYYAD_AUTH.showRankPanel === "function") {
        window.__ZYYAD_AUTH.showRankPanel();
      }
    },
    getNearRanking: function (callback) {
      later(callback, []);
    },
    checkWord: function (word, callback) {
      later(callback, ok({ word: word, pass: true }));
    },
    showRecommend: function () {},
    save: function (params) {
      if (!params || typeof params.callback !== "function") {
        return;
      }

      if (params.type === "read") {
        fetch("/api/save", { credentials: "same-origin" })
          .then(function (response) {
            return response.json();
          })
          .then(function (payload) {
            later(params.callback, ok(payload.data && payload.data.playerData ? payload.data.playerData : null));
          })
          .catch(function () {
            later(params.callback, ok(localStorage.getItem("playerData") || null));
          });
      } else {
        var playerData = params.data || params.value || localStorage.getItem("playerData") || "";
        request("/api/save", { method: "POST", body: { playerData: playerData } }, params.callback, ok());
      }
    },
    gameMode: function () {},
    showGuide: function (callback) {
      later(callback, ok());
    },
    checkAPI: function () {}
  };
})();
