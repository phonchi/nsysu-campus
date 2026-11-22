#!/usr/bin/env python3
"""Registers each page of the fire-safety plan onto the OAA room plan of the same SC floor and writes a composite: OAA colours underneath, safety linework in red.
Both come from the same CAD, so a scale and a shift fitted by edge correlation are enough; the fit is saved for later lookups. Output stays in artifacts/."""
import json
from pathlib import Path
import cv2
import numpy as np
import pymupdf
from PIL import Image
ROOT = Path(__file__).resolve().parents[1]
PLANS = ROOT / 'data/official-plans/walkthrough'; OUT = ROOT / 'artifacts/v9.1/safety'
doc = pymupdf.open(ROOT / 'data/sources/safety-pta_174543_8048869_04268.pdf')
PAGES = {'SC-1F': 2, 'SC-2F': 3, 'SC-3F': 4, 'SC-4F': 5}
SCALE0 = 1.429  # OAA 2x pixels per PDF point, from the stair positions on 2F
fits = {}
for fid, page in PAGES.items():
    oaa = np.array(Image.open(PLANS / f'{fid}.webp').convert('L'))
    oaa = cv2.resize(oaa, None, fx=2, fy=2, interpolation=cv2.INTER_AREA)
    # Thin dark lines only: the OAA fills and the big room labels would mislead the correlation.
    edges = cv2.Canny(oaa, 60, 160)
    pix = doc[page - 1].get_pixmap(matrix=pymupdf.Matrix(SCALE0, SCALE0), colorspace=pymupdf.csGRAY)
    s0 = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width)
    body = s0.copy(); body[int(s0.shape[0] * .9):] = 255  # drop the title block
    best = None
    for k in np.arange(.94, 1.0601, .004):
        small = cv2.resize(body, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
        line = cv2.dilate((small < 235).astype(np.uint8), np.ones((3, 3), np.uint8))
        target = cv2.dilate((edges > 0).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(np.float32)
        # Search with the plan as the template over the larger page.
        H, W = line.shape
        if target.shape[0] > H or target.shape[1] > W:
            continue
        r = cv2.matchTemplate(line.astype(np.float32), target, cv2.TM_CCORR_NORMED)
        _, score, _, loc = cv2.minMaxLoc(r)
        if best is None or score > best[0]:
            best = (score, float(k), loc)
    score, k, (tx, ty) = best
    scale = SCALE0 * k
    fits[fid] = dict(page=page, oaaPerPoint=scale, tx=-tx, ty=-ty, score=score)
    print(fid, 'score', round(score, 3), 'scale', round(scale, 4), 'loc', tx, ty)
    pix = doc[page - 1].get_pixmap(matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csGRAY)
    page_img = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width)
    h, w = oaa.shape
    crop = page_img[ty:ty + h, tx:tx + w]
    colour = np.array(Image.open(PLANS / f'{fid}.webp').convert('RGB').resize((w, h), Image.LANCZOS)).astype(np.float32)
    colour = 255 - (255 - colour) * .45
    mask = crop[..., None].astype(np.float32) / 255
    red = np.array([215, 0, 0], np.float32)
    out = colour * mask + red * (1 - mask)
    img = Image.fromarray(out.clip(0, 255).astype(np.uint8))
    img.save(OUT / f'{fid}-composite.png')
    for j in range(3):
        img.crop((j * w // 3, 0, (j + 1) * w // 3, h)).save(OUT / f'{fid}-composite-{j}.png')
(OUT / 'fits.json').write_text(json.dumps(fits, indent=1))
