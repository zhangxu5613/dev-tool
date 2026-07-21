#!/usr/bin/env python3
"""
赵云与阿斗 H5 - WebSocket 房间服务器

实现 local-multiplayer.js 需要的 /local-room 端点。
支持：
  - 创建房间（room="" 时自动生成 6 位 room_id）
  - 加入房间（room=xxxx）
  - 匹配（match=1，自动凑对）
  - 房间内消息广播（battle 同步）
  - 对手离线/重连
  - 房间结算后销毁

协议（JSON 消息）：
  客户端 → 服务端:
    {type: "join", action: "create|join|match|reconnect", room: "...", cid, name, profile, save}
    {type: "battle", data: {kind: "spawn|item|wave|op|result|enemyState|event|leave", ...}}
    {type: "leave"}
  服务端 → 客户端:
    {type: "hello", id, room, seat, seed, state, source, clients, save}
    {type: "room", room, players, clients, seed, state}
    {type: "start", room, seat, seed, source, clients, save, host}
    {type: "battle", from, data}
    {type: "peerleft"}
    {type: "peeroffline"} / {type: "peeronline"}
    {type: "settled", won, save}
    {type: "roomclosed", reason}
    {type: "error", code, message}

启动：python3 room_server.py  (默认端口 8091)
也可以作为模块被 game_server.py 调用。

设计原则：
  - 单线程异步（asyncio + websockets 风格）
  - 但不依赖第三方库，自己实现 WebSocket 帧解析
  - 房间状态用 dict 维护，无需持久化（房间是临时的）
"""
import asyncio
import base64
import hashlib
import json
import os
import random
import string
import sys
import time
from http import HTTPStatus

# ===== 配置 =====
PORT = 8091
HOST = "0.0.0.0"
WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
ROOM_ID_LEN = 6
MAX_ROOM_CLIENTS = 2  # 1v1
MATCH_TIMEOUT = 60  # 匹配超时秒数
ROOM_IDLE_TIMEOUT = 300  # 房间空闲超时秒数（无人时清理）


# ===== 房间状态 =====
class Room:
    def __init__(self, room_id, host_cid):
        self.room_id = room_id
        self.host_cid = host_cid  # 创建者 cid
        self.clients = {}  # cid -> Client
        self.seed = _gen_seed()
        self.state = "waiting"  # waiting / started / settled
        self.source = "create"
        self.save = ""  # host 的存档，给 opponent 用
        self.created_at = time.time()
        self.last_active = time.time()

    def to_dict(self):
        return {
            "room": self.room_id,
            "seed": self.seed,
            "state": self.state,
            "source": self.source,
            "clients": [c.to_dict() for c in self.clients.values()],
            "save": self.save,
        }

    def is_full(self):
        return len(self.clients) >= MAX_ROOM_CLIENTS

    def is_empty(self):
        return len(self.clients) == 0

    def touch(self):
        self.last_active = time.time()


class Client:
    def __init__(self, ws, cid, name, profile, save):
        self.ws = ws  # asyncio WebSocket 类似对象
        self.cid = cid
        self.name = name or "player"
        self.profile = profile or {}
        self.save = save or ""
        self.seat = -1
        self.room = None
        self.connected = True
        self.joined_at = time.time()

    def to_dict(self):
        return {
            "id": self.cid,
            "name": self.name,
            "profile": self.profile,
            "seat": self.seat,
            "connected": self.connected,
        }


# ===== 全局状态 =====
ROOMS = {}  # room_id -> Room
MATCH_QUEUE = []  # [Client, ...] 等待匹配的客户端
CLIENTS = {}  # cid -> Client (用于重连)


def _gen_seed():
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=12))


def _gen_room_id():
    for _ in range(10):
        rid = "".join(random.choices(string.digits, k=ROOM_ID_LEN))
        if rid not in ROOMS:
            return rid
    return "".join(random.choices(string.digits, k=10))


def _now_ms():
    return int(time.time() * 1000)


# ===== WebSocket 帧编解码（RFC 6455 简化版）=====
async def ws_send(ws, message):
    """发送 JSON 文本帧"""
    data = json.dumps(message, ensure_ascii=False).encode("utf-8")
    frame = _make_text_frame(data)
    try:
        ws.write(frame)
        await ws.drain()
    except Exception as e:
        print(f"[ws_send] error: {e}", file=sys.stderr)


def _make_text_frame(payload):
    """构造文本帧 (FIN=1, opcode=0x1)"""
    header = bytearray([0x81])
    length = len(payload)
    if length < 126:
        header.append(length | 0x80)  # mask=1 (server→client 实际不需要 mask, 但客户端能解)
        # 服务端发往客户端的帧不应 mask, 但有些客户端要求不 mask
        # RFC 6455: 服务端帧不能 mask
        header[-1] = length  # 去掉 mask 位
    elif length < 65536:
        header.append(126)
        header.extend(length.to_bytes(2, "big"))
    else:
        header.append(127)
        header.extend(length.to_bytes(8, "big"))
    return bytes(header) + payload


async def ws_recv(ws):
    """读取一帧 (只处理 text/binary, 忽略 ping/pong, 自动回 pong)"""
    try:
        header = await ws.readexactly(2)
    except Exception:
        return None
    b1, b2 = header[0], header[1]
    fin = b1 & 0x80
    opcode = b1 & 0x0F
    masked = b2 & 0x80
    length = b2 & 0x7F
    if length == 126:
        length = int.from_bytes(await ws.readexactly(2), "big")
    elif length == 127:
        length = int.from_bytes(await ws.readexactly(8), "big")
    mask = await ws.readexactly(4) if masked else b""
    payload = await ws.readexactly(length) if length else b""
    if masked:
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    if opcode == 0x8:  # close
        return None
    if opcode == 0x9:  # ping
        await ws_send_pong(ws, payload)
        return await ws_recv(ws)
    if opcode == 0xA:  # pong
        return await ws_recv(ws)
    if opcode in (0x1, 0x2):  # text / binary
        try:
            text = payload.decode("utf-8")
            return text
        except Exception:
            return None
    return None


async def ws_send_pong(ws, payload):
    frame = bytearray([0x8A])
    n = len(payload)
    if n < 126:
        frame.append(n)
    elif n < 65536:
        frame.append(126)
        frame.extend(n.to_bytes(2, "big"))
    else:
        frame.append(127)
        frame.extend(n.to_bytes(8, "big"))
    ws.write(bytes(frame) + payload)
    await ws.drain()


async def ws_close(ws):
    try:
        ws.write(b'\x88\x00')  # close frame
        await ws.drain()
    except Exception:
        pass


# ===== 业务逻辑 =====
async def handle_client(reader, writer, path_query):
    """处理一个 WebSocket 连接"""
    # path_query 形如 "/local-room?room=ABCD12&match=1"
    from urllib.parse import urlparse, parse_qs
    parsed = urlparse(path_query)
    query = parse_qs(parsed.query)
    req_room = (query.get("room", [""])[0] or "").strip()
    req_match = query.get("match", [""])[0] == "1"

    # 等第一条 join 消息
    first = await ws_recv(reader)
    if not first:
        await ws_close(writer)
        return
    try:
        msg = json.loads(first)
    except Exception:
        await ws_send(writer, {"type": "error", "code": "BAD_REQUEST", "message": "invalid join message"})
        await ws_close(writer)
        return
    if msg.get("type") != "join":
        await ws_send(writer, {"type": "error", "code": "BAD_REQUEST", "message": "first message must be join"})
        await ws_close(writer)
        return

    action = msg.get("action") or ("match" if req_match else "join")
    cid = msg.get("cid") or f"c{_now_ms()}{random.randint(1000, 9999)}"
    name = msg.get("name") or "player"
    profile = msg.get("profile") or {}
    save = msg.get("save") or ""

    # 创建 Client
    client = Client(writer, cid, name, profile, save)
    client.reader = reader  # 保留 reader 引用
    CLIENTS[cid] = client

    print(f"[room] client {cid} ({name}) action={action} room={req_room}", file=sys.stderr)

    # 路由到不同 action
    if action == "create":
        room_id = req_room or _gen_room_id()
        if room_id in ROOMS and ROOMS[room_id].is_full():
            await ws_send(writer, {"type": "error", "code": "ROOM_UNAVAILABLE", "message": "房间已满"})
            await ws_close(writer)
            return
        room = Room(room_id, cid)
        room.source = "create"
        client.seat = 0
        client.room = room
        room.clients[cid] = client
        if save:
            room.save = save
        ROOMS[room_id] = room
        await _send_hello(client, room)
        await _broadcast_room_update(room)
    elif action == "join":
        room = ROOMS.get(req_room)
        if not room:
            await ws_send(writer, {"type": "error", "code": "ROOM_NOT_FOUND", "message": "房间不存在"})
            await ws_close(writer)
            return
        if room.is_full():
            await ws_send(writer, {"type": "error", "code": "ROOM_FULL", "message": "房间已满"})
            await ws_close(writer)
            return
        client.seat = 1
        client.room = room
        room.clients[cid] = client
        room.touch()
        await _send_hello(client, room)
        await _broadcast_room_update(room)
        # 如果满员且 host 已就绪, 自动 start
        if room.is_full() and room.state == "waiting":
            await _start_battle(room)
    elif action == "match":
        # 加入匹配队列
        client.seat = -1
        MATCH_QUEUE.append(client)
        await ws_send(writer, {"type": "matching"})
        # 尝试立即匹配
        await _try_match()
    elif action == "reconnect":
        # 重连: 找已有 client by cid
        old = CLIENTS.get(cid)
        if old and old.room:
            # 接管旧连接
            room = old.room
            if cid in room.clients:
                # 替换 ws
                old.ws = writer
                old.reader = reader
                old.connected = True
                client.ws = writer
                client.reader = reader
                client.room = room
                client.seat = old.seat
                room.clients[cid] = client
                room.touch()
                await _send_hello(client, room)
                await _broadcast_room_update(room)
                # 通知对手重连
                await _notify_peer(room, client, {"type": "peeronline"})
            else:
                await ws_send(writer, {"type": "error", "code": "ROOM_NOT_FOUND", "message": "你不在该房间"})
                await ws_close(writer)
                return
        else:
            # 没找到旧 client, 尝试按 room_id 加入
            room = ROOMS.get(req_room)
            if not room:
                await ws_send(writer, {"type": "error", "code": "ROOM_NOT_FOUND", "message": "房间不存在或已销毁"})
                await ws_close(writer)
                return
            client.seat = 1 if any(c.seat == 0 for c in room.clients.values()) else 0
            client.room = room
            room.clients[cid] = client
            room.touch()
            await _send_hello(client, room)
            await _broadcast_room_update(room)
    else:
        await ws_send(writer, {"type": "error", "code": "BAD_ACTION", "message": f"unknown action: {action}"})
        await ws_close(writer)
        return

    # 进入消息循环
    try:
        while True:
            raw = await ws_recv(reader)
            if raw is None:
                break
            try:
                msg = json.loads(raw)
            except Exception:
                continue
            await _handle_message(client, msg)
    except Exception as e:
        print(f"[room] client {cid} error: {e}", file=sys.stderr)
    finally:
        await _on_client_disconnect(client)


async def _handle_message(client, msg):
    msg_type = msg.get("type")
    if msg_type == "battle":
        # 转发给同房间的其他客户端
        if client.room:
            client.room.touch()
            await _broadcast_to_others(client.room, client, {
                "type": "battle",
                "from": client.cid,
                "data": msg.get("data", {})
            })
    elif msg_type == "leave":
        await _on_client_disconnect(client)
    elif msg_type == "ping":
        await ws_send(client.ws, {"type": "pong", "t": _now_ms()})


async def _send_hello(client, room):
    """发送 hello 给新连接的客户端"""
    await ws_send(client.ws, {
        "type": "hello",
        "id": client.cid,
        "room": room.room_id,
        "seat": client.seat,
        "seed": room.seed,
        "state": room.state,
        "source": room.source,
        "clients": [c.to_dict() for c in room.clients.values()],
        "save": room.save if client.seat == 1 else "",  # 只给 opponent 发 host save
    })


async def _broadcast_room_update(room):
    """通知房间所有客户端房间状态变化"""
    for c in list(room.clients.values()):
        await ws_send(c.ws, {
            "type": "room",
            "room": room.room_id,
            "players": len(room.clients),
            "clients": [c2.to_dict() for c2 in room.clients.values()],
            "seed": room.seed,
            "state": room.state,
        })


async def _start_battle(room):
    """房间满员, 开始对战"""
    room.state = "started"
    room.touch()
    clients = list(room.clients.values())
    # 取 host 的 save 给 opponent
    host = next((c for c in clients if c.seat == 0), clients[0])
    opponent = next((c for c in clients if c.seat == 1), clients[-1])
    room.save = host.save or ""
    for c in clients:
        await ws_send(c.ws, {
            "type": "start",
            "id": c.cid,
            "room": room.room_id,
            "seat": c.seat,
            "seed": room.seed,
            "source": room.source,
            "clients": [c2.to_dict() for c2 in clients],
            "save": room.save if c is opponent else "",  # 只给 opponent 发 host save
            "host": host.cid,
        })


async def _try_match():
    """从匹配队列里凑对"""
    while len(MATCH_QUEUE) >= 2:
        c1 = MATCH_QUEUE.pop(0)
        c2 = MATCH_QUEUE.pop(0)
        if not c1.connected or not c2.connected:
            # 跳过已断开
            if c1.connected:
                MATCH_QUEUE.insert(0, c1)
            if c2.connected:
                MATCH_QUEUE.insert(0, c2)
            continue
        # 创建房间
        room_id = _gen_room_id()
        room = Room(room_id, c1.cid)
        room.source = "match"
        c1.seat = 0
        c2.seat = 1
        c1.room = room
        c2.room = room
        room.clients[c1.cid] = c1
        room.clients[c2.cid] = c2
        room.save = c1.save or ""
        ROOMS[room_id] = room
        # 发 hello
        await _send_hello(c1, room)
        await _send_hello(c2, room)
        # 立即 start
        await _start_battle(room)


async def _broadcast_to_others(room, sender, msg):
    """广播给房间内除 sender 外的客户端"""
    for c in list(room.clients.values()):
        if c is sender:
            continue
        await ws_send(c.ws, msg)


async def _notify_peer(room, sender, msg):
    """通知房间内除 sender 外的客户端"""
    await _broadcast_to_others(room, sender, msg)


async def _on_client_disconnect(client):
    """客户端断开"""
    if not client.room:
        # 在匹配队列里的, 移除
        if client in MATCH_QUEUE:
            try:
                MATCH_QUEUE.remove(client)
            except ValueError:
                pass
        CLIENTS.pop(client.cid, None)
        return

    room = client.room
    client.connected = False

    # 从房间移除
    if client.cid in room.clients:
        del room.clients[client.cid]

    if room.is_empty():
        # 房间空了, 销毁
        ROOMS.pop(room.room_id, None)
        CLIENTS.pop(client.cid, None)
        return

    # 还有其他客户端
    if room.state == "waiting":
        # 等待中, 通知对手离开
        await _broadcast_to_others(room, client, {"type": "peerleft"})
        # 重置房间状态, 等新对手
        room.state = "waiting"
        await _broadcast_room_update(room)
    elif room.state == "started":
        # 对战中离开, 通知对手胜利
        await _broadcast_to_others(room, client, {
            "type": "peerleft"
        })
        # 直接结算对手胜
        await _settle_room(room, winner_cid=next(iter(room.clients.keys()), None))
    elif room.state == "settled":
        # 已结算, 等所有人退出
        pass

    CLIENTS.pop(client.cid, None)


async def _settle_room(room, winner_cid=None):
    """结算房间"""
    room.state = "settled"
    for c in list(room.clients.values()):
        won = (c.cid == winner_cid) if winner_cid else False
        await ws_send(c.ws, {
            "type": "settled",
            "won": won,
            "save": room.save,
        })
    # 给一点时间让客户端处理, 然后销毁
    await asyncio.sleep(2)
    for c in list(room.clients.values()):
        await ws_close(c.ws)
    ROOMS.pop(room.room_id, None)


# ===== HTTP→WebSocket 升级 =====
async def handle_http(reader, writer):
    """处理 HTTP 请求, 如果是 /local-room 升级为 WebSocket, 否则返回 404"""
    try:
        # 读 HTTP 请求头
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = await reader.read(4096)
            if not chunk:
                writer.close()
                await writer.wait_closed()
                return
            data += chunk
        header_text = data.decode("utf-8", errors="replace")
        lines = header_text.split("\r\n")
        request_line = lines[0]
        parts = request_line.split(" ")
        if len(parts) < 3:
            writer.close()
            await writer.wait_closed()
            return
        method, path, version = parts[0], parts[1], parts[2]

        # 解析 headers
        headers = {}
        for line in lines[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()

        if path.startswith("/local-room") and headers.get("upgrade", "").lower() == "websocket":
            # WebSocket 升级
            ws_key = headers.get("sec-websocket-key", "")
            if not ws_key:
                writer.write(b"HTTP/1.1 400 Bad Request\r\n\r\n")
                await writer.drain()
                writer.close()
                await writer.wait_closed()
                return
            accept = base64.b64encode(
                hashlib.sha1((ws_key + WS_MAGIC).encode("utf-8")).digest()
            ).decode("utf-8")
            response = (
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept}\r\n"
                "\r\n"
            )
            writer.write(response.encode("utf-8"))
            await writer.drain()
            # 进入 WebSocket 循环
            await handle_client(reader, writer, path)
            writer.close()
            await writer.wait_closed()
            return

        # 非 WebSocket 请求
        body = b"WebSocket endpoint: /local-room\n"
        response = (
            "HTTP/1.1 200 OK\r\n"
            "Content-Type: text/plain\r\n"
            f"Content-Length: {len(body)}\r\n"
            "Connection: close\r\n"
            "\r\n"
        ).encode("utf-8") + body
        writer.write(response)
        await writer.drain()
        writer.close()
        await writer.wait_closed()
    except Exception as e:
        print(f"[http] error: {e}", file=sys.stderr)
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass


# ===== 启动 =====
async def main():
    server = await asyncio.start_server(handle_http, HOST, PORT)
    print(f"=== 房间服务器 (WebSocket) ===", file=sys.stderr)
    print(f"监听: ws://{HOST}:{PORT}/local-room", file=sys.stderr)
    print(f"支持: 创建房间 / 加入房间 / 匹配 / 重连 / 对战同步", file=sys.stderr)
    print(f"", file=sys.stderr)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    # 兼容 Python 3.6 (无 asyncio.run) 和 3.7+
    try:
        run_asyncio = getattr(asyncio, "run", None)
    except Exception:
        run_asyncio = None
    if run_asyncio is None:
        # Python 3.6 fallback
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(main())
        except KeyboardInterrupt:
            print("\n房间服务器关闭", file=sys.stderr)
        finally:
            try:
                loop.run_until_complete(loop.shutdown_asyncgens())
            except Exception:
                pass
            loop.close()
    else:
        # Python 3.7+
        try:
            run_asyncio(main())
        except KeyboardInterrupt:
            print("\n房间服务器关闭", file=sys.stderr)
