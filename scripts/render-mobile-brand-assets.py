#!/usr/bin/env python3
"""Render deterministic pixel-art Android brand assets with the Python stdlib."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

SIZE = 1024
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "apps" / "mobile" / "assets" / "images"

TRANSPARENT = (0, 0, 0, 0)
NAVY = (8, 27, 43, 255)
NAVY_GRID = (11, 38, 56, 255)
CREAM = (245, 241, 232, 255)
ICE = (220, 231, 231, 255)
WHITE = (249, 251, 247, 255)
TEAL = (0, 139, 139, 255)
AMBER = (255, 176, 0, 255)
CORAL = (255, 107, 107, 255)


class Canvas:
    def __init__(self, color: tuple[int, int, int, int]) -> None:
        self.pixels = bytearray(color * (SIZE * SIZE))

    def rect(
        self,
        x1: int,
        y1: int,
        x2: int,
        y2: int,
        color: tuple[int, int, int, int],
    ) -> None:
        row = bytes(color) * (x2 - x1)
        for y in range(y1, y2):
            start = (y * SIZE + x1) * 4
            self.pixels[start : start + len(row)] = row

    def save(self, path: Path) -> None:
        scanlines = bytearray()
        stride = SIZE * 4
        for y in range(SIZE):
            scanlines.append(0)
            start = y * stride
            scanlines.extend(self.pixels[start : start + stride])

        def chunk(kind: bytes, payload: bytes) -> bytes:
            body = kind + payload
            return (
                struct.pack(">I", len(payload))
                + body
                + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
            )

        png = bytearray(b"\x89PNG\r\n\x1a\n")
        png.extend(chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)))
        png.extend(chunk(b"IDAT", zlib.compress(bytes(scanlines), level=9)))
        png.extend(chunk(b"IEND", b""))
        path.write_bytes(png)


def draw_stair_box(
    canvas: Canvas,
    left: int,
    top: int,
    right: int,
    bottom: int,
    step: int,
    color: tuple[int, int, int, int],
) -> None:
    canvas.rect(left + step, top, right - step, bottom, color)
    canvas.rect(left, top + step, right, bottom - step, color)


def draw_wheel(canvas: Canvas) -> None:
    canvas.rect(448, 336, 576, 720, TEAL)
    canvas.rect(384, 368, 640, 688, TEAL)
    canvas.rect(352, 400, 672, 656, TEAL)
    canvas.rect(320, 464, 704, 592, TEAL)

    canvas.rect(448, 400, 576, 656, CREAM)
    canvas.rect(416, 432, 608, 624, CREAM)
    canvas.rect(384, 496, 640, 560, CREAM)

    canvas.rect(488, 352, 536, 464, CREAM)
    canvas.rect(488, 560, 536, 672, CREAM)
    canvas.rect(352, 488, 464, 536, CREAM)
    canvas.rect(560, 488, 672, 536, CREAM)
    for x, y in ((400, 400), (576, 400), (400, 576), (576, 576)):
        canvas.rect(x, y, x + 48, y + 48, CREAM)

    canvas.rect(480, 480, 544, 544, NAVY)
    canvas.rect(640, 464, 704, 560, NAVY)
    canvas.rect(672, 480, 720, 544, AMBER)


def draw_mark(canvas: Canvas) -> None:
    draw_stair_box(canvas, 192, 192, 832, 832, 64, CREAM)
    draw_stair_box(canvas, 256, 256, 768, 768, 48, ICE)
    canvas.rect(320, 320, 704, 704, WHITE)
    draw_wheel(canvas)
    canvas.rect(288, 288, 320, 320, AMBER)
    canvas.rect(704, 704, 736, 736, CORAL)


def render() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)

    icon = Canvas(NAVY)
    for y in range(0, SIZE, 128):
        for x in range(0, SIZE, 128):
            if (x // 128 + y // 128) % 2 == 0:
                icon.rect(x, y, x + 128, y + 128, NAVY_GRID)
    draw_mark(icon)
    icon.save(OUTPUT / "icon.png")

    adaptive = Canvas(TRANSPARENT)
    draw_mark(adaptive)
    adaptive.save(OUTPUT / "adaptive-icon.png")

    splash = Canvas(TRANSPARENT)
    draw_mark(splash)
    splash.save(OUTPUT / "splash-icon.png")


if __name__ == "__main__":
    render()
