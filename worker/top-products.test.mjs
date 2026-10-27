import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTopProducts } from './worker.js';
const shop={key:'test',name:'Test shop',id:'12',cipher:'cipher',token_key:'token',header_only_token:true};
const env={TIKTOK_APP_KEY:'test-key',TIKTOK_APP_SECRET:'test-secret',TIKTOK_TOKENS:{get:async key=>key==='shops'?[shop]:{access_token:'test-token'}}};
const date=new Date(Date.now()-2*86400000).toISOString().slice(0,10);
const originalFetch=globalThis.fetch;
test('daily top products: exact date, descending orders, zero exclusion, missing names and API failures',async()=>{
 try {
  const calls=[];
  globalThis.fetch=async(url,options)=>{
   const u=new URL(url); calls.push(u);
   assert.equal(options.headers['x-tts-access-token'],'test-token');
   if(u.pathname.startsWith('/product/'))return Response.json({code:105005,message:'Access denied'});
   assert.equal(u.searchParams.get('start_date_ge'),date);
   assert.equal(u.searchParams.get('end_date_lt'),new Date(new Date(date+'T00:00:00Z').getTime()+86400000).toISOString().slice(0,10));
   assert.equal(u.searchParams.get('sort_field'),'orders');assert.equal(u.searchParams.get('sort_order'),'DESC');
   return Response.json({code:0,data:{products:[{id:'10',total_performance:{orders:2,items_sold:3}},{id:'11',title:'<script>not HTML</script>',total_performance:{orders:5,items_sold:6}},{id:'12',total_performance:{orders:0,items_sold:0}}],latest_available_date:date}});
  };
  const r=await getTopProducts(env,'test',date);
  assert.equal(r.shop_key,'test');assert.equal(r.date,date);assert.equal(r.names_unavailable,true);
  assert.deepEqual(r.products.map(p=>[p.id,p.orders]),[['11',5],['10',2]]);
  assert.equal(r.products[0].name,'<script>not HTML</script>');assert.equal(r.products[1].name,null);
  await assert.rejects(()=>getTopProducts(env,'unknown',date),/cửa hàng/);
  await assert.rejects(()=>getTopProducts(env,'test','2026-02-30'),/Ngày/);
  globalThis.fetch=async()=>Response.json({code:105005,message:'Access denied'});
  await assert.rejects(()=>getTopProducts(env,'test',date),/Access denied/);
  globalThis.fetch=async()=>Response.json({code:0,data:{}});
  await assert.rejects(()=>getTopProducts(env,'test',date),/danh sách/);
  globalThis.fetch=async()=>Response.json({code:0,data:{products:[{id:'10',total_performance:{orders:'5',items_sold:5}}]}});
  await assert.rejects(()=>getTopProducts(env,'test',date),/không hợp lệ/);
  globalThis.fetch=async()=>Response.json({code:0,data:{products:[]}});
  assert.deepEqual((await getTopProducts(env,'test',date)).products,[]);
  const start=new Date(new Date(date+'T00:00:00Z').getTime()-6*86400000).toISOString().slice(0,10);
  globalThis.fetch=async(url)=>{
   const u=new URL(url);
   if(u.pathname.startsWith('/product/'))return Response.json({code:105005,message:'Access denied'});
   assert.equal(u.searchParams.get('start_date_ge'),start);
   assert.equal(u.searchParams.get('end_date_lt'),new Date(new Date(date+'T00:00:00Z').getTime()+86400000).toISOString().slice(0,10));
   assert.equal(u.searchParams.get('sort_field'),'items_sold');assert.equal(u.searchParams.get('page_size'),'10');
   return Response.json({code:0,data:{products:[{id:'20',total_performance:{orders:4,items_sold:9}},{id:'21',total_performance:{orders:5,items_sold:7}}],latest_available_date:date}});
  };
  const range=await getTopProducts(env,'test',start,date);
  assert.equal(range.date,undefined);assert.equal(range.period_start,start);assert.equal(range.period_end,date);
  assert.deepEqual(range.products.map(p=>[p.id,p.items_sold,p.orders]),[['20',9,4],['21',7,5]]);
 }finally{globalThis.fetch=originalFetch;}
});
