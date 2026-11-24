import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface CsvTableData {
  headers: string[];
  rows: Array<Array<string | number | null | undefined>>;
}

export interface PdfTableSection {
  title: string;
  headers: string[];
  rows: Array<Array<string | number | null | undefined>>;
}

export interface PdfReportDocumentInput {
  filename: string;
  title: string;
  subtitle: string;
  organizationLabel: string;
  dateRangeLabel: string;
  filterSummary: string;
  kpis: Array<{ label: string; value: string; detail: string }>;
  sections: PdfTableSection[];
}

const PURE_NUMBER_RE = /^-?\d+(\.\d+)?%?$/;

/**
 * Escapes a single CSV cell according to RFC 4180 and neutralizes spreadsheet
 * formula injection (=, +, -, @, tab, CR) on non-numeric strings.
 */
export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let str = String(value);
  const trimmedStart = str.trimStart();
  if (
    trimmedStart.length > 0 &&
    /^[=+\-@\t\r]/.test(trimmedStart) &&
    !PURE_NUMBER_RE.test(trimmedStart)
  ) {
    str = `'${str}`;
  }
  if (/[",\r\n]/.test(str)) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

/**
 * Generates a UTF-8 CSV string (with BOM for Excel compatibility) from headers and rows.
 */
export function buildCsvContent(table: CsvTableData): string {
  const lines: string[] = [];
  lines.push(table.headers.map(escapeCsvCell).join(','));
  for (const row of table.rows) {
    lines.push(row.map(escapeCsvCell).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function buildReportFilename(
  tenantCode: string,
  reportSlug: string,
  fromIso: string,
  toIso: string,
  ext: 'csv' | 'pdf',
): string {
  const safeCode = tenantCode.replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase() || 'ALL';
  const safeSlug = reportSlug.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const fromDate = fromIso.slice(0, 10);
  const toDate = toIso.slice(0, 10);
  return `omnisphere_${safeCode}_${safeSlug}_${fromDate}_to_${toDate}.${ext}`;
}

/**
 * Triggers a browser file download of a UTF-8 CSV generated client-side.
 */
export function downloadCsvFile(filename: string, table: CsvTableData): void {
  const content = buildCsvContent(table);
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Generates and downloads a structured executive PDF report in the browser
 * using jsPDF + jspdf-autotable (Section 13), falling back to window.print() if unavailable.
 */
export function downloadPdfReport(input: PdfReportDocumentInput): void {
  try {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const marginX = 40;

    // Header banner
    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(0, 0, pageWidth, 68, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(`OmniSphere — ${input.title}`, marginX, 30);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(203, 213, 225); // slate-300
    doc.text(input.subtitle, marginX, 49);

    // Filter metadata block
    let cursorY = 88;
    doc.setTextColor(51, 65, 85);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Organization:', marginX, cursorY);
    doc.setFont('helvetica', 'normal');
    doc.text(input.organizationLabel, marginX + 70, cursorY);

    doc.setFont('helvetica', 'bold');
    doc.text('Date Range:', pageWidth / 2, cursorY);
    doc.setFont('helvetica', 'normal');
    doc.text(input.dateRangeLabel, pageWidth / 2 + 62, cursorY);

    cursorY += 15;
    doc.setFont('helvetica', 'bold');
    doc.text('Filters:', marginX, cursorY);
    doc.setFont('helvetica', 'normal');
    doc.text(input.filterSummary, marginX + 70, cursorY);

    doc.setFont('helvetica', 'bold');
    doc.text('Generated:', pageWidth / 2, cursorY);
    doc.setFont('helvetica', 'normal');
    doc.text(new Date().toLocaleString(), pageWidth / 2 + 62, cursorY);

    cursorY += 18;

    // KPI Summary Table
    if (input.kpis.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.text('Key Performance Indicators', marginX, cursorY);
      cursorY += 8;

      autoTable(doc, {
        startY: cursorY,
        margin: { left: marginX, right: marginX },
        head: [['Metric', 'Value', 'Context']],
        body: input.kpis.map((k) => [k.label, k.value, k.detail]),
        theme: 'grid',
        headStyles: {
          fillColor: [79, 70, 229], // indigo-600
          textColor: 255,
          fontStyle: 'bold',
          fontSize: 8.5,
        },
        styles: {
          fontSize: 8.5,
          cellPadding: 5,
          textColor: [30, 41, 59],
        },
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 165 },
          1: { halign: 'right', fontStyle: 'bold', cellWidth: 85 },
        },
      });

      const lastTable = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
      cursorY = (lastTable?.finalY ?? cursorY + 80) + 22;
    }

    // Detail Table Sections
    for (const section of input.sections) {
      if (cursorY > doc.internal.pageSize.getHeight() - 120) {
        doc.addPage();
        cursorY = 48;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.text(section.title, marginX, cursorY);
      cursorY += 8;

      const safeBody =
        section.rows.length > 0
          ? section.rows.map((row) =>
              row.map((cell) => (cell === null || cell === undefined ? '—' : String(cell))),
            )
          : [section.headers.map((_, idx) => (idx === 0 ? 'No records in selected filter range' : ''))];

      autoTable(doc, {
        startY: cursorY,
        margin: { left: marginX, right: marginX },
        head: [section.headers],
        body: safeBody,
        theme: 'striped',
        headStyles: {
          fillColor: [30, 41, 59], // slate-800
          textColor: 255,
          fontStyle: 'bold',
          fontSize: 8,
        },
        styles: {
          fontSize: 7.5,
          cellPadding: 4,
          overflow: 'linebreak',
          textColor: [30, 41, 59],
        },
      });

      const lastTable = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
      cursorY = (lastTable?.finalY ?? cursorY + 60) + 20;
    }

    // Page footer on every page
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i += 1) {
      doc.setPage(i);
      const pageHeight = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `OmniSphere Industrial IoT Lifecycle Platform · ${input.organizationLabel}`,
        marginX,
        pageHeight - 22,
      );
      doc.text(`Page ${i} of ${pageCount}`, pageWidth - marginX - 52, pageHeight - 22);
    }

    doc.save(input.filename);
  } catch {
    // Graceful fallback per Section 13
    window.print();
  }
}
