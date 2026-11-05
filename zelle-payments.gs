// Zelle payment matcher. Paste into the SAME Apps Script project as rsvp-sheet.gs (new file),
// pick `setup` in the function dropdown, click Run once and allow Gmail access.
// Every 5 minutes it reads Chase "You received money with Zelle" emails, logs each one in a
// Payments tab, and ticks Paid (column E) for the RSVP rows it can match without guessing.

const PRICE = 15;
const PAYMENTS_SHEET = 'Payments';
const PAYMENTS_HEADER = ['Received', 'Sender', 'Amount', 'Memo', 'Transaction', 'Status', 'Marked paid'];
const ZELLE_QUERY = 'from:no.reply.alerts@chase.com subject:"You received money with Zelle" after:2026/11/04';
const PAID_COL = 5; // E, next to the four columns doPost writes

function setup() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'checkPayments'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('checkPayments').timeBased().everyMinutes(5).create();
  checkPayments();
}

function checkPayments() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const rsvp = ss.getSheetByName('RSVPs');
    let pay = ss.getSheetByName(PAYMENTS_SHEET);
    if (!pay) {
      pay = ss.insertSheet(PAYMENTS_SHEET);
      pay.appendRow(PAYMENTS_HEADER);
      pay.setFrozenRows(1);
    }
    if (!rsvp.getRange(1, PAID_COL).getValue()) rsvp.getRange(1, PAID_COL).setValue('Paid');
    if (!rsvp.getRange('J1').getValue()) rsvp.getRange('J1:K1').setValues([['Total paid', '=COUNTIF(E:E,TRUE)']]);

    // WHY: the transaction number is the idempotency key, so a re-run never logs or counts a payment twice
    const seen = {};
    if (pay.getLastRow() > 1) pay.getRange(2, 5, pay.getLastRow() - 1, 1).getValues().forEach(function (r) { seen[String(r[0])] = true; });

    const n = rsvp.getLastRow();
    const rows = n > 1 ? rsvp.getRange(2, 1, n - 1, PAID_COL).getValues() : [];
    const people = rows.map(function (r, i) {
      return { row: i + 2, name: String(r[0]).replace(/^'/, ''), status: r[1], paid: r[4] === true };
    }).filter(function (p) { return p.status === 'In' && p.name; });

    GmailApp.search(ZELLE_QUERY, 0, 200).forEach(function (thread) {
      thread.getMessages().forEach(function (msg) {
        const z = parseZelle_(msg.getPlainBody());
        if (!z) {
          // WHY: an email the parser can't read still shows up for Parv instead of vanishing
          const key = 'msg:' + msg.getId();
          if (!seen[key]) { seen[key] = true; pay.appendRow([msg.getDate(), '', '', '', key, 'CHECK: could not read this email', '']); }
          return;
        }
        if (seen[z.txn]) return;
        seen[z.txn] = true;
        const m = matchPayment_(z, people);
        m.rows.forEach(function (p) {
          rsvp.getRange(p.row, PAID_COL).insertCheckboxes().setValue(true);
          p.paid = true;
        });
        pay.appendRow([msg.getDate(), z.sender, z.amount, z.memo, z.txn, m.status, m.rows.map(function (p) { return p.name; }).join(', ')]);
      });
    });
  } finally {
    lock.releaseLock();
  }
}

// Pulls sender, amount, memo and transaction number out of a Chase Zelle receipt. Null if any required field is missing.
function parseZelle_(body) {
  body = String(body || '');
  const sender = /([^\n\]]+?)\s+sent you money/.exec(body);
  const amount = /Amount\s*\$\s*([\d,]+(?:\.\d{1,2})?)/.exec(body);
  const txn = /Transaction number\s*(\d+)/.exec(body);
  const memo = /\bMemo\b[ \t:]*([^\n]*)/.exec(body);
  if (!sender || !amount || !txn) return null;
  return {
    sender: sender[1].trim(),
    amount: Number(amount[1].replace(/,/g, '')),
    txn: txn[1],
    memo: memo ? memo[1].trim() : '',
  };
}

// WHY: memos like "diwali party: riya" carry filler words that must not count as names
const MEMO_FILLER = ['diwali', 'party', 'afterparty', 'payment', 'for', 'from', 'me', 'my', 'and', 'paid', 'rsvp'];

// Lowercase name words, without initials ("VINEETH C SAKHAMURU" -> vineeth, sakhamuru) or filler
function tokens_(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z\s]/g, ' ').split(/\s+/)
    .filter(function (w) { return w.length > 1 && MEMO_FILLER.indexOf(w) < 0; });
}

// The unpaid In rows that one name points at:
// a multi-word RSVP name matches when all its words appear ("Saahithi Mallarapu" in "SAAHITHI MALLARAPU");
// a one-word RSVP name matches when that word appears; a one-word memo matches the person with that first name.
// WHY: no surname-blind first-name match, so "RAHUL VERMA" never ticks "Rahul Sharma"
function candidates_(name, people) {
  const t = tokens_(name);
  if (!t.length) return [];
  const open = people.filter(function (p) { return !p.paid; });
  const full = open.filter(function (p) {
    const pt = tokens_(p.name);
    return pt.length > 1 && pt.every(function (w) { return t.indexOf(w) >= 0; });
  });
  if (full.length) return full;
  if (t.length === 1) return open.filter(function (p) { return tokens_(p.name)[0] === t[0]; });
  return open.filter(function (p) {
    const pt = tokens_(p.name);
    return pt.length === 1 && t.indexOf(pt[0]) >= 0;
  });
}

// Verify-or-abstain: ticks rows only when the amount covers exactly the people it names. Anything else is left for Parv.
function matchPayment_(z, people) {
  const count = z.amount / PRICE;
  if (!Number.isInteger(count) || count < 1) return { status: 'CHECK: amount is not a multiple of $' + PRICE, rows: [] };

  const names = z.memo.split(/[,&\/+\n]|\band\b/i).map(function (s) { return s.trim(); }).filter(Boolean);
  const picked = [];
  const ambiguous = [];
  function take(name) {
    const c = candidates_(name, people).filter(function (p) { return picked.indexOf(p) < 0; });
    if (c.length === 1) picked.push(c[0]);
    else if (c.length > 1) ambiguous.push(name);
  }
  if (count === 1) {
    // One person: the memo and the bank name must not point at two different people
    const bySender = candidates_(z.sender, people);
    const byMemo = names.length ? candidates_(names.join(' '), people) : [];
    const pool = bySender.length === 1 ? bySender : byMemo.length === 1 ? byMemo : [];
    if (bySender.length === 1 && byMemo.length === 1 && bySender[0] !== byMemo[0]) return { status: 'CHECK: sender and memo name different people', rows: [] };
    if (pool.length === 1) return { status: 'auto', rows: pool };
    return { status: 'CHECK: no unique RSVP match', rows: [] };
  }
  take(z.sender);
  names.forEach(take);
  if (!ambiguous.length && picked.length === count) return { status: 'auto (' + count + ' people)', rows: picked };
  return { status: 'CHECK: paid for ' + count + ', matched ' + picked.length + (ambiguous.length ? ', unclear: ' + ambiguous.join(', ') : ''), rows: [] };
}
