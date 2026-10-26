interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  INITIAL_ADMIN_EMAIL?: string;
  APP_ORIGIN?: string;
  EVENT_YEAR?: string;
  PUBLIC_EVENT_NAME?: string;
  PUBLICATION_MODE?: string;
}
type Role = 'owner' | 'admin' | 'exhibitor';
type SessionUser = { id: string; email: string; displayName: string | null; role: Role };
const COOKIE_NAME = 'tte_session';
const STATE_COOKIE = 'tte_oauth_state';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg','image/png','image/webp']);

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff', ...headers } });
}
function redirect(url: string, headers: HeadersInit = {}): Response { return new Response(null, { status: 302, headers: { location: url, 'cache-control':'no-store', ...headers } }); }
function cookieValue(request: Request, name: string): string | null {
  const value = request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${name}=`));
  return value ? decodeURIComponent(value.slice(name.length+1)) : null;
}
function cookie(name: string, value: string, maxAge: number, secure = true): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure?'; Secure':''}`;
}
function clearCookie(name: string, secure = true): string { return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure?'; Secure':''}`; }
function b64url(bytes: Uint8Array): string { let s=''; for (const b of bytes) s+=String.fromCharCode(b); return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function fromB64url(s: string): Uint8Array { const base=s.replace(/-/g,'+').replace(/_/g,'/'); const raw=atob(base+'='.repeat((4-base.length%4)%4)); return Uint8Array.from(raw,c=>c.charCodeAt(0)); }
async function hmac(secret: string, message: string): Promise<Uint8Array> { const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']); return new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(message))); }
async function makeSession(user: SessionUser, secret: string): Promise<string> { const payload=b64url(new TextEncoder().encode(JSON.stringify({ ...user, exp:Math.floor(Date.now()/1000)+60*60*12 }))); return `${payload}.${b64url(await hmac(secret,payload))}`; }
async function readSession(request: Request, secret?: string): Promise<SessionUser | null> {
  if(!secret)return null; const token=cookieValue(request,COOKIE_NAME); if(!token)return null;
  const [payload,signature,...rest]=token.split('.'); if(!payload||!signature||rest.length)return null;
  try { const expected=await hmac(secret,payload); const supplied=fromB64url(signature); if(expected.length!==supplied.length || !crypto.subtle) return null; let diff=0; for(let i=0;i<expected.length;i++)diff|=expected[i]^supplied[i]; if(diff!==0)return null; const data=JSON.parse(new TextDecoder().decode(fromB64url(payload))) as SessionUser & {exp:number}; if(data.exp<Math.floor(Date.now()/1000))return null; return {id:data.id,email:data.email,displayName:data.displayName,role:data.role}; } catch { return null; }
}
async function requireUser(request: Request, env: Env): Promise<SessionUser | Response> { const session=await readSession(request,env.SESSION_SECRET); if(!session)return json({error:'authentication_required'},401); const current=await env.DB.prepare('SELECT id,email,display_name,role,active FROM users WHERE id=?').bind(session.id).first<{id:string;email:string;display_name:string|null;role:Role;active:number}>(); if(!current||!current.active)return json({error:'authentication_required'},401,{'set-cookie':clearCookie(COOKIE_NAME,new URL(request.url).protocol==='https:')}); return {id:current.id,email:current.email,displayName:current.display_name,role:current.role}; }
async function requireAdmin(request: Request, env: Env): Promise<SessionUser | Response> { const user=await requireUser(request,env); if(user instanceof Response)return user; if(user.role!=='admin'&&user.role!=='owner')return json({error:'admin_required'},403); return user; }
function isResponse(value: SessionUser | Response): value is Response { return value instanceof Response; }
async function audit(env: Env, actor: string | null, action: string, entityType: string, entityId: string, details: Record<string, unknown> = {}, eventId: string | null = 'tte-2027'): Promise<void> {
  await env.DB.prepare('INSERT INTO audit_log (id, actor_user_id, event_id, action, entity_type, entity_id, details_json) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(),actor,eventId,action,entityType,entityId,JSON.stringify(details)).run();
}
function safeUrl(value: string): boolean { try { const u=new URL(value); return u.protocol==='https:' || u.hostname==='localhost'; } catch { return false; } }
function escapeCsvCell(value: unknown): string { const s=String(value??''); return /[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; }

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url=new URL(request.url); const path=url.pathname;
    if(path.startsWith('/api/')) {
      try { return await handleApi(request,env,url,ctx); }
      catch(error) { console.error(JSON.stringify({level:'error',route:path,message:error instanceof Error?error.message:'unknown'})); return json({error:'internal_error'},500); }
    }
    const assetRequest = path === '/admin' || path === '/admin/' ? new Request(new URL('/admin.html', request.url), request) : request;
    const asset=await env.ASSETS.fetch(assetRequest);
    const headers=new Headers(asset.headers);
    headers.set('x-content-type-options','nosniff'); headers.set('referrer-policy','strict-origin-when-cross-origin');
    headers.set('permissions-policy','camera=(), microphone=(), geolocation=()');
    if(path.endsWith('.html')||path==='/'||path==='/admin') { headers.set('content-security-policy',"default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"); headers.set('cache-control','no-cache'); }
    return new Response(asset.body,{status:asset.status,headers});
  }
};

async function handleApi(request: Request, env: Env, url: URL, ctx: ExecutionContext): Promise<Response> {
  const path=url.pathname; const method=request.method;
  if (['POST','PATCH','PUT','DELETE'].includes(method) && path !== '/api/auth/callback') {
    const originHeader = request.headers.get('Origin');
    const expectedOrigin = env.APP_ORIGIN ? new URL(env.APP_ORIGIN).origin : url.origin;
    if (!originHeader || originHeader !== expectedOrigin) return json({error:'origin_check_failed'},403);
  }
  if(path==='/api/health'&&method==='GET') return json({ok:true,eventYear:env.EVENT_YEAR||'2027',mode:env.PUBLICATION_MODE||'admin-controlled'});
  if(path==='/api/auth/google'&&method==='GET') {
    if(!env.GOOGLE_CLIENT_ID||!env.SESSION_SECRET) return json({error:'google_oauth_not_configured',message:'Google OAuth has not been configured yet.'},503);
    const state=crypto.randomUUID(); const origin=env.APP_ORIGIN||url.origin;
    const redirectUri=`${origin}/api/auth/callback`;
    const params=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:redirectUri,response_type:'code',scope:'openid email profile',state,hd:'',prompt:'select_account'}); params.delete('hd');
    return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,{'set-cookie':cookie(STATE_COOKIE,state,600,url.protocol==='https:')});
  }
  if(path==='/api/auth/callback'&&method==='GET') {
    const code=url.searchParams.get('code'); const state=url.searchParams.get('state'); const saved=cookieValue(request,STATE_COOKIE);
    if(!code||!state||!saved||state!==saved) return json({error:'invalid_oauth_state'},400,{'set-cookie':clearCookie(STATE_COOKIE,url.protocol==='https:')});
    if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.SESSION_SECRET) return json({error:'oauth_not_configured'},503);
    const origin=env.APP_ORIGIN||url.origin; const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:`${origin}/api/auth/callback`,grant_type:'authorization_code'})});
    if(!tokenResponse.ok)return json({error:'oauth_token_exchange_failed'},401,{'set-cookie':clearCookie(STATE_COOKIE,url.protocol==='https:')});
    const token=await tokenResponse.json() as {access_token?:string}; if(!token.access_token)return json({error:'oauth_access_token_missing'},401);
    const profileResponse=await fetch('https://www.googleapis.com/oauth2/v2/userinfo',{headers:{authorization:`Bearer ${token.access_token}`}}); if(!profileResponse.ok)return json({error:'google_profile_failed'},401);
    const profile=await profileResponse.json() as {id?:string;email?:string;name?:string;verified_email?:boolean};
    const email=(profile.email||'').trim().toLowerCase(); if(!email||!profile.verified_email)return json({error:'verified_google_email_required'},403,{'set-cookie':clearCookie(STATE_COOKIE,url.protocol==='https:')});
    const existing=await env.DB.prepare('SELECT id,email,display_name,role,active FROM users WHERE email=? COLLATE NOCASE').bind(email).first<{id:string;email:string;display_name:string|null;role:Role;active:number}>();
    let user=existing;
    if(!user && env.INITIAL_ADMIN_EMAIL && email===env.INITIAL_ADMIN_EMAIL.trim().toLowerCase()) {
      const hasOwner=await env.DB.prepare("SELECT id FROM users WHERE role='owner' LIMIT 1").first<{id:string}>();
      const id=crypto.randomUUID(); const role:Role=hasOwner?'admin':'owner';
      await env.DB.prepare('INSERT INTO users (id,email,display_name,role,active) VALUES (?,?,?,?,1)').bind(id,email,profile.name||email,role).run();
      user={id,email,display_name:profile.name||email,role,active:1};
      await audit(env,id,'user.bootstrap','user',id,{role,email},null);
    }
    if(!user||!user.active)return json({error:'account_not_authorized',message:'This Google account has not been authorized by the organizer.'},403,{'set-cookie':clearCookie(STATE_COOKIE,url.protocol==='https:')});
    await env.DB.prepare('UPDATE users SET display_name=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(profile.name||email,user.id).run();
    const session=await makeSession({id:user.id,email:user.email,displayName:profile.name||user.display_name,role:user.role},env.SESSION_SECRET);
    const response=redirect(`${origin}/admin`); response.headers.append('set-cookie',cookie(COOKIE_NAME,session,60*60*12,url.protocol==='https:')); response.headers.append('set-cookie',clearCookie(STATE_COOKIE,url.protocol==='https:')); return response;
  }
  if(path==='/api/auth/me'&&method==='GET') { const user=await readSession(request,env.SESSION_SECRET); const current=user?await env.DB.prepare('SELECT id,email,display_name,role,active FROM users WHERE id=?').bind(user.id).first<{id:string;email:string;display_name:string|null;role:Role;active:number}>():null; const activeUser=current&&current.active?{id:current.id,email:current.email,displayName:current.display_name,role:current.role}:null; return json({user:activeUser,exhibitorPortalEnabled:(await env.DB.prepare("SELECT value FROM app_settings WHERE key='exhibitor_portal_enabled'").first<{value:string}>())?.value==='true'}); }
  if(path==='/api/auth/logout'&&method==='POST') return json({ok:true},200,{'set-cookie':clearCookie(COOKIE_NAME,url.protocol==='https:')});

  if(path==='/api/public/booths'&&method==='GET') {
    const year=Number(url.searchParams.get('year')||env.EVENT_YEAR||2027);
    const event=await env.DB.prepare('SELECT id,year,status FROM events WHERE year=?').bind(year).first<{id:string;year:number;status:string}>();
    if(!event)return json({booths:[],event:null});
    const mapEnabled=(await env.DB.prepare("SELECT value FROM app_settings WHERE key='visitor_map_enabled'").first<{value:string}>())?.value==='true';
    if(event.status!=='public' && !mapEnabled) return json({event:{year:event.year,status:event.status},booths:[],published:false});
    const rows=await env.DB.prepare(`SELECT b.id,b.booth_number AS number,b.x,b.y,b.width,b.height,e.id AS exhibitor_id,e.name_th,e.name_en,e.description_th,e.description_en,e.website,e.social_links_json,e.public_status FROM booths b LEFT JOIN exhibitor_booths eb ON eb.booth_id=b.id LEFT JOIN exhibitors e ON e.id=eb.exhibitor_id AND e.archived_at IS NULL AND e.public_status='published' WHERE b.event_id=? AND b.is_visible=1 AND b.archived_at IS NULL ORDER BY b.sort_order,b.booth_number`).bind(event.id).all<Record<string,unknown>>();
    const booths=rows.results.map(r=>({id:r.id,number:r.number,x:r.x,y:r.y,width:r.width,height:r.height,published:!!r.exhibitor_id,name:r.exhibitor_id?(r.name_th||r.name_en||''):'',name_th:r.name_th||'',name_en:r.name_en||'',description_th:r.description_th||'',description_en:r.description_en||'',website:r.website||'',socialLinks:parseJson(r.social_links_json,'[]')}));
    return json({event:{year:event.year,status:event.status},booths});
  }
  if(path==='/api/public/exhibitors'&&method==='GET') {
    const q=(url.searchParams.get('q')||'').trim().slice(0,100); const year=Number(url.searchParams.get('year')||env.EVENT_YEAR||2027);
    const event=await env.DB.prepare('SELECT id,status FROM events WHERE year=?').bind(year).first<{id:string;status:string}>(); if(!event)return json({exhibitors:[]}); const mapEnabled=(await env.DB.prepare("SELECT value FROM app_settings WHERE key='visitor_map_enabled'").first<{value:string}>())?.value==='true'; if(event.status!=='public'&&!mapEnabled)return json({exhibitors:[],published:false});
    const rows=q?await env.DB.prepare(`SELECT DISTINCT e.id,e.name_th,e.name_en,e.description_th,e.description_en,e.website,b.booth_number FROM exhibitors e JOIN exhibitor_booths eb ON eb.exhibitor_id=e.id JOIN booths b ON b.id=eb.booth_id WHERE e.event_id=? AND e.public_status='published' AND e.archived_at IS NULL AND b.archived_at IS NULL AND (e.name_th LIKE ? OR e.name_en LIKE ? OR e.description_th LIKE ? OR e.description_en LIKE ? OR b.booth_number LIKE ?) ORDER BY e.name_en LIMIT 100`).bind(event.id,`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`).all():await env.DB.prepare(`SELECT DISTINCT e.id,e.name_th,e.name_en,e.description_th,e.description_en,e.website,b.booth_number FROM exhibitors e JOIN exhibitor_booths eb ON eb.exhibitor_id=e.id JOIN booths b ON b.id=eb.booth_id WHERE e.event_id=? AND e.public_status='published' AND e.archived_at IS NULL AND b.archived_at IS NULL ORDER BY e.name_en LIMIT 100`).bind(event.id).all();
    return json({exhibitors:rows.results});
  }
  if(path==='/api/public/event'&&method==='GET') {
    const year=Number(url.searchParams.get('year')||env.EVENT_YEAR||2027); const event=await env.DB.prepare('SELECT year,name_th,name_en,status,map_background_type FROM events WHERE year=?').bind(year).first(); return json({event});
  }

  const user=await requireUser(request,env); if(isResponse(user))return user;
  if(path==='/api/admin/overview'&&method==='GET') {
    const admin=await requireAdmin(request,env); if(isResponse(admin))return admin;
    const [event,booths,exhibitors,pending,settings]=await Promise.all([
      env.DB.prepare("SELECT id,year,name_th,name_en,status FROM events WHERE id=(SELECT value FROM app_settings WHERE key='active_event_id')").first(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM booths WHERE event_id=(SELECT value FROM app_settings WHERE key='active_event_id') AND archived_at IS NULL").first<{n:number}>(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM exhibitors WHERE event_id=(SELECT value FROM app_settings WHERE key='active_event_id') AND archived_at IS NULL").first<{n:number}>(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM submissions WHERE status='pending'").first<{n:number}>(),
      env.DB.prepare("SELECT key,value FROM app_settings").all<{key:string;value:string}>()
    ]);
    return json({user:admin,event,counts:{booths:booths?.n||0,exhibitors:exhibitors?.n||0,pending:pending?.n||0},settings:Object.fromEntries((settings.results||[]).map(s=>[s.key,s.value]))});
  }
  if(path==='/api/admin/users'&&method==='GET') {
    const admin=await requireAdmin(request,env); if(isResponse(admin))return admin;
    const result=await env.DB.prepare('SELECT id,email,display_name,role,active,created_at FROM users ORDER BY role,email').all(); return json({users:result.results});
  }
  if(path==='/api/admin/users'&&method==='POST') {
    const admin=await requireAdmin(request,env); if(isResponse(admin))return admin;
    const body=await request.json() as {email?:string;displayName?:string;role?:Role}; const email=(body.email||'').trim().toLowerCase(); const role=body.role||'exhibitor';
    if(!/^\S+@\S+\.\S+$/.test(email)||!['admin','exhibitor'].includes(role))return json({error:'invalid_user'},400);
    if(role==='admin'&&admin.role!=='owner')return json({error:'owner_only'},403);
    const id=crypto.randomUUID(); await env.DB.prepare('INSERT INTO users (id,email,display_name,role,active) VALUES (?,?,?,?,1)').bind(id,email,(body.displayName||email).slice(0,160),role).run(); await audit(env,admin.id,'user.create','user',id,{email,role}); return json({id,email,role},201);
  }
  if(path==='/api/admin/users'&&method==='PATCH') {
    const admin=await requireAdmin(request,env); if(isResponse(admin))return admin;
    const body=await request.json() as {id?:string;active?:boolean;role?:Role}; if(!body.id)return json({error:'user_id_required'},400);
    if(body.id===admin.id && body.active===false)return json({error:'cannot_deactivate_self'},400);
    const target=await env.DB.prepare('SELECT id,role FROM users WHERE id=?').bind(body.id).first<{id:string;role:Role}>(); if(!target)return json({error:'not_found'},404);
    if((target.role==='owner'||target.role==='admin'||body.role==='admin')&&admin.role!=='owner')return json({error:'owner_only'},403);
    if(body.active!==undefined)await env.DB.prepare('UPDATE users SET active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(body.active?1:0,body.id).run();
    if(body.role&&['admin','exhibitor'].includes(body.role))await env.DB.prepare('UPDATE users SET role=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(body.role,body.id).run();
    await audit(env,admin.id,'user.update','user',body.id,{active:body.active,role:body.role}); return json({ok:true});
  }
  if(path==='/api/admin/events'&&method==='GET') { const admin=await requireAdmin(request,env); if(isResponse(admin))return admin; const rows=await env.DB.prepare('SELECT id,year,name_th,name_en,status,created_at FROM events ORDER BY year DESC').all(); return json({events:rows.results}); }
  if(path==='/api/admin/events'&&method==='POST') {
    const admin=await requireAdmin(request,env); if(isResponse(admin))return admin; const body=await request.json() as {year?:number;nameTh?:string;nameEn?:string}; const year=Number(body.year); if(!Number.isInteger(year)||year<2020||year>2100)return json({error:'invalid_year'},400); const id=`tte-${year}`; await env.DB.prepare('INSERT INTO events (id,year,name_th,name_en,status) VALUES (?,?,?,? ,\'draft\')').bind(id,year,(body.nameTh||`TTE ${year}`).slice(0,160),(body.nameEn||`TTE ${year}`).slice(0,160)).run(); await audit(env,admin.id,'event.create','event',id,{year}); return json({id,year},201);
  }
  if(path==='/api/admin/booths'&&method==='GET') {
    const admin=await requireAdmin(request,env); if(isResponse(admin))return admin; const year=Number(url.searchParams.get('year')||env.EVENT_YEAR||2027); const rows=await env.DB.prepare('SELECT b.id,b.event_id,b.booth_number AS number,b.x,b.y,b.width,b.height,b.is_visible,b.archived_at, e.id AS exhibitor_id,e.public_status FROM booths b LEFT JOIN exhibitor_booths eb ON eb.booth_id=b.id LEFT JOIN exhibitors e ON e.id=eb.exhibitor_id WHERE b.event_id=(SELECT id FROM events WHERE year=?) AND b.archived_at IS NULL ORDER BY b.sort_order,b.booth_number').bind(year).all<Record<string,unknown>>(); return json({booths:rows.results.map(r=>({...r,published:r.public_status==='published'}))});
  }
  if(path==='/api/admin/booths'&&method==='POST') {
    const admin=await requireAdmin(request,env); if(isResponse(admin))return admin; const body=await request.json() as {eventId?:string;number?:string;x?:number;y?:number;width?:number;height?:number}; const eventId=body.eventId||'tte-2027'; const number=(body.number||'').trim().slice(0,40); if(!number)return json({error:'booth_number_required'},400); const id=crypto.randomUUID(); await env.DB.prepare('INSERT INTO booths (id,event_id,booth_number,x,y,width,height) VALUES (?,?,?,?,?,?,?)').bind(id,eventId,number,clamp(body.x,0,100),clamp(body.y,0,100),clamp(body.width,1,100),clamp(body.height,1,100)).run(); await audit(env,admin.id,'booth.create','booth',id,{number}); return json({id,number},201);
  }
  if(path==='/api/admin/exhibitors'&&method==='POST') {
    const admin=await requireAdmin(request,env); if(isResponse(admin))return admin; const body=await request.json() as {eventId?:string;nameTh?:string;nameEn?:string;descriptionTh?:string;descriptionEn?:string;website?:string;boothIds?:string[];emails?:string[]}; const eventId=body.eventId||'tte-2027'; const id=crypto.randomUUID(); const website=(body.website||'').trim(); if(website&&!safeUrl(website))return json({error:'website_must_be_https'},400);
    await env.DB.prepare('INSERT INTO exhibitors (id,event_id,name_th,name_en,description_th,description_en,website,public_status) VALUES (?,?,?,?,?,?,?,\'hidden\')').bind(id,eventId,(body.nameTh||'').slice(0,200),(body.nameEn||'').slice(0,200),(body.descriptionTh||'').slice(0,5000),(body.descriptionEn||'').slice(0,5000),website).run();
    for(const boothId of (body.boothIds||[]).slice(0,20))await env.DB.prepare('INSERT OR IGNORE INTO exhibitor_booths (exhibitor_id,booth_id) VALUES (?,?)').bind(id,boothId).run();
    for(const email of (body.emails||[]).slice(0,10)){const normalized=email.trim().toLowerCase();if(!/^\S+@\S+\.\S+$/.test(normalized))continue;let target=await env.DB.prepare('SELECT id FROM users WHERE email=? COLLATE NOCASE').bind(normalized).first<{id:string}>();if(!target){const userId=crypto.randomUUID();await env.DB.prepare("INSERT INTO users (id,email,role,active) VALUES (?,?, 'exhibitor',1)").bind(userId,normalized).run();target={id:userId};}await env.DB.prepare('INSERT OR IGNORE INTO exhibitor_accounts (exhibitor_id,user_id) VALUES (?,?)').bind(id,target.id).run();}
    await audit(env,admin.id,'exhibitor.create','exhibitor',id,{boothCount:(body.boothIds||[]).length});return json({id,publicStatus:'hidden'},201);
  }
  if(path==='/api/admin/exhibitors'&&method==='GET') { const admin=await requireAdmin(request,env);if(isResponse(admin))return admin;const rows=await env.DB.prepare(`SELECT e.*,GROUP_CONCAT(b.booth_number, ', ') AS booth_numbers FROM exhibitors e LEFT JOIN exhibitor_booths eb ON eb.exhibitor_id=e.id LEFT JOIN booths b ON b.id=eb.booth_id WHERE e.archived_at IS NULL AND e.event_id=(SELECT value FROM app_settings WHERE key='active_event_id') GROUP BY e.id ORDER BY e.updated_at DESC LIMIT 500`).all();return json({exhibitors:rows.results}); }
  if(path==='/api/admin/exhibitors/publish'&&method==='POST') {
    const admin=await requireAdmin(request,env);if(isResponse(admin))return admin;const body=await request.json() as {id?:string;published?:boolean};if(!body.id)return json({error:'exhibitor_id_required'},400);const status=body.published?'published':'hidden';await env.DB.prepare('UPDATE exhibitors SET public_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(status,body.id).run();await audit(env,admin.id,'exhibitor.publication','exhibitor',body.id,{status});return json({ok:true,status});
  }
  if(path==='/api/exhibitor/me'&&method==='GET') {
    if(user.role!=='exhibitor')return json({error:'exhibitor_only'},403);const portalEnabled=(await env.DB.prepare("SELECT value FROM app_settings WHERE key='exhibitor_portal_enabled'").first<{value:string}>())?.value==='true';if(!portalEnabled)return json({error:'exhibitor_portal_disabled'},403);const rows=await env.DB.prepare(`SELECT e.id,e.event_id,e.name_th,e.name_en,e.description_th,e.description_en,e.website,e.public_status, GROUP_CONCAT(b.id, ',') AS booth_ids,GROUP_CONCAT(b.booth_number, ', ') AS booth_numbers FROM exhibitors e JOIN exhibitor_accounts ea ON ea.exhibitor_id=e.id JOIN exhibitor_booths eb ON eb.exhibitor_id=e.id JOIN booths b ON b.id=eb.booth_id WHERE ea.user_id=? AND e.archived_at IS NULL GROUP BY e.id`).bind(user.id).all();return json({exhibitors:rows.results});
  }
  if(path==='/api/exhibitor/submit'&&method==='POST') {
    if(user.role!=='exhibitor')return json({error:'exhibitor_only'},403);const portalEnabled=(await env.DB.prepare("SELECT value FROM app_settings WHERE key='exhibitor_portal_enabled'").first<{value:string}>())?.value==='true';if(!portalEnabled)return json({error:'exhibitor_portal_disabled'},403);const body=await request.json() as {exhibitorId?:string;nameTh?:string;nameEn?:string;descriptionTh?:string;descriptionEn?:string;website?:string};if(!body.exhibitorId)return json({error:'exhibitor_id_required'},400);const access=await env.DB.prepare('SELECT e.id,e.public_status FROM exhibitors e JOIN exhibitor_accounts ea ON ea.exhibitor_id=e.id WHERE e.id=? AND ea.user_id=? AND e.archived_at IS NULL').bind(body.exhibitorId,user.id).first<{id:string;public_status:string}>();if(!access)return json({error:'not_assigned'},403);const website=(body.website||'').trim();if(website&&!safeUrl(website))return json({error:'website_must_be_https'},400);const payload={nameTh:(body.nameTh||'').slice(0,200),nameEn:(body.nameEn||'').slice(0,200),descriptionTh:(body.descriptionTh||'').slice(0,5000),descriptionEn:(body.descriptionEn||'').slice(0,5000),website};const id=crypto.randomUUID();await env.DB.prepare("INSERT INTO submissions (id,exhibitor_id,submitted_by,status,payload_json) VALUES (?,?,?,'pending',?)").bind(id,access.id,user.id,JSON.stringify(payload)).run();await audit(env,user.id,'submission.create','submission',id,{});return json({id,status:'pending'},201);
  }
  if(path==='/api/admin/submissions'&&method==='GET') {const admin=await requireAdmin(request,env);if(isResponse(admin))return admin;const rows=await env.DB.prepare(`SELECT s.id,s.exhibitor_id,s.status,s.payload_json,s.review_note,s.created_at,e.name_th,e.name_en,u.email AS submitted_email FROM submissions s JOIN exhibitors e ON e.id=s.exhibitor_id JOIN users u ON u.id=s.submitted_by ORDER BY CASE s.status WHEN 'pending' THEN 0 ELSE 1 END,s.created_at DESC LIMIT 300`).all();return json({submissions:rows.results.map(r=>({...r,payload:parseJson(r.payload_json,'{}')}))});}
  if(path==='/api/admin/submissions/review'&&method==='POST') {
    const admin=await requireAdmin(request,env);if(isResponse(admin))return admin;const body=await request.json() as {id?:string;action?:'approve'|'return'|'reject'|'edit';note?:string;payload?:Record<string,unknown>};if(!body.id||!['approve','return','reject','edit'].includes(body.action||''))return json({error:'invalid_review_action'},400);const sub=await env.DB.prepare('SELECT * FROM submissions WHERE id=?').bind(body.id).first<{id:string;exhibitor_id:string;payload_json:string}>();if(!sub)return json({error:'not_found'},404);let status='pending';if(body.action==='approve'){const p=(body.payload||parseJson(sub.payload_json,{})) as Record<string,unknown>;const website=String(p.website||'');if(website&&!safeUrl(website))return json({error:'website_must_be_https'},400);await env.DB.prepare('UPDATE exhibitors SET name_th=?,name_en=?,description_th=?,description_en=?,website=?,public_status=\'published\',updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(String(p.nameTh||''),String(p.nameEn||''),String(p.descriptionTh||''),String(p.descriptionEn||''),website,sub.exhibitor_id).run();status='published';}else if(body.action==='return')status='returned';else if(body.action==='reject')status='rejected';else if(body.action==='edit'){const p=body.payload||{};await env.DB.prepare('UPDATE exhibitors SET name_th=?,name_en=?,description_th=?,description_en=?,website=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(String(p.nameTh||''),String(p.nameEn||''),String(p.descriptionTh||''),String(p.descriptionEn||''),String(p.website||''),sub.exhibitor_id).run();status='pending';}
    await env.DB.prepare('UPDATE submissions SET status=?,review_note=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?').bind(status,(body.note||'').slice(0,2000),admin.id,sub.id).run();await audit(env,admin.id,`submission.${body.action}`,'submission',sub.id,{status});return json({ok:true,status});
  }
  if(path==='/api/admin/settings'&&method==='PATCH') {
    const admin=await requireAdmin(request,env);if(isResponse(admin))return admin;const body=await request.json() as {exhibitorPortalEnabled?:boolean;visitorMapEnabled?:boolean;backupRetentionDays?:number};const values:Record<string,string>={};if(body.exhibitorPortalEnabled!==undefined)values.exhibitor_portal_enabled=String(body.exhibitorPortalEnabled);if(body.visitorMapEnabled!==undefined){values.visitor_map_enabled=String(body.visitorMapEnabled);await env.DB.prepare('UPDATE events SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=(SELECT value FROM app_settings WHERE key=\'active_event_id\')').bind(body.visitorMapEnabled?'public':'draft').run();}if(body.backupRetentionDays!==undefined){if(![7,30,90,180,365].includes(body.backupRetentionDays))return json({error:'invalid_retention_days'},400);values.backup_retention_days=String(body.backupRetentionDays);}for(const [key,value] of Object.entries(values))await env.DB.prepare('INSERT INTO app_settings (key,value,updated_by,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP').bind(key,value,admin.id).run();await audit(env,admin.id,'settings.update','settings','app',values);return json({ok:true,settings:values});
  }
  if(path==='/api/admin/audit'&&method==='GET') {const admin=await requireAdmin(request,env);if(isResponse(admin))return admin;const rows=await env.DB.prepare('SELECT a.*,u.email AS actor_email FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.created_at DESC LIMIT 200').all();return json({entries:rows.results});}
  if(path==='/api/admin/backup/export'&&method==='POST') {
    const admin=await requireAdmin(request,env);if(isResponse(admin))return admin;const tables=['events','users','exhibitors','booths','exhibitor_booths','exhibitor_accounts','images','submissions','audit_log','app_settings'];const backup:Record<string,unknown[]>={};for(const table of tables){const result=await env.DB.prepare(`SELECT * FROM ${table}`).all();backup[table]=result.results as unknown[];}const body=JSON.stringify({schemaVersion:1,createdAt:new Date().toISOString(),createdBy:admin.email,tables:backup});const key=`backups/${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}.json`;await env.FILES.put(key,body,{httpMetadata:{contentType:'application/json'}});const id=crypto.randomUUID();await env.DB.prepare("INSERT INTO backup_records (id,created_by,storage_key,backup_type,size_bytes,status) VALUES (?,?,?,'full',?,'verified')").bind(id,admin.id,key,new TextEncoder().encode(body).length).run();await audit(env,admin.id,'backup.create','backup',id,{key});return json({id,key,sizeBytes:new TextEncoder().encode(body).length,status:'verified'},201);
  }
  if(path==='/api/admin/backups'&&method==='GET') {const admin=await requireAdmin(request,env);if(isResponse(admin))return admin;const rows=await env.DB.prepare('SELECT id,storage_key,backup_type,entity_type,entity_id,size_bytes,status,created_at FROM backup_records ORDER BY created_at DESC LIMIT 100').all();return json({backups:rows.results});}
  if(path==='/api/admin/backup/download'&&method==='GET') {const admin=await requireAdmin(request,env);if(isResponse(admin))return admin;const id=url.searchParams.get('id');if(!id)return json({error:'id_required'},400);const record=await env.DB.prepare('SELECT storage_key FROM backup_records WHERE id=?').bind(id).first<{storage_key:string}>();if(!record)return json({error:'not_found'},404);const object=await env.FILES.get(record.storage_key);if(!object)return json({error:'backup_file_missing'},404);return new Response(object.body,{headers:{'content-type':'application/json','content-disposition':`attachment; filename="tte-backup-${id}.json"`,'cache-control':'no-store'}});}
  return json({error:'not_found'},404);
}
function parseJson<T>(value: unknown, fallback: T): T { try{return JSON.parse(String(value)) as T;}catch{return fallback;} }
function clamp(value: unknown,min:number,max:number):number { const n=Number(value);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):min; }
