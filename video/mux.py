"""Lay the narration, the user's spoken lines and the app's readback over the recording.

    python mux.py out/   ->  out/loose-ends-demo.mp4
Narration clips start at their scene; each user line starts when the app began listening
(that is when record.mjs fed it to the microphone); the readback is the app's own caption
text spoken in a third voice, because headless Chromium's speechSynthesis makes no sound.
The app's sound cues (record.mjs logs each one it played) are re-synthesised by cues.py.
The first frames (page load, entering XR) are trimmed: output starts 0.4s before scene 1;
the next-evening reload is cut out the same way and captioned.
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

import cues

HERE = Path(__file__).resolve().parent
out = Path(sys.argv[1] if len(sys.argv) > 1 else HERE / "out")
cfg = json.loads((HERE / "scenes.json").read_text(encoding="utf-8"))
tl = json.loads((out / "timeline.json").read_text(encoding="utf-8"))
ids = [s["id"] for s in cfg["scenes"]]
APP_VOICE = "en-US-EmmaNeural"
FONT = "C\\:/Windows/Fonts/segoeui.ttf"
NOTE = "Recorded in the Meta IWER emulator, hands mode. Voices are synthetic."
NEXT = "The next evening (the demo moves the saved day back one day, then reloads)"

readback = out / "readback.mp3"
if tl.get("readback"):
    asyncio.run(edge_tts.Communicate(tl["readback"], APP_VOICE).save(str(readback)))

lead = max(0.0, tl[ids[0]] - 0.4)
# The next-evening reload (cut_from..cut_to) is cut out; out() maps recording time to video time.
cut = (tl["cut_from"], tl["cut_to"]) if "cut_from" in tl else None
gap = cut[1] - cut[0] if cut else 0.0


def out_t(at: float) -> float:
    return at - lead - (gap if cut and at >= cut[1] else 0.0)


end = min(out_t(tl["_end"]), 179.0)
clips = [(out / f"{i}.mp3", tl[i] + 0.25) for i in ids]
clips += [(out / f"user_{s['id']}.mp3", tl[f"user_{s['id']}"]) for s in cfg["scenes"] if s.get("user")]
if tl.get("readback"):
    clips.append((readback, tl["readback_at"] - 0.4))
tracks = []
if tl.get("cues"):  # one track, already in video time, laid at 0
    keep = [[c, out_t(at)] for c, at in tl["cues"] if at >= lead and not (cut and cut[0] <= at < cut[1])]
    tracks.append(cues.write_track(keep, end, out / "cues.wav"))

cmd = [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-i", str(out / tl["video"])]
parts, labels = [], []
inputs = [(path, out_t(at)) for path, at in clips] + [(t, 0.0) for t in tracks]
for n, (path, at) in enumerate(inputs, start=1):
    cmd += ["-i", str(path)]
    ms = max(0, int(round(at * 1000)))
    parts.append(f"[{n}:a]adelay={ms}|{ms}[a{n}]")
    labels.append(f"[a{n}]")
parts.append(f"{''.join(labels)}amix=inputs={len(inputs)}:normalize=0,apad[aout]")
if cut:
    parts.append(f"[0:v]trim=start={lead:.3f}:end={cut[0]:.3f},setpts=PTS-STARTPTS[v1]")
    parts.append(f"[0:v]trim=start={cut[1]:.3f},setpts=PTS-STARTPTS[v2]")
    parts.append("[v1][v2]concat=n=2:v=1:a=0[vcat]")
else:
    parts.append(f"[0:v]trim=start={lead:.3f},setpts=PTS-STARTPTS[vcat]")
draw = (f"drawtext=fontfile='{FONT}':text='{NOTE}':fontcolor=white@0.85:fontsize=20:"
        f"box=1:boxcolor=black@0.45:boxborderw=8:x=20:y=h-44:enable='lt(t,7)'")
if cut:
    c0 = out_t(cut[1])
    draw += (f",drawtext=fontfile='{FONT}':text='{NEXT}':fontcolor=white@0.9:fontsize=26:"
             f"box=1:boxcolor=black@0.5:boxborderw=10:x=(w-tw)/2:y=40:enable='between(t,{c0:.2f},{c0 + 5:.2f})'")
parts.append(f"[vcat]fps=30,{draw}[vout]")
cmd += ["-filter_complex", ";".join(parts), "-map", "[vout]", "-map", "[aout]",
        "-t", f"{end:.3f}", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
        str(out / "loose-ends-demo.mp4")]
r = subprocess.run(cmd, capture_output=True, text=True)
if r.returncode:
    sys.exit(r.stderr[-2000:])
print(json.dumps({"mp4": str(out / "loose-ends-demo.mp4"), "seconds": round(end, 1)}))
