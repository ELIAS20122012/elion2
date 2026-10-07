"""Draws horizontal levels on a chart screenshot. Usage: python mark_chart.py in.jpg out.jpg '{"levels":[{"y":120,"label":"..","type":"res|sup|other"}]}'"""
import json, sys
from PIL import Image, ImageDraw, ImageFont, features

src, out, spec = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
img = Image.open(src).convert("RGB")
W, H = img.size
layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
d = ImageDraw.Draw(layer)
RAQM = features.check("raqm")
font_path = spec.get("font")
size = max(14, W // 70)
try:
    font = ImageFont.truetype(font_path, size, layout_engine=ImageFont.Layout.RAQM if RAQM else ImageFont.Layout.BASIC) if font_path else ImageFont.load_default()
except Exception:
    font = ImageFont.load_default()
COL = {"res": (239, 68, 68), "sup": (34, 197, 94), "other": (250, 204, 21)}


def shape(t):
    if RAQM:
        return t
    try:
        import arabic_reshaper
        from bidi.algorithm import get_display
        return get_display(arabic_reshaper.reshape(t))
    except Exception:
        return t


for lv in spec.get("levels", [])[:8]:
    y = int(max(0, min(H - 1, float(lv["y"]))))
    c = COL.get(lv.get("type", "other"), COL["other"])
    d.line([(0, y), (W, y)], fill=c + (230,), width=max(2, H // 300))
    label = shape(str(lv.get("label", ""))[:40])
    kw = {"direction": "rtl"} if RAQM else {}
    tw = d.textlength(label, font=font, **kw) if label else 0
    x = W - tw - 16
    d.rounded_rectangle((x - 8, y - size - 8, W - 6, y - 2), 6, fill=(15, 23, 42, 200))
    d.text((x, y - size - 6), label, font=font, fill=c + (255,), **kw)
Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB").save(out, quality=92)
print(out)
