#!/usr/bin/env python3
"""Segmented emitter: reads mask RLE JSONs and emits ARMLite assembly per segment.

Approach per segment:
 - Align each frame to the first frame by searching horizontal shifts (±64)
 - Compute a base set = pixels present in >= `base_frac` of frames (after alignment)
 - For each frame compute additions (pixels in frame but not in shifted base)
   and removals (pixels in shifted base but not in frame)
 - Emit assembly with `.DATA` blocks: base_offsets, shifts, additions_data, additions_index/count,
   removals_data, removals_index/count.

Runtime per frame:
 - Clear screen
 - Draw base offsets shifted by per-frame shift
 - Draw additions (black)
 - Draw removals (white)

This is a prototype emitter to demonstrate segmentation and correctness.
"""
from __future__ import annotations

import os
import json
from pathlib import Path
import argparse
from typing import Set, Tuple, List


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


def best_horizontal_shift(prev_set: Set[int], cur_set: Set[int], w: int, max_shift: int = 64) -> Tuple[int, int]:
    best_dx = 0
    best_overlap = 0
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
            shifted = {x - dx for x in cur_xs if 0 <= x - dx < w}
            overlap += len(shifted & prev_xs)
        if overlap > best_overlap:
            best_overlap = overlap
            best_dx = dx
    return best_dx, best_overlap


def emit_segment(mask_files: List[Path], out_path: Path, seg_idx: int, base_frac: float = 0.9):
    # load frames
    frames = []
    for fp in mask_files:
        w, h, s = load_rle(fp)
        frames.append({'file': fp.name, 'set': s})
    n = len(frames)
    w = w
    h = h

    # align frames to first frame by best horizontal shift
    ref = frames[0]['set']
    shifts = [0] * n
    aligned_sets = [ref]
    for i in range(1, n):
        dx, overlap = best_horizontal_shift(ref, frames[i]['set'], w, max_shift=64)
        shifts[i] = dx
        # create aligned set (shifted coords into ref space)
        s = set()
        for idx in frames[i]['set']:
            y = idx // w
            x = idx % w
            x0 = x - dx
            if 0 <= x0 < w:
                s.add(y * w + x0)
        aligned_sets.append(s)

    # compute frequency per pixel in ref-space
    freq = {}
    for s in aligned_sets:
        for idx in s:
            freq[idx] = freq.get(idx, 0) + 1

    base_threshold = int(base_frac * n)
    base_pixels = set(idx for idx, c in freq.items() if c >= base_threshold)

    # base_offsets in bytes
    base_offsets = [idx * 4 for idx in sorted(base_pixels)]

    # compute per-frame additions/removals (in target coordinate space relative to PixelScreen)
    additions_all = []
    additions_index = []
    additions_count = []
    removals_all = []
    removals_index = []
    removals_count = []

    for i in range(n):
        dx = shifts[i]
        # shifted base set in global pixel coords (after adding dx back)
        shifted_base = set()
        for idx in base_pixels:
            y = idx // w
            x = idx % w
            x2 = x + dx
            if 0 <= x2 < w:
                shifted_base.add(y * w + x2)
        cur = frames[i]['set']
        additions = sorted([(p * 4) for p in (cur - shifted_base)])
        removals = sorted([(p * 4) for p in (shifted_base - cur)])
        additions_index.append(len(additions_all))
        additions_count.append(len(additions))
        additions_all.extend(additions)
        removals_index.append(len(removals_all))
        removals_count.append(len(removals))
        removals_all.extend(removals)

    # write assembly
    outp = out_path / f'segment_{seg_idx:03d}.asm'
    with open(outp, 'w') as fh:
        fh.write('; Segment emitter\n')
        fh.write(f'; frames: {n}  base_pixels: {len(base_offsets)}  additions_total: {len(additions_all)}  removals_total: {len(removals_all)}\n')
        fh.write('\n')
        fh.write('    MOV R0, #0x000000    ; black\n')
        fh.write('    MOV R12, #0xFFFFFF    ; white (for removals)\n')
        fh.write('    MOV R1, #.PixelScreen\n')
        fh.write('    MOV R2, #base_offsets\n')
        fh.write(f'    MOV R3, #{len(base_offsets)}\n')
        fh.write('    MOV R4, #shifts\n')
        fh.write(f'    MOV R5, #{n}    ; frame count\n')
        fh.write('    MOV R6, #0    ; current frame idx\n')
        fh.write('\n')
        fh.write('frame_loop:\n')
        # load shift for frame: compute addr = shifts + R6*4
        fh.write('    MOV R7, R6\n')
        fh.write('    LSL R7, R7, #2\n')
        fh.write('    ADD R7, R7, R4\n')
        fh.write('    LDR R8, [R7]    ; R8 = shift in pixels (we store shifts in pixels, convert below)\n')
        # convert shift in pixels to bytes:
        fh.write('    LSL R8, R8, #2    ; bytes\n')
        fh.write('    STR R0, .ClearScreen\n')

        # draw base_offsets shifted
        fh.write('    MOV R9, R2    ; ptr to base_offsets\n')
        fh.write('    MOV R10, #0\n')
        fh.write('base_loop:\n')
        fh.write('    LDR R11, [R9]\n')
        fh.write('    ADD R11, R11, R8\n')
        fh.write('    STR R0, [R1+R11]\n')
        fh.write('    ADD R9, R9, #4\n')
        fh.write('    ADD R10, R10, #1\n')
        fh.write('    CMP R10, R3\n')
        fh.write('    BLT base_loop\n')

        # additions
        fh.write('    MOV R12, #additions_index\n')
        fh.write('    LSL R13, R6, #2\n')
        fh.write('    ADD R12, R12, R13\n')
        fh.write('    LDR R14, [R12]    ; start index into additions_data\n')
        fh.write('    MOV R15, #additions_data\n')
        fh.write('    LSL R14, R14, #2\n')
        fh.write('    ADD R15, R15, R14    ; pointer to additions list\n')
        fh.write('    MOV R16, #0\n')
        fh.write('    MOV R18, #additions_count\n')
        fh.write('    ADD R18, R18, R13\n')
        fh.write('    LDR R19, [R18]    ; additions count\n')
        fh.write('add_loop:\n')
        fh.write('    CMP R16, R19\n')
        fh.write('    BGE add_done\n')
        fh.write('    LDR R20, [R15]\n')
        fh.write('    STR R0, [R1+R20]\n')
        fh.write('    ADD R15, R15, #4\n')
        fh.write('    ADD R16, R16, #1\n')
        fh.write('    B add_loop\n')
        fh.write('add_done:\n')

        # removals (write white)
        fh.write('    MOV R12, #removals_index\n')
        fh.write('    LSL R13, R6, #2\n')
        fh.write('    ADD R12, R12, R13\n')
        fh.write('    LDR R14, [R12]    ; start index into removals_data\n')
        fh.write('    MOV R15, #removals_data\n')
        fh.write('    LSL R14, R14, #2\n')
        fh.write('    ADD R15, R15, R14    ; pointer to removals list\n')
        fh.write('    MOV R16, #0\n')
        fh.write('    MOV R18, #removals_count\n')
        fh.write('    ADD R18, R18, R13\n')
        fh.write('    LDR R19, [R18]    ; removals count\n')
        fh.write('rem_loop:\n')
        fh.write('    CMP R16, R19\n')
        fh.write('    BGE rem_done\n')
        fh.write('    LDR R20, [R15]\n')
        fh.write('    STR R12, [R1+R20]\n')
        fh.write('    ADD R15, R15, #4\n')
        fh.write('    ADD R16, R16, #1\n')
        fh.write('    B rem_loop\n')
        fh.write('rem_done:\n')

        fh.write('    ADD R6, R6, #1\n')
        fh.write('    CMP R6, R5\n')
        fh.write('    BLT frame_loop\n')
        fh.write('    HALT\n')

        fh.write('\n')
        fh.write('.DATA\n')
        fh.write('base_offsets:\n')
        for v in base_offsets:
            fh.write(f'    .WORD {v}\n')
        fh.write('\n')
        fh.write('shifts:\n')
        for v in shifts:
            fh.write(f'    .WORD {v}\n')
        fh.write('\n')
        fh.write('additions_data:\n')
        for v in additions_all:
            fh.write(f'    .WORD {v}\n')
        fh.write('\n')
        fh.write('additions_index:\n')
        for v in additions_index:
            fh.write(f'    .WORD {v}\n')
        fh.write('\n')
        fh.write('additions_count:\n')
        for v in additions_count:
            fh.write(f'    .WORD {v}\n')
        fh.write('\n')
        fh.write('removals_data:\n')
        for v in removals_all:
            fh.write(f'    .WORD {v}\n')
        fh.write('\n')
        fh.write('removals_index:\n')
        for v in removals_index:
            fh.write(f'    .WORD {v}\n')
        fh.write('\n')
        fh.write('removals_count:\n')
        for v in removals_count:
            fh.write(f'    .WORD {v}\n')

    print('Wrote segment to', outp, 'frames=', n)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--masks-dir', default='masks')
    parser.add_argument('--out-dir', default='segments')
    parser.add_argument('--segment-size', type=int, default=256)
    parser.add_argument('--base-frac', type=float, default=0.9)
    args = parser.parse_args()

    p = Path(args.masks_dir)
    files = sorted(p.glob('frame_*.json'))
    if not files:
        print('No masks')
        return 1
    os.makedirs(args.out_dir, exist_ok=True)
    # process in chunks
    for i in range(0, len(files), args.segment_size):
        chunk = files[i:i+args.segment_size]
        seg_idx = i // args.segment_size
        emit_segment(chunk, Path(args.out_dir), seg_idx, base_frac=args.base_frac)

    return 0


if __name__ == '__main__':
    exit(main())
