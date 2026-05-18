const PDFDocument = require('pdfkit');
const prisma = require('../../config/db');
const { Writable } = require('stream');

function safeText(v) {
  return v ? String(v) : '';
}

function buildCityLine(client) {
  return [client.city, client.state, client.pincode].filter(Boolean).join(', ');
}

function measureClientSlipHeight(client, { slipWidth = 288, margins = { top: 18, left: 18, right: 18, bottom: 18 }, heightSafetyPadding = 12 } = {}) {
  const innerW = slipWidth - margins.left - margins.right;
  const measureDoc = new PDFDocument({ size: [slipWidth, 2000], margins });
  measureDoc.pipe(new Writable({ write(_chunk, _enc, cb) { cb(); } }));

  let totalH = margins.top;
  measureDoc.font('Helvetica-Bold').fontSize(16);
  totalH += measureDoc.heightOfString(safeText(client.company_name) || 'X', { width: innerW });
  totalH += 0.6 * measureDoc.currentLineHeight(true);

  measureDoc.font('Helvetica').fontSize(12);
  const addr = safeText(client.address);
  if (addr) totalH += measureDoc.heightOfString(addr, { width: innerW });
  const cityLine = buildCityLine(client);
  if (cityLine) totalH += measureDoc.heightOfString(cityLine, { width: innerW });

  const phone = safeText(client.phone);
  const email = safeText(client.email);
  if (phone || email) totalH += 0.6 * measureDoc.currentLineHeight(true);
  if (phone) totalH += measureDoc.heightOfString(`Phone: ${phone}`, { width: innerW });
  if (email) totalH += measureDoc.heightOfString(`Email: ${email}`, { width: innerW });

  totalH += margins.bottom + heightSafetyPadding;
  measureDoc.end();
  return { totalH, innerW, slipWidth, margins };
}

function renderSlipContent(doc, client, innerW) {
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#111827');
  doc.text(safeText(client.company_name), { width: innerW, align: 'left' });
  doc.moveDown(0.6);
  doc.font('Helvetica').fontSize(12).fillColor('#111827');

  const addr = safeText(client.address);
  if (addr) doc.text(addr, { width: innerW });

  const cityLine = buildCityLine(client);
  if (cityLine) doc.text(cityLine, { width: innerW });

  const phone = safeText(client.phone);
  const email = safeText(client.email);
  if (phone || email) doc.moveDown(0.6);
  if (phone) doc.text(`Phone: ${phone}`, { width: innerW });
  if (email) doc.text(`Email: ${email}`, { width: innerW });
}

function addClientSlipPage(doc, client, opts = {}) {
  const { totalH, innerW, slipWidth, margins } = measureClientSlipHeight(client, opts);
  doc.addPage({ size: [slipWidth, totalH], margins });
  renderSlipContent(doc, client, innerW);
}

async function getClientSlipData(company_id, clientId) {
  const client = await prisma.client.findFirst({
    where: { id: clientId, company_id, is_active: true },
    select: {
      id: true,
      company_name: true,
      address: true,
      city: true,
      state: true,
      pincode: true,
      phone: true,
      email: true
    }
  });

  if (!client) {
    const err = new Error('Client not found');
    err.statusCode = 404;
    throw err;
  }
  return client;
}

async function generateClientSlipPdfToStream({ company_id, clientId, stream }) {
  const client = await getClientSlipData(company_id, clientId);
  const { totalH, slipWidth, margins, innerW } = measureClientSlipHeight(client);
  const doc = new PDFDocument({ size: [slipWidth, totalH], margins, autoFirstPage: true });
  doc.pipe(stream);
  renderSlipContent(doc, client, innerW);
  doc.end();
}

module.exports = {
  generateClientSlipPdfToStream,
  getClientSlipData,
  renderSlipContent,
  measureClientSlipHeight,
  addClientSlipPage
};
