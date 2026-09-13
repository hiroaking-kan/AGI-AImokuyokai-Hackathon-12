// Google Sheets is the shared database. All application writes use a script lock
// and a single atomic Sheets batchUpdate (stock + history + replay result).
var TABLES = {
  Products: ['id', 'name', 'category', 'categoryJa', 'quantity', 'revision'],
  History: ['id', 'productId', 'productName', 'change', 'beforeQuantity', 'afterQuantity', 'action', 'source', 'reason', 'createdAt'],
  Pending: ['id', 'changeJson', 'revision', 'expiresAt', 'status'],
  Requests: ['id', 'fingerprint', 'resultJson']
};

function setupCheck() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SPREADSHEET_ID') || !props.getProperty('SHEETS_API_SECRET'))
    throw new Error('Script Properties に SPREADSHEET_ID と SHEETS_API_SECRET を設定してください。');
  readTables(props.getProperty('SPREADSHEET_ID'));
  console.log('Spreadsheet connection OK');
}

function doPost(event) {
  var lock = LockService.getScriptLock();
  var result;
  try {
    var input = JSON.parse(event.postData.contents);
    var props = PropertiesService.getScriptProperties();
    var secret = props.getProperty('SHEETS_API_SECRET');
    if (!secret || input.secret !== secret) fail('認証できません。', 403);
    if (!lock.tryLock(10000)) fail('別の更新を処理中です。もう一度お試しください。', 409);
    var id = props.getProperty('SPREADSHEET_ID');
    var tables = readTables(id);
    var writes = [];
    var data = operate(tables, input.method, input.path, input.body || {}, writes);
    if (writes.length) Sheets.Spreadsheets.batchUpdate({ requests: writes }, id);
    result = { status: 200, data: data };
  } catch (error) {
    result = { status: error.status || 500, data: { error: error.status ? error.message : 'スプレッドシートの処理に失敗しました。' } };
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function fail(message, status) { var error = new Error(message); error.status = status || 400; throw error; }
function text(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > (max || 200)) fail(label + 'を正しく入力してください。');
  return value.trim();
}
function readTables(id) {
  var metadata = Sheets.Spreadsheets.get(id, { fields: 'sheets.properties' });
  var names = Object.keys(TABLES);
  var ranges = Sheets.Spreadsheets.Values.batchGet(id, { ranges: names.map(function(name) { return name + '!A:Z'; }), valueRenderOption: 'UNFORMATTED_VALUE' }).valueRanges;
  var tables = {};
  names.forEach(function(name, index) {
    var values = ranges[index].values || [];
    if (JSON.stringify(values[0]) !== JSON.stringify(TABLES[name])) fail(name + ' の見出しが一致しません。', 503);
    var sheet = metadata.sheets.find(function(s) { return s.properties.title === name; });
    tables[name] = { id: sheet.properties.sheetId, rows: values.slice(1), capacity: sheet.properties.gridProperties.rowCount };
  });
  return tables;
}
function rowWrite(table, index, values, writes) {
  if (index + 2 > table.capacity) {
    writes.push({ appendDimension: { sheetId: table.id, dimension: 'ROWS', length: 1000 } });
    table.capacity += 1000;
  }
  writes.push({ updateCells: {
    start: { sheetId: table.id, rowIndex: index + 1, columnIndex: 0 },
    rows: [{ values: values.map(function(value) { return { userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: String(value == null ? '' : value) } }; }) }],
    fields: 'userEnteredValue'
  } });
  table.rows[index] = values;
}
function append(table, values, writes) { rowWrite(table, table.rows.length, values, writes); }
function publicProduct(row) { return { id: row[0], name: row[1], category: row[2], categoryJa: row[3], quantity: Number(row[4]) }; }
function historyObject(row) {
  var entry = {};
  TABLES.History.forEach(function(key, i) { if (row[i] !== undefined && row[i] !== '') entry[key] = row[i]; });
  ['change', 'beforeQuantity', 'afterQuantity'].forEach(function(key) { entry[key] = Number(entry[key]); });
  return entry;
}
function operate(tables, method, path, body, writes) {
  var products = tables.Products.rows;
  if (products.length !== 3 || products.some(function(row) { return !Number.isSafeInteger(Number(row[4])) || Number(row[4]) < 0 || !Number.isSafeInteger(Number(row[5])); })) fail('在庫データを確認してください。', 503);
  if (method === 'GET') {
    if (path === '/health') return { ok: true, database: 'google-sheets' };
    if (path === '/products') return products.map(publicProduct);
    if (path === '/history') return tables.History.rows.map(historyObject).reverse();
    var selected;
    if (path.indexOf('/products/category/') === 0) {
      var category = decodeURIComponent(path.slice('/products/category/'.length)).toLowerCase();
      var aliases = { chair: 'chair', '椅子': 'chair', 'いす': 'chair', 'イス': 'chair', 'office chair': 'chair', desk: 'desk', table: 'desk', '机': 'desk', 'デスク': 'desk', 'テーブル': 'desk', monitor: 'monitor', display: 'monitor', screen: 'monitor', 'モニター': 'monitor', 'モニタ': 'monitor' };
      selected = products.find(function(row) { return row[2] === aliases[category]; });
    } else if (path.indexOf('/products/') === 0) selected = products.find(function(row) { return row[0] === decodeURIComponent(path.slice(10)); });
    if (!selected) fail('商品が見つかりません。', 404);
    return publicProduct(selected);
  }
  if (method !== 'POST') fail('この操作には対応していません。', 405);
  var now = Date.now();
  if (path === '/inventory/prepare' || path === '/inventory/manual') {
    var manual = path === '/inventory/manual';
    var productId = text(body.productId, '商品');
    var index = products.findIndex(function(row) { return row[0] === productId; });
    if (index < 0) fail('商品が見つかりません。', 404);
    var action = manual ? 'adjustment' : body.action;
    if (['shipment', 'restock', 'adjustment'].indexOf(action) < 0 || !Number.isSafeInteger(body.quantity) || body.quantity === 0 || (action !== 'adjustment' && body.quantity < 0)) fail('数量・操作内容を確認してください。');
    var reason = manual ? text(body.reason, '理由', 500) : (body.reason ? text(body.reason, '理由', 500) : '');
    var requestId = manual ? text(body.requestId, 'リクエストID', 128) : Utilities.getUuid();
    var fingerprint = JSON.stringify([productId, body.quantity, reason]);
    if (manual) {
      var previous = tables.Requests.rows.find(function(row) { return row[0] === requestId; });
      if (previous) {
        if (previous[1] !== fingerprint) fail('同じリクエストIDで異なる変更はできません。', 409);
        return JSON.parse(previous[2]);
      }
    }
    var before = Number(products[index][4]);
    var after = before + (action === 'shipment' ? -body.quantity : body.quantity);
    if (after < 0 || !Number.isSafeInteger(after)) fail('在庫が不足しているか数量が大きすぎます。', 409);
    var change = { id: Utilities.getUuid(), productId: productId, productName: products[index][1], action: action, quantity: body.quantity,
      beforeQuantity: before, afterQuantity: after, source: manual ? 'manual' : 'ai', reason: reason, createdAt: new Date(now).toISOString() };
    if (!manual) {
      if (tables.Pending.rows.filter(function(row) { return row[4] === 'pending' && Number(row[3]) > now; }).length >= 100) fail('未確認の変更が多すぎます。', 429);
      append(tables.Pending, [change.id, JSON.stringify(change), Number(products[index][5]), now + 600000, 'pending'], writes);
      return change;
    }
    var result = applyChange(tables, index, change, writes);
    append(tables.Requests, [requestId, fingerprint, JSON.stringify(result)], writes);
    return result;
  }
  if (path === '/inventory/confirm' || path === '/inventory/cancel') {
    var pendingId = text(body.pendingId, '確認ID', 128);
    var pendingIndex = tables.Pending.rows.findIndex(function(row) { return row[0] === pendingId; });
    if (pendingIndex < 0) fail('確認待ちの変更がありません。', 409);
    var pending = tables.Pending.rows[pendingIndex];
    var completed = tables.History.rows.find(function(row) { return row[0] === pendingId; });
    var changeData = JSON.parse(pending[1]);
    var productIndex = products.findIndex(function(row) { return row[0] === changeData.productId; });
    if (productIndex < 0) fail('商品が見つかりません。', 409);
    if (completed) {
      if (path === '/inventory/cancel') fail('この変更はすでに確定しています。', 409);
      var old = historyObject(completed);
      var item = publicProduct(products[productIndex]); item.quantity = old.afterQuantity;
      return { product: item, history: old };
    }
    if (path === '/inventory/cancel') {
      pending[4] = 'cancelled'; rowWrite(tables.Pending, pendingIndex, pending, writes);
      return { cancelled: true };
    }
    if (pending[4] !== 'pending' || Number(pending[3]) <= now) fail('確認が期限切れかキャンセル済みです。', 409);
    if (Number(products[productIndex][5]) !== Number(pending[2]) || Number(products[productIndex][4]) !== changeData.beforeQuantity)
      fail('確認中に在庫が変更されました。現在庫を確認し、もう一度操作してください。', 409);
    var confirmed = applyChange(tables, productIndex, changeData, writes);
    pending[4] = 'confirmed'; rowWrite(tables.Pending, pendingIndex, pending, writes);
    return confirmed;
  }
  fail('APIが見つかりません。', 404);
}
function applyChange(tables, index, change, writes) {
  var row = tables.Products.rows[index].slice();
  row[4] = change.afterQuantity; row[5] = Number(row[5]) + 1;
  rowWrite(tables.Products, index, row, writes);
  var entry = { id: change.id, productId: change.productId, productName: change.productName,
    change: change.afterQuantity - change.beforeQuantity, beforeQuantity: change.beforeQuantity, afterQuantity: change.afterQuantity,
    action: change.action, source: change.source, reason: change.reason || '', createdAt: new Date().toISOString() };
  append(tables.History, TABLES.History.map(function(key) { return entry[key]; }), writes);
  return { product: publicProduct(row), history: entry };
}
