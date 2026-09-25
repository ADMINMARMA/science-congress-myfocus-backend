export type TableRow = (string | null)[];
export type TableData = {
  stands: {
    standsRows: TableRow[];
    fieldsSet: string[];
    programsSet: string[];
    servicesSet: string[];
  };
  commons: TableRow[];
  uiText: TableRow[];
  filterTags: Record<string, string | null>;
};

/** Fail deployment early when the workbook contains ambiguous stand identifiers. */
export function validateStandIds(data: TableData): void {
  const ids = new Set<string>();
  for (const row of data.stands.standsRows) {
    const id = row[0]?.trim().toLowerCase();
    if (!id) continue;
    if (ids.has(id)) throw new Error(`Duplicate stand ID: ${row[0]}`);
    ids.add(id);
  }
}
