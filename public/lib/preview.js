import { escapeHtml, parseInline, slugify, splitTableRow, normalizeLines } from './format.js';
import { renderInlineDiff } from './diff.js';

export function renderSourcePreview(md, lineDiff = { statuses: [] }, options = {}) {
  const side = options.side || 'base';
  const linePrefix = options.linePrefix || side;
  const lines = normalizeLines(md || '');
  const linesHtml = lines
    .map((line, index) => {
      const status = lineDiff.statuses[index] || 'same';
      const cls = status === 'same' ? '' : ` source-line-${status === 'added' ? 'added' : 'removed'}`;
      const lineNumber = index + 1;
      const lineId = `${linePrefix}-L${lineNumber}`;
      return `
        <span class="source-line${cls}" id="${lineId}" data-line="${lineNumber}">
          <button
            class="source-line-number"
            type="button"
            data-line-id="${lineId}"
            aria-label="Copy link to line ${lineNumber}"
            title="Copy link to line ${lineNumber}"
          >${lineNumber}</button>
          <span class="source-line-text">${escapeHtml(line) || '&nbsp;'}</span>
        </span>`;
    })
    .join('');
  return `<pre class="source-preview"><code>${linesHtml}</code></pre>`;
}

export function renderMarkdown(md, side = 'base', lineDiff = { statuses: [], matches: [], otherLines: [] }) {
  if (!md) return '<p class="empty-note">File is empty or missing on this ref.</p>';

  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  let inCode = false;
  let codeLang = '';
  let codeBuffer = [];
  let codeStartIndex = -1;
  let listType = null;
  let tableBuffer = null;
  let tableStartIndex = -1;

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  const sliceStatuses = (start, end) => lineDiff.statuses.slice(start, end);
  const hasChanges = (statuses) => statuses.some((status) => status !== 'same');
  const diffClass = (statuses) => {
    if (!hasChanges(statuses)) return '';
    return side === 'compare' ? 'diff-added' : 'diff-removed';
  };
  const wrapDiff = (html, statuses) => {
    const cls = diffClass(statuses);
    return cls ? `<div class="diff-block ${cls}">${html}</div>` : html;
  };
  const lineHasCounterpart = (lineIndex) => lineDiff.matches[lineIndex] >= 0;
  const counterpartTextFor = (lineIndex) => lineDiff.otherLines[lineDiff.matches[lineIndex]] || '';
  const counterpartRangeTextFor = (start, end) => {
    const length = end - start;
    if (length <= 0) return '';
    const counterpartIndices = [];
    for (let index = start; index < end; index += 1) {
      const counterpartIndex = lineDiff.matches[index];
      if (counterpartIndex < 0) return '';
      counterpartIndices.push(counterpartIndex);
    }

    const firstCounterpart = counterpartIndices[0];
    for (let offset = 1; offset < counterpartIndices.length; offset += 1) {
      if (counterpartIndices[offset] !== firstCounterpart + offset) {
        return '';
      }
    }

    return lineDiff.otherLines.slice(firstCounterpart, firstCounterpart + length).join(' ');
  };
  const renderLine = (text, lineIndex, forceDiff = false) => {
    const statuses = lineDiff.statuses[lineIndex] ? [lineDiff.statuses[lineIndex]] : [];
    const counterpart = lineHasCounterpart(lineIndex) ? counterpartTextFor(lineIndex) : '';
    const status = lineDiff.statuses[lineIndex] || 'same';
    const shouldDiff = forceDiff || status !== 'same';
    if (shouldDiff && counterpart) {
      return wrapDiff(renderInlineDiff(text, counterpart, side), statuses.length ? statuses : ['removed']);
    }
    return parseInline(text);
  };

  const flushTable = () => {
    if (!tableBuffer) return;
    const statuses = sliceStatuses(tableStartIndex, tableStartIndex + tableBuffer.length);
    const [header, ...rows] = tableBuffer;
    const headCells = splitTableRow(header);
    const parts = ['<table><thead><tr>'];
    for (const cell of headCells) {
      parts.push(`<th>${parseInline(cell)}</th>`);
    }
    parts.push('</tr></thead><tbody>');
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      parts.push('<tr>');
      const cells = splitTableRow(row);
      const rowLineIndex = tableStartIndex + rowIndex + 1;
      const counterpartRowText = lineHasCounterpart(rowLineIndex) ? counterpartTextFor(rowLineIndex) : '';
      const counterpartCells = counterpartRowText ? splitTableRow(counterpartRowText) : [];
      for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
        const cell = cells[cellIndex];
        const counterpartCell = counterpartCells[cellIndex] || '';
        const renderedCell =
          counterpartCell && lineDiff.statuses[rowLineIndex] !== 'same'
            ? renderInlineDiff(cell, counterpartCell, side)
            : parseInline(cell);
        parts.push(`<td>${renderedCell}</td>`);
      }
      parts.push('</tr>');
    }
    parts.push('</tbody></table>');
    out.push(wrapDiff(parts.join(''), statuses));
    tableBuffer = null;
    tableStartIndex = -1;
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimEnd();

    if (trimmed.startsWith('```')) {
      if (inCode) {
        const statuses = sliceStatuses(codeStartIndex, i + 1);
        const html = `<pre><code class="language-${escapeHtml(codeLang)}">${escapeHtml(codeBuffer.join('\n'))}</code></pre>`;
        out.push(wrapDiff(html, statuses));
        codeBuffer = [];
        inCode = false;
        codeLang = '';
        codeStartIndex = -1;
      } else {
        closeList();
        flushTable();
        inCode = true;
        codeLang = trimmed.slice(3).trim();
        codeStartIndex = i;
      }
      i += 1;
      continue;
    }

    if (inCode) {
      codeBuffer.push(line);
      i += 1;
      continue;
    }

    if (/^\|.*\|$/.test(trimmed) && i + 1 < lines.length && /^\|?[:\-\s|]+$/.test(lines[i + 1].trim())) {
      closeList();
      tableBuffer = [trimmed];
      tableStartIndex = i;
      i += 2;
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        tableBuffer.push(lines[i].trim());
        i += 1;
      }
      flushTable();
      continue;
    }

    if (!trimmed) {
      closeList();
      flushTable();
      i += 1;
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      closeList();
      flushTable();
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      const id = slugify(text);
      const html = `<h${level} id="${id}">${renderLine(text, i)}</h${level}>`;
      out.push(wrapDiff(html, sliceStatuses(i, i + 1)));
      i += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      closeList();
      flushTable();
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      const quoteStart = i - quoteLines.length;
      const quoteText = quoteLines.join(' ');
      const quoteCounterpart = counterpartRangeTextFor(quoteStart, i);
      const html = quoteCounterpart
        ? `<blockquote><p>${renderInlineDiff(quoteText, quoteCounterpart, side)}</p></blockquote>`
        : `<blockquote><p>${parseInline(quoteText)}</p></blockquote>`;
      out.push(wrapDiff(html, sliceStatuses(quoteStart, i)));
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      flushTable();
      if (listType !== 'ul') {
        closeList();
        listType = 'ul';
        out.push('<ul>');
      }
      const lineIndex = i;
      const text = trimmed.replace(/^[-*+]\s+/, '');
      const counterpart = lineHasCounterpart(lineIndex) ? counterpartTextFor(lineIndex).replace(/^[-*+]\s+/, '') : '';
      const html = counterpart && lineDiff.statuses[lineIndex] !== 'same'
        ? `<li>${renderInlineDiff(text, counterpart, side)}</li>`
        : `<li>${renderLine(text, lineIndex)}</li>`;
      out.push(wrapDiff(html, sliceStatuses(i, i + 1)));
      i += 1;
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      flushTable();
      if (listType !== 'ol') {
        closeList();
        listType = 'ol';
        out.push('<ol>');
      }
      const lineIndex = i;
      const text = trimmed.replace(/^\d+\.\s+/, '');
      const counterpart = lineHasCounterpart(lineIndex) ? counterpartTextFor(lineIndex).replace(/^\d+\.\s+/, '') : '';
      const html = counterpart && lineDiff.statuses[lineIndex] !== 'same'
        ? `<li>${renderInlineDiff(text, counterpart, side)}</li>`
        : `<li>${renderLine(text, lineIndex)}</li>`;
      out.push(wrapDiff(html, sliceStatuses(i, i + 1)));
      i += 1;
      continue;
    }

    closeList();
    flushTable();
    const paragraphStart = i;
    const paragraphs = [trimmed];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^[-*+]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !/^```/.test(lines[i].trim())
    ) {
      paragraphs.push(lines[i].trim());
      i += 1;
    }
    const currentText = paragraphs.join(' ');
    const paragraphStatuses = sliceStatuses(paragraphStart, i);
    const counterpart = counterpartRangeTextFor(paragraphStart, i);
    const html = counterpart && hasChanges(paragraphStatuses)
      ? `<p>${renderInlineDiff(currentText, counterpart, side)}</p>`
      : `<p>${parseInline(currentText)}</p>`;
    out.push(wrapDiff(html, paragraphStatuses));
  }

  closeList();
  flushTable();
  return out.join('');
}
