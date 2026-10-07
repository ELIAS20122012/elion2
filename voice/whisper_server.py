"""Elias OS speech-to-text worker (faster-whisper, local, CPU).

Protocol: one JSON object per line on stdin  -> one JSON object per line on stdout.
  in : {"id": "...", "path": "C:/.../voice.oga", "language": "fa"|null, "prompt": "vocabulary hint"|null}
  out: {"id": "...", "text": "...", "language": "fa", "duration": 7.2, "seconds": 3.1}
       {"id": "...", "error": "..."}
The first line printed is {"ready": true, ...} once the model is loaded.
Run with --warmup to download/load the model once and exit (used by voice-setup.cmd).
"""
import json
import os
import sys
import time


def load_audio(path: str):
    """Decode with the system ffmpeg to 16 kHz mono float32 (avoids PyAV/faster-whisper version clashes)."""
    import shutil
    import subprocess

    import numpy as np

    ffmpeg = os.environ.get("ELIAS_FFMPEG") or shutil.which("ffmpeg")
    if not ffmpeg:
        return path  # let faster-whisper decode it itself
    raw = subprocess.run(
        [ffmpeg, "-nostdin", "-loglevel", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", "16000", "-"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0


def main() -> None:
    model_name = os.environ.get("ELIAS_WHISPER_MODEL", "small")
    default_lang = os.environ.get("ELIAS_WHISPER_LANG") or None
    threads = int(os.environ.get("ELIAS_WHISPER_THREADS", "4"))
    t0 = time.time()
    try:
        from faster_whisper import WhisperModel

        model = WhisperModel(
            model_name,
            device="cpu",
            compute_type="int8",
            cpu_threads=threads,
            download_root=os.environ.get("ELIAS_WHISPER_DIR") or None,
        )
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ready": False, "error": f"{type(e).__name__}: {e}"}), flush=True)
        sys.exit(2)

    print(json.dumps({"ready": True, "model": model_name, "load_seconds": round(time.time() - t0, 1)}), flush=True)
    if "--warmup" in sys.argv:
        return

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        start = time.time()
        try:
            segments, info = model.transcribe(
                load_audio(req["path"]),
                language=req.get("language") or default_lang,
                beam_size=5,
                vad_filter=True,
                # vocabulary hint (Elias's own words: MT4, طلا, یادآوری…) — big accuracy win for Persian
                initial_prompt=req.get("prompt") or None,
            )
            text = " ".join(s.text.strip() for s in segments).strip()
            out = {
                "id": req["id"],
                "text": text,
                "language": info.language,
                "duration": round(info.duration, 1),
                "seconds": round(time.time() - start, 1),
            }
        except Exception as e:  # noqa: BLE001
            out = {"id": req.get("id"), "error": f"{type(e).__name__}: {e}"}
        print(json.dumps(out), flush=True)  # ASCII-escaped JSON: safe on any Windows console code page


if __name__ == "__main__":
    main()
