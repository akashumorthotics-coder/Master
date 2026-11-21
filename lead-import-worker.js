/* SheetJS CE is pinned and served from this site. All workbook parsing stays in this worker. */
importScripts('./vendor/sheetjs/xlsx-0.20.3.full.min.js');

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 500;
const MAX_COLUMNS = 64;

function validateZip(buffer) {
  // The XLSX central directory lets us reject oversized archives before decompression.
  const view = new DataView(buffer);
  let end = view.byteLength - 22;
  while (end >= Math.max(0, view.byteLength - 65557)) {
    if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === view.byteLength) break;
    end--;
  }
  if (end < Math.max(0, view.byteLength - 65557)) throw new Error('The XLSX file is damaged.');
  const count = view.getUint16(end + 10, true);
  const limit = view.getUint32(end + 16, true) + view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true), expanded = 0;
  if (!count || count > 1000 || limit > end) throw new Error('This XLSX file has an unsupported archive structure.');
  for (let i = 0; i < count; i++) {
    if (offset + 46 > limit || view.getUint32(offset, true) !== 0x02014b50) throw new Error('The XLSX file is damaged.');
    if (view.getUint16(offset + 8, true) & 1) throw new Error('Upload a workbook without password protection.');
    expanded += view.getUint32(offset + 24, true);
    if (expanded > 25 * 1024 * 1024) throw new Error('The workbook expands beyond 25 MB. Use a smaller file.');
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  if (offset !== limit) throw new Error('The XLSX file is damaged.');
}

function csvText(buffer) {
  const bytes = new Uint8Array(buffer);
  const encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
  let text;
  try { text = new TextDecoder(encoding, {fatal:true}).decode(buffer); }
  catch (_) { throw new Error('Save the CSV as UTF-8 and upload it again.'); }
  if (text.includes('\0')) throw new Error('Upload a valid CSV text file.');
  return text;
}

function cellText(cell, date1904) {
  if (!cell || cell.v === undefined || cell.v === null) return '';
  if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) {
    const date = XLSX.SSF.parse_date_code(cell.v, {date1904});
    if (date) return [date.y, date.m, date.d].map(n => String(n).padStart(2, '0')).join('-');
  }
  return String(cell.v).trim();
}

function readWorkbook(buffer, extension) {
  if (!buffer.byteLength || buffer.byteLength > MAX_BYTES) throw new Error('Choose a file up to 5 MB.');
  if (!['xlsx','xls','csv'].includes(extension)) throw new Error('Choose an XLSX, XLS, or CSV file.');
  const bytes = new Uint8Array(buffer);
  const zip = bytes[0] === 80 && bytes[1] === 75;
  const ole = bytes[0] === 208 && bytes[1] === 207 && bytes[2] === 17 && bytes[3] === 224;
  const biff = bytes[0] === 9 && [0,2,4,8].includes(bytes[1]);
  if (extension === 'xlsx' && !zip) throw new Error('Choose a valid XLSX workbook.');
  if (extension === 'xls' && !ole && !biff) throw new Error('Choose a valid XLS workbook.');
  if (extension === 'xlsx') validateZip(buffer);
  let book;
  try {
    book = XLSX.read(extension === 'csv' ? csvText(buffer) : buffer, {
      type:extension === 'csv' ? 'string' : 'array', raw:extension === 'csv', sheetRows:MAX_ROWS + 2,
      sheets:0, cellNF:true, cellText:false, cellHTML:false
    });
  } catch (e) {
    if (extension === 'csv' && e.message.includes('CSV')) throw e;
    throw new Error('Could not read the first worksheet. Check the file format and any password protection.');
  }
  const sheetName = book.SheetNames[0], sheet = book.Sheets[sheetName];
  if (!sheet?.['!ref']) throw new Error('The first worksheet is empty.');
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const full = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref']);
  if (full.e.c - range.s.c + 1 > MAX_COLUMNS) throw new Error('Keep the import to 64 columns or fewer.');
  if (full.e.r - range.s.r > MAX_ROWS) throw new Error('Keep the first worksheet to 500 data rows or fewer.');
  const date1904 = !!book.Workbook?.WBProps?.date1904;
  const rows = [];
  for (let row = range.s.r; row <= range.e.r; row++) {
    const cells = [];
    for (let col = range.s.c; col <= range.e.c; col++) cells.push(cellText(sheet[XLSX.utils.encode_cell({r:row,c:col})], date1904));
    if (cells.some(Boolean)) rows.push({sourceRow:row + 1,cells});
  }
  if (rows.length < 2) throw new Error('Include a header row followed by at least one data row.');
  return {sheetName, headers:rows.shift().cells, rows};
}

self.onmessage = ({data}) => {
  try {
    if (data.op === 'read') {
      self.postMessage({ok:true, workbook:readWorkbook(data.buffer, data.extension)});
    } else if (data.op === 'write') {
      const book = XLSX.utils.book_new();
      const sheet = XLSX.utils.aoa_to_sheet(data.rows);
      sheet['!cols'] = data.rows[0].map(title => ({wch:Math.min(35, Math.max(14, String(title).length + 4))}));
      XLSX.utils.book_append_sheet(book, sheet, data.sheetName);
      const buffer = XLSX.write(book, {bookType:'xlsx', type:'array', compression:true});
      self.postMessage({ok:true, buffer}, [buffer]);
    }
  } catch (error) { self.postMessage({ok:false, message:error.message || 'The workbook could not be processed.'}); }
};
