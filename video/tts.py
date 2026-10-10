"""Persian text → voice file (OGG/Opus for Telegram, or .wav for the PC speakers). Usage: python tts.py out.ogg|out.wav voice < text

Microsoft's edge-tts endpoint now and then refuses a request (403 / NoAudioReceived), so it is retried:
twice as asked, then without the speed change, then with the other Persian voice."""
import asyncio, os, subprocess, sys, tempfile

OTHER = {"fa-IR-FaridNeural": "fa-IR-DilaraNeural", "fa-IR-DilaraNeural": "fa-IR-FaridNeural"}


async def synth(text: str, voice: str, mp3: str) -> None:
    import edge_tts

    attempts = [(voice, "+8%"), (voice, "+8%"), (voice, None), (OTHER.get(voice, voice), None)]
    last = None
    for i, (v, rate) in enumerate(attempts):
        try:
            await edge_tts.Communicate(text, v, **({"rate": rate} if rate else {})).save(mp3)
            if os.path.exists(mp3) and os.path.getsize(mp3) > 0:
                return
        except Exception as e:  # noqa: BLE001
            last = e
        await asyncio.sleep(1.5 * (i + 1))
    raise RuntimeError(f"edge-tts failed after {len(attempts)} tries: {type(last).__name__}: {last}")


async def main():
    out, voice = sys.argv[1], sys.argv[2]
    text = sys.stdin.read().strip()
    if not text:
        sys.exit("nothing to say")
    mp3 = tempfile.mktemp(suffix=".mp3")
    if os.environ.get("ELIAS_FAKE_TTS"):
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "1", mp3], check=True)
    else:
        await synth(text, voice, mp3)
    # .wav → plain PCM (played on the PC speakers by the voice assistant); anything else → Opus voice note
    codec = ["-ac", "1", "-ar", "24000"] if out.lower().endswith(".wav") else ["-c:a", "libopus", "-b:a", "48k"]
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", mp3, *codec, out], check=True)
    os.remove(mp3)
    print(out)


asyncio.run(main())
