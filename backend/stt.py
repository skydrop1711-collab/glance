#!/usr/bin/env python3
"""Glance STT worker — faster-whisper (local, no key, no account).

Usage: stt.py <wav-path>
  Input : 16 kHz, mono, 16-bit PCM WAV (written by the Node backend).
  Output: one JSON line on stdout:
          {"text": "...", "language": "id", "duration_s": 12.3}

Model: faster-whisper "tiny", CPU, int8 — small enough to load in ~1-2 s
and transcribe a 10 s utterance in a few seconds on this VM.
Language is auto-detected (the user speaks Indonesian; a demo in another
language still works). An empty result means "no speech detected", not an
error — the caller returns an empty transcription, not a 500.
"""
import json
import sys

from faster_whisper import WhisperModel

MODEL = "tiny"


def main() -> int:
    if len(sys.argv) != 2:
        print(json.dumps({"error": "usage: stt.py <wav-path>"}))
        return 2
    model = WhisperModel(MODEL, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        sys.argv[1],
        language=None,  # auto-detect (user speaks Indonesian)
        beam_size=5,
        vad_filter=False,
    )
    text = " ".join(s.text.strip() for s in segments).strip()
    print(json.dumps({
        "text": text,
        "language": info.language,
        "duration_s": round(info.duration, 2),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
