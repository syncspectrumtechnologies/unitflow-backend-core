function parsePositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.floor(n));
}

function getPagination(req, { defaultPageSize = 25, maxPageSize = 100 } = {}) {
  const pageRaw = req.query.page;
  const pageSizeRaw = req.query.page_size || req.query.pageSize;
  const paginateRaw = req.query.paginate;

  const enabled =
    pageRaw !== undefined ||
    pageSizeRaw !== undefined ||
    paginateRaw === "true" ||
    paginateRaw === "1";

  const page = parsePositiveInt(pageRaw) || 1;
  const page_size = Math.min(maxPageSize, parsePositiveInt(pageSizeRaw) || defaultPageSize);
  const skip = (page - 1) * page_size;
  const take = page_size;
  const include_total = req.query.include_total !== "false";

  return { enabled, page, page_size, skip, take, include_total };
}

function buildPaginationMeta({ page, page_size, total }) {
  const total_pages = page_size > 0 ? Math.ceil(total / page_size) : 0;
  return {
    page,
    page_size,
    total,
    total_pages,
    has_next: page < total_pages,
    has_prev: page > 1
  };
}

module.exports = {
  getPagination,
  buildPaginationMeta
};
