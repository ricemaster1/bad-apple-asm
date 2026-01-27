#!/usr/bin/env python3
"""Analyze mask JSON files and compute per-frame statistics.

Outputs `masks/stats.json` with per-frame metrics: black count, diff count,
best horizontal shift (and overlap fraction), runs per row, and summary.
"""
from __future__ import annotations

import os
import json
from pathlib import Path
import argparse
from typing import Set, Tuple


def load_rle(path: Path) -> Tuple[int, int, Set[int]]:
    with open(path, 'r') as fh:
        data = json.load(fh)
    w = data['w']
    h = data['h']
    rows = data['rows']
    s = set()
    for y, runs in enumerate(rows):
        for start, length in runs:
            for x in range(start, start + length):
                s.add(y * w + x)
    return w, h, s


def best_horizontal_shift(prev_set: Set[int], cur_set: Set[int], w: int, max_shift: int = 32) -> Tuple[int, int]:
    # Returns (best_dx, best_overlap)
    best_dx = 0
    best_overlap = 0
    # Precompute prev per-row sets for quick shifting
    prev_rows = {}
    for idx in prev_set:
        y = idx // w
        x = idx % w
        prev_rows.setdefault(y, set()).add(x)
    cur_rows = {}
    for idx in cur_set:
        y = idx // w
        x = idx % w
        cur_rows.setdefault(y, set()).add(x)

    for dx in range(-max_shift, max_shift + 1):
        overlap = 0
        for y, cur_xs in cur_rows.items():
            prev_xs = prev_rows.get(y)
            if not prev_xs:
                continue
            # shift cur_xs by -dx to align with prev
            shifted = {x - dx for x in cur_xs if 0 <= x - dx < w}
            overlap += len(shifted & prev_xs)
        if overlap > best_overlap:
            best_overlap = overlap
            best_dx = dx
    return best_dx, best_overlap


def analyze_masks(masks_dir: str, out_path: str):
    p = Path(masks_dir)
    files = sorted(p.glob('frame_*.json'))
    if not files:
        print('No mask JSON files found in', masks_dir)
        return 1

    stats = {'frames': [], 'summary': {}}
    total_black = 0
    total_diff = 0
    shift_matches = 0
    w = h = None
    prev_set = None

    for i, fp in enumerate(files, start=1):
        w_i, h_i, cur_set = load_rle(fp)
        if w is None:
            w, h = w_i, h_i
        black = len(cur_set)
        frame_stat = {'frame': i, 'file': fp.name, 'black': black}
        if prev_set is None:
            frame_stat.update({'diff': black, 'best_dx': 0, 'best_overlap': 0, 'overlap_frac': 0.0})
        else:
            diff = len(prev_set ^ cur_set)
            best_dx, best_overlap = best_horizontal_shift(prev_set, cur_set, w, max_shift=32)
            overlap_frac = best_overlap / max(1, max(len(prev_set), len(cur_set)))
            frame_stat.update({'diff': diff, 'best_dx': best_dx, 'best_overlap': best_overlap, 'overlap_frac': overlap_frac})
            total_diff += diff
            if overlap_frac >= 0.7:
                shift_matches += 1

        stats['frames'].append(frame_stat)
        total_black += black
        prev_set = cur_set
        if i % 200 == 0:
            print(f'Analyzed {i} frames')

    n = len(files)
    stats['summary'] = {
        'count': n,
        'avg_black': total_black / n,
        'avg_diff': total_diff / max(1, n-1),
        'shift_match_percent': 100.0 * shift_matches / max(1, n-1),
        'width': w,
        'height': h,
    }

    with open(out_path, 'w') as fh:
        json.dump(stats, fh, indent=2)

    print('Wrote stats to', out_path)
    print('Summary:', stats['summary'])
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--masks-dir', default='masks')
    parser.add_argument('--out', default='masks/stats.json')
    args = parser.parse_args()
    return analyze_masks(args.masks_dir, args.out)


if __name__ == '__main__':
    exit(main())
