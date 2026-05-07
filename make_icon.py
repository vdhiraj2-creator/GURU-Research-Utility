#!/usr/bin/env python3
"""Generate GURU icon.png — dark background, teal branding, monospace aesthetic."""
import math
from PIL import Image, ImageDraw, ImageFont

SIZE   = 600
BG     = (5, 7, 10)        # #05070a
TEAL   = (0, 255, 204)     # --pulse
TEAL2  = (0, 200, 160)     # slightly dimmer teal for glow layers
WHITE  = (255, 255, 255)
DIM    = (71, 85, 105)     # slate-500

img  = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# ── Background: rounded square ───────────────────────────────────────
R = 80  # corner radius
def rounded_rect(draw, xy, radius, fill):
    x0, y0, x1, y1 = xy
    draw.rectangle([x0+radius, y0, x1-radius, y1], fill=fill)
    draw.rectangle([x0, y0+radius, x1, y1-radius], fill=fill)
    draw.ellipse([x0, y0, x0+2*radius, y0+2*radius], fill=fill)
    draw.ellipse([x1-2*radius, y0, x1, y0+2*radius], fill=fill)
    draw.ellipse([x0, y1-2*radius, x0+2*radius, y1], fill=fill)
    draw.ellipse([x1-2*radius, y1-2*radius, x1, y1], fill=fill)

rounded_rect(draw, (0, 0, SIZE-1, SIZE-1), R, BG)

# ── Subtle teal grid lines (research/data aesthetic) ─────────────────
grid_color = (0, 255, 204, 18)
for i in range(0, SIZE, 32):
    draw.line([(i, 0), (i, SIZE)], fill=grid_color, width=1)
    draw.line([(0, i), (SIZE, i)], fill=grid_color, width=1)

# ── Outer glow ring ──────────────────────────────────────────────────
cx, cy = SIZE // 2, SIZE // 2
for r, alpha in [(230, 8), (220, 16), (210, 24)]:
    ring = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    rd   = ImageDraw.Draw(ring)
    rd.ellipse([cx-r, cy-r, cx+r, cy+r], outline=(0, 255, 204, alpha), width=2)
    img  = Image.alpha_composite(img, ring)

draw = ImageDraw.Draw(img)

# ── Inner circle background ──────────────────────────────────────────
draw.ellipse([cx-190, cy-190, cx+190, cy+190], fill=(8, 12, 18))
draw.ellipse([cx-188, cy-188, cx+188, cy+188], outline=(0, 255, 204, 60), width=1)

# ── "G·U·R·U" letters ────────────────────────────────────────────────
try:
    font_bold = ImageFont.truetype('/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf', 108)
    font_small = ImageFont.truetype('/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf', 22)
except:
    font_bold  = ImageFont.load_default()
    font_small = font_bold

text   = 'GURU'
# Measure total width
total_w = 0
char_widths = []
for ch in text:
    bb = font_bold.getbbox(ch)
    w  = bb[2] - bb[0]
    char_widths.append(w)
    total_w += w

dot_r   = 6     # pulsing dot radius
gap     = 18    # gap between letter and dot
spacing = 28    # extra spacing between letter+dot groups
group_w = sum(char_widths) + (dot_r * 2 + gap) * 4 + spacing * 3

x_start = cx - group_w // 2
y_text  = cy - 70

x = x_start
for i, ch in enumerate(text):
    bb = font_bold.getbbox(ch)
    ch_w = bb[2] - bb[0]
    ch_h = bb[3] - bb[1]

    # Glow shadow layers
    for off, alpha in [(4, 30), (2, 60), (1, 120)]:
        draw.text((x - bb[0] + off, y_text - bb[1] + off), ch,
                  font=font_bold, fill=(0, 255, 204, alpha))
        draw.text((x - bb[0] - off, y_text - bb[1] - off), ch,
                  font=font_bold, fill=(0, 255, 204, alpha))

    # Main letter — white with slight teal tint
    draw.text((x - bb[0], y_text - bb[1]), ch, font=font_bold, fill=(230, 255, 250))

    x += ch_w

    # Pulsing dot after each letter
    dot_x = x + gap + dot_r
    dot_y = y_text + ch_h // 2 - dot_r + 4
    # Glow layers
    for gr, ga in [(dot_r+6, 20), (dot_r+3, 40), (dot_r+1, 80)]:
        draw.ellipse([dot_x-gr, dot_y-gr, dot_x+gr, dot_y+gr],
                     fill=(0, 255, 204, ga))
    # Core dot
    draw.ellipse([dot_x-dot_r, dot_y-dot_r, dot_x+dot_r, dot_y+dot_r],
                 fill=TEAL)

    x = dot_x + dot_r + gap
    if i < len(text) - 1:
        x += spacing - gap

# ── Subtitle ─────────────────────────────────────────────────────────
subtitle = 'RESEARCH INTELLIGENCE'
sb = font_small.getbbox(subtitle)
sw = sb[2] - sb[0]
draw.text((cx - sw // 2, cy + 50), subtitle, font=font_small, fill=(0, 255, 204, 160))

# ── Bottom accent line ───────────────────────────────────────────────
line_y = cy + 90
draw.line([(cx-60, line_y), (cx+60, line_y)], fill=(0, 255, 204, 80), width=1)

# ── Save ─────────────────────────────────────────────────────────────
out = img.convert('RGB')  # flatten alpha for icon.png
out.save('public/icon.png', 'PNG', optimize=True)
img.save('public/icon-512.png', 'PNG')  # keep RGBA version too

# Also save to root for Electron
out.save('icon.png', 'PNG')

print('Done — public/icon.png and icon.png written.')
print(f'Size: {SIZE}x{SIZE}px')
