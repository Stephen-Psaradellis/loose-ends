"""Lay the narration, the user's spoken lines and the app's readback over the recording.

    python mux.py out/   ->  out/loose-ends-demo.mp4
Narration clips start at their scene; each user line starts when the app began listening
(that is when record.mjs fed it to the microphone); the readback is the app's own caption
text spoken in a third voice, because headless Chromium's speechSynthesis makes no sound.
The first frames (page load, entering XR) are trimmed: output starts 0.4s before scene 1.
Needs edge-tts + imageio-ffmpeg (Python 3.10 on this machine; edge-tts >= 7.3.1).
"""
from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from pathlib import Path

import edge_tts
import imageio_ffmpeg

HERE = Path(__file__).resolve().parent
out = Path(sys.argv[1] if len(sys.argv) > 1 else HERE / "out")
cfg = json.loads((HERE / "scenes.json").read_text(encoding="utf-8"))
tl = json.loads((out / "timeline.json").read_text(encoding="utf-8"))
ids = [s["id"] for s in cfg["scenes"]]
APP_VOICE = "en-US-EmmaNeural"
FONT = "C\\:/Windows/Fonts/segoeui.ttf"
NOTE = "Recorded in the Meta IWER emulator, hands mode. Voices are synthetic."

readback = out / "readback.mp3"
if tl.get("readback"):
    asyncio.run(edge_tts.Communicate(tl["readback"], APP_VOICE).save(str(readback)))

lead = max(0.0, tl[ids[0]] - 0.4)
end = min(tl["_end"] - lead, 179.0)
clips = [(out / f"{i}.mp3", tl[i] + 0.25) for i in ids]
clips += [(out / f"user_{s['id']}.mp3", tl[f"user_{s['id']}"]) for s in cfg["scenes"] if s.get("user")]
if tl.get("readback"):
    clips.append((readback, tl["readback_at"] - 0.4))

cmd = [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-ss", f"{lead:.3f}", "-i", str(out / tl["video"])]
parts, labels = [], []
for n, (path, at) in enumerate(clips, start=1):
    cmd += ["-i", str(path)]
    ms = max(0, int(round((at - lead) * 1000)))
    parts.append(f"[{n}:a]adelay={ms}|{ms}[a{n}]")
    labels.append(f"[a{n}]")
parts.append(f"{''.join(labels)}amix=inputs={len(clips)}:normalize=0,apad[aout]")
parts.append(f"[0:v]fps=30,drawtext=fontfile='{FONT}':text='{NOTE}':fontcolor=white@0.85:fontsize=20:"
             f"box=1:boxcolor=black@0.45:boxborderw=8:x=20:y=h-44:enable='lt(t,7)'[vout]")
cmd += ["-filter_complex", ";".join(parts), "-map", "[vout]", "-map", "[aout]",
        "-t", f"{end:.3f}", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
        str(out / "loose-ends-demo.mp4")]
r = subprocess.run(cmd, capture_output=True, text=True)
if r.returncode:
    sys.exit(r.stderr[-2000:])
print(json.dumps({"mp4": str(out / "loose-ends-demo.mp4"), "seconds": round(end, 1)}))
