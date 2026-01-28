#!/usr/bin/env python3
"""Emit bitpacked frames and a small ARMLite decompressor.

Produces per-segment assembly files containing a small runtime loop
that loads packed bytes and writes pixels at runtime. This keeps the
ASM small (mostly data) while the decompressor is compact code.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import os
from typing import List


def load_rle(path: Path):
    with open(path, 'r') as fh:
        data = json.load(fh)
    w = data['w']
    h = data['h']
    s = set()
    for y, runs in enumerate(data['rows']):
        for start, length in runs:
            for x in range(start, start + length):
                s.add(y * w + x)
    return w, h, s


def pack_frame(bitset: set, w: int, h: int) -> bytearray:
    total = w * h
    out = bytearray((total + 7) // 8)
    for i in range(total):
        byte_idx = i // 8
        bit_idx = 7 - (i % 8)  # MSB-first
        if i in bitset:
            out[byte_idx] |= (1 << bit_idx)
    return out


def emit_segment_bitpacked(mask_files: List[Path], out_dir: Path, seg_idx: int):
    frames = []
    for fp in mask_files:
        w, h, s = load_rle(fp)
        frames.append(s)
    n = len(frames)
    w = w
    h = h
    bytes_per_frame = (w * h + 7) // 8

    outp = out_dir / f'segment_{seg_idx:03d}_bitpacked.asm'
    os.makedirs(out_dir, exist_ok=True)
    with open(outp, 'w') as fh:
        fh.write('; Bitpacked segment emitter\n')
        fh.write(f'; frames={n} w={w} h={h} bytes_per_frame={bytes_per_frame}\n\n')

        # runtime
        fh.write('    MOV R0, #0x000000    ; black colour\n')
        fh.write('    MOV R1, .PixelScreen ; base address for pixel writes\n')
        fh.write('    MOV R2, frames_data  ; pointer to packed frames\n')
        fh.write(f'    MOV R3, #{n}         ; frame count\n')
        fh.write(f'    MOV R4, #{bytes_per_frame} ; bytes/frame\n')
        fh.write('    MOV R5, #0           ; frame index\n')
        fh.write('\n')
        fh.write('frame_loop:\n')
        # compute data ptr = R2 + R5 * bytes_per_frame
        # bytes_per_frame typically 1536 = 512 + 1024 -> implement as (R<<9) + (R<<10)
        fh.write('    MOV R6, R5\n')
        fh.write('    LSL R6, R6, #9    ; *512\n')
        fh.write('    MOV R7, R6\n')
        fh.write('    LSL R7, R7, #1    ; *1024\n')
        fh.write('    ADD R6, R6, R7    ; *1536 -> frame offset in bytes\n')
        fh.write('    ADD R6, R6, R2    ; R6 -> ptr to frame data\n')

        fh.write('    MOV R10, #0       ; pixel index counter (counts pixels written)\n')
        fh.write('    MOV R7, #0        ; byte index\n')
        fh.write('byte_loop:\n')
        fh.write('    LDRB R8, [R6]     ; load packed byte\n')
        fh.write('    CMP R8, #0\n')
        fh.write('    BEQ byte_skip\n')
        fh.write('    MOV R9, #0x80    ; bit mask (MSB first)\n')
        fh.write('bit_loop:\n')
        fh.write('    AND R11, R8, R9\n')
        fh.write('    CMP R11, #0\n')
        fh.write('    BEQ bit_skip\n')
        fh.write('    LSL R12, R10, #2   ; pixel_index * 4 (word offset)\n')
        fh.write('    ADD R12, R12, R1   ; address = PixelScreen + offset\n')
        fh.write('    STR R0, [R12]      ; draw black pixel\n')
        fh.write('bit_skip:\n')
        fh.write('    LSR R9, R9, #1\n')
        fh.write('    ADD R10, R10, #1\n')
        fh.write('    CMP R9, #0\n')
        fh.write('    BNE bit_loop\n')
        fh.write('byte_skip:\n')
        fh.write('    ADD R6, R6, #1\n')
        fh.write('    ADD R7, R7, #1\n')
        fh.write('    CMP R7, R4\n')
        fh.write('    BLT byte_loop\n')

        fh.write('    ADD R5, R5, #1\n')
        fh.write('    CMP R5, R3\n')
        fh.write('    BLT frame_loop\n')
        fh.write('    HALT\n\n')

        fh.write('.DATA\n')
        fh.write('frames_data:\n')

        # write packed bytes for all frames
        for fi, s in enumerate(frames):
            packed = pack_frame(s, w, h)
            # write 16 bytes per .BYTE line
            for i in range(0, len(packed), 16):
                chunk = packed[i:i+16]
                fh.write('    .BYTE ')
                fh.write(','.join(f'0x{b:02x}' for b in chunk))
                fh.write('\n')

    print('Wrote bitpacked segment:', outp)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--masks-dir', default='masks')
    parser.add_argument('--out-dir', default='segments_bitpacked')
    parser.add_argument('--segment-size', type=int, default=256)
    args = parser.parse_args()

    p = Path(args.masks_dir)
    files = sorted(p.glob('frame_*.json'))
    if not files:
        print('No masks found in', args.masks_dir)
        return 1
    os.makedirs(args.out_dir, exist_ok=True)

    for i in range(0, len(files), args.segment_size):
        chunk = files[i:i+args.segment_size]
        seg_idx = i // args.segment_size
        emit_segment_bitpacked(chunk, Path(args.out_dir), seg_idx)

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
