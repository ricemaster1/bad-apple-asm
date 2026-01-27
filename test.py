"""
Use this as a template for the Bad Apple!! P V, it is used to render individual frames but with some modifications.
I'm sure it can also render the full video but I haven't tested that yet.

True Color utilities for ARMLite assembly generation.

This module provides functions to generate ARMLite assembly using full 24-bit
RGB hex values instead of the limited 147 CSS3 named colors.

Notes:

Bad Apple on ARMLite

need a way to play audio
as found from previous attempt, one frame (any given image) ~50K loc and renders top to bottom per row
can use advantage of background being white,  so only put a switching condition to turn any given tile black.
can use the Conway's Game of Life as example because it renders very quickly
it should be fast enough to sync with audio
would need a way to inject audio into browser automatically and play the animation (run assembly code) on ARMLite simultaneously, perhaps run a node.js backend using playwright? Can use python's PIL library for image processing, but probably not needed because each frame is black and white and can be quantized in other ways such as ffmpeg or imagemagick
for testing and debugging purposes, a local GUI could be created in the same format as ARMLite, but only to test framerate or audio delay, other features are not necessary. 
A comparison side-by-side video of the real Bad Apple!! video can be played too

Also be sure to review the Programming reference manual_v1_3.pdf for ARMLite for more details on the assembly instructions and capabilities.
You may use the armlite_manual.txt file if you cannot open the PDF.
"""

from __future__ import annotations

from datetime import datetime
import os
from typing import Sequence

# Resolution presets (width, height, .Resolution value)
RESOLUTIONS = {
    'low': (32, 32, 0),   # 32x32 low-res (direct addressed)
    'mid': (64, 64, 1),   # 64x64 mid-res
    'hi': (128, 128, 2),  # 128x128 hi-res
}

def rgb_to_hex(r: int, g: int, b: int) -> int:
    """
    Convert RGB values to a single hexadecimal integer.

    Args:
        r (int): Red component (0-255).
        g (int): Green component (0-255).
        b (int): Blue component (0-255).

    Returns:
        int: Hexadecimal representation of the color.
    """
    return (r << 16) | (g << 8) | b

def hex_to_rgb(hex_val: int) -> tuple[int, int, int]:
    """
    Convert a hexadecimal integer to RGB values.

    Args:
        hex_val (int): Hexadecimal representation of the color.

    Returns:
        tuple[int, int, int]: Tuple containing (R, G, B) values.
    """
    r = (hex_val >> 16) & 0xFF
    g = (hex_val >> 8) & 0xFF
    b = hex_val & 0xFF
    return (r, g, b)

def generate_truecolor_assembly(
                                color_grid: Sequence[Sequence[int]], 
                                output_path: str, 
                                *, image_path: str = '', 
                                resolution: str = 'hi',
                                comment: str = '',
) -> None:
    """
    Generate ARMLite assembly code for a grid of true color values.

    Args:
        color_grid (Sequence[Sequence[int]]): 2D grid of hexadecimal color values.
        output_path (str): Path to save the generated assembly file.
        image_path (str, optional): Path to the source image. Defaults to ''.
        resolution (str, optional): Resolution preset ('low', 'mid', 'hi'). Defaults to 'hi'.
        comment (str, optional): Additional comment to include in the assembly file. Defaults to ''.
    """
    height = len(color_grid)
    width = len(color_grid[0]) if height else 0
    _, _, res_value = RESOLUTIONS.get(resolution, RESOLUTIONS['hi'])
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    lines = [
        '; === True Color Sprite ===',
        f'; Generated: {timestamp}',
    ]
    
    if image_path:
        lines.append(f'; Source: {os.path.basename(image_path)}')
    if comment:
        lines.append(f'; {comment}')

    lines.extend([
        f'; Resolution: {width}x{height} (mode {res_value})'
        '; Full 24-bit RGB  - no palette quantization',
        '',
        f'    MOV R0, #{res_value}',
        '    STR R0, .Resolution',
        '    MOV R1, .PixelScreen', 
    ])

    for y in range(height):
        for x in range(width):
            offset = ((y * width) + x) * 4
            hex_color = color_grid[y][x]
            lines.append(f'    MOV R5, #{offset}')
            lines.append(f'   ADD R4, R1, R5')
            lines.append(f'    MOV R0, #0x{hex_color:06X}')
            lines.append(f'    STR R0, [R4]   ; ({x},{y})')
    lines.append('   HALT')
    with open(output_path, 'w') as fh:
        fh.write('\n'.join(lines))

def generate_truecolor_assembly_optimized(
                                color_grid: Sequence[Sequence[int]], 
                                output_path: str, 
                                *, image_path: str = '', 
                                resolution: str = 'hi',
                                comment: str = '',
) -> None:
    """
    Generate optimized ARMLite assembly code for a grid of true color values.

    This version minimizes the number of MOV instructions by reusing registers.

    Args:
        color_grid (Sequence[Sequence[int]]): 2D grid of hexadecimal color values.
        output_path (str): Path to save the generated assembly file.
        image_path (str, optional): Path to the source image. Defaults to ''.
        resolution (str, optional): Resolution preset ('low', 'mid', 'hi'). Defaults to 'hi'.
        comment (str, optional): Additional comment to include in the assembly file. Defaults to ''.
    """
    height = len(color_grid)
    width = len(color_grid[0]) if height else 0
    _, _, res_value = RESOLUTIONS.get(resolution, RESOLUTIONS['hi'])
    total_pixels = width * height

    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    # Flatten the grid to a list of hex values
    pixels = [color_grid[y][x] for y in range(height) for x in range(width)]
    unique_colors = len(set(pixels))

    lines = [
        '; === True Color Sprite (Optimized) ===',
        f'; Generated: {timestamp}',
    ]
    
    if image_path:
        lines.append(f'; Source: {os.path.basename(image_path)}')
    if comment:
        lines.append(f'; {comment}')

    lines.extend([
        f'; Resolution: {width}x{height} (mode {res_value})',
        f'; {total_pixels} pixels, {unique_colors} unique colors',
        '; Full 24-bit RGB  - no palette quantization',
        '',
        f'    MOV R0, #{res_value}',
        '    STR R0, .Resolution',
        
        '    MOV R1, .PixelScreen', 
        '    MOV R2, #pixels',
        f'    MOV R3, #{total_pixels}',
        '    MOV R4, #0           ; pixel index',
        '',
        'draw_loop:',
        '    LDR R5, [R2]         ; load color from data',       
        '    STR R5, [R1]         ; write color to screen',
        '    ADD R1, R1, #4       ; next screen pixel',
        '    ADD R2, R2, #4       ; next data word',
        '    ADD R4, R4, #1       ; increment pixel index',
        '    CMP R4, R3           ; compare pixel index with total pixels',
        '    BLT draw_loop        ; loop if not done',
        '',
        '   HALT',
        '',
        '.DATA',
        'pixels:',
    ])

    # Add pixel data
    for px in pixels:
        lines.append(f'    .WORD 0x{px:06X}')
    
    with open(output_path, 'w') as fh:
        fh.write('\n'.join(lines))