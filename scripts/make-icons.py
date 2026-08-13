#!/usr/bin/env python3
"""Generate the favicon set from Mulderserverlogo.png.

The source is NOT transparent, despite looking like it: whatever exported it
painted the transparency checkerboard into the pixels as real grey and white
squares (alpha is 255 everywhere, corner pixel is RGB 206,206,206). Scaled to
32px those squares average out to a light grey block behind the logo.

So the background is cut out here by colour rather than by alpha. The mark is
orange and the checkerboard is neutral grey, so saturation separates them
cleanly — and using saturation as the alpha value anti-aliases the edges for
free instead of leaving a hard 1px staircase.

Usage:  python3 scripts/make-icons.py
Needs:  Pillow
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "Mulderserverlogo.png"
PUBLIC = ROOT / "public"

# Saturation (max channel - min channel) above which a pixel is fully the logo.
# The orange sits at 120-190; the neutral checkerboard sits at 0-3.
FULLY_OPAQUE_AT = 60
# Below this, treat as background outright — kills JPEG-ish noise in the greys.
NOISE_FLOOR = 6

SIZES = {
    "icon-32x32.png": 32,
    "icon-64x64.png": 64,
    "apple-icon.png": 180,
    # Shown in the page header at 40px; generated large enough to stay sharp on
    # high-DPI screens.
    "logo.png": 256,
}


def cut_background(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    pixels = image.load()
    width, height = image.size

    for y in range(height):
        for x in range(width):
            r, g, b, _ = pixels[x, y]
            saturation = max(r, g, b) - min(r, g, b)

            if saturation <= NOISE_FLOOR:
                pixels[x, y] = (r, g, b, 0)
                continue

            alpha = min(255, round(saturation * 255 / FULLY_OPAQUE_AT))

            # Edge pixels are the orange blended into a light background, so they
            # read washed out once composited onto a dark tab bar. Undo that blend
            # (un-premultiply against the local background) to keep edges the same
            # colour as the body of the mark.
            if alpha < 255:
                scale = 255 / alpha
                r = min(255, round(255 - (255 - r) * scale))
                g = min(255, round(255 - (255 - g) * scale))
                b = min(255, round(255 - (255 - b) * scale))

            pixels[x, y] = (r, g, b, alpha)

    return image


def main() -> None:
    cut = cut_background(Image.open(SOURCE))

    # Crop to what's actually drawn. The artwork sits high in the source frame
    # with dead space beneath it, so a centred crop would leave the icon
    # off-centre. The real alpha bounding box beats eyeballing it.
    bbox = cut.getchannel("A").getbbox()
    cut = cut.crop(bbox)

    # Pad back to a square so no axis gets squashed by the resize.
    side = max(cut.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(cut, ((side - cut.width) // 2, (side - cut.height) // 2))

    for name, size in SIZES.items():
        square.resize((size, size), Image.LANCZOS).save(PUBLIC / name)
        print(f"wrote public/{name} ({size}x{size})")


if __name__ == "__main__":
    main()
