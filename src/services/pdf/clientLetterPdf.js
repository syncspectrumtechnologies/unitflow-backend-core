const PDFDocument = require('pdfkit');

const LETTER_TOP_SPACING = 180;
const LETTER_TEXT_COLOR = '#111111';
const LETTER_ACCENT_COLOR = '#008000';
const LETTER_FONT_SIZE = 13;

function renderTemplate(text, ctx) {
  if (!text) return '';
  return text
    .replace(/\{\{\s*client_name\s*\}\}/gi, ctx.client_name || '')
    .replace(/\{\{\s*client_company\s*\}\}/gi, ctx.client_company || '')
    .replace(/\{\{\s*client_address\s*\}\}/gi, ctx.client_address || '')
    .replace(/\{\{\s*client_city\s*\}\}/gi, ctx.client_city || '')
    .replace(/\{\{\s*client_state\s*\}\}/gi, ctx.client_state || '')
    .replace(/\{\{\s*client_pincode\s*\}\}/gi, ctx.client_pincode || '')
    .replace(/\{\{\s*client_phone\s*\}\}/gi, ctx.client_phone || '')
    .replace(/\{\{\s*client_email\s*\}\}/gi, ctx.client_email || '')
    .replace(/\{\{\s*today\s*\}\}/gi, new Date().toLocaleDateString());
}

function drawLetterHeader(doc, branding, title) {
  doc.fillColor('#ffffff');
  doc.y = LETTER_TOP_SPACING;
}

function joinNonEmpty(parts, separator) {
  return parts.map((part) => String(part || '').trim()).filter(Boolean).join(separator);
}

function buildHighlightTargets(ctx) {
  const rawTargets = [
    { text: String(ctx.client_company || '').trim(), font: 'Helvetica-Bold' },
    { text: joinNonEmpty([ctx.client_address, ctx.client_city], ', '), font: 'Helvetica' },
    { text: joinNonEmpty([ctx.client_address, ctx.client_city], ','), font: 'Helvetica' },
    { text: joinNonEmpty([ctx.client_address, ctx.client_city, ctx.client_state], ', '), font: 'Helvetica' },
    { text: joinNonEmpty([ctx.client_address, ctx.client_city, ctx.client_state], ','), font: 'Helvetica' },
    { text: joinNonEmpty([ctx.client_address, ctx.client_city, ctx.client_state, ctx.client_pincode], ', '), font: 'Helvetica' },
    { text: joinNonEmpty([ctx.client_address, ctx.client_city, ctx.client_state, ctx.client_pincode], ','), font: 'Helvetica' },
    { text: joinNonEmpty([ctx.client_city, ctx.client_state, ctx.client_pincode], ', '), font: 'Helvetica' },
    { text: joinNonEmpty([ctx.client_city, ctx.client_state, ctx.client_pincode], ','), font: 'Helvetica' },
    { text: String(ctx.client_address || '').trim(), font: 'Helvetica' }
  ];

  const seen = new Set();
  return rawTargets
    .filter(({ text }) => text)
    .sort((a, b) => b.text.length - a.text.length)
    .filter(({ text }) => {
      const lookup = text.toLowerCase();
      if (seen.has(lookup)) return false;
      seen.add(lookup);
      return true;
    })
    .map(({ text, font }) => ({ text, lookup: text.toLowerCase(), font }));
}

function buildLineRuns(line, targets) {
  if (!line || !targets.length) {
    return [{ text: line, color: LETTER_TEXT_COLOR, font: 'Helvetica' }];
  }

  const runs = [];
  const lowerLine = line.toLowerCase();
  let cursor = 0;

  while (cursor < line.length) {
    let nextMatch = null;

    targets.forEach((target) => {
      const index = lowerLine.indexOf(target.lookup, cursor);
      if (index === -1) return;
      if (!nextMatch || index < nextMatch.index || (index === nextMatch.index && target.text.length > nextMatch.target.text.length)) {
        nextMatch = { index, target };
      }
    });

    if (!nextMatch) {
      runs.push({ text: line.slice(cursor), color: LETTER_TEXT_COLOR, font: 'Helvetica' });
      break;
    }

    if (nextMatch.index > cursor) {
      runs.push({ text: line.slice(cursor, nextMatch.index), color: LETTER_TEXT_COLOR, font: 'Helvetica' });
    }

    runs.push({
      text: line.slice(nextMatch.index, nextMatch.index + nextMatch.target.text.length),
      color: LETTER_ACCENT_COLOR,
      font: nextMatch.target.font
    });
    cursor = nextMatch.index + nextMatch.target.text.length;
  }

  return runs.filter((run) => run.text);
}

function renderStyledLetterBody(doc, body, ctx) {
  const renderedBody = renderTemplate(body, ctx);
  const lines = renderedBody.split(/\r?\n/);
  const highlightTargets = buildHighlightTargets(ctx);

  lines.forEach((line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      doc.moveDown(1);
      return;
    }

    const runs = buildLineRuns(line, highlightTargets);
    runs.forEach((run, runIndex) => {
      const isLastRun = runIndex === runs.length - 1;
      doc
        .font(run.font)
        .fontSize(LETTER_FONT_SIZE)
        .fillColor(run.color)
        .text(run.text, runIndex === 0 ? { align: 'left', lineGap: 4, continued: !isLastRun } : { continued: !isLastRun });
    });
  });
}

function renderClientLetterPage(doc, { branding, title, body, ctx, includeGeneratedStamp = true }) {
  drawLetterHeader(doc, branding, title);
  renderStyledLetterBody(doc, body, ctx);
}

async function generateClientLetterPdfToStream({ stream, branding, title, body, ctx }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      doc.on('error', reject);
      doc.pipe(stream);
      renderClientLetterPage(doc, { branding, title, body, ctx, includeGeneratedStamp: true });
      doc.end();
      stream.on('finish', resolve);
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = {
  generateClientLetterPdfToStream,
  renderTemplate,
  drawLetterHeader,
  renderClientLetterPage
};
