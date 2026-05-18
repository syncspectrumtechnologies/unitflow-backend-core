process.env.ALLOW_DIRECT_CORE_LOGIN = process.env.ALLOW_DIRECT_CORE_LOGIN || "true";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "4h";
process.env.JWT_REFRESH_THRESHOLD_SECONDS = process.env.JWT_REFRESH_THRESHOLD_SECONDS || "14400";
process.env.NODE_ENV = process.env.NODE_ENV || "test";

const assert = require("assert");
const prisma = require("../src/config/db");
const app = require("../src/app");
const { hashPassword } = require("../src/utils/password");

function decodeJwt(token) {
  const payload = token.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

function todayIso() {
  return new Date().toISOString();
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function monthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function isoForMonthDay(day, hour = 10, minute = 0, second = 0) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, hour, minute, second)).toISOString();
}

function dayKeyForMonthDay(day) {
  return isoForMonthDay(day).slice(0, 10);
}

function approxFourHours(decoded) {
  const ttl = Number(decoded.exp) - Number(decoded.iat);
  return ttl >= 14390 && ttl <= 14410;
}

async function startServer(port) {
  const server = app.listen(port, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return server;
}

async function stopServer(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
}

async function request(baseUrl, path, { method = "GET", token = null, factoryId = null, body = undefined, expectPdf = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (factoryId) headers["X-Factory-Id"] = factoryId;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(baseUrl + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  if (expectPdf) {
    const buffer = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, buffer };
  }

  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (_err) {
      json = null;
    }
  }
  return { status: res.status, headers: res.headers, json, text };
}

async function cleanupCompany(companyId) {
  if (!companyId) return;
  const where = { company_id: companyId };
  await prisma.broadcastRecipient.deleteMany({ where });
  await prisma.broadcastMessage.deleteMany({ where });
  await prisma.chatMessage.deleteMany({ where });
  await prisma.conversationMember.deleteMany({ where });
  await prisma.conversation.deleteMany({ where });
  await prisma.paymentAllocation.deleteMany({ where });
  await prisma.invoiceStatusHistory.deleteMany({ where });
  await prisma.invoiceCharge.deleteMany({ where });
  await prisma.invoiceItem.deleteMany({ where });
  await prisma.invoice.deleteMany({ where });
  await prisma.orderStatusHistory.deleteMany({ where });
  await prisma.orderFulfillment.deleteMany({ where });
  await prisma.orderCharge.deleteMany({ where });
  await prisma.orderItem.deleteMany({ where });
  await prisma.order.deleteMany({ where });
  await prisma.inventoryMovement.deleteMany({ where });
  await prisma.stockSnapshot.deleteMany({ where });
  await prisma.stockBalance.deleteMany({ where });
  await prisma.clientProduct.deleteMany({ where });
  await prisma.clientCategory.deleteMany({ where });
  await prisma.clientContact.deleteMany({ where });
  await prisma.activityLog.deleteMany({ where });
  await prisma.userSession.deleteMany({ where });
  await prisma.passwordResetOtp.deleteMany({ where });
  await prisma.userFactoryMap.deleteMany({ where });
  await prisma.userPermissionMap.deleteMany({ where });
  await prisma.userRoleMap.deleteMany({ where });
  await prisma.numberSequence.deleteMany({ where });
  await prisma.salesCompany.deleteMany({ where });
  await prisma.client.deleteMany({ where });
  await prisma.product.deleteMany({ where });
  await prisma.productCategory.deleteMany({ where });
  await prisma.factory.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.company.deleteMany({ where: { id: companyId } });
}

(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const port = 4310 + Math.floor(Math.random() * 200);
  const baseUrl = `http://127.0.0.1:${port}`;
  const password = "UnitflowE2E!234";
  let companyId = null;
  let server = null;

  try {
    const company = await prisma.company.create({
      data: {
        name: `UnitFlow E2E ${suffix}`,
        legal_name: `UnitFlow E2E ${suffix}`,
        is_active: true
      }
    });
    companyId = company.id;

    const passwordHash = await hashPassword(password);
    const factoryOne = await prisma.factory.create({ data: { company_id: company.id, name: `Factory A ${suffix}`, is_active: true } });
    const factoryTwo = await prisma.factory.create({ data: { company_id: company.id, name: `Factory B ${suffix}`, is_active: true } });
    const category = await prisma.productCategory.create({ data: { company_id: company.id, name: `Category ${suffix}`, is_active: true } });
    const product = await prisma.product.create({ data: { company_id: company.id, category_id: category.id, name: `Product ${suffix}`, unit: "PCS", price: 2.5, is_active: true } });
    const reportProduct = await prisma.product.create({ data: { company_id: company.id, category_id: category.id, name: `Report Product ${suffix}`, unit: "PCS", price: 3.75, is_active: true } });
    const client = await prisma.client.create({ data: { company_id: company.id, company_name: `Client ${suffix}`, opening_balance_type: "DEBIT", is_active: true } });
    const salesCompany = await prisma.salesCompany.create({ data: { company_id: company.id, name: `Sales ${suffix}`, is_active: true } });
    await prisma.user.create({
      data: {
        company_id: company.id,
        email: `admin-${suffix}@example.com`,
        name: `Admin ${suffix}`,
        password_hash: passwordHash,
        is_admin: true,
        status: "ACTIVE"
      }
    });

    server = await startServer(port);

    const login = await request(baseUrl, "/auth/login", {
      method: "POST",
      body: { email: `admin-${suffix}@example.com`, password, company_id: company.id }
    });
    assert.strictEqual(login.status, 200, `login failed: ${login.text}`);
    assert.ok(login.json?.token, "login token missing");
    assert.strictEqual(login.json?.expires_in, "4h");

    const loginDecoded = decodeJwt(login.json.token);
    assert.ok(approxFourHours(loginDecoded), `expected 4h token ttl, got ${loginDecoded.exp - loginDecoded.iat}`);

    const me = await request(baseUrl, "/auth/me", { token: login.json.token });
    assert.strictEqual(me.status, 200, `auth/me failed: ${me.text}`);
    const autoRefreshedToken = me.headers.get("x-access-token");
    assert.ok(autoRefreshedToken, "auto refresh token header missing");
    assert.notStrictEqual(autoRefreshedToken, login.json.token, "auto refresh should mint a fresh JWT");
    assert.strictEqual(decodeJwt(autoRefreshedToken).jti, loginDecoded.jti, "refresh should preserve session jti");

    const refresh = await request(baseUrl, "/auth/refresh", { method: "POST", token: autoRefreshedToken, body: {} });
    assert.strictEqual(refresh.status, 200, `auth/refresh failed: ${refresh.text}`);
    const activeToken = refresh.json?.token;
    assert.ok(activeToken, "explicit refresh token missing");
    const activeDecoded = decodeJwt(activeToken);
    const autoRefreshDecoded = decodeJwt(autoRefreshedToken);
    assert.strictEqual(activeDecoded.jti, loginDecoded.jti, "explicit refresh should preserve session jti");
    assert.ok(Number(activeDecoded.exp) >= Number(autoRefreshDecoded.exp), "explicit refresh should not shorten token expiry");

    const reportDay9 = isoForMonthDay(9);
    const reportDay10 = isoForMonthDay(10);
    const reportDay11 = isoForMonthDay(11);
    const reportDay12 = isoForMonthDay(12);
    const reportDay13 = isoForMonthDay(13);
    const reportDay14 = isoForMonthDay(14);
    const reportDay12AsOf = isoForMonthDay(12, 23, 59, 59);
    const reportFrom = dayKeyForMonthDay(10);
    const reportTo = dayKeyForMonthDay(14);

    const openingOne = await request(baseUrl, "/inventory/opening-stock", {
      method: "POST",
      token: activeToken,
      factoryId: factoryOne.id,
      body: { product_id: product.id, quantity: 20, date: todayIso(), remarks: "E2E opening A" }
    });
    assert.strictEqual(openingOne.status, 201, `opening stock A failed: ${openingOne.text}`);

    const openingTwo = await request(baseUrl, "/inventory/opening-stock", {
      method: "POST",
      token: activeToken,
      factoryId: factoryTwo.id,
      body: { product_id: product.id, quantity: 10, date: todayIso(), remarks: "E2E opening B" }
    });
    assert.strictEqual(openingTwo.status, 201, `opening stock B failed: ${openingTwo.text}`);

    const stockInitial = await request(baseUrl, `/inventory/stock?factory_id=all&product_id=${product.id}`, { token: activeToken });
    assert.strictEqual(stockInitial.status, 200, `initial stock failed: ${stockInitial.text}`);
    assert.strictEqual(Number(stockInitial.json?.rows?.[0]?.stock_qty || 0), 30);

    const orderCreate = await request(baseUrl, "/orders", {
      method: "POST",
      token: activeToken,
      factoryId: factoryOne.id,
      body: {
        client_id: client.id,
        sales_company_id: salesCompany.id,
        order_date: todayIso(),
        items: [{ product_id: product.id, quantity: 12, unit_price: 2.5 }],
        charges: []
      }
    });
    assert.strictEqual(orderCreate.status, 201, `order create failed: ${orderCreate.text}`);
    const orderId = orderCreate.json.id;

    const dispatch = await request(baseUrl, `/orders/${orderId}/status`, {
      method: "PUT",
      token: activeToken,
      factoryId: factoryOne.id,
      body: {
        status: "DISPATCHED",
        allocations: [
          { product_id: product.id, factory_id: factoryOne.id, quantity: 7 },
          { product_id: product.id, factory_id: factoryTwo.id, quantity: 5 }
        ]
      }
    });
    assert.strictEqual(dispatch.status, 200, `dispatch failed: ${dispatch.text}`);
    assert.strictEqual(dispatch.json.status, "DISPATCHED");

    const orderAfterDispatch = await request(baseUrl, `/orders/${orderId}`, { token: activeToken, factoryId: factoryOne.id });
    assert.strictEqual(orderAfterDispatch.status, 200, `order fetch after dispatch failed: ${orderAfterDispatch.text}`);
    assert.strictEqual(orderAfterDispatch.json.fulfillments.length, 2);

    const stockFactoryOne = await request(baseUrl, `/inventory/stock?factory_id=${factoryOne.id}&product_id=${product.id}&include_totals=true`, { token: activeToken });
    const stockFactoryTwo = await request(baseUrl, `/inventory/stock?factory_id=${factoryTwo.id}&product_id=${product.id}&include_totals=true`, { token: activeToken });
    assert.strictEqual(Number(stockFactoryOne.json?.stock_qty || 0), 13);
    assert.strictEqual(Number(stockFactoryTwo.json?.stock_qty || 0), 5);

    const cancel = await request(baseUrl, `/orders/${orderId}/cancel`, {
      method: "PUT",
      token: activeToken,
      factoryId: factoryOne.id,
      body: { note: "E2E cancel" }
    });
    assert.strictEqual(cancel.status, 200, `cancel failed: ${cancel.text}`);
    assert.strictEqual(cancel.json.status, "CANCELLED");

    const stockAfterCancel = await request(baseUrl, `/inventory/stock?factory_id=all&product_id=${product.id}&include_totals=true`, { token: activeToken });
    assert.strictEqual(stockAfterCancel.status, 200, `stock after cancel failed: ${stockAfterCancel.text}`);
    assert.strictEqual(Number(stockAfterCancel.json?.stock_qty || 0), 30);

    const reportOpeningOne = await request(baseUrl, "/inventory/opening-stock", {
      method: "POST",
      token: activeToken,
      factoryId: factoryOne.id,
      body: { product_id: reportProduct.id, quantity: 50, date: reportDay9, remarks: "Report opening A" }
    });
    assert.strictEqual(reportOpeningOne.status, 201, `report opening stock A failed: ${reportOpeningOne.text}`);

    const reportOpeningTwo = await request(baseUrl, "/inventory/opening-stock", {
      method: "POST",
      token: activeToken,
      factoryId: factoryTwo.id,
      body: { product_id: reportProduct.id, quantity: 10, date: reportDay9, remarks: "Report opening B" }
    });
    assert.strictEqual(reportOpeningTwo.status, 201, `report opening stock B failed: ${reportOpeningTwo.text}`);

    const reportInOne = await request(baseUrl, "/inventory/movements/in", {
      method: "POST",
      token: activeToken,
      factoryId: factoryOne.id,
      body: { product_id: reportProduct.id, quantity: 5, date: reportDay10, remarks: "Report in A" }
    });
    assert.strictEqual(reportInOne.status, 201, `report in movement failed: ${reportInOne.text}`);

    const reportOutOne = await request(baseUrl, "/inventory/movements/out", {
      method: "POST",
      token: activeToken,
      factoryId: factoryTwo.id,
      body: { product_id: reportProduct.id, quantity: 3, date: reportDay11, remarks: "Report out B" }
    });
    assert.strictEqual(reportOutOne.status, 201, `report out movement failed: ${reportOutOne.text}`);

    const reportDeleteOne = await request(baseUrl, "/inventory/movements/delete", {
      method: "POST",
      token: activeToken,
      factoryId: factoryOne.id,
      body: { product_id: reportProduct.id, quantity: 2, date: reportDay12, remarks: "Report delete A" }
    });
    assert.strictEqual(reportDeleteOne.status, 201, `report delete movement failed: ${reportDeleteOne.text}`);

    const reportAdjustment = await request(baseUrl, "/inventory/movements/adjustment", {
      method: "POST",
      token: activeToken,
      factoryId: factoryOne.id,
      body: { product_id: reportProduct.id, quantity: -1, date: reportDay13, remarks: "Report adjustment A" }
    });
    assert.strictEqual(reportAdjustment.status, 201, `report adjustment failed: ${reportAdjustment.text}`);

    const reportInTwo = await request(baseUrl, "/inventory/movements/in", {
      method: "POST",
      token: activeToken,
      factoryId: factoryTwo.id,
      body: { product_id: reportProduct.id, quantity: 4, date: reportDay14, remarks: "Report in B" }
    });
    assert.strictEqual(reportInTwo.status, 201, `report second in movement failed: ${reportInTwo.text}`);

    const reportCurrentStock = await request(baseUrl, `/inventory/stock?factory_id=all&product_id=${reportProduct.id}&include_totals=true`, { token: activeToken });
    assert.strictEqual(reportCurrentStock.status, 200, `report current stock failed: ${reportCurrentStock.text}`);
    assert.strictEqual(Number(reportCurrentStock.json?.stock_qty || 0), 63);

    const deleteMovement = await request(baseUrl, "/inventory/movements/delete", {
      method: "POST",
      token: activeToken,
      factoryId: factoryOne.id,
      body: { product_id: product.id, quantity: 2, date: todayIso(), remarks: "E2E delete" }
    });
    assert.strictEqual(deleteMovement.status, 201, `manual delete failed: ${deleteMovement.text}`);

    const summary = await request(baseUrl, `/inventory/stock-summary?factory_id=all&product_id=${product.id}&month_key=${monthKey()}`, { token: activeToken });
    assert.strictEqual(summary.status, 200, `stock summary failed: ${summary.text}`);
    assert.strictEqual(Number(summary.json?.stock_qty || 0), 28);
    assert.ok(Array.isArray(summary.json?.daily_breakdown?.rows), "daily breakdown missing");
    const todayRow = summary.json.daily_breakdown.rows.find((row) => row.date === todayKey());
    assert.ok(todayRow, "today row missing from daily breakdown");
    assert.strictEqual(Number(todayRow.delete_qty || 0), 2);
    assert.strictEqual(Number(todayRow.closing_qty || 0), 28);

    const movements = await request(baseUrl, `/inventory/movements?factory_id=all&product_id=${product.id}&month_key=${monthKey()}&page=1&page_size=100`, { token: activeToken });
    assert.strictEqual(movements.status, 200, `movements failed: ${movements.text}`);
    assert.strictEqual(movements.json.month_key, monthKey());
    const movementTypes = new Set((movements.json.items || []).map((row) => `${row.type}:${row.source_type}`));
    assert.ok(movementTypes.has("IN:OPENING"), "opening movement missing");
    assert.ok(movementTypes.has("OUT:ORDER"), "dispatch movement missing");
    assert.ok(movementTypes.has("DELETE:MANUAL"), "delete movement missing");
    assert.ok(movementTypes.has("IN:RETURN"), "cancel return movement missing");

    const summaryPdf = await request(baseUrl, `/inventory/stock-summary/pdf?factory_id=all&product_id=${product.id}&date_from=${todayKey()}&date_to=${todayKey()}`, { token: activeToken, expectPdf: true });
    assert.strictEqual(summaryPdf.status, 200, "stock summary pdf failed");
    assert.ok((summaryPdf.headers.get("content-type") || "").includes("pdf"), "stock summary pdf content type mismatch");
    assert.ok(summaryPdf.buffer.length > 500, "stock summary pdf too small");

    const monthlyPdf = await request(baseUrl, `/inventory/stock-summary/${product.id}/monthly.pdf?factory_id=all&month_key=${monthKey()}`, { token: activeToken, expectPdf: true });
    assert.strictEqual(monthlyPdf.status, 200, "monthly inventory pdf failed");
    assert.ok((monthlyPdf.headers.get("content-type") || "").includes("pdf"), "monthly pdf content type mismatch");
    assert.ok(monthlyPdf.buffer.length > 500, "monthly pdf too small");

    const reportTotals = await request(baseUrl, `/inventory/stock?factory_id=all&product_id=${reportProduct.id}&include_totals=true&date_from=${reportFrom}&date_to=${reportTo}`, { token: activeToken });
    assert.strictEqual(reportTotals.status, 200, `report totals failed: ${reportTotals.text}`);
    assert.strictEqual(Number(reportTotals.json?.opening_qty || 0), 60);
    assert.strictEqual(Number(reportTotals.json?.movement_totals?.in_qty || 0), 9);
    assert.strictEqual(Number(reportTotals.json?.movement_totals?.out_qty || 0), 3);
    assert.strictEqual(Number(reportTotals.json?.movement_totals?.delete_qty || 0), 2);
    assert.strictEqual(Number(reportTotals.json?.movement_totals?.adjustment_qty || 0), -1);
    assert.strictEqual(Number(reportTotals.json?.movement_qty || 0), 3);
    assert.strictEqual(Number(reportTotals.json?.closing_qty || 0), 63);
    assert.strictEqual(Number(reportTotals.json?.stock_qty || 0), 63);

    const reportList = await request(baseUrl, `/inventory/stock?factory_id=all&product_id=${reportProduct.id}&date_from=${reportFrom}&date_to=${reportTo}`, { token: activeToken });
    assert.strictEqual(reportList.status, 200, `report list failed: ${reportList.text}`);
    const reportListRow = (reportList.json?.rows || []).find((row) => row.product?.id === reportProduct.id);
    assert.ok(reportListRow, "report product row missing from stock list");
    assert.strictEqual(Number(reportListRow.opening_qty || 0), 60);
    assert.strictEqual(Number(reportListRow.in_qty || 0), 9);
    assert.strictEqual(Number(reportListRow.out_qty || 0), 3);
    assert.strictEqual(Number(reportListRow.delete_qty || 0), 2);
    assert.strictEqual(Number(reportListRow.adjustment_qty || 0), -1);
    assert.strictEqual(Number(reportListRow.closing_qty || 0), 63);

    const reportSummary = await request(baseUrl, `/inventory/stock-summary?factory_id=all&product_id=${reportProduct.id}&date_from=${reportFrom}&date_to=${reportTo}`, { token: activeToken });
    assert.strictEqual(reportSummary.status, 200, `report summary failed: ${reportSummary.text}`);
    assert.strictEqual(Number(reportSummary.json?.opening_qty || 0), 60);
    assert.strictEqual(Number(reportSummary.json?.stock_qty || 0), 63);
    assert.strictEqual(Number(reportSummary.json?.movement_totals?.delete_qty || 0), 2);
    assert.ok(reportSummary.json?.daily_breakdown && Array.isArray(reportSummary.json.daily_breakdown.rows), "daily breakdown missing from report summary");
    assert.strictEqual(Number(reportSummary.json?.daily_breakdown?.count || 0), 5);
    const reportDay10Row = reportSummary.json.daily_breakdown.rows.find((row) => row.date === reportFrom);
    const reportDay11Row = reportSummary.json.daily_breakdown.rows.find((row) => row.date === dayKeyForMonthDay(11));
    const reportDay12Row = reportSummary.json.daily_breakdown.rows.find((row) => row.date === dayKeyForMonthDay(12));
    const reportDay13Row = reportSummary.json.daily_breakdown.rows.find((row) => row.date === dayKeyForMonthDay(13));
    const reportDay14Row = reportSummary.json.daily_breakdown.rows.find((row) => row.date === reportTo);
    assert.ok(reportDay10Row, "day 10 row missing from daily breakdown");
    assert.ok(reportDay11Row, "day 11 row missing from daily breakdown");
    assert.ok(reportDay12Row, "day 12 row missing from daily breakdown");
    assert.ok(reportDay13Row, "day 13 row missing from daily breakdown");
    assert.ok(reportDay14Row, "day 14 row missing from daily breakdown");
    assert.strictEqual(Number(reportDay10Row.opening_qty || 0), 60);
    assert.strictEqual(Number(reportDay10Row.in_qty || 0), 5);
    assert.strictEqual(Number(reportDay10Row.closing_qty || 0), 65);
    assert.strictEqual(Number(reportDay11Row.out_qty || 0), 3);
    assert.strictEqual(Number(reportDay11Row.closing_qty || 0), 62);
    assert.strictEqual(Number(reportDay12Row.delete_qty || 0), 2);
    assert.strictEqual(Number(reportDay12Row.closing_qty || 0), 60);
    assert.strictEqual(Number(reportDay13Row.adjustment_qty || 0), -1);
    assert.strictEqual(Number(reportDay13Row.closing_qty || 0), 59);
    assert.strictEqual(Number(reportDay14Row.in_qty || 0), 4);
    assert.strictEqual(Number(reportDay14Row.closing_qty || 0), 63);

    const reportFactoryOneSummary = await request(baseUrl, `/inventory/stock-summary?factory_id=${factoryOne.id}&product_id=${reportProduct.id}&date_from=${reportFrom}&date_to=${reportTo}`, { token: activeToken, factoryId: factoryOne.id });
    assert.strictEqual(reportFactoryOneSummary.status, 200, `factory one report summary failed: ${reportFactoryOneSummary.text}`);
    assert.strictEqual(Number(reportFactoryOneSummary.json?.opening_qty || 0), 50);
    assert.strictEqual(Number(reportFactoryOneSummary.json?.movement_totals?.in_qty || 0), 5);
    assert.strictEqual(Number(reportFactoryOneSummary.json?.movement_totals?.out_qty || 0), 0);
    assert.strictEqual(Number(reportFactoryOneSummary.json?.movement_totals?.delete_qty || 0), 2);
    assert.strictEqual(Number(reportFactoryOneSummary.json?.movement_totals?.adjustment_qty || 0), -1);
    assert.strictEqual(Number(reportFactoryOneSummary.json?.stock_qty || 0), 52);

    const reportAsOf = await request(baseUrl, `/inventory/stock-summary?factory_id=all&product_id=${reportProduct.id}&as_of=${encodeURIComponent(reportDay12AsOf)}`, { token: activeToken });
    assert.strictEqual(reportAsOf.status, 200, `report as_of summary failed: ${reportAsOf.text}`);
    assert.strictEqual(Number(reportAsOf.json?.stock_qty || 0), 60);
    assert.strictEqual(reportAsOf.json?.daily_breakdown, null);

    const reportMovements = await request(baseUrl, `/inventory/movements?factory_id=all&product_id=${reportProduct.id}&date_from=${reportFrom}&date_to=${reportTo}&page=1&page_size=100`, { token: activeToken });
    assert.strictEqual(reportMovements.status, 200, `report movements failed: ${reportMovements.text}`);
    assert.strictEqual((reportMovements.json?.items || []).length, 5);
    const reportMovementTypes = new Set((reportMovements.json?.items || []).map((row) => `${row.type}:${row.source_type}`));
    assert.ok(reportMovementTypes.has("IN:MANUAL"), "manual IN movement missing");
    assert.ok(reportMovementTypes.has("OUT:MANUAL"), "manual OUT movement missing");
    assert.ok(reportMovementTypes.has("DELETE:MANUAL"), "manual DELETE movement missing");
    assert.ok(reportMovementTypes.has("ADJUSTMENT:MANUAL"), "manual ADJUSTMENT movement missing");
    assert.ok((reportMovements.json?.items || []).every((row) => {
      const dateKey = String(row.date || "").slice(0, 10);
      return dateKey >= reportFrom && dateKey <= reportTo;
    }), "movement rows escaped the requested date filter");

    const reportSummaryPdf = await request(baseUrl, `/inventory/stock-summary/pdf?factory_id=all&product_id=${reportProduct.id}&date_from=${reportFrom}&date_to=${reportTo}`, { token: activeToken, expectPdf: true });
    assert.strictEqual(reportSummaryPdf.status, 200, "report stock summary pdf failed");
    assert.ok((reportSummaryPdf.headers.get("content-type") || "").includes("pdf"), "report stock summary pdf content type mismatch");
    assert.ok(reportSummaryPdf.buffer.length > 500, "report stock summary pdf too small");

    const reportListPdf = await request(baseUrl, `/inventory/stock-summary/pdf?factory_id=all&date_from=${reportFrom}&date_to=${reportTo}`, { token: activeToken, expectPdf: true });
    assert.strictEqual(reportListPdf.status, 200, "stock list pdf failed");
    assert.ok((reportListPdf.headers.get("content-type") || "").includes("pdf"), "stock list pdf content type mismatch");
    assert.ok(reportListPdf.buffer.length > 500, "stock list pdf too small");

    const reportMonthlyDefaultPdf = await request(baseUrl, `/inventory/stock-summary/${reportProduct.id}/monthly.pdf?factory_id=all`, { token: activeToken, expectPdf: true });
    assert.strictEqual(reportMonthlyDefaultPdf.status, 200, "default monthly inventory pdf failed");
    assert.ok((reportMonthlyDefaultPdf.headers.get("content-type") || "").includes("pdf"), "default monthly pdf content type mismatch");
    assert.ok(reportMonthlyDefaultPdf.buffer.length > 500, "default monthly pdf too small");

    const invalidSummaryMonth = await request(baseUrl, `/inventory/stock-summary?factory_id=all&product_id=${reportProduct.id}&month_key=2026-13`, { token: activeToken });
    assert.strictEqual(invalidSummaryMonth.status, 400, "invalid month_key should return 400 on stock summary");

    const invalidMovementsMonth = await request(baseUrl, `/inventory/movements?factory_id=all&product_id=${reportProduct.id}&month_key=2026-13`, { token: activeToken });
    assert.strictEqual(invalidMovementsMonth.status, 400, "invalid month_key should return 400 on movements");

    const conflictSummary = await request(baseUrl, `/inventory/stock-summary?factory_id=all&product_id=${reportProduct.id}&date_from=${reportFrom}&date_to=${reportTo}&as_of=${encodeURIComponent(reportDay12AsOf)}`, { token: activeToken });
    assert.strictEqual(conflictSummary.status, 400, "date filters combined with as_of should fail on stock summary");

    const conflictPdf = await request(baseUrl, `/inventory/stock-summary/pdf?factory_id=all&product_id=${reportProduct.id}&date_from=${reportFrom}&date_to=${reportTo}&as_of=${encodeURIComponent(reportDay12AsOf)}`, { token: activeToken });
    assert.strictEqual(conflictPdf.status, 400, "date filters combined with as_of should fail on stock summary pdf");

    const failingOrder = await request(baseUrl, "/orders", {
      method: "POST",
      token: activeToken,
      factoryId: factoryOne.id,
      body: {
        client_id: client.id,
        sales_company_id: salesCompany.id,
        order_date: todayIso(),
        items: [{ product_id: product.id, quantity: 29, unit_price: 2.5 }],
        charges: []
      }
    });
    assert.strictEqual(failingOrder.status, 201, `second order create failed: ${failingOrder.text}`);

    const failedDispatch = await request(baseUrl, `/orders/${failingOrder.json.id}/status`, {
      method: "PUT",
      token: activeToken,
      factoryId: factoryOne.id,
      body: {
        status: "DISPATCHED",
        allocations: [
          { product_id: product.id, factory_id: factoryOne.id, quantity: 19 },
          { product_id: product.id, factory_id: factoryTwo.id, quantity: 10 }
        ]
      }
    });
    assert.strictEqual(failedDispatch.status, 400, "failed dispatch should return 400");
    assert.ok((failedDispatch.json?.message || "").toLowerCase().includes("insufficient"), "failed dispatch should report insufficient stock");

    const finalStock = await request(baseUrl, `/inventory/stock?factory_id=all&product_id=${product.id}&include_totals=true`, { token: activeToken });
    assert.strictEqual(finalStock.status, 200, `final stock failed: ${finalStock.text}`);
    assert.strictEqual(Number(finalStock.json?.stock_qty || 0), 28);

    console.log("verify_auth_inventory_orders: ok");
  } catch (err) {
    console.error("verify_auth_inventory_orders: failed");
    console.error(err);
    process.exitCode = 1;
  } finally {
    await stopServer(server).catch(() => null);
    await cleanupCompany(companyId).catch((err) => {
      console.error("cleanup failed", err);
      process.exitCode = 1;
    });
    await prisma.$disconnect().catch(() => null);
  }
})();

