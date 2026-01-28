; One-frame bitpacked test (128x96)
; Draw an 8x8 black block at top-left

    MOV R0, #0x000000
    MOV R1, #.PixelScreen
    MOV R5, #0          ; row
row_loop:
    MOV R3, #0          ; col
pix_loop:
    LSL R6, R5, #7      ; row * 128
    ADD R6, R6, R3      ; pixel index = row*128 + col
    LSL R4, R6, #2      ; byte offset = pixel_index * 4
    ADD R4, R4, R1      ; address = PixelScreen + offset
    STR R0, [R4]
    ADD R3, R3, #1
    CMP R3, #8
    BLT pix_loop
    ADD R5, R5, #1
    CMP R5, #8
    BLT row_loop
    HALT
