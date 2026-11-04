// Diwali Afterparty RSVP receiver. Paste into Extensions > Apps Script of the RSVP Google Sheet,
// then Deploy > New deployment > Web app, execute as Me, access Anyone.
// Rows: one per browser (device id), so a guest who changes their answer updates their own row.

const SHEET_NAME = 'RSVPs';
const HEADER = ['Name', 'RSVP', 'Updated', 'Device ID'];

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADER);
    // WHY: totals stay in row 1 so appendRow keeps landing directly under the last RSVP
    sh.getRange('F1:I1').setValues([['Total in', '=COUNTIF(B:B,"In")', 'Total out', '=COUNTIF(B:B,"Out")']]);
    sh.setFrozenRows(1);
  }
  return sh;
}

// WHY: Sheets runs any cell text starting with = + - @ as a formula; a leading quote stores it as plain text
function safe_(s) {
  s = String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const name = safe_(body.name);
    const status = body.status === 'in' ? 'In' : body.status === 'out' ? 'Out' : '';
    const device = String(body.device || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
    if (!name || !status || !device) return json_({ ok: false, error: 'missing name, status or device' });

    const sh = sheet_();
    const row = [name, status, new Date(), device];
    const ids = sh.getLastRow() > 1 ? sh.getRange(2, 4, sh.getLastRow() - 1, 1).getValues() : [];
    for (let i = 0; i < ids.length; i++) {
      if (ids[i][0] === device) {
        sh.getRange(i + 2, 1, 1, 4).setValues([row]);
        return json_({ ok: true, updated: true });
      }
    }
    sh.appendRow(row);
    return json_({ ok: true, updated: false });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  sheet_();
  return json_({ ok: true });
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
