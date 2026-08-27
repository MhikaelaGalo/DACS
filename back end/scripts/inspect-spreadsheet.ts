/**
 * Prints the structure of an Excel workbook: sheet names, header rows,
 * a few sample rows, and row counts. Read-only — touches nothing.
 *
 *   npx tsx scripts/inspect-spreadsheet.ts "C:/path/to/file.xlsx"
 */
import ExcelJS from "exceljs";

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: npx tsx scripts/inspect-spreadsheet.ts <file.xlsx>");
  process.exit(1);
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("text" in value) return String(value.text);
    if ("result" in value) return String(value.result ?? "");
    return JSON.stringify(value);
  }
  return String(value);
}

async function main(): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  console.log(`Workbook: ${filePath}`);
  console.log(`Sheets: ${workbook.worksheets.length}\n`);

  for (const sheet of workbook.worksheets) {
    console.log(`=== Sheet "${sheet.name}" ===`);
    console.log(`Rows (incl. header): ${sheet.rowCount}, Columns: ${sheet.columnCount}`);

    const maxPreview = Math.min(sheet.rowCount, 6);
    for (let rowNumber = 1; rowNumber <= maxPreview; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cells.push(`[${colNumber}] ${cellText(cell.value)}`);
      });
      console.log(`  Row ${rowNumber}: ${cells.join(" | ")}`);
    }
    console.log("");
  }
}

main().catch((error) => {
  console.error("Inspection failed:", error);
  process.exit(1);
});
