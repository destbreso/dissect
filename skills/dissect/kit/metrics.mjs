// Text widths for the floor plan. Readers' fonts differ, and a plan has to
// leave room for its words in all of them: these are the advance widths of two
// wide fonts, Verdana and DejaVu Sans (the larger of the two for each
// character, in hundredths of an em, regular and bold), measured in Chrome. The
// page fits its words again with the font the reader actually has.

const ASCII = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";
const REGULAR = [36, 41, 46, 84, 64, 108, 78, 28, 46, 46, 64, 84, 37, 41, 37, 46, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 46, 46, 84, 84, 84, 55, 100, 69, 69, 70, 78, 64, 58, 78, 76, 43, 46, 70, 56, 87, 75, 79, 61, 79, 70, 69, 62, 74, 69, 99, 69, 62, 69, 46, 46, 46, 84, 64, 64, 62, 64, 54, 64, 59, 36, 64, 64, 28, 35, 60, 28, 98, 64, 59, 64, 64, 43, 53, 40, 64, 60, 82, 60, 60, 53, 64, 46, 64, 84];
const BOLD = [35, 46, 59, 87, 72, 128, 88, 34, 55, 55, 72, 87, 38, 48, 38, 69, 72, 72, 72, 72, 72, 72, 72, 72, 72, 72, 41, 41, 87, 87, 87, 62, 100, 78, 77, 74, 83, 69, 69, 83, 84, 55, 56, 78, 64, 100, 85, 85, 74, 85, 79, 72, 69, 82, 78, 113, 78, 74, 73, 55, 69, 55, 87, 72, 72, 68, 72, 60, 72, 68, 44, 72, 72, 35, 41, 68, 35, 106, 72, 69, 72, 72, 50, 60, 48, 72, 66, 98, 67, 66, 60, 72, 55, 72, 87];
const OTHER = { "✓": [84, 84], "✗": [84, 84], "…": [100, 105], "·": [37, 38], "×": [84, 87], "µ": [65, 74], "≤": [84, 87], "≥": [84, 87], "é": [60, 68], "á": [62, 68], "í": [28, 35], "ó": [61, 69], "ú": [64, 72], "ñ": [64, 72], "→": [100, 100], "←": [100, 100] };

/** The width of a text at a size, in a wide font: what the floor plan budgets for it. */
export function wideWidth(text, size, bold = false) {
  let em = 0;
  for (const ch of String(text)) {
    const i = ASCII.indexOf(ch);
    em += i >= 0 ? (bold ? BOLD : REGULAR)[i] : (OTHER[ch]?.[bold ? 1 : 0] ?? 100);
  }
  return (em / 100) * size;
}
