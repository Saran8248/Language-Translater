"""
Generates clean icons for Universal Translator extension in 16x16, 32x32, 48x48, 128x128 PNG formats
and a scalable SVG file.
"""
from PIL import Image, ImageDraw, ImageFont
import os

def create_icon(size: int) -> Image.Image:
    # 4x supersampling for high quality antialiasing
    scale = 4
    canvas_size = size * scale
    img = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded rectangle background
    corner_radius = int(canvas_size * 0.22)
    padding = int(canvas_size * 0.04)
    bbox = [padding, padding, canvas_size - padding, canvas_size - padding]

    # Gradient-like background
    draw.rounded_rectangle(bbox, radius=corner_radius, fill="#2563eb")

    # Draw inner globe/translation badge design
    # A circular motif or translation symbol
    center_x = canvas_size // 2
    center_y = canvas_size // 2
    globe_radius = int(canvas_size * 0.36)

    # Subtle inner circle
    draw.ellipse(
        [center_x - globe_radius, center_y - globe_radius,
         center_x + globe_radius, center_y + globe_radius],
        outline="#ffffff",
        width=int(2 * scale)
    )

    # Horizontal equator line
    draw.line(
        [(center_x - globe_radius, center_y), (center_x + globe_radius, center_y)],
        fill="#93c5fd",
        width=int(1.5 * scale)
    )

    # Vertical meridian ellipse
    meridian_width = int(globe_radius * 0.55)
    draw.ellipse(
        [center_x - meridian_width, center_y - globe_radius,
         center_x + meridian_width, center_y + globe_radius],
        outline="#93c5fd",
        width=int(1.5 * scale)
    )

    # Letter 'A' on upper-left quadrant and '文' or symbol on lower-right
    # Let's draw stylized 'A'
    font_size = int(size * scale * 0.32)
    try:
        # Try finding standard font
        font = ImageFont.truetype("arial.ttf", font_size)
    except Exception:
        font = ImageFont.load_default()

    # Draw "T" or "A" symbol in center or upper
    text = "A"
    try:
        tbbox = draw.textbbox((0, 0), text, font=font)
        tw = tbbox[2] - tbbox[0]
        th = tbbox[3] - tbbox[1]
        draw.text(
            (center_x - tw // 2, center_y - th // 2 - int(scale * 2)),
            text,
            fill="#ffffff",
            font=font
        )
    except Exception:
        pass

    # Downsample with Lanczos resampling for crisp antialiasing
    final_img = img.resize((size, size), Image.Resampling.LANCZOS)
    return final_img

def main():
    icons_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "extension", "icons")
    os.makedirs(icons_dir, exist_ok=True)

    sizes = [16, 32, 48, 128]
    for s in sizes:
        icon = create_icon(s)
        path = os.path.join(icons_dir, f"icon{s}.png")
        icon.save(path, format="PNG")
        print(f"Generated {path}")

    # Also create an SVG version
    svg_content = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#3b82f6" />
      <stop offset="100%" stop-color="#1d4ed8" />
    </linearGradient>
  </defs>
  <rect x="6" y="6" width="116" height="116" rx="26" fill="url(#grad)" />
  <circle cx="64" cy="64" r="44" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.9" />
  <ellipse cx="64" cy="64" rx="22" ry="44" fill="none" stroke="#93c5fd" stroke-width="2.5" opacity="0.8" />
  <line x1="20" y1="64" x2="108" y2="64" stroke="#93c5fd" stroke-width="2.5" opacity="0.8" />
  <text x="64" y="74" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="38" font-weight="bold" fill="#ffffff" text-anchor="middle">A</text>
</svg>'''

    svg_path = os.path.join(icons_dir, "icon.svg")
    with open(svg_path, "w", encoding="utf-8") as f:
        f.write(svg_content)
    print(f"Generated {svg_path}")

if __name__ == "__main__":
    main()
