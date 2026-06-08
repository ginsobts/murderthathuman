# 把超大的原始 PNG 压成适合内嵌的小图，供 build-play.js 打包用。
# 用法：python shrink-assets.py   （需要 Pillow）
from PIL import Image
import os

base = os.path.join(os.path.dirname(__file__), "assets")

def kb(p):
    return f"{os.path.getsize(p)/1024:.0f} KB"

# 壁纸：缩到 1280 宽、转 JPEG（背景图不需要透明）
wp = Image.open(os.path.join(base, "wallpaper.png")).convert("RGB")
wp.thumbnail((1280, 1280))
out_wp = os.path.join(base, "sm-wallpaper.jpg")
wp.save(out_wp, "JPEG", quality=78, optimize=True)
print("sm-wallpaper.jpg:", kb(out_wp))

# 图标：缩到 128，保留透明，存 PNG
for name in ["icon-txt", "icon-img", "icon-folder"]:
    im = Image.open(os.path.join(base, name + ".png")).convert("RGBA")
    im.thumbnail((128, 128))
    out = os.path.join(base, "sm-" + name + ".png")
    im.save(out, "PNG", optimize=True)
    print("sm-" + name + ".png:", kb(out))
