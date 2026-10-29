"""Compose T4 review images from Blender renders (tools/create_landmarks.py) and reference photos.

    python3 -I tools/landmark_compare.py
- artifacts/v3/comparison/<id>.png : reference photo (left) | render from a similar angle (right)
- artifacts/v3/T4/landmarks.png     : contact sheet of every landmark's renders
Reference photos are untrusted downloads: opened only with Pillow, never used as textures.
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
T4 = ROOT / 'artifacts/v3/T4'; REN = T4 / 'renders'; REFS = T4 / 'refs'; CMP = ROOT / 'artifacts/v3/comparison'
FONT = '/home/phonchi/.local/share/fonts/NotoSansCJKtc-Bold.otf'
# id -> (reference file under refs/<id>/, render view name, caption)
PAIRS = json.loads((T4 / 'compare-pairs.json').read_text(encoding='utf-8'))


def font(n):
    try: return ImageFont.truetype(FONT, n)
    except Exception: return ImageFont.load_default()


def fit(im, w, h):
    im = im.convert('RGB'); r = min(w / im.width, h / im.height); im = im.resize((max(1, int(im.width * r)), max(1, int(im.height * r))), Image.LANCZOS)
    bg = Image.new('RGB', (w, h), (245, 241, 230)); bg.paste(im, ((w - im.width) // 2, (h - im.height) // 2)); return bg


def main():
    CMP.mkdir(parents=True, exist_ok=True); W, H = 760, 570
    for lid, pairs in PAIRS.items():
        rows = []
        for ref, view, cap in pairs:
            rp, vp = REFS / lid / ref, REN / f'{lid}__{view}.png'
            if not vp.exists(): print('missing render', vp); continue
            row = Image.new('RGB', (W * 2 + 30, H + 46), (251, 246, 234)); d = ImageDraw.Draw(row)
            row.paste(fit(Image.open(rp), W, H) if rp.exists() else Image.new('RGB', (W, H), (200, 200, 200)), (10, 36))
            row.paste(fit(Image.open(vp), W, H), (W + 20, 36))
            d.text((12, 6), f'{lid} · 參考照片 {ref}', font=font(20), fill=(29, 42, 58)); d.text((W + 22, 6), f'模型渲染 {view} · {cap}', font=font(20), fill=(29, 42, 58))
            rows.append(row)
        if not rows: continue
        out = Image.new('RGB', (rows[0].width, sum(r.height for r in rows)), (251, 246, 234)); y = 0
        for r in rows: out.paste(r, (0, y)); y += r.height
        out.save(CMP / f'{lid}.png', optimize=True); print('COMPARISON', lid, len(rows))
    renders = sorted(p for p in REN.glob('*__*.png') if not p.name.startswith('smoke'))
    by = {}
    for p in renders: by.setdefault(p.name.split('__')[0], []).append(p)
    tw, th, cols = 480, 360, 4; cells = [p for k in sorted(by) for p in by[k]]
    sheet = Image.new('RGB', (tw * cols, (th + 28) * ((len(cells) + cols - 1) // cols)), (251, 246, 234)); d = ImageDraw.Draw(sheet)
    for i, p in enumerate(cells):
        x, y = (i % cols) * tw, (i // cols) * (th + 28)
        sheet.paste(fit(Image.open(p), tw - 6, th), (x + 3, y + 26)); d.text((x + 6, y + 2), p.stem.replace('__', ' · '), font=font(18), fill=(29, 42, 58))
    sheet.save(T4 / 'landmarks.png', optimize=True); print('SHEET', len(cells))


if __name__ == '__main__':
    main()
