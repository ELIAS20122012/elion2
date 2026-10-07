"""Elias OS desktop voice assistant — "Hey Elion".

Listens to the default microphone. Speech segments are found with a simple adaptive energy detector; each
segment's first seconds are checked with a small Whisper model (biased with the prompt "Hey Elion") for the
wake phrase. On a hit — or when the hotkey (default ctrl+alt+e) is pressed — the command is saved as a WAV and
sent to the Elias OS daemon (local dashboard API), which transcribes it with the main model, answers, and
returns a .wav that is played here. Only audio after the wake phrase/hotkey ever leaves this script (as a
local file for the daemon); nothing is uploaded.
"""
import json
import os
import queue
import re
import sys
import tempfile
import threading
import time
import urllib.request
import wave

import numpy as np
import sounddevice as sd

RATE = 16000
FRAME = 480  # 30 ms
PORT = int(os.environ.get("ELIAS_PORT", "7420"))
HOTKEY = os.environ.get("ELIAS_HOTKEY", "ctrl+alt+e")
WAKE_MODEL = os.environ.get("ELIAS_WAKE_MODEL", "tiny")
TMP = os.environ.get("ELIAS_VOICE_TMP") or tempfile.gettempdir()
WAKE_RE = re.compile(r"\b(?:hey|hi|hay|a)?[\s,.!]*(?:elion|ellion|elian|ilion|alien|eleon|elyon|aileen|e lion|a lion|hey lion)\b", re.I)

frames: "queue.Queue[np.ndarray]" = queue.Queue()
hotkey_event = threading.Event()
busy = threading.Event()


def log(msg: str) -> None:
    print(msg, flush=True)


def beep(kind: str = "listen") -> None:
    try:
        import winsound

        if kind == "listen":
            winsound.Beep(880, 90)
            winsound.Beep(1320, 90)
        elif kind == "error":
            winsound.Beep(300, 250)
        else:
            winsound.Beep(660, 80)
    except Exception:  # noqa: BLE001
        pass


def play(path: str) -> None:
    try:
        import winsound

        winsound.PlaySound(path, winsound.SND_FILENAME)
    except Exception as e:  # noqa: BLE001
        log(f"play failed: {e}")
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def api(method: str, path: str, body=None, timeout=120):
    req = urllib.request.Request(
        f"http://127.0.0.1:{PORT}{path}",
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        method=method,
        headers={"content-type": "application/json", "x-elias": "1", "host": f"127.0.0.1:{PORT}"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def save_wav(audio: np.ndarray) -> str:
    os.makedirs(TMP, exist_ok=True)
    path = os.path.join(TMP, f"listen-{int(time.time() * 1000)}.wav")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())
    return path


class Segmenter:
    """Adaptive energy VAD: start after 3 loud frames, stop after `silence_ms` of quiet, max `max_s` seconds."""

    def __init__(self, silence_ms=1300, max_s=20.0):
        self.noise = 0.004
        self.silence_frames = silence_ms // 30
        self.max_frames = int(max_s * 1000 / 30)

    def rms(self, f: np.ndarray) -> float:
        return float(np.sqrt(np.mean(f * f)) + 1e-9)

    def next_segment(self, timeout: float | None = None, interrupt: threading.Event | None = None):
        pre: list[np.ndarray] = []
        seg: list[np.ndarray] = []
        loud = quiet = 0
        started = False
        t0 = time.time()
        while True:
            if interrupt is not None and interrupt.is_set():
                return None
            if timeout is not None and not started and time.time() - t0 > timeout:
                return None
            try:
                f = frames.get(timeout=0.5)
            except queue.Empty:
                continue
            e = self.rms(f)
            thr = max(self.noise * 3.0, 0.012)
            if not started:
                self.noise = 0.995 * self.noise + 0.005 * min(e, 0.05)
                pre = (pre + [f])[-10:]
                loud = loud + 1 if e > thr else 0
                if loud >= 3:
                    started = True
                    seg = pre[:]
                continue
            seg.append(f)
            quiet = quiet + 1 if e < thr * 0.7 else 0
            if quiet >= self.silence_frames or len(seg) >= self.max_frames:
                return np.concatenate(seg)


def drain() -> None:
    while not frames.empty():
        try:
            frames.get_nowait()
        except queue.Empty:
            break


def ask(audio: np.ndarray) -> None:
    """Send a recorded command to the daemon, wait for the answer, play it."""
    busy.set()
    try:
        r = api("POST", "/api/voice", {"wav": save_wav(audio)}, timeout=180)
        if r.get("wakeOnly"):
            return listen_for_command()
        log(f"heard: {r.get('heard', '')[:120]}")
        if not r.get("done") and r.get("taskId"):
            beep("ok")
            for _ in range(240):  # up to ~8 minutes
                time.sleep(2)
                r = api("GET", f"/api/voice/{r['taskId']}")
                if r.get("done"):
                    break
        if r.get("audio"):
            play(r["audio"])
        elif r.get("text"):
            log(f"answer (no audio): {r['text'][:120]}")
    except Exception as e:  # noqa: BLE001
        log(f"ask failed: {e}")
        beep("error")
    finally:
        drain()
        busy.clear()


def listen_for_command() -> None:
    beep("listen")
    drain()
    seg = Segmenter(silence_ms=1600).next_segment(timeout=8)
    if seg is None:
        beep("ok")
        return
    ask(seg)


def main() -> None:
    from faster_whisper import WhisperModel

    model = WhisperModel(WAKE_MODEL, device="cpu", compute_type="int8", cpu_threads=2, download_root=os.environ.get("ELIAS_WHISPER_DIR") or None)

    try:
        import keyboard

        keyboard.add_hotkey(HOTKEY, lambda: hotkey_event.set())
        log(f"hotkey: {HOTKEY}")
    except Exception as e:  # noqa: BLE001
        log(f"hotkey unavailable: {e}")

    def on_audio(indata, _frames, _time, status):  # noqa: ANN001
        if not busy.is_set():
            frames.put(indata[:, 0].copy())

    with sd.InputStream(samplerate=RATE, channels=1, dtype="float32", blocksize=FRAME, callback=on_audio):
        log(f"listening for 'Hey Elion' (wake model {WAKE_MODEL})")
        seg = Segmenter()
        while True:
            if hotkey_event.is_set():
                hotkey_event.clear()
                listen_for_command()
                continue
            audio = seg.next_segment(interrupt=hotkey_event)
            if audio is None or len(audio) < RATE * 0.4:
                continue
            head = audio[: int(RATE * 2.5)]
            # Skip if head is nearly silent (avoids hallucination on quiet frames)
            if float(np.sqrt(np.mean(head * head))) < 0.008:
                continue
            segs, _ = model.transcribe(head, language="en", beam_size=1, vad_filter=True, condition_on_previous_text=False)
            text = " ".join(s.text for s in segs).strip()
            if not WAKE_RE.search(text):
                continue
            log(f"wake: {text[:60]}")
            if len(audio) < RATE * 1.8:
                listen_for_command()  # only "Hey Elion" → beep, then listen for the command
            else:
                ask(audio)  # "Hey Elion, …" in one breath; the daemon strips the wake phrase


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
