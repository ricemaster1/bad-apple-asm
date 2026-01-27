#!/usr/bin/env python3
"""Convert frames to 1-bit masks and write compact RLE per-frame.

Usage:
  python process_frames.py --frames-dir frames --out-dir masks --subset 200

Outputs per-frame JSON files with RLE rows and a `index.json` summary.
"""
from __future__ import annotations

import os
import sys
import json
from PIL import Image
from pathlib import Path
import argparse


def frame_paths(frames_dir):
    p = Path(frames_dir)
    files = sorted([str(x) for x in p.glob('*.png')])
    return files


def mask_rle_from_image(path, threshold=128):
    im = Image.open(path).convert('L')
    w, h = im.size
    pix = im.load()
    rows = []
    total_black = 0
    for y in range(h):
        runs = []
        x = 0
        while x < w:
            # find next black pixel
            while x < w and pix[x, y] >= threshold:
                x += 1
            if x >= w:
                break
            start = x
            while x < w and pix[x, y] < threshold:
                x += 1
            length = x - start
            runs.append([start, length])
            total_black += length
        rows.append(runs)
    return {'w': w, 'h': h, 'rows': rows, 'black': total_black}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--frames-dir', default='frames')
    parser.add_argument('--out-dir', default='masks')
    parser.add_argument('--threshold', type=int, default=128)
    parser.add_argument('--subset', type=int, default=0,
                        help='Process only first N frames (0 = all)')
    args = parser.parse_args()

    frames = frame_paths(args.frames_dir)
    if not frames:
        print('No frames found in', args.frames_dir)
        return 1
    os.makedirs(args.out_dir, exist_ok=True)

    if args.subset > 0:
        frames = frames[:args.subset]

    index = {'count': len(frames), 'frames': []}

    for i, fp in enumerate(frames, start=1):
        outf = os.path.join(args.out_dir, f'frame_{i:05d}.json')
        rle = mask_rle_from_image(fp, threshold=args.threshold)
        with open(outf, 'w') as fh:
            json.dump(rle, fh)
        index['frames'].append({'src': os.path.basename(fp), 'out': os.path.basename(outf), 'black': rle['black']})
        if i % 50 == 0:
            print(f'Processed {i}/{len(frames)}')

    with open(os.path.join(args.out_dir, 'index.json'), 'w') as fh:
        json.dump(index, fh)

    print('Done. Wrote', len(frames), 'masks to', args.out_dir)
    return 0


if __name__ == '__main__':
    sys.exit(main())
