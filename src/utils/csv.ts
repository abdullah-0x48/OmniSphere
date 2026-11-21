import type { DeviceImportRowInput } from '../../shared/types.ts';

/**
 * Parses RFC-4180 style CSV text into raw string rows without external dependencies.
 * Handles UTF-8 BOM, CRLF/LF line endings, quoted commas, and escaped quotes ("").
 */
export function parseCsvMatrix(rawText: string): string[][] {
  const text = rawText.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

const REQUIRED_HEADERS = ['serialnumber', 'hardwareid', 'model', 'site'] as const;

export function parseDeviceImportCsv(rawText: string): {
  rows: DeviceImportRowInput[];
  headerError: string | null;
} {
  const matrix = parseCsvMatrix(rawText);
  if (matrix.length < 2) {
    return {
      rows: [],
      headerError:
        'CSV must include a header row (serialNumber,hardwareId,model,site,tags,name) and at least one data row.',
    };
  }

  const headerIdx = new Map<string, number>();
  matrix[0].forEach((h, idx) => {
    headerIdx.set(normalizeHeader(h), idx);
  });

  const missing = REQUIRED_HEADERS.filter((req) => !headerIdx.has(req));
  if (missing.length > 0) {
    return {
      rows: [],
      headerError: `Missing required CSV columns: ${missing.join(', ')}. Expected headers: serialNumber, hardwareId, model, site, tags, name.`,
    };
  }

  const getCell = (cols: string[], key: string): string => {
    const idx = headerIdx.get(key);
    if (idx === undefined || idx >= cols.length) return '';
    return cols[idx].trim();
  };

  const parsedRows: DeviceImportRowInput[] = [];
  for (let i = 1; i < matrix.length; i += 1) {
    const cols = matrix[i];
    parsedRows.push({
      rowNumber: i,
      serialNumber: getCell(cols, 'serialnumber'),
      hardwareId: getCell(cols, 'hardwareid'),
      model: getCell(cols, 'model'),
      site: getCell(cols, 'site'),
      tags: getCell(cols, 'tags'),
      name: getCell(cols, 'name'),
    });
  }

  return { rows: parsedRows, headerError: null };
}

export function downloadJsonFile(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadTextFile(filename: string, content: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function buildSampleDeviceCsv(siteName: string): string {
  return [
    'serialNumber,hardwareId,model,site,tags,name',
    `SN-IMP-2026-001,AA:11:22:33:44:01,TH-200 Temperature and Humidity Sensor,${siteName},"line-1,critical",Sensor-Imp-01`,
    `SN-IMP-2026-002,AA:11:22:33:44:02,VM-310 Vibration Monitor,${siteName},"line-2",Vib-Imp-02`,
  ].join('\n');
}
