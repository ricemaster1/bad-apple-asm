// Minimal two-pass assembler scaffold for ARMLite
// - Supports labels and .WORD/.BYTE directives
// - Emits an object { byteCount, words, addrToLine, lineToByteAddress }

function tokenizeLines(programText){
  const rawLines = programText.replace(/\r\n/g,'\n').split('\n');
  return rawLines.map(l => l.trim());
}

function parseInteger(token){
  if(/^0x/i.test(token)) return parseInt(token,16);
  if(/^0b/i.test(token)) return parseInt(token.slice(1),2);
  const n = parseInt(token,10);
  return isNaN(n)?null:n;
}

function assemble(programText){
  const lines = tokenizeLines(programText);
  const labels = Object.create(null);
  let byteCount = 0;
  const addrToLine = [];
  const lineToByteAddress = [];

  // First pass: collect labels and compute addresses for directives we support
  for(let i=0;i<lines.length;i++){
    let raw = lines[i];
    // strip comments (// and ;)
    const commentIdx = raw.search(/\/\/|;/);
    if(commentIdx>=0) raw = raw.slice(0,commentIdx).trim();
    if(!raw) { continue; }

    // label
    if(raw.endsWith(':')){
      const name = raw.slice(0,-1).trim();
      if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('Invalid label '+name+' at line '+(i+1));
      labels[name] = byteCount;
      continue;
    }

    // directive or instruction
    const parts = raw.split(/\s+/);
    const op = parts[0].toUpperCase();
    lineToByteAddress[i] = byteCount;
    addrToLine[byteCount/4] = i;

    if(op==='.WORD'){
      // single 32-bit word per token following
      const valToken = raw.slice(5).trim();
      const val = parseInteger(valToken);
      if(val===null) throw new Error('.WORD expects integer at line '+(i+1));
      byteCount += 4;
      continue;
    }
    if(op==='.BYTE'){
      const valToken = raw.slice(5).trim();
      const val = parseInteger(valToken);
      if(val===null) throw new Error('.BYTE expects integer at line '+(i+1));
      byteCount += 1;
      continue;
    }

    // unknown instruction — for now reserve 4 bytes per instruction
    byteCount += 4;
  }

  // Second pass: emit words
  const words = new Uint32Array(Math.max(1, Math.ceil(byteCount/4)));
  let curByte = 0;

  for(let i=0;i<lines.length;i++){
    let raw = lines[i];
    const commentIdx = raw.search(/\/\/|;/);
    if(commentIdx>=0) raw = raw.slice(0,commentIdx).trim();
    if(!raw) continue;
    if(raw.endsWith(':')) continue;

    const parts = raw.split(/\s+/);
    const op = parts[0].toUpperCase();
    if(op==='.WORD'){
      const valToken = raw.slice(5).trim();
      const val = parseInteger(valToken);
      words[curByte/4] = val >>> 0;
      curByte += 4;
      continue;
    }
    if(op==='.BYTE'){
      const valToken = raw.slice(5).trim();
      const val = parseInteger(valToken);
      const wordIndex = Math.floor(curByte/4);
      const byteOffset = curByte%4;
      const shift = (3-byteOffset)*8;
      words[wordIndex] = (words[wordIndex] | ((val & 0xFF) << shift)) >>> 0;
      curByte += 1;
      continue;
    }

    // Instruction emission placeholder
    // For now we support a tiny MOV immediate pattern: MOV Rn,#imm
    const m = raw.match(/^MOV\s+(R([0-9]|1[0-5]))\s*,\s*#(.+)$/i);
    if(m){
      const rd = parseInt(m[2],10);
      const imm = parseInteger(m[3]);
      if(imm===null) throw new Error('Bad immediate on MOV at line '+(i+1));
      // Encode as a placeholder opcode: 0xEA000000 | (rd<<12) | (imm & 0xFFF)
      const opcode = (0xEA<<24) | ((rd & 0xF) << 12) | (imm & 0xFFF);
      words[curByte/4] = opcode >>> 0;
      curByte += 4;
      continue;
    }

    // Unknown instruction: throw so user extends implementation deliberately
    throw new Error('Unknown instruction or directive at line '+(i+1)+': '+raw);
  }

  return {
    byteCount: curByte,
    words: Array.from(words),
    addrToLine,
    lineToByteAddress
  };
}

module.exports = { assemble };
