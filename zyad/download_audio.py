#!/usr/bin/env python3
"""尝试常见 mp3 文件名，存在则下载，不删除任何文件"""
import os
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "http://game.ruankor.com/h5new/45"
SOUND_DIR = "/Users/sladezhang/source/dev-tool/canvas/zhaoyun-game/resources/sound"
MUSIC_DIR = "/Users/sladezhang/source/dev-tool/canvas/zhaoyun-game/resources/music"

# 基于游戏（赵云、阿斗、三国题材）的常见 mp3 命名
SOUND_CANDIDATES = [
    "btn_up", "btn_click", "btn_close", "btn_ok", "btn_cancel",
    "click", "open", "popup", "close", "success", "fail",
    "hit", "crit", "coin", "gold", "silver", "gem", "heart",
    "level_up", "level_down", "damage", "dodge", "block", "parry",
    "skill", "skill_cast", "combo", "big_combo",
    "boss_appear", "boss_death", "boss_attack",
    "battle_start", "battle_end", "battle_win", "battle_lose",
    "arrow_shoot", "sword_swing", "sword_attack",
    "knife", "axe", "spear", "fire_burn", "ice_freeze",
    "lightning", "wind", "thunder", "heal", "revive",
    "buy", "sell", "refresh", "rank_up", "rank_down",
    "star", "gold_fly", "score_fly", "die", "win", "lose", "draw",
    "stamina", "energy", "rage", "buff", "debuff",
    "pve", "pvp", "pve_start", "pve_end", "pvp_start", "pvp_end",
    "battle_start_fight", "battle_end_settle", "battle_reward",
    "knife_swing", "knife_hit", "knife_miss", "knife_kill",
    "longdan", "qiang", "qiang_swing", "qiang_hit",
    "huo", "huo_attack", "huo_burn", "huo_hit",
    "bing", "bing_attack", "bing_freeze", "bing_hit",
    "lei", "lei_attack", "lei_thunder", "lei_hit",
    "music_battle", "music_boss", "music_lobby", "music_victory", "music_defeat",
    "music_menu", "music_shop", "music_load", "music_match",
    "zhao", "zhao_attack", "zhao_skill", "zhao_death",
    "ad", "ad_attack", "ad_death",
    "equip", "equip_change", "equip_up",
    "reward_get", "reward_open", "reward_chest",
    "login", "logout", "register", "load_complete",
    "button_press", "button_release", "button_hover",
    "click_ok", "click_cancel", "click_tap",
    "score_increase", "score_finish", "score_get",
    "level_complete", "level_failed", "level_start",
    "pvp_match", "pvp_start", "pvp_end", "pvp_result",
    "battle_round", "battle_result", "battle_reward",
    "skill_ready", "skill_cast_1", "skill_cast_2", "skill_cast_3",
    "kill", "kill_normal", "kill_boss",
    "upgrade", "upgrade_success", "upgrade_fail",
    "lottery", "lottery_draw", "lottery_reward",
    "page_flip", "page_turn", "page_next", "page_prev",
    "shop_buy", "shop_sell", "shop_refresh",
    "warning", "error", "alert", "notice", "tip",
    "stamina_full", "stamina_empty", "energy_full", "energy_empty",
    "wave_start", "wave_end", "round_start", "round_end",
    "spawn", "spawn_enemy", "spawn_boss",
    "buff_gain", "buff_lose", "debuff_gain", "debuff_lose",
]

# 音乐文件（通常是 .mp3 或 .ogg）常见名
MUSIC_CANDIDATES = [
    "bgm", "menu", "lobby", "battle", "boss", "victory", "defeat",
    "loading", "intro", "ending", "shop", "inventory",
    "bgm_menu", "bgm_lobby", "bgm_battle", "bgm_boss", "bgm_victory", "bgm_defeat",
    "music_battle_1", "music_battle_2", "music_battle_3",
    "music_boss_1", "music_boss_2", "music_lobby_1",
    "music_match", "music_shop", "music_load",
    "theme", "opening", "ending", "credits",
]


def try_download(path, url):
    """尝试下载，返回 (path, success, size)"""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        resp = urllib.request.urlopen(req, timeout=10)
        if resp.status == 200:
            data = resp.read()
            if len(data) > 100:  # 至少 100 字节才是真实文件
                return (path, data, len(data))
        return (path, None, 0)
    except Exception:
        return (path, None, 0)


def main():
    print(f"=== 搜索 sound/*.mp3 ===")
    sound_found = []
    with ThreadPoolExecutor(max_workers=16) as pool:
        futures = {}
        for name in SOUND_CANDIDATES:
            path = f"{SOUND_DIR}/{name}.mp3"
            if os.path.exists(path) and os.path.getsize(path) > 0:
                continue  # 跳过已下载
            url = f"{BASE}/resources/sound/{name}.mp3"
            futures[pool.submit(try_download, path, url)] = name

        for fut in as_completed(futures):
            path, data, size = fut.result()
            if data:
                # 写入文件
                with open(path, "wb") as f:
                    f.write(data)
                name = os.path.basename(path)
                print(f"  ✓ {name} ({size} bytes)")
                sound_found.append(name)

    print(f"\n sound: 找到 {len(sound_found)} 个新文件")

    print(f"\n=== 搜索 music/* ===")
    music_found = []
    with ThreadPoolExecutor(max_workers=16) as pool:
        futures = {}
        for name in MUSIC_CANDIDATES:
            for ext in [".mp3", ".ogg"]:
                path = f"{MUSIC_DIR}/{name}{ext}"
                if os.path.exists(path) and os.path.getsize(path) > 0:
                    continue
                url = f"{BASE}/resources/music/{name}{ext}"
                futures[pool.submit(try_download, path, url)] = f"{name}{ext}"

        for fut in as_completed(futures):
            path, data, size = fut.result()
            if data:
                with open(path, "wb") as f:
                    f.write(data)
                name = os.path.basename(path)
                print(f"  ✓ {name} ({size} bytes)")
                music_found.append(name)

    print(f"\n music: 找到 {len(music_found)} 个新文件")


if __name__ == "__main__":
    main()
