// Faster drop-in for make.fun's csv-reader 1.0.0: run(input) returns exactly
// csv-reader 1.0.0's answer {columns, rows, errors} for every input {text, header}.
//
// The reference reads one character at a time and builds every field a character
// at a time. This reader keeps the same policy byte for byte, but works in bulk:
//
//   - an unquoted field is found by scanning for the nearest of , LF, CR, then one
//     slice (stray CRs, rare, fall back to joining segments);
//   - a quoted field finds its closing quote with indexOf ("" doubling folded in),
//     counts its line breaks after it closes, and normalises CR/CRLF to LF with one
//     replace only when a CR is present;
//   - a quote that never closes falls back to the reference's re-read-as-unquoted.
//   - line numbers are tracked incrementally: one per physical line break, plus the
//     line breaks inside a quoted field once it closes (an unterminated quote's
//     would-be line breaks are never counted, as the reference resets them).
//
// Everything runs in one function over locals only (no closures over mutable
// state), so V8 keeps the whole parse in registers. Pure: no clock, no randomness,
// no locale, nothing kept from one call to the next.

/** CRLF or a lone CR inside quotes: each reads as one LF in the value. */
const CR_RE = /\r\n?/g;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    // The record being read: the line it starts on and the index in rows it takes (null: the header).
    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;

    const fields = [];
    let quoted = false;
    let ended = 0; // 0: the field ended at a comma, the record goes on; 1: it ended, the record ends
    do {
      let value;
      // prefix !== null: the field still needs an unquoted scan from scanPos, onto prefix
      // (an unquoted field, the junk after a closing quote, or an unterminated quote's re-read).
      let prefix = null;
      let scanPos = pos;
      let junkScan = false;
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        const open = pos;
        pos += 1;
        // The closing quote: the next quote that is not doubled ("" inside is one quote).
        let segStart = pos;
        let qparts = null;
        let closedAt = -1;
        let qpos = pos;
        for (;;) {
          const qq = text.indexOf('"', qpos);
          if (qq === -1) break;
          if (text.charCodeAt(qq + 1) === 34) {
            if (qparts === null) qparts = [text.slice(segStart, qq)];
            else qparts.push(text.slice(segStart, qq));
            qparts.push('"');
            qpos = qq + 2;
            segStart = qq + 2;
            continue;
          }
          closedAt = qq;
          break;
        }
        if (closedAt === -1) {
          // The quote never closes: it is a literal character, and the text after it
          // is read again as unquoted (unterminated_quote). No line was counted for
          // the failed scan, as the reference resets its line to the opening quote's.
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          prefix = '"';
          scanPos = open + 1;
        } else {
          let raw;
          if (qparts === null) raw = text.slice(segStart, closedAt);
          else {
            qparts.push(text.slice(segStart, closedAt));
            raw = qparts.join('');
          }
          // Each CRLF or lone CR inside quotes reads as LF in the value; after that
          // every line break the field held is one LF in the value, so counting the
          // value's LFs counts the field's lines.
          const val = raw.indexOf('\r') === -1 ? raw : raw.replace(CR_RE, '\n');
          let p = 0;
          for (;;) {
            const f = val.indexOf('\n', p);
            if (f === -1) break;
            line += 1;
            p = f + 1;
          }
          pos = closedAt + 1;
          if (pos >= n) {
            value = val;
            ended = 1;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos += 1;
              value = val;
              ended = 0;
            } else if (c === 10) {
              pos += 1;
              line += 1;
              value = val;
              ended = 1;
            } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              value = val;
              ended = 1;
            } else {
              // What follows the closing quote is appended as it stands, up to the
              // next comma or line break (quote_junk, when the field ends).
              prefix = val;
              scanPos = pos;
              junkScan = true;
            }
          }
        }
      } else {
        quoted = false;
        prefix = '';
        scanPos = pos;
      }

      if (prefix !== null) {
        // One unquoted scan: to the next comma, line break or end of text, a CR not
        // followed by LF dropped (stray_cr). Stray CRs are rare, so a field that
        // holds one falls back to joining segments.
        let start = scanPos;
        let parts = null;
        let p = scanPos;
        let tailEnd;
        for (;;) {
          let i = p;
          while (i < n) {
            const c = text.charCodeAt(i);
            if (c === 44 || c === 10 || c === 13) break;
            i += 1;
          }
          if (i >= n) {
            tailEnd = n;
            pos = n;
            ended = 1;
            break;
          }
          const d = text.charCodeAt(i);
          if (d === 44) {
            tailEnd = i;
            pos = i + 1;
            ended = 0;
            break;
          }
          if (d === 10) {
            tailEnd = i;
            pos = i + 1;
            line += 1;
            ended = 1;
            break;
          }
          if (i + 1 < n && text.charCodeAt(i + 1) === 10) {
            tailEnd = i;
            pos = i + 2;
            line += 1;
            ended = 1;
            break;
          }
          // A lone CR: dropped, and the field goes on after it.
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          if (parts === null) parts = [text.slice(start, i)];
          else parts.push(text.slice(start, i));
          p = i + 1;
          start = i + 1;
        }
        const tail = text.slice(start, tailEnd);
        value = parts === null ? prefix + tail : prefix + parts.join('') + tail;
        if (junkScan && value.length > prefix.length) {
          errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        }
      }

      fields.push(value);
    } while (ended === 0);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
