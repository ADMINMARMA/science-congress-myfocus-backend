import { read, utils } from 'xlsx';
import { validateStandIds, type TableData, type TableRow } from './table-data.js';

/** Parse the established My Focus workbook contract without truncating rows. */
export function parseTable(buffer: Buffer): TableData {
  const workbook = read(buffer, { type: 'buffer' });
  const rows = (name: string, start: number, end: number): TableRow[] => {
    const sheet = workbook.Sheets[name];
    if (!sheet?.['!ref']) throw new Error(`Missing worksheet: ${name}`);
    const last = utils.decode_range(sheet['!ref']).e.r;
    if (last < 1) return [];
    return utils
      .sheet_to_json<TableRow>(sheet, {
        header: 1,
        raw: false,
        defval: null,
        range: { s: { c: start, r: 1 }, e: { c: end, r: last } },
      })
      .filter((row) => row[0] !== null && row[0]?.trim());
  };
  const standsRows = rows('stands', 1, 15);
  const values = (column: number, split: boolean) => [
    ...new Set(
      standsRows.flatMap((row) => {
        const value = row[column];
        return (value ? (split ? value.split(', ') : [value]) : [])
          .map((entry) => entry.trim().replace(/\s+/g, ' '))
          .filter(Boolean);
      }),
    ),
  ];
  const data: TableData = {
    stands: {
      standsRows,
      fieldsSet: values(7, false),
      programsSet: values(8, true),
      servicesSet: values(9, true),
    },
    commons: rows('commons', 1, 12),
    uiText: rows('uiText', 0, 2),
    filterTags: Object.fromEntries(rows('filterTags', 1, 2).map(([ru, en]) => [ru!, en ?? null])),
  };
  validateStandIds(data);
  return data;
}
