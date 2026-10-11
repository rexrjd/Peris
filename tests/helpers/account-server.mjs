import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
// Isolated HTTP Auth stand-in backed by the actual generated game SQL. Tests
// never create users or alter data in the configured production Supabase project.
export async function accountServer(){
 const db=new PGlite();let next=1;
 const sessions=new Map(),expired=new Set(),logins=[];
 await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime`);
 await db.exec(await readFile('supabase/FRESH_INSTALL_V15.sql','utf8'));
 const user=id=>({id,aud:'authenticated',role:'authenticated',is_anonymous:true,app_metadata:{provider:'anonymous',providers:['anonymous']},user_metadata:{},identities:[],created_at:new Date().toISOString()});
 const token=id=>[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:id,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'local-test-signature'].join('.');
 const receipt=id=>({access_token:token(id),token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,refresh_token:'refresh-'+id,user:user(id)});
 const result=(status,data)=>({status,data,headers:{'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type,x-client-info,x-supabase-api-version','access-control-allow-methods':'GET,POST,OPTIONS'}});
 async function request(url,method,headers,body){
  const path=new URL(url).pathname;
  if(method==='OPTIONS')return result(204,null);
  const auth=headers.authorization??headers.Authorization??'';
  let id;try{id=JSON.parse(Buffer.from(auth.replace(/^Bearer /i,'').split('.')[1],'base64url').toString()).sub;}catch{}
  if(path==='/auth/v1/signup'){
   id=`90000000-0000-4000-8000-${String(next++).padStart(12,'0')}`;
   await db.query('insert into auth.users(id)values($1)',[id]);sessions.set(id,true);return result(200,receipt(id));
  }
  if(path==='/auth/v1/logout')return result(204,null);
  if(path==='/auth/v1/token'){
   const owner=body.refresh_token?.replace(/^refresh-/,'');
   if(!sessions.has(owner)||expired.has(owner))return result(400,{code:'refresh_token_not_found',msg:'Invalid Refresh Token'});
   return result(200,receipt(owner));
  }
  const publicDirectory=path==='/rest/v1/rpc/peris_account_directory';
  if(!publicDirectory&&(!sessions.has(id)||expired.has(id)))return result(401,{code:'PGRST301',message:'JWT expired'});
  if(path==='/auth/v1/user')return result(200,user(id));
  try{
   return await db.transaction(async tx=>{
    await tx.exec(publicDirectory?'set local role anon':'set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[publicDirectory?'':id]);
    if(path.startsWith('/rest/v1/rpc/')){
     const name=path.split('/').at(-1);
     // Only existing named test RPCs, with parameters bound as values.
     const args={peris_login:['p_display_name'],peris_enter_account:['p_display_name','p_mode','p_faction','p_creation_id'],peris_account_directory:['p_search','p_faction','p_activity','p_sort','p_offset','p_limit'],peris_snapshot:[],sync_my_state:[],peris_map_snapshot:['p_min_x','p_min_y','p_max_x','p_max_y'],peris_rename:['p_name']};
     if(!Object.hasOwn(args,name))return result(400,{message:'Unexpected test RPC: '+name});
     const values=args[name].map(k=>body[k]);
     const rows=await tx.query(`select public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) result`,values);
     const data=rows.rows[0].result;if(name==='peris_login'||name==='peris_enter_account')logins.push({auth_id:id,...data});
     return result(200,data);
    }
    const table=path.split('/').at(-1),select=new URL(url).searchParams.get('select');
    if(table==='armies'&&select==='id,owner_id,home_settlement_id')return result(200,(await tx.query('select id,owner_id,home_settlement_id from public.armies')).rows);
    if(table==='settlements'&&select==='id,faction')return result(200,(await tx.query('select id,faction from public.settlements')).rows);
    return result(400,{message:'Unexpected test request: '+path});
   });
  }catch(error){return result(/^PT\d{3}$/.test(error.code??'')?Number(error.code.slice(2)):400,{code:error.code,message:error.message});}
 }
 return {request,logins,async seed(name,faction='roman'){const auth=await request('https://local.supabase.co/auth/v1/signup','POST',{},{});const token=auth.data.access_token;return(await request('https://local.supabase.co/rest/v1/rpc/peris_enter_account','POST',{authorization:'Bearer '+token},{p_display_name:name,p_mode:'create',p_faction:faction,p_creation_id:crypto.randomUUID()})).data;},async faction(id){return(await db.query('select faction from public.settlements where owner_id=$1 order by id',[id])).rows[0].faction;},expire:id=>expired.add(id),async counts(){return(await db.query('select (select count(*)from public.players)players,(select count(*)from public.settlements)cities,(select count(*)from public.armies)armies')).rows[0];},async close(){await db.close();}};
}
