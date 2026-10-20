import {test,expect,type Page} from '@playwright/test';
// @ts-expect-error Existing isolated PostgreSQL HTTP fixture is plain JavaScript.
import {accountServer} from '../helpers/account-server.mjs';

let server:Awaited<ReturnType<typeof accountServer>>;
test.beforeAll(async()=>{server=await accountServer();});
test.afterAll(async()=>{await server.close();});

async function connect(page:Page,name:string){
 const calls:string[]=[];let pending=0;const failure={core:false,map:false,social:false};
 await page.clock.install();
 await page.context().routeWebSocket('**',socket=>socket.close());
 await page.context().addInitScript(()=>{
  localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));
  const original=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(type:string,...args:unknown[]){
   return ['webgl','webgl2','experimental-webgl'].includes(type)?null:Reflect.apply(original,this,[type,...args]);
  } as typeof original;
 });
 await page.context().route('**/*.supabase.co/**',async route=>{
  const request=route.request(),endpoint=new URL(request.url()).pathname.split('/').at(-1)!;
  calls.push(endpoint);pending++;
  try{
   if(endpoint==='sync_my_state'&&failure.core||endpoint==='peris_map_snapshot'&&failure.map||endpoint==='peris_social_snapshot'&&failure.social){
    await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Reporter check: synthetic server overload',code:'53300'})});return;
   }
   const response=await server.request(request.url(),request.method(),request.headers(),request.postDataJSON()??{});
   await route.fulfill({status:response.status,headers:response.headers,body:response.data==null?'':JSON.stringify(response.data)});
  }finally{pending--;}
 });
 await page.goto('/');await page.getByRole('button',{name:'Shared world',exact:true}).click();
 await page.getByRole('button',{name:'Create account',exact:true}).click();await page.getByLabel('Name your ruler').fill(name);
 await page.locator('.account-create .account-primary').click();await expect(page.getByLabel('Game menu')).toBeVisible();
 await page.getByRole('navigation',{name:'Game navigation'}).getByRole('button',{name:'Armies',exact:true}).click();
 await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));
 const advance=async(seconds:number)=>{
  for(let i=0;i<seconds;i++){
   await page.clock.runFor(1000);
   await new Promise(resolve=>setTimeout(resolve,25));
   await expect.poll(()=>pending).toBe(0);
  }
 };
 await expect.poll(()=>pending).toBe(0);calls.length=0;
 return {calls,advance,failure};
}

test('idle accounts avoid repeatedly settling and downloading an unchanged world',async({page},info)=>{
 const {calls,advance}=await connect(page,'Idle Poller');
 await advance(20);
 const count=(name:string)=>calls.filter(c=>c===name).length;
 expect(count('sync_my_state'),'idle polling continues').toBeGreaterThanOrEqual(1);
 expect(count('sync_my_state'),'at most two idle settlements plus one boundary request in twenty seconds').toBeLessThanOrEqual(3);
 expect(count('peris_snapshot'),'idle private snapshots follow the same budget').toBeLessThanOrEqual(3);
 expect(count('peris_snapshot')).toBeGreaterThanOrEqual(1);
 expect(count('peris_map_snapshot'),'unchanged public viewport is not downloaded every five seconds').toBeLessThanOrEqual(2);
 expect(count('peris_social_snapshot'),'closed-panel unread badges still update within ten seconds').toBeLessThanOrEqual(2);
 expect(count('peris_social_snapshot')).toBeGreaterThanOrEqual(1);
 await page.screenshot({path:info.outputPath('idle-shared-account.png')});
});

test('opening messages keeps summary polling bounded',async({page})=>{
 const {calls,advance}=await connect(page,'Social Poller');
 await page.getByRole('navigation',{name:'Community navigation'}).getByRole('button',{name:/^Messages/}).click();
 await expect(page.getByRole('dialog',{name:'Messages',exact:true})).toBeVisible();
 await expect.poll(()=>calls.filter(c=>c==='peris_social_snapshot').length).toBeGreaterThan(0);
 calls.length=0;await advance(20);
 expect(calls.filter(c=>c==='peris_social_snapshot').length).toBeLessThanOrEqual(4);
});

test('map and social outages back off without stopping healthy private-state checks',async({page})=>{
 const {calls,advance,failure}=await connect(page,'Partial Poller');failure.map=true;failure.social=true;
 await page.getByRole('navigation',{name:'Community navigation'}).getByRole('button',{name:/^Messages/}).click();
 await advance(35);
 expect(calls.filter(c=>c==='peris_map_snapshot').length).toBeLessThanOrEqual(4);
 expect(calls.filter(c=>c==='peris_social_snapshot').length).toBeLessThanOrEqual(4);
 expect(calls.filter(c=>c==='peris_snapshot').length).toBeGreaterThan(1);
 failure.map=false;failure.social=false;calls.length=0;await advance(65);
 expect(calls).toContain('peris_map_snapshot');expect(calls).toContain('peris_social_snapshot');
 await expect(page.getByText('Reporter check: synthetic server overload',{exact:true})).toHaveCount(0);
});

test('background state requests back off after overload and then recover',async({page},info)=>{
 const {calls,advance,failure}=await connect(page,'Retry Poller');failure.core=true;
 await advance(35);
 expect(calls.filter(c=>c==='sync_my_state').length,'overload must not trigger another attempt every 2.5 seconds').toBeLessThanOrEqual(4);
 await expect(page.getByText('Reporter check: synthetic server overload',{exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('controlled-overload.png')});
 failure.core=false;calls.length=0;await advance(65);
 expect(calls).toContain('peris_snapshot');
 await expect(page.getByText('Reporter check: synthetic server overload',{exact:true})).toHaveCount(0);
 await expect(page.getByLabel('Game menu')).toBeVisible();
});
