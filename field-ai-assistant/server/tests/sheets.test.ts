import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ConfirmResult, InventoryChange } from '../../shared/types.js';

type Row = (string | number)[];
type Tables = Record<string, { id: number; rows: Row[]; capacity: number }>;
const code = readFileSync(new URL('../../apps-script/Code.gs', import.meta.url), 'utf8');
function fixture() {
  const context = vm.createContext({ Utilities: { getUuid: randomUUID } });
  vm.runInContext(code, context);
  const tables: Tables = Object.fromEntries(Object.keys(context.TABLES).map((name, i) => [name, { id: i, rows: [], capacity: 1000 }]));
  tables.Products.rows = [
    ['chair-001', 'オフィスチェアA', 'chair', '椅子', 20, 0],
    ['desk-001', 'デスクA', 'desk', 'デスク', 10, 0],
    ['monitor-001', 'モニターA', 'monitor', 'モニター', 15, 0],
  ];
  const call = <T>(path: string, body = {}, method = 'POST'): T => context.operate(tables, method, path, body, []);
  const prepare = () => call<InventoryChange>('/inventory/prepare', {productId:'chair-001',quantity:2,action:'shipment'});
  const manual = (quantity: number, requestId = randomUUID(), reason = '棚卸し') => call<ConfirmResult>('/inventory/manual', {productId:'chair-001',quantity,requestId,reason});
  return { context, tables, call, prepare, manual };
}
test('Sheets: preview does not change stock; confirm is replay-safe', () => {
  const f = fixture(); const p = f.prepare();
  assert.equal(f.tables.Products.rows[0][4], 20);
  const result = f.call<ConfirmResult>('/inventory/confirm', {pendingId:p.id});
  assert.equal(result.product.quantity, 18);
  assert.equal(f.call<ConfirmResult>('/inventory/confirm',{pendingId:p.id}).product.quantity,18);
  assert.equal(f.tables.History.rows.length,1);
});
test('Sheets: competing and ABA changes require fresh confirmation', () => {
  const f = fixture(); const p = f.prepare();
  f.manual(1); f.manual(-1);
  assert.equal(f.tables.Products.rows[0][4],20);
  assert.throws(()=>f.call('/inventory/confirm',{pendingId:p.id}),/確認中に在庫/);
});
test('Sheets: duplicate manual request never applies twice; changed body rejected', () => {
  const f = fixture(); const id = randomUUID();
  assert.equal(f.manual(-1,id).product.quantity,19);
  assert.equal(f.manual(-1,id).product.quantity,19);
  assert.equal(f.tables.History.rows.length,1);
  assert.throws(()=>f.manual(-2,id),/異なる変更/);
});
test('Sheets: cancellation and expiry block updates; no negative stock', () => {
  const f=fixture();const p=f.prepare();f.call('/inventory/cancel',{pendingId:p.id});
  assert.throws(()=>f.call('/inventory/confirm',{pendingId:p.id}),/キャンセル済み/);
  const p2=f.prepare();f.tables.Pending.rows[1][3]=0;
  assert.throws(()=>f.call('/inventory/confirm',{pendingId:p2.id}),/期限切れ/);
  assert.throws(()=>f.manual(-21),/在庫が不足/);
  assert.equal(f.tables.Products.rows[0][4],20);
});
test('Sheets: strings beginning with = are stored as text, never formulas', () => {
  const f=fixture();const writes: {updateCells?: {rows: {values: {userEnteredValue: object}[]}[]}}[]=[];
  f.context.operate(f.tables,'POST','/inventory/manual',{productId:'chair-001',quantity:1,requestId:randomUUID(),reason:'=IMPORTXML("https://example.com", "x")'},writes);
  const values=writes.flatMap(x=>x.updateCells?.rows.flatMap(r=>r.values) || []);
  assert.ok(values.some(x=>'stringValue' in x.userEnteredValue && String(x.userEnteredValue.stringValue).startsWith('=IMPORTXML')));
  assert.ok(values.every(x=>!('formulaValue' in x.userEnteredValue)));
});
test('Sheets: doPost uses one atomic commit and always releases the lock', () => {
  const f=fixture();let commits=0;let released=0;
  Object.assign(f.context,{
    PropertiesService:{getScriptProperties:()=>({getProperty:(name:string)=>name==='SHEETS_API_SECRET'?'fixture-secret':'fixture-sheet'})},
    LockService:{getScriptLock:()=>({tryLock:()=>true,hasLock:()=>true,releaseLock:()=>released++})},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:(text:string)=>({setMimeType:()=>JSON.parse(text)})},
    Sheets:{Spreadsheets:{batchUpdate:(data:{requests:unknown[]})=>{assert.equal(data.requests.length,3);commits++;}}},
    readTables:()=>structuredClone(f.tables),
  });
  const input={secret:'fixture-secret',method:'POST',path:'/inventory/manual',body:{productId:'chair-001',quantity:1,reason:'検証',requestId:randomUUID()}};
  assert.equal(f.context.doPost({postData:{contents:JSON.stringify(input)}}).status,200);
  assert.equal(commits,1);assert.equal(released,1);
  input.secret='wrong';assert.equal(f.context.doPost({postData:{contents:JSON.stringify(input)}}).status,403);
  assert.equal(commits,1);
});

test('Sheets: appended team columns are accepted and preserved during updates', () => {
  const f=fixture();
  f.tables.Products.rows[0].push('倉庫A');
  const names=Object.keys(f.context.TABLES);
  f.context.Sheets={Spreadsheets:{
    get:()=>({sheets:names.map((title,i)=>({properties:{title,sheetId:i,gridProperties:{rowCount:1000}}}))}),
    Values:{batchGet:()=>({valueRanges:names.map(name=>({values:[
      [...f.context.TABLES[name],...(name==='Products'?['location']:[])],...f.tables[name].rows,
    ]}))})},
  }};
  const tables=f.context.readTables('fixture');
  f.context.operate(tables,'POST','/inventory/manual',{productId:'chair-001',quantity:1,reason:'棚卸し',requestId:randomUUID()},[]);
  assert.equal(tables.Products.rows[0][4],21);
  assert.equal(tables.Products.rows[0][6],'倉庫A');
});

test('Sheets: read-only requests do not wait for the write lock', () => {
  const f=fixture();
  Object.assign(f.context,{
    PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'fixture'})},
    LockService:{getScriptLock:()=>({tryLock:()=>assert.fail('GET must not lock'),hasLock:()=>false})},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:(text:string)=>({setMimeType:()=>JSON.parse(text)})},
    readTables:()=>structuredClone(f.tables),
  });
  const result=f.context.doPost({postData:{contents:JSON.stringify({secret:'fixture',method:'GET',path:'/products'})}});
  assert.equal(result.status,200);assert.equal(result.data.length,3);
});
