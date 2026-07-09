import * as replicad from 'replicad';

export function parseSVGPath(pathStr: string) {
  const tokens = pathStr.match(/[a-zA-Z]+|[-+]?[0-9]*\.?[0-9]+/g);
  if (!tokens || tokens.length === 0) return new replicad.Sketcher("XY").done();

  let sketch = new replicad.Sketcher("XY");
  let i = 0;
  let currentPos: [number, number] = [0, 0];

  while (i < tokens.length) {
    const cmd = tokens[i];
    if (/[MmLlHhVvCcQqZzAa]/.test(cmd)) {
      i++;
      const isRel = cmd === cmd.toLowerCase() && cmd !== 'Z' && cmd !== 'z';
      
      switch (cmd.toUpperCase()) {
        case 'M': {
          const x = parseFloat(tokens[i++]);
          const y = parseFloat(tokens[i++]);
          currentPos = isRel ? [currentPos[0] + x, currentPos[1] + y] : [x, y];
          sketch.movePointerTo(currentPos);
          break;
        }
        case 'L': {
          const x = parseFloat(tokens[i++]);
          const y = parseFloat(tokens[i++]);
          currentPos = isRel ? [currentPos[0] + x, currentPos[1] + y] : [x, y];
          sketch.lineTo(currentPos);
          break;
        }
        case 'H': {
          const x = parseFloat(tokens[i++]);
          currentPos[0] = isRel ? currentPos[0] + x : x;
          sketch.lineTo(currentPos);
          break;
        }
        case 'V': {
          const y = parseFloat(tokens[i++]);
          currentPos[1] = isRel ? currentPos[1] + y : y;
          sketch.lineTo(currentPos);
          break;
        }
        case 'C': {
          const x1 = parseFloat(tokens[i++]);
          const y1 = parseFloat(tokens[i++]);
          const x2 = parseFloat(tokens[i++]);
          const y2 = parseFloat(tokens[i++]);
          const x = parseFloat(tokens[i++]);
          const y = parseFloat(tokens[i++]);
          
          const cp1: [number, number] = isRel ? [currentPos[0] + x1, currentPos[1] + y1] : [x1, y1];
          const cp2: [number, number] = isRel ? [currentPos[0] + x2, currentPos[1] + y2] : [x2, y2];
          currentPos = isRel ? [currentPos[0] + x, currentPos[1] + y] : [x, y];
          
          sketch.cubicBezierCurveTo(currentPos, cp1, cp2);
          break;
        }
        case 'Q': {
          const x1 = parseFloat(tokens[i++]);
          const y1 = parseFloat(tokens[i++]);
          const x = parseFloat(tokens[i++]);
          const y = parseFloat(tokens[i++]);
          
          const cp1: [number, number] = isRel ? [currentPos[0] + x1, currentPos[1] + y1] : [x1, y1];
          currentPos = isRel ? [currentPos[0] + x, currentPos[1] + y] : [x, y];
          
          sketch.quadraticBezierCurveTo(currentPos, cp1);
          break;
        }
        case 'Z':
        case 'z': {
          sketch.close();
          break;
        }
        default: {
          break;
        }
      }
    } else {
      i++;
    }
  }

  return sketch.done();
}
