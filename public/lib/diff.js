import { parseInline } from './format.js';

export function computeLineDiff(baseText, compareText) {
  const baseLines = String(baseText ?? '').replace(/\r\n/g, '\n').split('\n');
  const compareLines = String(compareText ?? '').replace(/\r\n/g, '\n').split('\n');
  const rows = baseLines.length;
  const cols = compareLines.length;
  const stride = cols + 1;
  const directions = new Uint8Array((rows + 1) * (cols + 1));
  const prev = new Uint32Array(cols + 1);
  const curr = new Uint32Array(cols + 1);

  for (let i = 1; i <= rows; i += 1) {
    curr[0] = 0;
    for (let j = 1; j <= cols; j += 1) {
      if (baseLines[i - 1] === compareLines[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        directions[i * stride + j] = 0;
      } else if (prev[j] >= curr[j - 1]) {
        curr[j] = prev[j];
        directions[i * stride + j] = 1;
      } else {
        curr[j] = curr[j - 1];
        directions[i * stride + j] = 2;
      }
    }
    prev.set(curr);
  }

  const baseStatuses = Array(rows).fill('removed');
  const compareStatuses = Array(cols).fill('added');
  const baseMatches = Array(rows).fill(-1);
  const compareMatches = Array(cols).fill(-1);
  const ops = [];
  let i = rows;
  let j = cols;
  while (i > 0 && j > 0) {
    const direction = directions[i * stride + j];
    if (direction === 0) {
      ops.push({ type: 'same', baseIndex: i - 1, compareIndex: j - 1 });
      i -= 1;
      j -= 1;
    } else if (direction === 1) {
      ops.push({ type: 'delete', baseIndex: i - 1 });
      i -= 1;
    } else {
      ops.push({ type: 'insert', compareIndex: j - 1 });
      j -= 1;
    }
  }

  while (i > 0) {
    ops.push({ type: 'delete', baseIndex: i - 1 });
    i -= 1;
  }

  while (j > 0) {
    ops.push({ type: 'insert', compareIndex: j - 1 });
    j -= 1;
  }

  ops.reverse();

  const pendingDeletes = [];
  const pendingInserts = [];
  for (const op of ops) {
    if (op.type === 'same') {
      baseStatuses[op.baseIndex] = 'same';
      compareStatuses[op.compareIndex] = 'same';
      baseMatches[op.baseIndex] = op.compareIndex;
      compareMatches[op.compareIndex] = op.baseIndex;
      continue;
    }

    if (op.type === 'delete') {
      const insertIndex = pendingInserts.shift();
      if (insertIndex !== undefined) {
        baseStatuses[op.baseIndex] = 'removed';
        compareStatuses[insertIndex] = 'added';
        baseMatches[op.baseIndex] = insertIndex;
        compareMatches[insertIndex] = op.baseIndex;
      } else {
        pendingDeletes.push(op.baseIndex);
      }
      continue;
    }

    const deleteIndex = pendingDeletes.shift();
    if (deleteIndex !== undefined) {
      baseStatuses[deleteIndex] = 'removed';
      compareStatuses[op.compareIndex] = 'added';
      baseMatches[deleteIndex] = op.compareIndex;
      compareMatches[op.compareIndex] = deleteIndex;
    } else {
      pendingInserts.push(op.compareIndex);
    }
  }

  for (const deleteIndex of pendingDeletes) {
    baseStatuses[deleteIndex] = 'removed';
  }

  for (const insertIndex of pendingInserts) {
    compareStatuses[insertIndex] = 'added';
  }

  return {
    base: { statuses: baseStatuses, matches: baseMatches, otherLines: compareLines },
    compare: { statuses: compareStatuses, matches: compareMatches, otherLines: baseLines },
  };
}

function tokenizeDiffText(text) {
  return String(text ?? '').match(/\s+|[^\s]+/g) || [];
}

export function computeTokenDiff(baseText, compareText) {
  const baseTokens = tokenizeDiffText(baseText);
  const compareTokens = tokenizeDiffText(compareText);
  const rows = baseTokens.length;
  const cols = compareTokens.length;
  const stride = cols + 1;
  const directions = new Uint8Array((rows + 1) * (cols + 1));
  const prev = new Uint32Array(cols + 1);
  const curr = new Uint32Array(cols + 1);

  for (let i = 1; i <= rows; i += 1) {
    curr[0] = 0;
    for (let j = 1; j <= cols; j += 1) {
      if (baseTokens[i - 1] === compareTokens[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        directions[i * stride + j] = 0;
      } else if (prev[j] >= curr[j - 1]) {
        curr[j] = prev[j];
        directions[i * stride + j] = 1;
      } else {
        curr[j] = curr[j - 1];
        directions[i * stride + j] = 2;
      }
    }
    prev.set(curr);
  }

  const ops = [];
  let i = rows;
  let j = cols;
  while (i > 0 && j > 0) {
    const direction = directions[i * stride + j];
    if (direction === 0) {
      ops.push({ type: 'same', baseToken: baseTokens[i - 1], compareToken: compareTokens[j - 1] });
      i -= 1;
      j -= 1;
    } else if (direction === 1) {
      ops.push({ type: 'delete', baseToken: baseTokens[i - 1] });
      i -= 1;
    } else {
      ops.push({ type: 'insert', compareToken: compareTokens[j - 1] });
      j -= 1;
    }
  }

  while (i > 0) {
    ops.push({ type: 'delete', baseToken: baseTokens[i - 1] });
    i -= 1;
  }

  while (j > 0) {
    ops.push({ type: 'insert', compareToken: compareTokens[j - 1] });
    j -= 1;
  }

  return ops.reverse();
}

function renderTokenPiece(token) {
  if (!token) return '';
  if (/^\s+$/.test(token)) {
    return token.replace(/ /g, '&nbsp;').replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');
  }
  return parseInline(token);
}

export function renderInlineDiff(baseText, compareText, side = 'base') {
  const ops = computeTokenDiff(baseText, compareText);
  const parts = [];
  for (const op of ops) {
    if (op.type === 'same') {
      parts.push(renderTokenPiece(op.baseToken));
      continue;
    }
    if (side === 'base' && op.type === 'delete') {
      parts.push(`<span class="inline-diff inline-removed">${renderTokenPiece(op.baseToken)}</span>`);
      continue;
    }
    if (side === 'compare' && op.type === 'insert') {
      parts.push(`<span class="inline-diff inline-added">${renderTokenPiece(op.compareToken)}</span>`);
    }
  }
  return parts.join('');
}
