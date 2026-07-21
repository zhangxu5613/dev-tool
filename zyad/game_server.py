#!/usr/bin/env python3
"""
赵云与阿斗 H5 - 本地游戏服务器（单文件 + SQLite + 多用户）

实现 19 个 API 端点 + 静态资源托管 + 占位符兜底。

数据库表：
  users(id, username, password_hash, created_at)
  sessions(token, user_id, created_at)
  saves(user_id, player_data, updated_at)
  scores(user_id, rank_id, score, updated_at)
  events(id, user_id, payload, created_at)
  errors(id, user_id, payload, created_at)

启动：python3 game_server.py
默认端口：8090
"""
import http.server
import socketserver
import os
import json
import sys
import sqlite3
import time
import uuid
import hashlib
import re
from urllib.parse import urlparse, parse_qs

PORT = 8090
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(DIRECTORY, "game_state.db")

# ===== 资源占位符 =====
PLACEHOLDER_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cf000000030001006029e8b80000000049454e44ae426082"
)
PLACEHOLDER_LH = b'{"_$ver":1,"_$type":"Sprite","name":"placeholder","width":1,"height":1}'
PLACEHOLDER_DIALOG = b'{"_$ver":1,"_$type":"Dialog","name":"Dialog","width":640,"height":1386,"anchorX":0.5,"anchorY":0.5}'
PLACEHOLDER_SCENE = b'{"_$ver":1,"_$type":"Scene","name":"Scene","width":640,"height":1386}'

# ===== 字段映射表 (内部名 <-> 网络短名) =====
# 来自 bundle.js 解码 - D.toServer() 使用的 E 表
FIELD_MAP = {
    "_nick": "nk", "_gameAvatar": "ga", "_avatarUrl": "au", "_province": "pv",
    "_registerTime": "rt", "_saveTime": "st", "_gold": "gd", "_win": "wn",
    "_lose": "ls", "_weaponFragments": "wf", "_equip": "eq",
    "_isGetLastRankReward": "rr", "_props": "ps", "_winDay": "wd", "_loseDay": "ld",
    "_lastLoseDifficulty": "lld", "_setting": "sg", "_openProps": "op",
    "_lowPrProps": "lp", "_stamina": "sm", "_lastRecoverStaminaTime": "lrt",
    "_staminaAdCountToday": "sac", "_lastShareStaminaTime": "lst",
    "_staminaShareCountToday": "ssc", "_winStreak": "ws",
    "_consecutiveLoginDays": "cld", "_weaponFree": "wfr", "_hasUsedFreeShovel": "hfs",
    "_hasUsedFreeBulldozer": "hfb", "_isAdFreeUser": "afu", "_newWeaponIds": "nwi",
    "_avatarUnlocks": "aul", "_sidebarState": "ss", "_followDouyinState": "fds",
    "_hasPlacedActivePropThisBattle": "pap", "_weaponSceneDragGuideDone": "wdg",
    "_curStar": "cs", "_rankCorrected": "rc", "_lastStar": "lts", "_mergedGenerals": "mg",
}
FIELD_MAP_REVERSE = {v: k for k, v in FIELD_MAP.items()}
SETTING_MAP = {"sd": "showDamageNum", "mv": "musicVolume", "sv": "soundVolume"}


# ===== 数据库 =====
def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS saves (
            user_id INTEGER PRIMARY KEY,
            player_data TEXT,
            updated_at INTEGER,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS scores (
            user_id INTEGER,
            rank_id TEXT,
            score INTEGER DEFAULT 0,
            updated_at INTEGER,
            PRIMARY KEY(user_id, rank_id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            payload TEXT,
            created_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS errors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            payload TEXT,
            created_at INTEGER
        );
    """)
    conn.commit()
    conn.close()


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def hash_pwd(pwd):
    return hashlib.sha256(pwd.encode("utf-8")).hexdigest()


def now_ms():
    return int(time.time() * 1000)


# ===== 存档字段转换 =====
def to_server_format(player_data_str):
    """内部名 → 2字符短名 (D.toServer)"""
    try:
        data = json.loads(player_data_str) if isinstance(player_data_str, str) else player_data_str
    except Exception:
        return {}
    out = {}
    for k, v in data.items():
        short = FIELD_MAP.get(k)
        if short and v is not None:
            out[short] = v
    return out


def from_server_format(cloud_data):
    """2字符短名 → 内部名 (D.fromServer)"""
    if not isinstance(cloud_data, dict):
        return None
    out = {}
    for k, v in cloud_data.items():
        full = FIELD_MAP_REVERSE.get(k, k)
        out[full] = v
    # 修正 _setting 子字段
    s = out.get("_setting")
    if isinstance(s, dict):
        normalized = {}
        for k, v in s.items():
            normalized[SETTING_MAP.get(k, k)] = v
        out["_setting"] = normalized
    return out


# ===== 段位分数公式 (calculateRankScore) =====
def calc_score(player_data_str):
    try:
        data = json.loads(player_data_str) if isinstance(player_data_str, str) else player_data_str
    except Exception:
        return 0
    star = max(0, int(data.get("_curStar", 0)))
    win = max(0, int(data.get("_win", 0)))
    lose = max(0, int(data.get("_lose", 0)))
    gold = max(0, int(data.get("_gold", 0)))
    streak = max(0, int(data.get("_winStreak", 0)))
    props = len(data.get("_props", [])) if isinstance(data.get("_props"), list) else 0
    equip = len([x for x in data.get("_equip", []) if isinstance(x, int) and x >= 0]) if isinstance(data.get("_equip"), list) else 0
    return max(0, int(star * 10000 + win * 120 + max(0, win - lose) * 60 + streak * 80 + props * 30 + equip * 40 + min(gold, 1000000) / 50))


# ===== 默认玩家存档 =====
DEFAULT_PLAYER_DATA = json.dumps({
    "_nick": "", "_gameAvatar": 1, "_avatarUrl": "", "_province": "",
    "_registerTime": 0, "_saveTime": 0, "_gold": 0, "_win": 0, "_lose": 0,
    "_weaponFragments": [], "_equip": [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
    "_isGetLastRankReward": 0, "_props": [], "_winDay": 0, "_loseDay": 0,
    "_lastLoseDifficulty": -1, "_setting": {"showDamageNum": True, "musicVolume": 1, "soundVolume": 1},
    "_openProps": False, "_lowPrProps": [], "_stamina": 5,
    "_lastRecoverStaminaTime": 0, "_staminaAdCountToday": 0,
    "_lastShareStaminaTime": 0, "_staminaShareCountToday": 0,
    "_winStreak": 0, "_consecutiveLoginDays": 1, "_weaponFree": False,
    "_hasUsedFreeShovel": False, "_hasUsedFreeBulldozer": False, "_isAdFreeUser": False,
    "_newWeaponIds": [], "_avatarUnlocks": [0]*16, "_sidebarState": 0,
    "_followDouyinState": 0, "_hasPlacedActivePropThisBattle": False,
    "_weaponSceneDragGuideDone": False, "_curStar": 0, "_rankCorrected": 0,
    "_lastStar": 0, "_mergedGenerals": [],
})


# ===== HTTP 响应辅助 =====
def send_json(self, payload, status=200, extra_headers=None):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    self.send_response(status)
    self.send_header("Content-Type", "application/json; charset=utf-8")
    self.send_header("Content-Length", str(len(body)))
    self.send_header("Access-Control-Allow-Origin", "*")
    self.send_header("Access-Control-Allow-Credentials", "true")
    if extra_headers:
        for k, v in extra_headers.items():
            self.send_header(k, v)
    self.end_headers()
    self.wfile.write(body)


def send_ok(self, data=None, code=0):
    send_json(self, {"code": code, "success": True, "data": data if data is not None else {}})


def send_err(self, msg, status=400, code=1):
    send_json(self, {"code": code, "success": False, "message": msg}, status=status)


def serve_placeholder(self, content_type, data):
    self.send_response(200)
    self.send_header("Content-Type", content_type)
    self.send_header("Content-Length", str(len(data)))
    self.send_header("Access-Control-Allow-Origin", "*")
    self.send_header("Cache-Control", "max-age=3600")
    self.end_headers()
    if data:
        self.wfile.write(data)


# ===== 认证 =====
def get_auth_token(self):
    """从 header 取 authentication token"""
    return self.headers.get("authentication", "")


def get_current_user(self):
    """根据 token 返回 user_id，未登录返回 None"""
    token = get_auth_token(self)
    if not token:
        return None
    conn = db()
    row = conn.execute("SELECT user_id FROM sessions WHERE token=?", (token,)).fetchone()
    conn.close()
    return row["user_id"] if row else None


def get_user_by_username(username):
    conn = db()
    row = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    conn.close()
    return row


def create_session(user_id):
    token = uuid.uuid4().hex
    conn = db()
    conn.execute("INSERT INTO sessions(token, user_id, created_at) VALUES(?, ?, ?)",
                 (token, user_id, now_ms()))
    conn.commit()
    conn.close()
    return token


def destroy_session(token):
    conn = db()
    conn.execute("DELETE FROM sessions WHERE token=?", (token,))
    conn.commit()
    conn.close()


# ===== 玩家存档 =====
def get_player_data(user_id):
    conn = db()
    row = conn.execute("SELECT player_data FROM saves WHERE user_id=?", (user_id,)).fetchone()
    conn.close()
    if row and row["player_data"]:
        return row["player_data"]
    return DEFAULT_PLAYER_DATA


def set_player_data(user_id, data_str):
    conn = db()
    conn.execute("""
        INSERT INTO saves(user_id, player_data, updated_at) VALUES(?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET player_data=excluded.player_data, updated_at=excluded.updated_at
    """, (user_id, data_str, now_ms()))
    conn.commit()
    conn.close()


# ===== 排行榜 =====
def submit_score(user_id, rank_id, score):
    conn = db()
    conn.execute("""
        INSERT INTO scores(user_id, rank_id, score, updated_at) VALUES(?, ?, ?, ?)
        ON CONFLICT(user_id, rank_id) DO UPDATE SET score=excluded.score, updated_at=excluded.updated_at
    """, (user_id, rank_id, score, now_ms()))
    conn.commit()
    conn.close()


def get_rank_list(rank_id, limit=50):
    conn = db()
    rows = conn.execute("""
        SELECT s.score, u.username, s.updated_at
        FROM scores s JOIN users u ON u.id = s.user_id
        WHERE s.rank_id = ?
        ORDER BY s.score DESC LIMIT ?
    """, (rank_id, limit)).fetchall()
    conn.close()
    return [{"rank": i + 1, "username": r["username"], "score": r["score"]} for i, r in enumerate(rows)]


# ===== HTTP Handler =====
class GameHTTPHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    # ---------- 通用工具 ----------
    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def _parse_path(self):
        u = urlparse(self.path)
        return u.path, parse_qs(u.query), u.query

    # ---------- POST 路由 ----------
    def do_POST(self):
        path, query, raw_query = self._parse_path()
        body = self._read_body()

        # 1. 认证类
        if path == "/api/register":
            return self._handle_register(body)
        if path == "/api/login":
            return self._handle_login(body)
        if path == "/api/logout":
            token = get_auth_token(self)
            if token:
                destroy_session(token)
            return send_ok(self)
        if path == "/api/save":
            return self._handle_save(body)
        if path == "/api/score":
            return self._handle_score(body)

        # 2. 业务类
        if path == "/sys/user/login":
            return self._handle_sys_login(body)
        if path == "/sys/user/info":
            return self._handle_sys_user_info(body)
        if path == "/sys/user/data":
            return self._handle_sys_user_data(body)

        # 3. 埋点/错误
        if path == "/sys/oa/point/add/new":
            return self._handle_track(body)
        if path == "/sys/oa/errorUpload/add":
            return self._handle_error_upload(body)

        # 4. 其他 POST - 通用 OK 响应
        return send_ok(self)

    # ---------- GET 路由 ----------
    def do_GET(self):
        path, query, raw_query = self._parse_path()

        # 1. API 端点
        if path.startswith("/api/") or path.startswith("/zyyad/") or path.startswith("/sys/") or path == "/bestRank":
            return self._handle_api_get(path, query, raw_query)

        # 2. 静态文件（带占位符兜底）
        return self._serve_static_or_placeholder()

    # ---------- OPTIONS (CORS) ----------
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, authentication")
        self.send_header("Access-Control-Allow-Credentials", "true")
        self.end_headers()

    # ===== 认证处理器 =====
    def _handle_register(self, body):
        username = (body.get("username") or "").strip()
        password = body.get("password") or ""
        if not username or not password:
            return send_err(self, "用户名或密码不能为空")
        if get_user_by_username(username):
            return send_err(self, "用户名已存在", 409)

        conn = db()
        cur = conn.execute(
            "INSERT INTO users(username, password_hash, created_at) VALUES(?, ?, ?)",
            (username, hash_pwd(password), now_ms())
        )
        user_id = cur.lastrowid
        # 初始化默认存档
        conn.execute("INSERT INTO saves(user_id, player_data, updated_at) VALUES(?, ?, ?)",
                     (user_id, DEFAULT_PLAYER_DATA, now_ms()))
        conn.commit()
        conn.close()

        token = create_session(user_id)
        return send_ok(self, {
            "user": {"username": username, "id": user_id},
            "token": token,
            "playerData": DEFAULT_PLAYER_DATA,
        })

    def _handle_login(self, body):
        username = (body.get("username") or "").strip()
        password = body.get("password") or ""
        user = get_user_by_username(username)
        if not user or user["password_hash"] != hash_pwd(password):
            return send_err(self, "用户名或密码错误", 401)

        token = create_session(user["id"])
        player_data = get_player_data(user["id"])
        return send_ok(self, {
            "user": {"username": username, "id": user["id"]},
            "token": token,
            "playerData": player_data,
        })

    def _handle_save(self, body):
        user_id = get_current_user(self) or _get_or_create_anon_user()
        player_data = body.get("playerData") or DEFAULT_PLAYER_DATA
        set_player_data(user_id, player_data)
        # 自动计算并更新段位分数
        score = calc_score(player_data)
        if score > 0:
            rank_id = "zyyadRankScore:" + _get_username(user_id)
            submit_score(user_id, rank_id, score)
        return send_ok(self, {"playerData": player_data})

    def _handle_score(self, body):
        user_id = get_current_user(self) or _get_or_create_anon_user()
        rank_id = body.get("rankId") or "default"
        score = int(body.get("score") or 0)
        if score > 0:
            submit_score(user_id, rank_id, score)
        return send_ok(self, {"rankId": rank_id, "score": score})

    # ===== 系统类处理器 =====
    def _handle_sys_login(self, body):
        """第三方登录 (sys/user/login)
        真实环境: body={code: "<微信code>"}, 服务端拿 code 换 openid
        本地 mock: body={code: "<username>"} 或 {username: ...}
        """
        code = body.get("code") or body.get("username") or "guest"
        # 把 code 当 username
        user = get_user_by_username(code)
        if not user:
            # 自动注册
            conn = db()
            cur = conn.execute(
                "INSERT INTO users(username, password_hash, created_at) VALUES(?, ?, ?)",
                (code, hash_pwd(uuid.uuid4().hex), now_ms())
            )
            user_id = cur.lastrowid
            conn.execute("INSERT INTO saves(user_id, player_data, updated_at) VALUES(?, ?, ?)",
                         (user_id, DEFAULT_PLAYER_DATA, now_ms()))
            conn.commit()
            conn.close()
        else:
            user_id = user["id"]

        token = create_session(user_id)
        player_data = get_player_data(user_id)
        cloud_data = to_server_format(player_data)
        return send_ok(self, {
            "authentication": token,
            "userId": user_id,
            "userType": 0,
            "userData": cloud_data,
            "attach": {"province": "本地"},
        })

    def _handle_sys_user_info(self, body):
        user_id = get_current_user(self) or _get_or_create_anon_user()
        # body 是用户资料，直接回显
        return send_ok(self, {"userId": user_id, "info": body})

    def _handle_sys_user_data(self, body):
        """云存档上传 (sys/user/data)
        body 是 2字符短名字段, 转回内部名后存
        """
        user_id = get_current_user(self) or _get_or_create_anon_user()
        # body 是已映射的短字段, 反推回内部名
        internal = from_server_format(body)
        if internal is None:
            return send_err(self, "存档格式错误")
        internal["_saveTime"] = now_ms()
        data_str = json.dumps(internal, ensure_ascii=False)
        set_player_data(user_id, data_str)
        return send_ok(self)

    def _handle_track(self, body):
        """批量埋点 (sys/oa/point/add/new)
        body 是数组: [{event, ...}, ...]
        """
        user_id = get_current_user(self) or 0
        if not isinstance(body, list):
            body = [body]
        conn = db()
        for evt in body:
            conn.execute(
                "INSERT INTO events(user_id, payload, created_at) VALUES(?, ?, ?)",
                (user_id, json.dumps(evt, ensure_ascii=False), now_ms())
            )
        conn.commit()
        conn.close()
        return send_ok(self)

    def _handle_error_upload(self, body):
        user_id = get_current_user(self) or 0
        conn = db()
        conn.execute(
            "INSERT INTO errors(user_id, payload, created_at) VALUES(?, ?, ?)",
            (user_id, json.dumps(body, ensure_ascii=False), now_ms())
        )
        conn.commit()
        conn.close()
        return send_ok(self)

    # ===== GET API 处理器 =====
    def _handle_api_get(self, path, query, raw_query):
        # /api/me
        if path == "/api/me":
            user_id = get_current_user(self)
            if not user_id:
                return send_ok(self, {"user": None, "playerData": ""})
            user = _get_user_by_id(user_id)
            player_data = get_player_data(user_id)
            return send_ok(self, {"user": {"username": user["username"], "id": user_id}, "playerData": player_data})

        # /api/save (GET 读档)
        if path == "/api/save":
            user_id = get_current_user(self)
            if not user_id:
                return send_ok(self, {"playerData": ""})
            return send_ok(self, {"playerData": get_player_data(user_id)})

        # /api/rank
        if path == "/api/rank":
            rank_id = (query.get("rankId", ["default"])[0])
            limit = int(query.get("limit", ["50"])[0])
            return send_ok(self, get_rank_list(rank_id, limit))

        # /zyyad/game/start
        if path == "/zyyad/game/start":
            return send_ok(self, {"started": True, "timestamp": now_ms()})

        # /zyyad/game/end
        if path == "/zyyad/game/end":
            star = query.get("star", ["0"])[0]
            win = query.get("win", ["0"])[0]
            return send_ok(self, {"ended": True, "star": int(star), "win": int(win)})

        # /zyyad/game/country/list
        if path == "/zyyad/game/country/list":
            return send_ok(self, {"countries": [
                {"id": 1, "name": "涿鹿", "unlocked": True},
                {"id": 2, "name": "云梦泽", "unlocked": True},
                {"id": 3, "name": "虎牢关", "unlocked": True},
                {"id": 4, "name": "赤壁", "unlocked": True},
            ]})

        # /zyyad/game/province/detail/list
        if path == "/zyyad/game/province/detail/list":
            return send_ok(self, {"provinces": [
                {"id": 1, "name": "幽州", "difficulty": 1},
                {"id": 2, "name": "冀州", "difficulty": 2},
                {"id": 3, "name": "并州", "difficulty": 3},
            ]})

        # /sys/server/time
        if path == "/sys/server/time":
            return send_ok(self, now_ms())

        # /bestRank
        if path == "/bestRank":
            user_id = get_current_user(self)
            if not user_id:
                return send_ok(self, {"bestRank": 0})
            conn = db()
            row = conn.execute(
                "SELECT MAX(score) as best FROM scores WHERE user_id=?", (user_id,)
            ).fetchone()
            conn.close()
            return send_ok(self, {"bestRank": row["best"] or 0})

        # 兜底
        return send_ok(self)

    # ===== 静态文件 + 占位符 =====
    def _serve_static_or_placeholder(self):
        path = self.translate_path(self.path)
        if os.path.isfile(path):
            file_size = os.path.getsize(path)
            ext = os.path.splitext(self.path)[1].lower()
            # 9字节假占位文件视为缺失
            if file_size < 10 and ext in ('.mp3', '.ogg', '.wav', '.lh', '.ls', '.json', '.atlas', '.skel', '.txt'):
                if ext in ('.mp3', '.ogg', '.wav'):
                    self.send_error(404, "Audio file not found")
                    return
                # 其他走占位符
            else:
                super().do_GET()
                return

        ext = os.path.splitext(self.path)[1].lower()
        if ext in ('.mp3', '.ogg', '.wav'):
            self.send_error(404, "Audio file not found")
        elif ext in ('.png', '.jpg', '.jpeg', '.webp'):
            serve_placeholder(self, "image/png", PLACEHOLDER_PNG)
        elif ext == '.js':
            serve_placeholder(self, "application/javascript", b"// placeholder\n")
        elif ext == '.json':
            serve_placeholder(self, "application/json", b"{}")
        elif ext in ('.lh', '.ls'):
            path_lower = self.path.lower()
            if '/dialog/' in path_lower and ext == '.lh':
                ph = PLACEHOLDER_DIALOG
            elif ext == '.ls':
                ph = PLACEHOLDER_SCENE
            else:
                ph = PLACEHOLDER_LH
            serve_placeholder(self, "application/octet-stream", ph)
        else:
            self.send_error(404, "File not found")

    def log_message(self, format, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))


# ===== 辅助函数 =====
def _get_username(user_id):
    conn = db()
    row = conn.execute("SELECT username FROM users WHERE id=?", (user_id,)).fetchone()
    conn.close()
    return row["username"] if row else "guest"


def _get_user_by_id(user_id):
    conn = db()
    row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    conn.close()
    return row


def _get_or_create_anon_user():
    """未登录时自动给一个匿名用户（id 固定，存档不丢）。
    
    使用场景：游戏自动保存时 h5api.save() 直接调 /api/save，但用户还没注册/登录。
    与其返回 401 让客户端 localStorage 兜底，不如直接存到匿名槽位，
    用户后续注册时可以把匿名存档迁移过去。
    """
    ANON_USERNAME = "__anonymous__"
    user = get_user_by_username(ANON_USERNAME)
    if user:
        return user["id"]
    conn = db()
    cur = conn.execute(
        "INSERT INTO users(username, password_hash, created_at) VALUES(?, ?, ?)",
        (ANON_USERNAME, hash_pwd(uuid.uuid4().hex), now_ms())
    )
    user_id = cur.lastrowid
    conn.execute("INSERT INTO saves(user_id, player_data, updated_at) VALUES(?, ?, ?)",
                 (user_id, DEFAULT_PLAYER_DATA, now_ms()))
    conn.commit()
    conn.close()
    return user_id


# ===== 启动 =====
if __name__ == "__main__":
    init_db()
    os.chdir(DIRECTORY)
    socketserver.TCPServer.allow_reuse_address = True
    print(f"=== 赵云与阿斗 H5 本地游戏服务器 ===")
    print(f"监听: http://localhost:{PORT}")
    print(f"目录: {DIRECTORY}")
    print(f"数据库: {DB_PATH}")
    print(f"")
    print(f"已实现的 API 端点 (19 个):")
    print(f"  认证: POST /api/register, /api/login, /api/logout")
    print(f"        GET  /api/me")
    print(f"  存档: POST /api/save, GET /api/save")
    print(f"  段位: POST /api/score, GET /api/rank")
    print(f"  业务: GET /zyyad/game/start, /zyyad/game/end,")
    print(f"             /zyyad/game/country/list, /zyyad/game/province/detail/list")
    print(f"        GET /sys/server/time, /bestRank")
    print(f"        POST /sys/user/login, /sys/user/info, /sys/user/data")
    print(f"  埋点: POST /sys/oa/point/add/new, /sys/oa/errorUpload/add")
    print(f"")
    print(f"默认账号: 无（首次访问自动跳转注册）")
    print(f"")
    with socketserver.TCPServer(("", PORT), GameHTTPHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n服务器关闭")
