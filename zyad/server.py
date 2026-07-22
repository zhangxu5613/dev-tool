#!/usr/bin/env python3
"""
zyad 游戏总入口 - 在 8090 端口同时提供:
  - 静态文件 (HTML/JS/CSS/图片等)
  - HTTP API (19 个端点)
  - WebSocket 房间 (/local-room)

由 game_server.py + room_server.py 合并而来。
启动: python3 server.py
"""
import asyncio
import http.server
import socketserver
import os
import sys
import threading
import socket

# 复用现有的实现
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# 导入 game_server 的所有组件
from game_server import (
    DIRECTORY, PORT, GameHTTPHandler, init_db,
    PLACEHOLDER_PNG, PLACEHOLDER_LH, PLACEHOLDER_DIALOG, PLACEHOLDER_SCENE,
    serve_placeholder,
)
# 导入 room_server 的所有组件
from room_server import (
    handle_client as room_handle_client,
    WS_MAGIC,
)
import base64
import hashlib
from urllib.parse import urlparse, parse_qs


class HybridHandler(GameHTTPHandler):
    """扩展 GameHTTPHandler, 支持 WebSocket 升级"""

    def do_GET(self):
        # 检查是否是 WebSocket 升级请求
        upgrade = self.headers.get("Upgrade", "").lower()
        ws_key = self.headers.get("Sec-WebSocket-Key", "")
        if upgrade == "websocket" and ws_key and self.path.startswith("/local-room"):
            self._handle_websocket_upgrade()
            return
        # 其他走原逻辑
        super().do_GET()

    def _handle_websocket_upgrade(self):
        """同步 handler 里处理 WebSocket 升级。
        
        因为 game_server 是同步 http.server 模型, 而房间是异步的,
        我们用一个线程跑 asyncio loop, 每个连接创建 task。
        """
        ws_key = self.headers.get("Sec-WebSocket-Key", "")
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
        try:
            self.wfile.write(response.encode("utf-8"))
            self.wfile.flush()
        except Exception:
            return

        # 拿到 raw socket, 包装成 asyncio reader/writer
        sock = self.connection
        sock.setblocking(False)

        # 获取或创建线程内的 event loop
        loop = _get_loop()
        asyncio.run_coroutine_threadsafe(
            _serve_ws(sock, self.path),
            loop
        ).result()


def _get_loop():
    """获取/创建后台 asyncio loop"""
    global _loop
    if _loop is None:
        _loop = asyncio.new_event_loop()
        t = threading.Thread(target=_loop.run_forever, daemon=True)
        t.start()
    return _loop


_loop = None


async def _serve_ws(sock, path):
    """把 raw socket 转成 asyncio reader/writer, 交给 room_handle_client"""
    reader, writer = await asyncio.open_connection(sock=sock)
    try:
        await room_handle_client(reader, writer, path)
    except Exception as e:
        print(f"[ws] error: {e}", file=sys.stderr)
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass


if __name__ == "__main__":
    init_db()
    os.chdir(DIRECTORY)
    socketserver.TCPServer.allow_reuse_address = True
    
    print(f"=== 赵云与阿斗 H5 总服务器 ===", file=sys.stderr)
    print(f"监听: http://localhost:{PORT}", file=sys.stderr)
    print(f"目录: {DIRECTORY}", file=sys.stderr)
    print(f"", file=sys.stderr)
    print(f"功能:", file=sys.stderr)
    print(f"  - 静态文件托管", file=sys.stderr)
    print(f"  - 19 个 HTTP API 端点", file=sys.stderr)
    print(f"  - WebSocket 房间 /local-room (匹配/创建/加入/对战同步)", file=sys.stderr)
    print(f"", file=sys.stderr)
    
    with socketserver.TCPServer(("", PORT), HybridHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n服务器关闭", file=sys.stderr)
