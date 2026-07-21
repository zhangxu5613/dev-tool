# 赵云与阿斗 H5 - API 接口文档

> 通过分析 `bundle.js`、`auth-client.js`、`h5api-local.js`、`gm-launcher.js` 中所有 fetch 调用点 + 入参 payload 结构 + 调用上下文 + 后续代码逻辑反推得出。
>
> 提取日期：2026-07-21

---

## 目录

1. [总览](#1-总览)
2. [认证类 API（auth-client.js 私有）](#2-认证类-api)
3. [游戏业务 API（bundle.js 内部 Y/Service 类）](#3-游戏业务-api)
4. [数据上报 API](#4-数据上报-api)
5. [h5api 公开方法（h5api-local.js）](#5-h5api-公开方法)
6. [附录：Server 类的内部结构](#6-附录server-类的内部结构)

---

## 1. 总览

### 1.1 架构

- **HTTP client**：`Laya.HttpRequest`，5 秒超时（`Y["Aa"]=5000`）
- **请求头**：`Content-Type: application/json` + `authentication: <token>`（登录后由 `Da()` 设置）
- **基础 URL**：`Server.path` (默认空字符串 = 当前域名)
- **请求格式**：所有 POST 请求 body 均为 JSON

### 1.2 所有 API 端点

| # | 端点 | 方法 | 触发时机 | 用途 |
|---|---|---|---|---|
| **认证类** | | | | |
| 1 | `/api/login` | POST | 用户在登录 tab 提交表单 | 用户登录 |
| 2 | `/api/register` | POST | 用户在注册 tab 提交表单 | 用户注册 |
| 3 | `/api/logout` | POST | 用户点击退出按钮 | 退出登录 |
| 4 | `/api/me` | GET | 启动时检查登录状态 | 获取当前用户信息 |
| **存档类** | | | | |
| 5 | `/api/save` | POST | 玩家数据变更（防抖 700ms 后） | 保存玩家存档 |
| 6 | `/api/save` | POST | 退出登录 / GM 工具写入 | GM 强制覆盖存档（含 `gmWrite: true` 标记） |
| 7 | `/api/save` | GET | 启动时从云端读取存档 | 读取玩家存档 |
| 8 | `/api/score` | POST | 存档保存后自动调用（防抖 900ms） | 提交段位分数 |
| 9 | `/api/rank` | GET | 打开排行榜 / 切换"战力/星数"标签 | 拉取排行榜 |
| **业务类** | | | | |
| 10 | `/zyyad/game/start` | GET | 进入游戏（登录后） | 游戏开始上报 |
| 11 | `/zyyad/game/end` | GET | 战斗结束 | 上报战斗结果（星数+胜负） |
| 12 | `/zyyad/game/country/list` | GET | 进入游戏 | 拉取可玩关卡/省份 |
| 13 | `/zyyad/game/province/detail/list` | GET | 进入游戏 | 拉取省份详情 |
| 14 | `/sys/server/time` | GET | 启动时 + 进入游戏时 | 获取服务器时间（防作弊） |
| 15 | `/sys/user/login` | POST | 登录 | 第三方登录 / 主登录入口 |
| 16 | `/sys/user/info` | POST | 启动时（每 5 局 1 次） | 上传玩家完整存档 |
| 17 | `/sys/user/data` | POST | 启动时 | 上传玩家完整存档（同 16 类似） |
| **埋点/错误** | | | | |
| 18 | `/sys/oa/point/add/new` | POST | 游戏事件埋点 | 批量上报玩家行为事件 |
| 19 | `/sys/oa/errorUpload/add` | POST | 代码异常 | 上报客户端错误日志 |

### 1.3 鉴权流程

```
1. 用户填表 → POST /api/login {username, password}
2. 服务端返回 {success, data: {authentication, userId, userType, userData, attach}}
3. 客户端 Server.Da() 处理：保存 authentication token, userId, userType
4. 后续请求都带 header: "authentication: <token>"
```

### 1.4 玩家存档字段映射

**38 个核心字段**（内部名 → 2字符短名用于网络传输）：

| 内部名 | 网络字段 | 含义 |
|---|---|---|
| `_nick` | `nk` | 昵称 |
| `_gameAvatar` | `ga` | 头像 ID |
| `_avatarUrl` | `au` | 头像 URL |
| `_province` | `pv` | 省份 |
| `_registerTime` | `rt` | 注册时间戳 |
| `_saveTime` | `st` | 存档时间戳 |
| `_gold` | `gd` | 金币 |
| `_win` | `wn` | 胜利场次 |
| `_lose` | `ls` | 失败场次 |
| `_weaponFragments` | `wf` | 武器碎片 |
| `_equip` | `eq` | 已装备武器（12 个槽位） |
| `_isGetLastRankReward` | `rr` | 是否领取过上次段位奖励 |
| `_props` | `ps` | 道具列表 |
| `_winDay` | `wd` | 当天胜利 |
| `_loseDay` | `ld` | 当天失败 |
| `_lastLoseDifficulty` | `lld` | 上次失败难度 |
| `_setting` | `sg` | 设置（嵌套） |
| `_openProps` | `op` | 是否开启道具 |
| `_lowPrProps` | `lp` | 低优先级道具 |
| `_stamina` | `sm` | 体力 |
| `_lastRecoverStaminaTime` | `lrt` | 上次体力恢复时间 |
| `_staminaAdCountToday` | `sac` | 今日看广告回体力次数 |
| `_lastShareStaminaTime` | `lst` | 上次分享领体力时间 |
| `_staminaShareCountToday` | `ssc` | 今日分享领体力次数 |
| `_winStreak` | `ws` | 连胜 |
| `_consecutiveLoginDays` | `cld` | 连续登录天数 |
| `_weaponFree` | `wfr` | 是否武器免费 |
| `_hasUsedFreeShovel` | `hfs` | 是否用过免费铲子 |
| `_hasUsedFreeBulldozer` | `hfb` | 是否用过免费推土车 |
| `_isAdFreeUser` | `afu` | 是否去广告用户 |
| `_newWeaponIds` | `nwi` | 新获得武器 |
| `_avatarUnlocks` | `aul` | 头像解锁（12 槽） |
| `_sidebarState` | `ss` | 侧边栏状态 |
| `_followDouyinState` | `fds` | 是否关注抖音 |
| `_hasPlacedActivePropThisBattle` | `pap` | 本局是否已使用道具 |
| `_weaponSceneDragGuideDone` | `wdg` | 武器引导是否完成 |
| `_curStar` | `cs` | 当前星数 |
| `_rankCorrected` | `rc` | 段位已修正 |
| `_lastStar` | `lts` | 上次星数 |
| `_mergedGenerals` | `mg` | 已合成武将列表 |

**设置子字段**（`_setting` 内部）：

| 内部名 | 网络字段 | 含义 |
|---|---|---|
| `showDamageNum` | `sd` | 是否显示伤害数字 |
| `musicVolume` | `mv` | 音乐音量 |
| `soundVolume` | `sv` | 音效音量 |

---

## 2. 认证类 API

### 2.1 POST `/api/login` — 登录

**调用点**：`auth-client.js:242`，登录 tab 提交表单时触发。

**Request body**：
```json
{
  "username": "<string>",
  "password": "<string>"
}
```

**Expected response**（mock 在 `game_server.py`）：
```json
{
  "success": true,
  "data": {
    "user": { "username": "local_player" },
    "playerData": "<存档字符串>"
  }
}
```

**客户端处理**：
- 成功后调用 `bootGame(data)` 进入游戏
- 失败显示错误：`{ message: error.message || "操作失败" }`

---

### 2.2 POST `/api/register` — 注册

**调用点**：`auth-client.js:242`，注册 tab 提交表单时触发。

**Request body**：
```json
{
  "username": "<string>",
  "password": "<string>"
}
```

**Response**：同 login。

---

### 2.3 POST `/api/logout` — 退出登录

**调用点**：
- `auth-client.js:62` — 启动时检查 token 无效
- `auth-client.js:577` — 用户点击退出按钮

**Request body**：（无）

**客户端副作用**：
- 清空 `localStorage.zyyadActiveUser`
- 跳转 `gameIndex.html?logout=1`

---

### 2.4 GET `/api/me` — 获取当前用户

**调用点**：h5api-local.js / bundle.js 启动初始化时（`resolveUserInfo`）

**Expected response**：
```json
{
  "success": true,
  "data": {
    "user": { "username": "..." },
    "playerData": "<存档字符串>"
  }
}
```

---

## 3. 游戏业务 API

### 3.1 POST `/api/save` — 保存玩家存档

**调用点**：
- `auth-client.js:525` — 防抖 700ms 后的 fetch（普通保存）
- `auth-client.js:520` — 退出时 `navigator.sendBeacon`（紧急保存）
- `auth-client.js:550` — `saveNow()` 立即保存（带 options）
- `gm-launcher.js:110` — GM 工具强制覆盖（含 `gmWrite: true`）
- `bundle.js` — 战斗结束、`auth.saveNow()` 调用

**Request body**（普通）：
```json
{
  "playerData": "<stringified存档>"
}
```

**Request body**（GM 模式）：
```json
{
  "playerData": "<stringified存档>",
  "gmWrite": true
}
```

**Request body**（h5api-local.js save type="read"）：无 body（GET 请求，**但当前服务端是 POST，应该改成 GET**）

**Expected response**：
```json
{
  "success": true,
  "data": { "playerData": "<存档字符串>" }
}
```

**保存后副作用**：
- 自动调用 `submitRankScoreFromSave(value, false)`（900ms 防抖后）→ POST `/api/score`
- `lastSaved = value`（本地缓存）

**存档自动合并策略**：
- 启动时登录返回 `userData`（云端存档）
- 本地局数 ≥ 云端局数 → 用本地
- 否则用云端（覆盖本地）

---

### 3.2 POST `/api/score` — 提交段位分数

**调用点**：
- `auth-client.js:701` — `submitRankScoreFromSave()`（存档保存后自动）
- `h5api-local.js:48, 98, 101` — `submitScore`, `submitRanking`, `submitRankScore`

**Request body**（auth-client.js）：
```json
{
  "rankId": "zyyadRankScore:<username>",
  "score": <number>
}
```

**Request body**（h5api-local.js）：
```json
{
  "rankId": "default",
  "score": <number>
}
```

**分数计算公式**（`calculateRankScore`）：
```
score = floor(
  star * 10000
  + win * 120
  + max(0, win - lose) * 60
  + streak * 80
  + props_count * 30
  + equip_count * 40
  + min(gold, 1000000) / 50
)
```

**Expected response**：
```json
{
  "success": true,
  "data": {}
}
```

**触发条件**：
- 仅当 `score > 0` 且 `score > lastRankScore` 时发送
- 防抖 900ms（immediate=true 时 120ms）
- `isRoomBattleMode()` 房间模式不发送
- 未登录不发送

---

### 3.3 GET `/api/rank` — 获取排行榜

**调用点**：
- `auth-client.js:935` — 原生 UI 拉取
- `auth-client.js:1168` — DOM 拉取
- `h5api-local.js:51, 107` — `getRank`, `getRanking`

**Query params**：
```
/api/rank?rankId=<rankId>&limit=50
```

**Expected response**：
```json
{
  "success": true,
  "data": [
    { "rank": 1, "username": "player1", "score": 12345 },
    { "rank": 2, "username": "player2", "score": 10000 }
  ]
}
```

**模式**：`power`（战力）和 `stars`（星数）两种榜单。

---

### 3.4 GET `/zyyad/game/start` — 游戏开始

**调用点**：`Server.Ua(t)` — 玩家点击"开始游戏"

**Query params**：（无）

**Expected response**（mock）：
```json
{
  "code": 0,
  "success": true,
  "data": {}
}
```

**作用**：服务端可能用于"开始一局"的状态记录（在线统计、防作弊）。

---

### 3.5 GET `/zyyad/game/end` — 战斗结束

**调用点**：`Server.Fa(win, callback)` — 战斗结束流程

**Query params**：
```
/zyyad/game/end?star=<curStar>&win=<0|1>
```

**Request body**（POST 模式）：
```json
{ "skin": 1 }
```

**Expected response**（mock）：
```json
{
  "code": 0,
  "success": true,
  "data": {}
}
```

**作用**：
- 上报战斗结果给服务端
- 服务端可能用于段位积分计算 / 排行榜更新
- `skin: 1` 表示玩家使用的皮肤 ID

---

### 3.6 GET `/zyyad/game/country/list` — 关卡列表

**调用点**：`Server.Oa(t)` — 进入游戏

**Query params**：
```
/zyyad/game/country/list?type=<this.ba>
```

`this.ba` 默认是 `3`（某种关卡类型 ID）

**Expected response**（mock）：
```json
{
  "code": 0,
  "success": true,
  "data": { "countries": [...] }
}
```

**作用**：服务端配置可用关卡/省份（避免客户端硬编码）。

---

### 3.7 GET `/zyyad/game/province/detail/list` — 省份详情

**调用点**：`Server.Ya(t)` → `Xa(t) → Oa(t)`（同 country/list 的封装）

**Query params**：
```
/zyyad/game/province/detail/list?type=<this.ba>
```

---

### 3.8 GET `/sys/server/time` — 服务器时间

**调用点**：`Server.getTime(t)` → `Server.Ga(t)`

**作用**：防作弊（客户端不能改本地时间影响体力恢复逻辑）

**Expected response**：
```json
{
  "code": 0,
  "success": true,
  "data": <unix_timestamp_ms>
}
```

**客户端逻辑**：
```js
Ga(t) {
  this.getTime({'success': s => {
    const h = s.data;  // 服务器时间戳
    f.Gs(h, Ct.instance().player.isGetLastRankReward) >= 1
      && this.request("bestRank", null, t);  // 拉取最高段位
  }});
}
```

---

### 3.9 POST `/sys/user/login` — 主登录入口

**调用点**：`Server.Ia(code, h, callback)` — bundle.js 启动登录

**Request body**：
```json
{
  "code": "<第三方登录code>"  // 来自外部平台
}
```

**Expected response**（由 `Da()` 处理）：
```json
{
  "code": 0,
  "success": true,
  "data": {
    "authentication": "<token>",     // 写入 Server.authentication
    "userId": 12345,                 // 写入 Server.Sa
    "userType": 0,                   // 写入 Server.userType
    "userData": "<cloudSaveString>", // 写入 Server._a
    "attach": { "province": "广东" } // 写入 player.province
  }
}
```

**作用**：
- 第三方 SDK 登录（如抖音/微信）回调
- 返回 token 用于后续请求头
- 返回 userData 是云端存档（与本地对比取新）

---

### 3.10 POST `/sys/user/info` — 上传用户信息

**调用点**：`Server.Wa(t)` — `t` 是要上传的数据对象

**Request body**：
```json
{
  "userId": 12345,
  "nick": "...",
  "avatar": ...,
  ...其他用户资料
}
```

**作用**：用户资料变更后上报（如改名、改头像）。

---

### 3.11 POST `/sys/user/data` — 上传玩家完整存档

**调用点**：`Server.Ca(force)` — 启动时（每 5 局 1 次）+ 立即上传模式

**调用频率**：
```js
Ca(s=false) {
  if (this.Sa <= 0) return;  // 未登录
  if (!s) {  // 自动模式
    let s = Number(LocalStorage.getItem("playGameCount") || 0);
    s++;
    LocalStorage.setItem("playGameCount", String(s));
    if (s !== 1 && s % 5 !== 0) return;  // 跳过：不是第 1 局且不是 5 的倍数
  }
  // 调用 request("sys/user/data", cloudPush(), success/fail, "post")
}
```

**触发条件**：
- 第 1 局
- 第 5、10、15... 局（每 5 局）
- 退出登录前的紧急保存（`s=true` 强制）

**Request body**：`cloudPush()` = `D.toServer(player._data)` = 字段名映射后的存档（如 `_gold` → `gd` 等）

**Expected response**：
```json
{
  "code": 0,
  "success": true,
  "data": {}
}
```

**作用**：服务端备份玩家存档（与 `/api/save` 功能类似，但使用 2 字符短字段名 + 在 `sys/user/data` 路径，更像云存档专用）。

---

## 4. 数据上报 API

### 4.1 POST `/sys/oa/point/add/new` — 批量事件埋点

**调用点**：`X.instance().track(events[], callback)` → `Y.track(t, s)`

**调用时机**：
- 玩家死亡、购买道具、合成武将、升级、进入战斗 等关键事件
- 数据先入 LocalStorage 队列，启动/空闲时批量上报

**LocalStorage key**：`t["wl"]`（`pendingTrackKey`）— 实际值通过 `vl()` 看到是字符串

**Request body**（批量数组）：
```json
[
  {
    "event": "event_name",
    "timestamp": 1234567890,
    "props": { ... }
  },
  {
    "event": "another_event",
    "timestamp": 1234567891,
    "props": { ... }
  }
]
```

**Expected response**：
```json
{
  "code": 0,
  "success": true,
  "data": {}
}
```

**成功后的副作用**：
- `LocalStorage.removeItem(t["wl"])` — 清空队列

**作用**：
- 玩家行为埋点（运营分析）
- 触发间隔 ~5 局一次（与存档上传同步）

**LocalStorage 队列结构**（`ml()` 读、`enqueue()` 写）：
```ts
interface PendingTrack {
  event: string;
  // 实际字段未解出，可能是 {type, data, time, ...}
}
```

---

### 4.2 POST `/sys/oa/errorUpload/add` — 上报错误日志

**调用点**：异常处理（待确认具体触发点）

**Request body**：
```json
{
  "stack": "<错误堆栈>",
  "message": "<错误信息>",
  "url": "<发生页面URL>",
  "line": 123,
  "col": 456,
  "userAgent": "...",
  "userId": 12345
}
```

**Expected response**：
```json
{
  "code": 0,
  "success": true,
  "data": {}
}
```

**作用**：客户端崩溃/异常日志上报，便于线上问题排查。

---

## 5. h5api 公开方法

`window.h5api` 是游戏暴露给 H5 容器的接口，H5 宿主（抖音/微信小游戏）调用这些方法跟游戏通信。

| 方法 | 调用方 | 作用 |
|---|---|---|
| `h5api.initGame()` | 宿主启动时 | 通知游戏已加载 |
| `h5api.progress(num)` | 宿主加载时 | 通知加载进度 |
| `h5api.submitScore(score, callback)` | 宿主 | 提交分数（POST /api/score, rankId="default"） |
| `h5api.getRank(callback)` | 宿主 | 拉取排行榜（GET /api/rank） |
| `h5api.canPlayAd(callback)` | 宿主 | 是否有广告 |
| `h5api.playAd(callback)` | 宿主 | 播放激励视频广告（返回 `{code:10001, success:true}`） |
| `h5api.playYlhAd(placementId, callback)` | 宿主 | 播放指定位置广告 |
| `h5api.playInterstitialAd(callback)` | 宿主 | 插屏广告 |
| `h5api.share()` | 宿主 | 分享 |
| `h5api.isLogin()` | 宿主 | 是否已登录 |
| `h5api.login(callback)` | 宿主 | 触发登录（local mock 返回 `{local:true, user:...}`） |
| `h5api.getUserAvatar()` | 宿主 | 获取用户头像（空字符串） |
| `h5api.getUserSmallAvatar()` | 宿主 | 小头像（空字符串） |
| `h5api.getUserBigAvatar()` | 宿主 | 大头像（空字符串） |
| `h5api.getUserLargeAvatar()` | 宿主 | 加大头像（空字符串） |
| `h5api.submitRanking(score, callback)` | 宿主 | 提交分数（同 submitScore） |
| `h5api.submitRankScore(rankId, score, callback)` | 宿主 | 提交分数到指定 rankId |
| `h5api.getMyRanking(callback)` | 宿主 | 我的排名（mock 返回空） |
| `h5api.getRanking(callback)` | 宿主 | 排行榜（GET /api/rank） |
| `h5api.showRanking()` | 宿主 | 显示原生排行榜 UI |
| `h5api.showRankList()` | 宿主 | 同上 |
| `h5api.getNearRanking(callback)` | 宿主 | 我的附近排名（mock 返回 []） |
| `h5api.checkWord(word, callback)` | 宿主 | 校验词（mock 返回 `{pass:true}`） |
| `h5api.showRecommend()` | 宿主 | 显示推荐位 |
| `h5api.save({type, data, callback})` | 宿主 | type="read" → 读存档 (GET /api/save)；其他 → 写存档 (POST /api/save) |
| `h5api.gameMode()` | 宿主 | 游戏模式 |
| `h5api.showGuide(callback)` | 宿主 | 显示引导 |
| `h5api.checkAPI()` | 宿主 | 检测 H5 API 可用性 |

---

## 6. 附录：Server 类的内部结构

`Y` 类（`var X=Y` 是别名）是所有 API 调用的入口。

### 6.1 字段

| 字段 | 默认值 | 含义 |
|---|---|---|
| `_a` | `null` | 云端存档（登录返回的 `userData` 字段） |
| `path` | `""` | API 基础路径（默认空 = 当前域名） |
| `xa` | `false` | 是否禁用请求 |
| `authentication` | `""` | 鉴权 token（登录后由 `Da()` 设置） |
| `Sa` | `0` | userId |
| `userType` | `0` | 用户类型 |
| `ba` | `3` | 业务类型 ID（关卡分类） |
| `channelAppId` | `0` | 渠道 app id（`init(t)` 时设置） |

**静态字段**：

| 字段 | 值 | 含义 |
|---|---|---|
| `Y["Aa"]` | `5000` | HTTP timeout（ms） |
| `Y["Ha"]` | `"playGameCount"` | 存档上传局数计数 key |
| `Y["za"]` | `1201` | 渠道 code 1 |
| `Y["$a"]` | `1203` | 渠道 code 2 |

### 6.2 核心方法

| 方法 | 作用 |
|---|---|
| `get url()` | 返回 `path`（如果未禁用） |
| `request(s, i, h, e="get", a=Aa)` | Laya HttpRequest 发送请求 |
| `Ea(s, i, h, e)` | request 的 Promise 封装 |
| `Ia(code, h, e)` | 登录（POST /sys/user/login，调用 Da） |
| `Da(t)` | 处理登录响应，提取 token/userId/userType/userData |
| `Ra()` | 同步云端存档（调用 D.parseCloudSaveRaw + player.resolveCloudOnLoad） |
| `Ua(t)` | 游戏开始（GET /zyyad/game/start） |
| `Fa(win, s)` | 战斗结束（GET /zyyad/game/end?star=&win=） |
| `Oa(t)` | 关卡列表（GET /zyyad/game/country/list?type=） |
| `Ya(t)` | 省份详情（GET /zyyad/game/province/detail/list?type=） |
| `getTime(t)` | 服务器时间（GET /sys/server/time） |
| `Ga(t)` | 包装 getTime + 比较 lastRankReward 时间 |
| `Ca(force=false)` | 存档上传（每 5 局 1 次，POST /sys/user/data） |
| `Wa(t)` | 用户信息上报（POST /sys/user/info） |
| `track(events[], callback)` | 批量埋点（POST /sys/oa/point/add/new） |
| `ja(t)` | 错误日志上报（POST /sys/oa/errorUpload/add） |

### 6.3 数据流

```
[用户操作] → [客户端存档更新] → [saveNow()] → [POST /api/save]
                                            ↓
                          [submitRankScoreFromSave] (900ms 后)
                                            ↓
                                    [POST /api/score]

[启动] → [Server.Ia(code)] → [POST /sys/user/login] → [Da(t)]
                                                ↓
                                    [Server.Ra()] 同步云存档
                                                ↓
                                    [Server.Ca()] 每 5 局 1 次
                                                ↓
                                    [POST /sys/user/data]
```

### 6.4 关键代码

**`Server.request()`**（Laya HttpRequest 封装）：
```js
request(s, i, h, e="get", a=t["Aa"]) {
  const n = new Laya.HttpRequest();
  let r = ["Content-Type", "application/json", "authentication", this.authentication];
  n.http.timeout = a;
  n.send(this.url + s, i, e, "json", r);
  n.once(Laya.Event.COMPLETE, this, () => {
    h.success && h.success(n.data);
  });
  n.once(Laya.Event.ERROR, this, t => {
    h.fail && h.fail(t);
  });
}
```

**`D.toServer()`**（字段名映射）：
```js
static toServer(s) { return t.remap(s, E); }
static remap(t, s) {
  const i = JSON.parse("{}");
  for (const [h, e] of Object.entries(t)) {
    if (void 0 === e) continue;
    const t = s[h];  // E 表中查找
    t && (i[t] = e);  // i[短名] = 原值
  }
  return i;
}
```

**`D.fromServer()`**（反向映射）：
```js
static fromServer(s) {
  const i = t.remap(s, B);  // B 是 E 的反向表
  const h = i._setting;
  if (h && typeof h === "object") {
    i._setting = t.normalizeSetting(h);  // 修正 _setting 子字段
  }
  return i;
}
```

---

## 7. 总结

通过分析源码可得出**完整 API 接口协议**：

- **19 个服务端点**：5 业务、3 业务(zyyad)、6 系统(sys)、3 认证、2 埋点
- **字段映射机制**：内部 38 个下划线字段 ↔ 网络 2 字符短名，节省带宽（云存档专用）
- **登录双轨**：`/api/login` (本地密码) + `/sys/user/login` (第三方 SDK)
- **存档双轨**：`/api/save` (本地) + `/sys/user/data` (云端备份)
- **省流策略**：
  - 云存档只在第 1 局和每 5 局上传
  - 段位分数只在比上次大时上报（防抖 900ms）
  - 事件埋点先入 LocalStorage 队列，批量上报
- **安全设计**：
  - 所有请求带 `authentication` token
  - 服务器时间防作弊
  - 段位积分根据 `win/lose/star/gold/props/equip` 公式计算（服务端验证）
