import {test,expect,type Page} from '@playwright/test';
import {createSolo} from '../../src/features/campaign/domain/newRealm';

// Controller regression fixture only. RPC replies are synthetic; this is not a
// successful gameplay run. Separate live probes use the actual shared backend.
async function controller(page:Page,active=false){
 const world=createSolo('Controller');world.camps=[];delete world.map;
 if(active)world.battles=[{id:1,status:'active',attacker_army_id:world.armies[0].id,defender_army_id:null} as typeof world.battles[number]];
 const calls:string[]=[];let pending=0,hold=false,release=()=>{};
 await page.clock.install();await page.context().routeWebSocket('**',socket=>socket.close());
 await page.context().route('**/*.supabase.co/**',async route=>{
  const endpoint=new URL(route.request().url()).pathname.split('/').at(-1)!;calls.push(endpoint);pending++;
  try{
   if(endpoint==='peris_snapshot'&&hold){hold=false;await new Promise<void>(resolve=>{release=resolve;});await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Controlled snapshot failure'})});return;}
   if(endpoint==='settlements'){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Controlled cosmetic lookup failure'})});return;}
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(endpoint==='peris_snapshot'?world:{ok:true})});
  }finally{pending--;}
 });
 await page.goto('/');await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));
 await page.evaluate(async fixture=>{
  // @ts-expect-error Browser imports the actual engine through the Vite server.
  const {OnlineEngine}=await import('/src/engine/online/OnlineEngine.ts');
  (window as any).pollingController=new OnlineEngine(fixture.players[0].id,fixture);
 },world);
 const advance=async(seconds:number)=>{
  for(let i=0;i<seconds*4;i++){
   await page.clock.runFor(250);await new Promise(resolve=>setTimeout(resolve,5));
   await expect.poll(()=>pending).toBe(0);
  }
 };
 return {calls,world,advance,holdNext:()=>{hold=true;},release:()=>release()};
}

test('a confirmed player action retains its forced refresh when an older snapshot fails',async({page})=>{
 const probe=await controller(page);probe.holdNext();
 try{
  await page.evaluate(()=>{void (window as any).pollingController.refresh(false);});
  await expect.poll(()=>probe.calls.filter(c=>c==='peris_snapshot').length).toBe(1);
  await page.evaluate(async()=>{await (window as any).pollingController.command({type:'readAllReports'});});
  expect(probe.calls).toContain('peris_read_all_reports');
  probe.release();
  await expect.poll(()=>probe.calls.filter(c=>c==='peris_snapshot').length).toBe(2);
 }finally{probe.release();await page.evaluate(()=>(window as any).pollingController.destroy());}
});

test('active battles continue ticking while failing cosmetic lookups back off independently',async({page})=>{
 const {calls,advance}=await controller(page,true);
 try{
  await advance(20);
  expect(calls.filter(c=>c==='peris_tick').length,'battle ticks still run at the existing cadence').toBeGreaterThanOrEqual(15);
  expect(calls.filter(c=>c==='peris_snapshot').length).toBeGreaterThanOrEqual(15);
  expect(calls.filter(c=>c==='settlements').length,'cosmetic failures must not retry on every battle snapshot').toBeLessThanOrEqual(4);
 }finally{await page.evaluate(()=>(window as any).pollingController.destroy());}
});

test('a queued construction order retains fast state checks',async({page})=>{
 const {calls,world,advance}=await controller(page);
 world.orders.push({owner_id:world.players[0].id} as typeof world.orders[number]);
 // The controller receives the same pending-work fixture as an authoritative snapshot.
 await page.evaluate(orders=>{(window as any).pollingController.core.orders=orders;},world.orders);
 try{
  await advance(10);
  expect(calls.filter(c=>c==='sync_my_state').length).toBeGreaterThanOrEqual(3);
 }finally{await page.evaluate(()=>(window as any).pollingController.destroy());}
});
