import json, math, os, random
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'character', 'base')
OUT = os.path.join(ROOT, 'preview', 'atlas')
os.makedirs(SRC, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

W, H = 256, 512
PAD, BLEED = 4, 2
PARTS = {
    'torso':  ((56, 97, 148),  'fabric'),
    'head':   ((237, 199, 163), 'skin'),
    'armL':   ((77, 122, 184),  'sleeve'),
    'armR':   ((41, 82, 133),   'sleeve'),
    'handL':  ((237, 199, 163), 'skin'),
    'handR':  ((214, 173, 138), 'skin'),
    'legL':   ((71, 102, 143),  'denim'),
    'legR':   ((41, 66, 97),    'denim'),
    'footL':  ((82, 71, 61),    'leather'),
    'footR':  ((51, 41, 36),    'leather'),
}

def clamp(v):
    return max(0, min(255, int(round(v))))

def make_part(part, base, kind):
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    px = img.load()
    for y in range(H):
        t = y / (H - 1)
        shade = 1.08 - t * 0.18
        for x in range(W):
            r, g, b = base
            n = 0
            if kind in ('fabric', 'sleeve', 'denim'):
                # woven vertical/horizontal fibers
                vx = math.sin(x * 0.55) * 4 + math.sin(x * 0.13 + y * 0.02) * 3
                hy = math.sin(y * 0.9) * 3
                n = vx + hy
            elif kind == 'skin':
                n = math.sin(x * 0.08 + y * 0.03) * 2 + math.sin(y * 0.41) * 1.4
            elif kind == 'leather':
                n = math.sin(x * 0.31 + y * 0.17) * 5 + math.sin(y * 0.9) * 2
            px[x, y] = (clamp(r * shade + n), clamp(g * shade + n * 0.8), clamp(b * shade + n * 0.6), 255)
    d = ImageDraw.Draw(img)
    if kind in ('fabric', 'sleeve'):
        for yy in range(0, H, 12):
            d.line([(0, yy), (W, yy)], fill=(255, 255, 255, 18))
        for xx in range(0, W, 10):
            d.line([(xx, 0), (xx, H)], fill=(0, 0, 0, 14))
        # shoulder/elbow seam blocks
        for yy in (int(H*0.42), int(H*0.72)):
            d.line([(0, yy), (W, yy)], fill=(0, 0, 0, 40), width=2)
            d.line([(0, yy+2), (W, yy+2)], fill=(255, 255, 255, 22), width=1)
    elif kind == 'denim':
        for xx in range(0, W, 18):
            d.line([(xx, 0), (xx, H)], fill=(255, 255, 255, 12))
            d.line([(xx+3, 0), (xx+3, H)], fill=(0, 0, 0, 18))
        d.line([(W//2, 0), (W//2, H)], fill=(255, 255, 255, 26), width=2)
    elif kind == 'skin':
        for yy in range(0, H, 46):
            d.line([(W*0.22, yy+8), (W*0.78, yy+12)], fill=(120, 78, 58, 28), width=1)
        d.ellipse([W*0.42, H*0.16, W*0.58, H*0.22], fill=(255, 255, 255, 18))
    elif kind == 'leather':
        for xx in range(0, W, 20):
            d.line([(xx, 0), (xx, H)], fill=(255, 255, 255, 16))
        d.rectangle([0, int(H*0.86), W, H], fill=(20, 16, 14, 90))
        d.line([(0, int(H*0.86)), (W, int(H*0.86))], fill=(255, 255, 255, 30), width=3)
    if part == 'head':
        # 头发/五官：让头部不再是一块渐变皮肤
        d.rectangle([0, 0, W, int(H * 0.28)], fill=(58, 38, 28, 255))
        for yy in range(0, int(H * 0.28), 5):
            d.line([(0, yy), (W, yy)], fill=(86, 58, 42, 80))
        d.arc([W*0.08, H*0.18, W*0.92, H*0.42], 200, 340, fill=(58, 38, 28, 255), width=8)
        d.ellipse([W*0.30, H*0.40, W*0.40, H*0.47], fill=(255, 255, 255, 235))
        d.ellipse([W*0.60, H*0.40, W*0.70, H*0.47], fill=(255, 255, 255, 235))
        d.ellipse([W*0.34, H*0.425, W*0.37, H*0.455], fill=(40, 28, 20, 255))
        d.ellipse([W*0.64, H*0.425, W*0.67, H*0.455], fill=(40, 28, 20, 255))
        d.line([(W*0.50, H*0.46), (W*0.47, H*0.55)], fill=(170, 120, 95, 160), width=2)
        d.arc([W*0.38, H*0.56, W*0.62, H*0.64], 20, 160, fill=(150, 70, 70, 220), width=3)
    elif part == 'torso':
        d.polygon([(W*0.35, 0), (W*0.50, H*0.14), (W*0.65, 0)], fill=(30, 48, 76, 255))
        d.line([(W*0.5, H*0.05), (W*0.5, H*0.98)], fill=(22, 38, 62, 150), width=2)
        for yy in range(int(H*0.10), int(H*0.95), 42):
            d.ellipse([W*0.47, yy, W*0.53, yy+5], fill=(220, 210, 180, 180))
        d.rectangle([0, int(H*0.94), W, H], fill=(32, 50, 78, 255))
    elif part in ('armL', 'armR'):
        d.rectangle([0, int(H*0.86), W, H], fill=(26, 42, 66, 255))
        d.line([(0, int(H*0.86)), (W, int(H*0.86))], fill=(180, 190, 200, 100), width=2)
    elif part in ('legL', 'legR'):
        d.rectangle([0, 0, W, int(H*0.08)], fill=(30, 46, 70, 255))
        d.line([(W*0.15, H*0.1), (W*0.32, H*0.2)], fill=(20, 34, 54, 140), width=3)
        d.rectangle([0, int(H*0.9), W, H], fill=(28, 44, 66, 255))
    elif part in ('footL', 'footR'):
        for yy in range(int(H*0.18), int(H*0.5), 26):
            d.line([(W*0.2, yy), (W*0.8, yy+8)], fill=(230, 230, 220, 180), width=3)
        d.rectangle([0, int(H*0.9), W, H], fill=(18, 16, 14, 255))
        d.line([(0, int(H*0.9)), (W, int(H*0.9))], fill=(200, 190, 170, 90), width=2)
    elif part in ('handL', 'handR'):
        for yy in range(int(H*0.25), int(H*0.9), 52):
            d.line([(W*0.1, yy), (W*0.9, yy+6)], fill=(150, 100, 75, 110), width=2)
    if part == 'head':
        img = img.transpose(Image.FLIP_TOP_BOTTOM)
    img.save(os.path.join(SRC, f'{part}.png'))
    return img

regions = []
images = {}
for idx, (part, (base, kind)) in enumerate(PARTS.items()):
    images[part] = make_part(part, base, kind)
    col, row = idx % 5, idx // 5
    x = PAD + col * (W + PAD * 2)
    y = PAD + row * (H + PAD * 2)
    regions.append({'id': part, 'x': x, 'y': y, 'width': W, 'height': H})

page = Image.new('RGBA', (2048, 2048), (0, 0, 0, 0))
for reg in regions:
    img = images[reg['id']]
    x, y = reg['x'], reg['y']
    # bleed: repeat edge pixels outward
    for by in range(-BLEED, H + BLEED):
        for bx in range(-BLEED, W + BLEED):
            sx = min(W - 1, max(0, bx))
            sy = min(H - 1, max(0, by))
            page.putpixel((x + bx, y + by), img.getpixel((sx, sy)))
    page.paste(img, (x, y))

page.save(os.path.join(OUT, 'base.png'))
meta = {
    'version': 1,
    'page': {'width': 2048, 'height': 2048, 'pma': False, 'filter': 'linear'},
    'padding': PAD,
    'bleed': BLEED,
    'regions': regions,
}
with open(os.path.join(OUT, 'base.json'), 'w', encoding='utf-8') as f:
    json.dump(meta, f, ensure_ascii=False, indent=2)
print('atlas', len(regions), 'parts', '->', os.path.join(OUT, 'base.png'))

# 2-page 示例：验证运行时多页绑定。页 0/1 各 5 个 region。
def write_pages(ids_per_page, prefix, page_w=2048, page_h=1024):
    pages = []
    for page_index, ids in enumerate(ids_per_page):
        page_img = Image.new('RGBA', (page_w, page_h), (0, 0, 0, 0))
        page_regions = []
        for col, part in enumerate(ids):
            x = PAD + col * (W + PAD * 2)
            y = PAD
            img = images[part]
            for by in range(-BLEED, H + BLEED):
                for bx in range(-BLEED, W + BLEED):
                    sx = min(W - 1, max(0, bx))
                    sy = min(H - 1, max(0, by))
                    page_img.putpixel((x + bx, y + by), img.getpixel((sx, sy)))
            page_regions.append({'id': part, 'x': x, 'y': y, 'width': W, 'height': H})
        name = f'{prefix}-{page_index}.png'
        page_img.save(os.path.join(OUT, name))
        pages.append({
            'image': name,
            'page': {'width': page_w, 'height': page_h, 'pma': False, 'filter': 'linear'},
            'padding': PAD,
            'bleed': BLEED,
            'regions': page_regions,
        })
    with open(os.path.join(OUT, f'{prefix}.json'), 'w', encoding='utf-8') as f:
        json.dump({'version': 1, 'pages': pages}, f, ensure_ascii=False, indent=2)

ids = list(PARTS.keys())
write_pages([ids[:5], ids[5:]], 'multi')
print('multi-page atlas ->', os.path.join(OUT, 'multi.json'))
