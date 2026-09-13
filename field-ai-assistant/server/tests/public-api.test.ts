import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../api/index.js';

test('public API rejects cross-origin writes, missing DB, and hides upstream failures', async () => {
  const oldUrl=process.env.SHEETS_API_URL;const oldSecret=process.env.SHEETS_API_SECRET;const originalFetch=globalThis.fetch;
  const call=async (path:string, method='GET', origin?:string) => {
    let status=0;let data:Record<string,unknown>={};
    const headers:Record<string,string>={host:'fixture.vercel.app','content-type':'application/json'};
    if(origin) headers.origin=origin;
    const req={method,headers,query:{path},body:{productId:'chair-001',quantity:1}};
    const res={setHeader:()=>{},set statusCode(value:number){status=value;},end:(body:string)=>{data=JSON.parse(body);}};
    await handler(req as unknown as Parameters<typeof handler>[0],res as unknown as Parameters<typeof handler>[1]);
    return {status,data};
  };
  try {
    delete process.env.SHEETS_API_URL;delete process.env.SHEETS_API_SECRET;
    assert.equal((await call('products')).status,503);
    assert.equal((await call('inventory/manual','POST','https://foreign.example')).status,403);
    assert.equal((await call('../.env')).status,404);
    process.env.SHEETS_API_URL='https://script.google.com/macros/s/fixture/exec';
    process.env.SHEETS_API_SECRET='fixture-bridge-secret';
    globalThis.fetch=async (_url,init)=>{
      const body=JSON.parse(String(init?.body));assert.equal(body.secret,'fixture-bridge-secret');assert.equal(body.path,'/products');
      return Response.json({status:200,data:[{id:'chair-001',quantity:20}]});
    };
    assert.equal((await call('products')).status,200);
    globalThis.fetch=async ()=>{throw new Error('fixture-bridge-secret');};
    const failure=await call('products');assert.equal(failure.status,502);
    assert.ok(!JSON.stringify(failure).includes('fixture-bridge-secret'));
  } finally {
    if(oldUrl===undefined)delete process.env.SHEETS_API_URL;else process.env.SHEETS_API_URL=oldUrl;
    if(oldSecret===undefined)delete process.env.SHEETS_API_SECRET;else process.env.SHEETS_API_SECRET=oldSecret;
    globalThis.fetch=originalFetch;
  }
});
