import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { filterInbox, inboxReceipt, type InboxQuery } from '../src/features/campaign/domain/reportInbox';
import { markAllReportsRead, unreadReportCount } from '../src/features/campaign/domain/reports';
import type { Report } from '../src/features/campaign/domain/types';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportDetails } from '../src/features/campaign/ui/ReportDetails';
import { heroPortraitUrl } from '../src/features/heroes/domain/portraits';

(globalThis as any).React=React;

function fixture() {
    const world=createSolo('Reader'), camp=world.camps[0], date=world.server_now;
    const report={id:1,battle_id:101,camp_id:camp.id,owner_id:'solo-ruler',title:'Older victory',won:true,result:{attacker_losses:2,defender_losses:9,loot:{wood:50,stone:0,food:0,gold:0},delivered:{wood:30,stone:0,food:0,gold:0},replacement_cost:{wood:10,stone:5,food:0,gold:0}},created_at:date} as Report;
    world.reports=[report,{...report,id:2,battle_id:102,title:'Recent defeat',won:false,read_at:date,created_at:new Date(Date.parse(date)+1000).toISOString()},{...report,id:3,battle_id:103,owner_id:'rival',title:'Private rival'}, {...report,id:4,battle_id:104,camp_id:undefined,title:'Neutral older battle'}];
    return world;
}
const query:InboxQuery={filter:'all',search:'',outcome:'all',order:'newest'};
test('inbox search and filters retain privacy, chronology and report-side uncertainty',()=>{
    const world=fixture();
    assert.deepEqual(filterInbox(world,'solo-ruler',query).map(row=>row.id),[2,4,1]);
    assert.deepEqual(filterInbox(world,'solo-ruler',{...query,filter:'unread'}).map(row=>row.id),[4,1]);
    assert.deepEqual(filterInbox(world,'solo-ruler',{...query,filter:'losses'}).map(row=>row.id),[2,1]);
    assert.deepEqual(filterInbox(world,'solo-ruler',{...query,search:'RECENT',outcome:'defeat'}).map(row=>row.id),[2]);
    assert.deepEqual(filterInbox(world,'solo-ruler',{...query,order:'oldest'}).map(row=>row.id),[1,4,2]);
    assert.equal(inboxReceipt(world,world.reports[3],'solo-ruler').losses,null);
    assert.equal(inboxReceipt(world,world.reports[0],'solo-ruler').net,15);
});
test('read all preserves first timestamps, excludes rivals and leaves later reports unread',()=>{
    const world=fixture(), first=world.reports[1].read_at!, now=new Date(Date.parse(first)+2000).toISOString();
    markAllReportsRead(world,'solo-ruler',now);
    assert.equal(world.reports[1].read_at,first);
    assert.equal(world.reports[0].read_at,now);
    assert.equal(world.reports[2].read_at,undefined);
    assert.equal(unreadReportCount(world,'solo-ruler'),0);
    world.reports.push({...world.reports[0],id:9,read_at:null});
    assert.equal(unreadReportCount(world,'solo-ruler'),1);
    world.unread_report_count=80;
    assert.equal(unreadReportCount(world,'solo-ruler',true),80);
    assert.equal(unreadReportCount(world,'solo-ruler'),1);
});
test('older hero rewards retain their recorded army race when portrait metadata is absent',()=>{
    const world=fixture(), report=world.reports[0];
    report.result.attacker_faction='orc';
    report.result.hero_reward={hero_id:1,hero_name:'Older commander',hero_class:'knight',experience:110,experience_before:0,experience_after:110,level_before:1,level_after:2,artifacts:[]};
    const html=renderToStaticMarkup(React.createElement(ReportDetails,{world,playerId:'solo-ruler',report}));
    assert.ok(html.includes(heroPortraitUrl('orc','knight',1)));
    assert.ok(!html.includes(heroPortraitUrl('roman','knight',1)));
});
