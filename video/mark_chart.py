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
    y2 = int(max(0, min(H - 1, float(lv.get("y2", y)))))
    y, y2 = sorted((y, y2))
    x1 = int(max(0, min(W - 1, float(lv.get("x1", 0)))))
    x2 = int(max(0, min(W - 1, float(lv.get("x2", W - 1)))))
    x1, x2 = sorted((x1, x2))
    c = COL.get(lv.get("type", "other"), COL["other"])
    if y2 > y:
        d.rectangle((x1, y, x2, y2), fill=c + (45,), outline=c + (220,), width=max(2, H // 300))
    else:
        d.line([(x1, y), (x2, y)], fill=c + (230,), width=max(2, H // 300))
    label = shape(str(lv.get("label", ""))[:40])
    kw = {"direction": "rtl"} if RAQM else {}
    tw = d.textlength(label, font=font, **kw) if label else 0
    x = max(8, x2 - tw - 10)
    label_y = max(2, min(H - size - 12, y - size - 8))
    if label:
        d.rounded_rectangle((x - 6, label_y, min(W - 1, x + tw + 6), label_y + size + 6), 6, fill=(15, 23, 42, 220))
        d.text((x, label_y + 2), label, font=font, fill=c + (255,), **kw)
Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB").save(out, quality=92)
print(out)
