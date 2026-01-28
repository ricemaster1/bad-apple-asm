Local ARMLite assembler (scaffold)

This minimal assembler is an extensible starting point for building a local ARMLite compiler.

Features (current):
- Two-pass parser
- Labels (symbol table)
- `.WORD` and `.BYTE` directives
- Emits an array of 32-bit words (words corresponding to addresses 0,4,8...)

Usage (node):

```bash
node -e "const asm=require('./lib/assembler'); const src=require('fs').readFileSync('lib/assembler/test.asm','utf8'); console.log(asm.assemble(src));"
```

Files:
- `index.js` — main assembler API (`assemble(programText)`)
- `test.asm` — tiny example

Next work:
- Implement instruction encodings to match the ARMLite simulator's expectations.
- Add CLI and unit tests.
