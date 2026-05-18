
function parseDateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function formatFiscalYearLabel(startYear) {
  const endYearShort = String(startYear + 1).slice(-2);
  return `${startYear}-${endYearShort}`;
}

function normalizeFiscalYearLabel(input) {
  const startYear = parseFiscalYearStartYear(input);
  if (startYear === null) return null;
  return formatFiscalYearLabel(startYear);
}

function parseFiscalYearStartYear(input) {
  if (!input) return null;
  const raw = String(input).trim();

  let m = raw.match(/^(\d{4})$/);
  if (m) return Number(m[1]);

  m = raw.match(/^(\d{4})\s*[-/]\s*(\d{2})$/);
  if (m) return Number(m[1]);

  m = raw.match(/^(\d{4})\s*[-/]\s*(\d{4})$/);
  if (m) return Number(m[1]);

  m = raw.match(/^FY\s*(\d{4})$/i);
  if (m) return Number(m[1]);

  m = raw.match(/^FY\s*(\d{4})\s*[-/]\s*(\d{2,4})$/i);
  if (m) return Number(m[1]);

  return null;
}

function getIndiaFiscalYearRange(startYear) {
  const start = new Date(Date.UTC(startYear, 3, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(startYear + 1, 2, 31, 23, 59, 59, 999));
  return { start, end, fiscal_year: formatFiscalYearLabel(startYear) };
}

function parseMonthKey(input) {
  if (!input) return null;
  const raw = String(input).trim();
  const match = raw.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month, month_key: `${year}-${String(month).padStart(2, '0')}` };
}

function getCalendarMonthRange(input) {
  const parsed = typeof input === 'string' ? parseMonthKey(input) : input;
  if (!parsed) return null;
  const start = new Date(Date.UTC(parsed.year, parsed.month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(parsed.year, parsed.month, 0, 23, 59, 59, 999));
  return {
    start,
    end,
    month_key: parsed.month_key,
    year: parsed.year,
    month: parsed.month
  };
}


function getCurrentIndiaFiscalYearBoundaryDate(now = new Date()) {
  const d = new Date(now);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const fiscalStartYear = month >= 3 ? year : year - 1;
  const fiscalStart = new Date(Date.UTC(fiscalStartYear, 3, 1, 0, 0, 0, 0));
  return new Date(fiscalStart.getTime() - 1);
}

function getCurrentIndiaFiscalYearLabel(now = new Date()) {
  const d = new Date(now);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const fiscalStartYear = month >= 3 ? year : year - 1;
  return formatFiscalYearLabel(fiscalStartYear);
}

function getFiscalYearLabelForMonthKey(input) {
  const parsed = parseMonthKey(input);
  if (!parsed) return null;
  return formatFiscalYearLabel(parsed.month >= 4 ? parsed.year : parsed.year - 1);
}

function resolveDateRangeFromQuery(query = {}) {
  const explicitFrom = parseDateOrNull(query.date_from);
  const explicitTo = parseDateOrNull(query.date_to);

  if (explicitFrom || explicitTo) {
    return {
      date_from: explicitFrom ? startOfDay(explicitFrom) : null,
      date_to: explicitTo ? endOfDay(explicitTo) : null,
      fiscal_year: null,
      source: 'EXPLICIT_RANGE'
    };
  }

  const rawFiscalYear = query.fiscal_year || query.fy || query.financial_year || null;
  const startYear = parseFiscalYearStartYear(rawFiscalYear);
  if (startYear !== null) {
    const range = getIndiaFiscalYearRange(startYear);
    return {
      date_from: range.start,
      date_to: range.end,
      fiscal_year: range.fiscal_year,
      source: 'FISCAL_YEAR'
    };
  }

  return {
    date_from: null,
    date_to: null,
    fiscal_year: null,
    source: 'NONE'
  };
}

module.exports = {
  parseDateOrNull,
  resolveDateRangeFromQuery,
  getIndiaFiscalYearRange,
  formatFiscalYearLabel,
  normalizeFiscalYearLabel,
  parseMonthKey,
  getCalendarMonthRange,
  getCurrentIndiaFiscalYearBoundaryDate,
  getCurrentIndiaFiscalYearLabel,
  getFiscalYearLabelForMonthKey
};
