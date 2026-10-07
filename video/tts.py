"""Persian text → voice file (OGG/Opus for Telegram, or .wav for the PC speakers). Usage: python tts.py out.ogg|out.wav voice < text"""
import asyncio, os, subprocess, sys, tempfile


async def main():
    out, voice = sys.argv[1], sys.argv[2]
    text = sys.stdin.read().strip()
    mp3 = tempfile.mktemp(suffix=".mp3")
    if os.environ.get("ELIAS_FAKE_TTS"):
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "1", mp3], check=True)
    else:
        import edge_tts
        await edge_tts.Communicate(text, voice, rate="+8%").save(mp3)
    # .wav → plain PCM (played on the PC speakers by the voice assistant); anything else → Opus voice note
    codec = ["-ac", "1", "-ar", "24000"] if out.lower().endswith(".wav") else ["-c:a", "libopus", "-b:a", "48k"]
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", mp3, *codec, out], check=True)
    os.remove(mp3)
    print(out)


asyncio.run(main())
