# bad-apple frame2arm generator

Simple C++ tool `frame2arm` that reads a text mask (`mask.txt`) and emits ARMLite assembly
which shifts the mask horizontally across multiple frames. This approach stores black-pixel
offsets and per-frame shifts to avoid emitting full per-frame static images.

Build (simple):

```
g++ -std=c++17 -O2 -I src -o frame2arm src/main.cpp
./frame2arm mask.txt bad-apple.asm 128
```

`mask.txt` format: lines containing `0` and `1` characters only. Example provided.
