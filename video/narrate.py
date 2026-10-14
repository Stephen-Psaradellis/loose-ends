"""Synthesize one narration clip per scene and record each clip's length.

    python narrate.py --mode demo|sandbox --out out/
Needs: pip install edge-tts imageio-ffmpeg  (Microsoft neural voices; synthetic narration,
disclosed in DEVPOST.md).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import subprocess
from pathlib import Path

import edge_tts
import imageio_ffmpeg

HERE = Path(__file__).resolve().parent


def duration(path: Path) -> float:
    err = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-i", str(path)],
                         capture_output=True, text=True).stderr
    h, m, s = re.search(r"Duration: (\d+):(\d+):([\d.]+)", err).groups()
    return int(h) * 3600 + int(m) * 60 + float(s)


async def say(text: str, voice: str, rate: str, path: Path) -> None:
    """edge-tts refuses bursts with a 403 now and then; back off and retry."""
    for attempt in range(6):
        try:
            await edge_tts.Communicate(text, voice, rate=rate).save(str(path))
            return
        except Exception:
            if attempt == 5:
                raise
            await asyncio.sleep(3 * (attempt + 1))


async def main(mode: str, out: Path) -> None:
    cfg = json.loads((HERE / "scenes.json").read_text(encoding="utf-8"))
    out.mkdir(parents=True, exist_ok=True)
    lengths = {}
    for sc in cfg["scenes"]:
        text = sc.get(f"say_{mode}") or sc["say"]
        clip = out / f"{sc['id']}.mp3"
        await say(text, cfg["voice"], cfg["rate"], clip)
        lengths[sc["id"]] = round(duration(clip), 3)
        if sc.get("user"):
            u = out / f"user_{sc['id']}.mp3"
            await say(sc["user"], cfg["user_voice"], cfg["user_rate"], u)
            subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-i", str(u),
                            "-ar", "48000", "-ac", "1", str(u.with_suffix(".wav"))], check=True)
            lengths[f"user_{sc['id']}"] = round(duration(u), 3)
    (out / "lengths.json").write_text(json.dumps(lengths, indent=1), encoding="utf-8")
    print(json.dumps({"total_s": round(sum(lengths.values()), 1), **lengths}))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="demo")
    ap.add_argument("--out", type=Path, default=HERE / "out")
    a = ap.parse_args()
    asyncio.run(main(a.mode, a.out))
