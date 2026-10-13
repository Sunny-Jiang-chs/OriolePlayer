"""Build the author example using only the Python standard library."""

import json
import math
import struct
import wave
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parent
WIDTH, HEIGHT = 1280, 720
SAMPLE_RATE = 22050


def png_chunk(kind, data):
    checksum = zlib.crc32(kind + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", checksum)


def build_image(path, evening=False):
    sky = (35, 58, 73) if evening else (190, 228, 224)
    water = (51, 99, 113) if evening else (76, 157, 173)
    sun = (234, 126, 111) if evening else (248, 204, 107)
    land = (30, 43, 53) if evening else (50, 75, 78)
    light = (251, 214, 137) if evening else (235, 244, 231)
    rows = bytearray()
    for y in range(HEIGHT):
        rows.append(0)
        for x in range(WIDTH):
            color = sky if y < 430 else water
            if (x - 930) ** 2 + (y - 240) ** 2 < 84 ** 2:
                color = sun
            if y > 450 and 800 < x < 1080 and y % 48 < 4:
                color = sun
            if 0 < x < 560 and 270 < y < 530:
                color = land
            if 65 < x < 495 and 312 < y < 428:
                color = light
            if 270 < x < 287 and 312 < y < 428:
                color = land
            if 95 < x < 115 and 428 < y < 646:
                color = land
            if 480 < x < 500 and 428 < y < 646:
                color = land
            if 50 < x < 820 and 510 < y < 542:
                color = land
            if 610 < x < 633 and 510 < y < 697:
                color = land
            if y > 680:
                color = land
            rows.extend(color)
    header = struct.pack(">IIBBBBB", WIDTH, HEIGHT, 8, 2, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", header)
        + png_chunk(b"IDAT", zlib.compress(rows, 9))
        + png_chunk(b"IEND", b"")
    )


def build_audio(path, duration, effect=False):
    frames = bytearray()
    notes = (220, 275, 330, 275)
    for index in range(round(SAMPLE_RATE * duration)):
        time = index / SAMPLE_RATE
        if effect:
            frequency = 660 if time < 0.10 else 880
            envelope = min(1, time / 0.01) * max(0, 1 - time / duration) ** 2
            value = 0.30 * envelope * math.sin(2 * math.pi * frequency * time)
        else:
            phase = time % 1
            envelope = math.sin(math.pi * phase) ** 2
            frequency = notes[int(time) % len(notes)]
            value = 0.13 * envelope * (
                math.sin(2 * math.pi * frequency * time)
                + 0.25 * math.sin(2 * math.pi * frequency * 2 * time)
            )
        frames.extend(struct.pack("<h", round(32767 * value)))
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        output.writeframes(frames)


def page(page_id, order, speaker, body, visual_id, events=None, choices=None):
    return {
        "id": page_id,
        "order": order,
        "text": {"speaker": speaker, "body": body},
        "visual": {"assetId": visual_id, "status": "available"},
        "audioEvents": events or [],
        "choices": choices or [],
    }


def event(action, bus, asset_id=None, loop=False, volume=1):
    return {
        "action": action,
        "bus": bus,
        "assetId": asset_id,
        "loop": loop,
        "wait": False,
        "volume": volume,
    }


def choice(label, scene_id, page_id):
    return {
        "label": label,
        "enabled": True,
        "targetSceneId": scene_id,
        "targetPageId": page_id,
    }


def build():
    media = ROOT / "media"
    media.mkdir(parents=True, exist_ok=True)
    build_image(media / "station-day.png")
    build_image(media / "station-evening.png", evening=True)
    build_audio(media / "quiet-platform.wav", 4.0)
    build_audio(media / "arrival.wav", 0.24, effect=True)
    package = {
        "schemaVersion": "1.0.0",
        "project": {
            "id": "author-example",
            "title": "最后一班渡船",
            "engine": "cgscene",
            "locale": "zh-CN",
            "description": "独立创作样例；所有图片与声音由本地代码合成。",
        },
        "assets": {
            "visuals": [
                {
                    "id": "station-day",
                    "uri": "media/station-day.png",
                    "mimeType": "image/png",
                    "width": WIDTH,
                    "height": HEIGHT,
                    "status": "available",
                },
                {
                    "id": "station-evening",
                    "uri": "media/station-evening.png",
                    "mimeType": "image/png",
                    "width": WIDTH,
                    "height": HEIGHT,
                    "status": "available",
                },
            ],
            "audio": [
                {
                    "id": "quiet-platform",
                    "uri": "media/quiet-platform.wav",
                    "name": "候船台",
                    "mimeType": "audio/wav",
                    "duration": 4.0,
                    "status": "available",
                },
                {
                    "id": "arrival",
                    "uri": "media/arrival.wav",
                    "name": "抵达铃声",
                    "mimeType": "audio/wav",
                    "duration": 0.24,
                    "status": "available",
                },
            ],
        },
        "scenes": [
            {
                "id": "platform",
                "title": "候船台",
                "category": "开场",
                "pages": [
                    page(
                        "platform-01", 0, "旁白",
                        "午后的渡口很安静。她把未寄出的信放进口袋，坐在窗边等候。",
                        "station-day",
                        [event("play", "bgm", "quiet-platform", loop=True, volume=0.45)],
                    ),
                    page(
                        "platform-02", 1, "林",
                        "铃声响了。最后一班船已经靠岸，你愿意一起过去吗？",
                        "station-day",
                        [event("play", "sfx", "arrival", volume=0.7)],
                        [
                            choice("一起登船", "crossing", "crossing-01"),
                            choice("留在窗边", "waiting", "waiting-01"),
                        ],
                    ),
                ],
            },
            {
                "id": "crossing",
                "title": "出发",
                "category": "结尾",
                "pages": [
                    page(
                        "crossing-01", 0, "旁白",
                        "夕阳落在水面上。她终于把信递了出去，渡船缓缓离开岸边。",
                        "station-evening",
                        choices=[choice("回到候船台", "platform", "platform-01")],
                    ),
                ],
            },
            {
                "id": "waiting",
                "title": "留下",
                "category": "结尾",
                "pages": [
                    page(
                        "waiting-01", 0, "旁白",
                        "暮色填满了窗框。她把信摊在桌上，写下了新的第一句话。",
                        "station-evening",
                        [event("stop", "bgm")],
                        [choice("回到候船台", "platform", "platform-01")],
                    ),
                ],
            },
        ],
        "source": {"kind": "authored", "generator": "build_example.py"},
    }
    (ROOT / "package.json").write_text(
        json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("Built example: 3 scenes, 4 pages, 2 PNG visuals, 2 WAV audio assets.")


if __name__ == "__main__":
    build()
