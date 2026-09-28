#!/usr/bin/env python3
"""Prepare user-captured screenshots for Chrome Web Store without re-rendering them."""

from pathlib import Path

from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "publishing" / "assets"
CANVAS_SIZE = (1280, 800)
BACKGROUND = "#F4F5EE"

SCREENSHOTS = {
    "Screenshot 2026-09-27_interface_1.png": "store-interface-1-1280x800.png",
    "Screenshot 2026-09-27_interface_2.png": "store-interface-2-1280x800.png",
    "Screenshot 2026-09-27_interface_3.png": "store-interface-3-1280x800.png",
    "Screenshot 2026-09-27_notification_2.png": "store-notification-2-1280x800.png",
    "Screenshot 2026-09-27_notification_3.png": "store-notification-3-1280x800.png",
}


def prepare(source: Path, destination: Path) -> None:
    with Image.open(source) as opened:
        image = opened.convert("RGBA")

    width, height = image.size
    scale = min(1.0, CANVAS_SIZE[0] / width, CANVAS_SIZE[1] / height)
    if scale < 1.0:
        target = (round(width * scale), round(height * scale))
        image = image.resize(target, Image.Resampling.LANCZOS)

    canvas = Image.new("RGB", CANVAS_SIZE, BACKGROUND)
    left = (CANVAS_SIZE[0] - image.width) // 2
    top = (CANVAS_SIZE[1] - image.height) // 2
    canvas.paste(image, (left, top), image.getchannel("A"))

    # A light post-resize sharpening recovers edge contrast lost by downsampling
    # without changing the screenshot's content or recreating any text.
    if scale < 1.0:
        canvas = canvas.filter(ImageFilter.UnsharpMask(radius=0.55, percent=55, threshold=3))

    canvas.save(destination, format="PNG", optimize=True)
    print(f"{source.name}: {width}x{height} -> {destination.name} ({image.width}x{image.height} on 1280x800)")


def main() -> None:
    for source_name, destination_name in SCREENSHOTS.items():
        prepare(ASSETS / source_name, ASSETS / destination_name)


if __name__ == "__main__":
    main()
