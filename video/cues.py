"""The app's sound cues as a WAV track, for the demo video.

Headless Chromium plays Web Audio into nothing and Playwright records no sound, so
record.mjs logs each cue the app played (timeline.json "cues": [[name, seconds], ...])
and this module re-synthesises them from the same table the app uses (app/src/sound.ts):
sine tones, a 15 ms exponential attack, an exponential decay over the tone, optional
exponential glide - the same shape Sounds.play schedules.

    python cues.py out/   ->  out/cues.wav  (mux.py calls write_track itself)
"""
from __future__ import annotations

import json
import re
import sys
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
SOUND_TS = HERE.parent / "app" / "src" / "sound.ts"
RATE = 48000
# The app plays cues at VOLUME (0.08) under a quiet room; in the video they sit under a
# narrator, so they are lifted to stay audible. Still well under the voices.
VIDEO_GAIN = 4.0


def load_table(src: str | None = None) -> tuple[dict[str, list[dict]], float]:
    """Parse CUES and VOLUME out of sound.ts, so the video can never drift from the app."""
    src = src if src is not None else SOUND_TS.read_text(encoding="utf-8")
    notes = {k: float(v) for k, v in re.findall(r"const (\w+) = ([\d.]+);", src)}
    volume = float(re.search(r"export const VOLUME = ([\d.]+);", src).group(1))
    body = re.search(r"export const CUES[^=]*= \{(.*?)\n\};", src, re.S).group(1)
    # A comment line between entries ends the previous entry's match late and merges two cues.
    body = re.sub(r"^\s*//.*\n", "", body, flags=re.M)
    table: dict[str, list[dict]] = {}
    for name, tones in re.findall(r"(\w+): \[(.*?)\],?\n(?=  \w+:|$)", body + "\n", re.S):
        table[name] = []
        for t in re.findall(r"\{([^}]*)\}", tones):
            kv = dict(re.findall(r"(\w+): ([\w.]+)", t))
            val = lambda x: notes[x] if x in notes else float(x)  # noqa: E731
            table[name].append({"f": val(kv["f"]), "at": val(kv["at"]), "len": val(kv["len"]),
                                "to": val(kv["to"]) if "to" in kv else None,
                                "gain": val(kv["gain"]) if "gain" in kv else 1.0})
    return table, volume


def tone(t: dict, volume: float) -> np.ndarray:
    n = int((t["len"] + 0.02) * RATE)
    x = np.arange(n) / RATE
    f = np.full(n, t["f"])
    if t["to"]:
        k = np.clip(x / t["len"], 0, 1)
        f = t["f"] * (t["to"] / t["f"]) ** k
    phase = 2 * np.pi * np.cumsum(f) / RATE
    peak = volume * t["gain"]
    att = 0.015
    env = np.where(x < att, 0.0001 * (peak / 0.0001) ** (x / att),
                   peak * (0.0001 / peak) ** np.clip((x - att) / (t["len"] - att), 0, 1))
    return np.sin(phase) * env


def render(cues: list[list], seconds: float, table=None, volume=None) -> np.ndarray:
    if table is None:
        table, volume = load_table()
    out = np.zeros(int(seconds * RATE) + RATE)
    for name, at in cues:
        for t in table[name]:
            y = tone(t, volume * VIDEO_GAIN)
            i = int((at + t["at"]) * RATE)
            if 0 <= i < len(out):
                out[i:i + len(y)] += y[: len(out) - i]
    return out


def write_track(cues: list[list], seconds: float, path: Path) -> Path:
    pcm = (np.clip(render(cues, seconds), -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())
    return path


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else HERE / "out")
    tl = json.loads((out / "timeline.json").read_text(encoding="utf-8"))
    print(write_track(tl.get("cues", []), tl["_end"], out / "cues.wav"))
