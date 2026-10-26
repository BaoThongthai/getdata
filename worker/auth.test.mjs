import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authGate, secureResponse } from './auth.js';
import worker from './worker.js';
const root = 'https://example.workers.dev';
const salt = '1234567890abcdef1234567890abcdef';
const bytes = Uint8Array.from(salt.match(/../g), h => parseInt(h,16));
const key = await crypto.subtle.importKey('raw',new TextEncoder().encode('test-password-only'),'PBKDF2',false,['deriveBits']);
const hash = Buffer.from(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:bytes,iterations:100000},key,256)).toString('hex');
function setup() {
  const values=new Map();
  return { values, env:{ DASHBOARD_AUTH:JSON.stringify({username:'test-user',salt,hash}), TIKTOK_TOKENS:{get:async k=>values.has(k)?JSON.parse(values.get(k)):null,put:async(k,v)=>values.set(k,v),delete:async k=>values.delete(k)}, LOGIN_RATE_LIMIT:{limit:async()=>({success:true})}, ACCOUNT_RATE_LIMIT:{limit:async()=>({success:true})} } };
}
const request = (path, options={}) => new Request(root+path, options);
const login = (username='test-user',password='test-password-only',origin=root)=>request('/api/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username,password})});
test('authentication, cookies, expiration, logout, API gate and security headers',async()=>{
 const {env,values}=setup();
 assert.equal((await worker.fetch(request('/api/shops'),env)).status,401);
 assert.equal((await worker.fetch(request('/api/top-products?shop=test&date=2026-10-22'),env)).status,401);
 assert.equal((await worker.fetch(request('/api/stats?date=2026-10-22'),env)).status,401);
 assert.equal((await worker.fetch(request('/api/total'),env)).status,401);
 assert.equal((await authGate(login('bad','bad'),env)).status,401);
 assert.equal((await authGate(login('test-user','wrong'),env)).status,401);
 assert.equal((await authGate(login('test-user','test-password-only','https://evil.example'),env)).status,403);
 const ok=await authGate(login(),env); assert.equal(ok.status,200);
 const cookie=ok.headers.get('set-cookie');for(const flag of ['HttpOnly','Secure','SameSite=Strict','Path=/','Max-Age=14400'])assert(cookie.includes(flag));
 const cookieHeader=cookie.split(';')[0];
 assert.equal((await authGate(request('/api/auth/me',{headers:{cookie:cookieHeader}}),env)).status,200);
 assert.equal(await authGate(request('/api/shops',{headers:{cookie:cookieHeader}}),env),null);
 assert.equal((await authGate(request('/api/shops',{headers:{cookie:'__Host-vifon_session='+'0'.repeat(64)}}),env)).status,401);
 const sk=[...values.keys()][0],saved=JSON.parse(values.get(sk));values.set(sk,JSON.stringify({...saved,expires:0}));
 assert.equal((await authGate(request('/api/shops',{headers:{cookie:cookieHeader}}),env)).status,401);
 values.set(sk,JSON.stringify(saved));
 assert.equal((await authGate(request('/api/auth/logout',{method:'POST',headers:{origin:root,cookie:cookieHeader}}),env)).status,200);
 assert.equal((await authGate(request('/api/shops',{headers:{cookie:cookieHeader}}),env)).status,401);
 env.LOGIN_RATE_LIMIT.limit=async()=>({success:false});assert.equal((await authGate(login(),env)).status,429);
 const secured=secureResponse(new Response('test',{headers:{'access-control-allow-origin':'*'}}));
 assert.equal(secured.headers.get('access-control-allow-origin'),null);assert.equal(secured.headers.get('cache-control'),'no-store');assert(secured.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
});
