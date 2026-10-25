// The chapter's money, for the Financial Secretary and the Treasurer working on
// their own, before the rest of the app is in people's hands:
//   - the books the chapter already keeps, brought into the ledger from a CSV
//     file (lib/booksImport.js), by whoever keeps the ledger;
//   - each Sunday's offering, counted and filed by the Treasurer with a photo,
//     and recorded by the Financial Secretary like any other filing;
//   - the Sundays side by side: how many were checked in, and what was given.
//
// The split server.js keeps for every movement of money stays: the Treasurer
// files, the Financial Secretary records. Nothing here lets the person holding
// the money write it into the books.
const multer = require('multer');
const csvTable = require('../lib/csvTable');
const booksImport = require('../lib/booksImport');
const { rejectOperatorKeys } = require('../lib/requestGuard');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SERVICES = { sunday: 'Sunday', midweek: 'Midweek', special: 'Special programme' };
const MAX_OFFERING = 1000000;

const TEMPLATE = [
  'Date,Details,Category,Money in,Money out,How,Who,Reference',
  '06/09/2026,Sunday offering,Offertory,"1,250.00",,Cash,Congregation,',
  '08/09/2026,Transport for evangelism,Outreach,,200.00,MoMo,Driver,MP2609081234',
  '13/09/2026,Harvest,Harvest,500.00,,Cash,,'
].join('\r\n') + '\r\n';

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: csvTable.MAX_BYTES + 1, files: 1 }
});

function registerBooksRoutes(app, deps) {
  const { repo, requireRole, requireCapability, CAP, upload, gridfs, compressIfImage, actorName, cleanText } = deps;

  const takeFile = (req, res, next) => csvUpload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'That file is larger than 1 MB. Books saved as CSV are far smaller, so check it is the right file.' });
    return res.status(400).json({ error: 'Could not read that upload. Choose the file again.' });
  });

  // ---------- the books the chapter already keeps ----------
  // Three steps, one route, the file sent with each (as for Shepherding's list):
  // 'read' guesses the columns, 'check' says what would happen, 'import' does it.
  app.post('/api/executive/finance/import', requireRole('executive'), takeFile, rejectOperatorKeys,
    requireCapability(CAP.FINANCE_LEDGER, async (req, res, { staff }) => {
      if (!req.file) return res.status(400).json({ error: 'Choose the CSV file with your books.' });
      const step = ['read', 'check', 'import'].includes(req.body.step) ? req.body.step : 'read';
      const file = csvTable.readFile(req.file.buffer, { hasHeader: req.body.hasHeader !== '0' });
      if (file.error) return res.status(400).json({ error: file.error });
      if (!file.rows.length) return res.status(400).json({ error: 'There is nothing in that file but the headings.' });

      if (step === 'read') {
        const mapping = booksImport.guessMapping(file.headers);
        return res.json({
          fields: booksImport.FIELDS,
          rowCount: file.rows.length,
          columns: file.headers.map((heading, i) => ({
            index: i, heading, field: mapping[i],
            samples: file.rows.map(r => r.cells[i]).filter(Boolean).slice(0, 3)
          }))
        });
      }

      const mapping = booksImport.cleanMapping(req.body.mapping, file.headers.length) || booksImport.guessMapping(file.headers);
      if (!mapping.includes('date')) return res.status(400).json({ error: 'Choose which column holds the date.' });
      if (!['amount', 'amountIn', 'amountOut'].some(f => mapping.includes(f))) {
        return res.status(400).json({ error: 'Choose which column holds the amount, or which hold money in and money out.' });
      }
      const existing = await repo.getAll('financeEntries', { chapterId: staff.chapterId });
      const { plan, counts, totals, from, to } = booksImport.planImport(file, mapping, { existing });
      const view = (p) => ({ row: p.row, action: p.action, reason: p.reason || '', warnings: p.warnings, ...(p.entry || {}) });
      const summary = {
        rowCount: file.rows.length, counts, totals, from, to,
        adding: plan.filter(p => p.action === 'add').slice(0, 8).map(view),
        notAdding: plan.filter(p => p.action !== 'add').slice(0, 500).map(view),
        warnings: plan.filter(p => p.warnings.length).slice(0, 200).map(view)
      };
      if (step === 'check') return res.json(summary);

      // Numbered within the batch, as hundreds are made in one go.
      const batch = repo.genId('fin');
      const by = `${actorName(req)} (from the books kept before)`;
      let added = 0;
      for (const [i, p] of plan.entries()) {
        if (p.action !== 'add') continue;
        await repo.create('financeEntries', {
          ...p.entry, id: `${batch}_${i}`, chapterId: staff.chapterId,
          source: 'finance', approvalStatus: 'recorded', recordedBy: by, origin: 'import'
        });
        added++;
      }
      res.json({ ...summary, done: { added } });
    }));

  app.get('/api/executive/finance/import/template.csv', requireRole('executive'),
    requireCapability(CAP.FINANCE_LEDGER, async (req, res) => {
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', 'attachment; filename="aconsu-books.csv"');
      res.send(TEMPLATE);
    }));

  // ---------- a Sunday's offering ----------
  // Counted after service, filed by the Treasurer with a photo of the count,
  // and waiting for the Financial Secretary like any other filing. One per
  // service: a second would be the same money twice. If the first was wrong,
  // the Financial Secretary sends it back and it is filed again.
  app.post('/api/executive/treasury/offering', requireRole('executive'), upload.single('photo'),
    requireCapability(CAP.TREASURY_REPORT, async (req, res, { staff }) => {
      const date = String(req.body.date || '');
      if (!DATE.test(date)) return res.status(400).json({ error: 'Choose the date of the service.' });
      if (date > new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: 'That service has not happened yet.' });
      const serviceType = SERVICES[req.body.serviceType] ? req.body.serviceType : 'sunday';
      const amount = Math.round(Number(req.body.amount) * 100) / 100;
      if (!amount || amount <= 0) return res.status(400).json({ error: 'Type the amount counted.' });
      if (amount > MAX_OFFERING) return res.status(400).json({ error: 'That amount looks too large to be right. Check it.' });
      if (!req.file) return res.status(400).json({ error: 'Add a photo of the count (the counted money or the count sheet). An offering without it cannot be recorded.' });

      const filed = await repo.getAll('financeEntries', { chapterId: staff.chapterId, category: 'offertory', serviceDate: date, serviceType });
      const standing = filed.find(e => e.approvalStatus !== 'rejected');
      if (standing) {
        return res.status(409).json({
          error: `The offering for this service is already filed (GHS ${standing.amount.toFixed(2)}, ${standing.approvalStatus === 'recorded' ? 'recorded' : 'waiting on the Financial Secretary'}). If it was wrong, ask them to send it back, then file it again.`
        });
      }

      const compressed = await compressIfImage(req.file.buffer, req.file.mimetype);
      const receiptFileId = String(await gridfs.uploadBuffer(compressed.buffer, req.file.originalname, {
        category: 'receipt', placement: 'treasury', contentType: compressed.contentType,
        title: `Offering ${date}`, chapterId: staff.chapterId
      }));
      const countedWith = cleanText(req.body.countedWith || '').slice(0, 120);
      const note = cleanText(req.body.note || '').slice(0, 300);
      const item = await repo.create('financeEntries', {
        chapterId: staff.chapterId,
        entryType: 'income', category: 'offertory', amount, date,
        serviceDate: date, serviceType,
        description: [`${SERVICES[serviceType]} offering`, countedWith && `counted with ${countedWith}`, note].filter(Boolean).join('. '),
        method: ['cash', 'momo', 'bank', 'other'].includes(req.body.method) ? req.body.method : 'cash',
        reference: '', payee: '',
        receiptFileId,
        source: 'treasury', filedBy: staff.name || '',
        approvalStatus: 'pending', recordedBy: ''
      }, 'fin');
      res.json({ success: true, item });
    }));

  // ---------- the Sundays, side by side ----------
  // For each recent service: how many were checked in (and walked in) at the
  // door, and the offering, recorded or still waiting. Counts only: who came is
  // Shepherding's, not the books'.
  app.get('/api/executive/finance/sundays', requireRole('executive'),
    requireCapability(CAP.FINANCE_SUMMARY, async (req, res, { staff }) => {
      const chapterId = staff.chapterId;
      const [registers, offerings] = await Promise.all([
        repo.getAll('attendanceRecords', { chapterId }),
        repo.getAll('financeEntries', { chapterId, category: 'offertory', entryType: 'income' })
      ]);
      const services = new Map();
      const at = (date, serviceType) => {
        const key = `${date}|${serviceType}`;
        if (!services.has(key)) services.set(key, { date, serviceType, attendance: null, recorded: 0, waiting: 0, sentBack: 0 });
        return services.get(key);
      };
      registers.forEach((r) => {
        at(r.date, r.serviceType).attendance = r.marks.filter(m => m.status === 'present').length + (r.visitorCount || 0);
      });
      offerings.forEach((e) => {
        // An offering written into the books without naming its service (the
        // books brought in, or entered by hand) belongs to that day's Sunday
        // service.
        const s = at(e.serviceDate || e.date, e.serviceType || 'sunday');
        if (e.approvalStatus === 'recorded') s.recorded += Number(e.amount) || 0;
        else if (e.approvalStatus === 'pending') s.waiting += Number(e.amount) || 0;
        else if (e.approvalStatus === 'rejected') s.sentBack++;
      });
      const list = [...services.values()]
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.serviceType.localeCompare(b.serviceType)))
        .slice(0, 12)
        .map(s => ({ ...s, label: SERVICES[s.serviceType] || s.serviceType, recorded: Math.round(s.recorded * 100) / 100, waiting: Math.round(s.waiting * 100) / 100 }));
      res.json(list);
    }));
}

module.exports = { registerBooksRoutes };
