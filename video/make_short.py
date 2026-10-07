"""Renders a vertical YouTube Short (1080x1920) from a JSON spec: Persian TTS (edge-tts) + designed slides + ffmpeg.

Usage: python make_short.py spec.json
spec: {"title", "scenes": [{"text": "on-screen headline", "say": "narration"}], "out": dir,
       "voice": "fa-IR-FaridNeural", "fonts": {"bold": path, "regular": path}, "brand": "@handle"}
Prints one JSON line: {"video": path, "thumb": path, "seconds": n}
"""
import asyncio, json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont, features

W, H, FPS = 1080, 1920, 30
RAQM = features.check("raqm")
PALETTES = [((12, 18, 38), (58, 28, 113)), ((8, 32, 44), (14, 116, 144)), ((30, 14, 40), (157, 23, 77)),
            ((10, 24, 20), (21, 128, 61)), ((24, 20, 8), (180, 83, 9)), ((14, 14, 30), (67, 56, 202))]


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"{cmd[0]} failed: {p.stderr[-600:]}")
    return p.stdout


def duration(path):
    return float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).strip())


def shape(line):
    if RAQM:
        return line
    import arabic_reshaper
    from bidi.algorithm import get_display
    return get_display(arabic_reshaper.reshape(line))


def text_kw():
    return {"direction": "rtl", "language": "fa"} if RAQM else {}


def wrap(draw, text, font, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        test = f"{cur} {w}".strip()
        if draw.textlength(shape(test), font=font, **text_kw()) <= max_w or not cur:
            cur = test
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def gradient(c1, c2):
    img = Image.new("RGB", (W, H), c1)
    px = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        px.line([(0, y), (W, y)], fill=tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)))
    return img


def fit_font(draw, text, path, max_w, max_lines, start, min_size):
    size = start
    while size > min_size:
        f = ImageFont.truetype(path, size, layout_engine=ImageFont.Layout.RAQM if RAQM else ImageFont.Layout.BASIC)
        lines = wrap(draw, text, f, max_w)
        if len(lines) <= max_lines:
            return f, lines
        size -= 6
    f = ImageFont.truetype(path, min_size, layout_engine=ImageFont.Layout.RAQM if RAQM else ImageFont.Layout.BASIC)
    return f, wrap(draw, text, f, max_w)[:max_lines]


def draw_center(draw, lines, font, y, fill, gap=1.35):
    lh = font.size * gap
    for i, ln in enumerate(lines):
        s = shape(ln)
        w = draw.textlength(s, font=font, **text_kw())
        draw.text(((W - w) / 2, y + i * lh), s, font=font, fill=fill, **text_kw())
    return y + len(lines) * lh


def slide(i, n, scene, fonts, brand, path):
    c1, c2 = PALETTES[i % len(PALETTES)]
    img = gradient(c1, c2)
    d = ImageDraw.Draw(img)
    d.ellipse((W - 520, -260, W + 260, 520), fill=tuple(min(255, v + 18) for v in c2))
    head, hl = fit_font(d, scene["text"], fonts["bold"], 900, 4, 112, 64)
    sub, sl = fit_font(d, scene.get("say", ""), fonts["regular"], 880, 6, 50, 36)
    block = len(hl) * head.size * 1.35 + 60 + len(sl) * sub.size * 1.5
    y = (H - block) / 2 - 40
    y = draw_center(d, hl, head, y, (255, 255, 255))
    d.rounded_rectangle(((W - 120) / 2, y + 20, (W + 120) / 2, y + 30), 5, fill=(250, 204, 21))
    draw_center(d, sl, sub, y + 60, (226, 232, 240), 1.5)
    seg = (W - 160) / n
    for k in range(n):
        d.rounded_rectangle((80 + k * seg + 6, 120, 80 + (k + 1) * seg - 6, 132), 6, fill=(255, 255, 255) if k <= i else (90, 90, 110))
    if brand:
        bf = ImageFont.truetype(fonts["bold"], 44)
        w = d.textlength(brand, font=bf)
        d.text(((W - w) / 2, H - 200), brand, font=bf, fill=(250, 204, 21))
    img.save(path)


async def tts(text, voice, path):
    if os.environ.get("ELIAS_FAKE_TTS"):  # tests: silent audio, ~0.07s per character
        run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", f"{max(1.5, len(text) * 0.07):.2f}", path])
        return
    import edge_tts
    await edge_tts.Communicate(text, voice, rate="+5%").save(path)


def main():
    spec = json.load(open(sys.argv[1], encoding="utf-8"))
    out = spec["out"]
    os.makedirs(out, exist_ok=True)
    scenes, voice, fonts, brand = spec["scenes"], spec.get("voice", "fa-IR-FaridNeural"), spec["fonts"], spec.get("brand", "")
    clips, total = [], 0.0
    for i, sc in enumerate(scenes):
        png, mp3, mp4 = (os.path.join(out, f"s{i:02d}.{e}") for e in ("png", "mp3", "mp4"))
        slide(i, len(scenes), sc, fonts, brand, png)
        asyncio.run(tts(sc.get("say") or sc["text"], voice, mp3))
        dur = duration(mp3) + 0.35
        total += dur
        frames = int(dur * FPS)
        run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-i", png, "-i", mp3,
             "-vf", f"scale=1188:2112,zoompan=z='min(zoom+0.0008,1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s={W}x{H}:fps={FPS},format=yuv420p",
             "-t", f"{dur:.2f}", "-af", "apad", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
             "-c:a", "aac", "-ar", "44100", "-b:a", "160k", mp4])
        clips.append(mp4)
    lst = os.path.join(out, "list.txt")
    with open(lst, "w", encoding="utf-8") as f:
        f.writelines(f"file '{os.path.basename(c)}'\n" for c in clips)
    video = os.path.join(out, "short.mp4")
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", "-movflags", "+faststart", video])
    thumb = os.path.join(out, "thumb.jpg")
    Image.open(os.path.join(out, "s00.png")).convert("RGB").save(thumb, quality=90)
    for c in clips:
        os.remove(c)
    print(json.dumps({"video": video, "thumb": thumb, "seconds": round(total, 1), "raqm": RAQM}))


if __name__ == "__main__":
    main()
