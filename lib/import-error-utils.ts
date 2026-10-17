const ROW_ERROR_RE = /^Row (\d+):\s*(.+)$/;

/**
 * Groups row-level validation lines that share the same message, e.g.
 * "Row 1: …" + "Row 2: …" → "Rows 1, 2: …"
 */
export function groupImportValidationErrors(errors: string[]): string[] {
  const ungrouped: string[] = [];
  const byMessage = new Map<string, number[]>();

  for (const line of errors) {
    const m = line.match(ROW_ERROR_RE);
    if (!m) {
      ungrouped.push(line);
      continue;
    }
    const row = Number(m[1]);
    const msg = m[2].trim();
    const rows = byMessage.get(msg);
    if (rows) {
      rows.push(row);
    } else {
      byMessage.set(msg, [row]);
    }
  }

  const grouped: string[] = [];
  for (const [msg, rows] of byMessage) {
    const uniqueSorted = [...new Set(rows)].sort((a, b) => a - b);
    const rowPart =
      uniqueSorted.length === 1
        ? `Row ${uniqueSorted[0]}`
        : `Rows ${uniqueSorted.join(', ')}`;
    grouped.push(`${rowPart}: ${msg}`);
  }

  grouped.sort((a, b) => {
    const ra = a.match(/^Rows? (\d+)/);
    const rb = b.match(/^Rows? (\d+)/);
    return (ra ? Number(ra[1]) : 0) - (rb ? Number(rb[1]) : 0);
  });

  return [...ungrouped, ...grouped];
}
