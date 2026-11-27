#!/usr/bin/env python3
"""Glance STT daemon — persistent faster-whisper worker.

Loads the tiny model ONCE at startup (a cold load takes ~20 s on this VM),
then serves one transcription per JSON line on stdin:

  request:  {"wav": "/tmp/glance-stt-xxx/audio.wav"}
  response: {"text": "...", "language": "id", "duration_s": 12.3}
            or {"error": "..."} on failure
  request:  {"ping": true}  -> response {"pong": true}
  request:  {"quit": true}  -> exits

One JSON object per line, always flushed. A fresh one-shot worker
(backend/stt.py) exists as a fallback if this daemon cannot start.
"""
import json
import sys

from faster_whisper import WhisperModel

MODEL = "tiny"


def main() -> int:
    model = WhisperModel(MODEL, device="cpu", compute_type="int8")
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue
        if req.get("ping"):
            print(json.dumps({"pong": True}), flush=True)
            continue
        if req.get("quit"):
            break
        try:
            segments, info = model.transcribe(
                req["wav"],
                language=None,  # auto-detect (user speaks Indonesian)
                beam_size=5,
                vad_filter=False,
            )
            text = " ".join(s.text.strip() for s in segments).strip()
            print(json.dumps({
                "text": text,
                "language": info.language,
                "duration_s": round(info.duration, 2),
            }, ensure_ascii=False), flush=True)
        except Exception as e:  # noqa: BLE001 - report, keep serving
            print(json.dumps({"error": str(e)[:300]}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
