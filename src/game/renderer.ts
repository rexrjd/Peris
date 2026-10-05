import type { Battle, BattleOrder, Formation, MapSelection, World } from '../types/game'
import { angleDiff, armyPosition, clamp, dist, FIELD_H, FIELD_W, formationSize, seeded, UNITS, WORLD_H, WORLD_W } from './rules'
import { house, makeTerrain } from './graphics'

export type RenderState={world:World;playerId:string;mode:'world'|'battle';battle?:Battle;selection?:MapSelection;selectedIds:number[];moveMode?:boolean;touchOrder?:'select'|'move'|'attack'}
export type RenderActions={selectMap:(s:MapSelection)=>void;moveArmy:(x:number,y:number)=>void;selectUnits:(ids:number[])=>void;order:(o:BattleOrder)=>void;pause:()=>void;rally:()=>void}
type Particle={x:number;y:number;vx:number;vy:number;life:number;max:number;kind:'arrow'|'dust'|'death'|'charge';tx?:number;ty?:number;startx?:number;starty?:number;color:string}

export class GameRenderer {
  private canvas:HTMLCanvasElement
  private c:CanvasRenderingContext2D
  private state:()=>RenderState
  private actions:()=>RenderActions
  private resize:ResizeObserver
  private frame=0
  private running=true
  private w=1;private h=1;private dpr=1
  private terrain:HTMLCanvasElement|null=null
  private terrainKey=''
  private lastSelection=''
  private camera={x:600,y:350,zoom:1}
  private zoomBase=1
  private down:{x:number;y:number;wx:number;wy:number;button:number;shift:boolean}|null=null
  private pointer={x:0,y:0}
  private keys=new Set<string>()
  private particles:Particle[]=[]
  private positions=new Map<number,{x:number;y:number;facing:number;soldiers:number}>()
  private deaths:{x:number;y:number;side:string;angle:number}[]=[]
  private last=0
  private previousStatus=new Map<number,string>()
  private lastVolley=0
  private cleanup:(()=>void)[]=[]
  constructor(canvas:HTMLCanvasElement,state:()=>RenderState,actions:()=>RenderActions){
    this.canvas=canvas;this.c=canvas.getContext('2d')!;this.state=state;this.actions=actions
    this.resize=new ResizeObserver(()=>this.setSize());this.resize.observe(canvas.parentElement!)
    this.bind();this.setSize();this.frame=requestAnimationFrame(t=>this.loop(t))
  }
  private setSize(){
    const rect=this.canvas.parentElement!.getBoundingClientRect();this.w=Math.max(1,rect.width);this.h=Math.max(1,rect.height);this.dpr=Math.min(2,window.devicePixelRatio||1)
    this.canvas.width=this.w*this.dpr;this.canvas.height=this.h*this.dpr;this.canvas.style.width=`${this.w}px`;this.canvas.style.height=`${this.h}px`
    const s=this.state();this.zoomBase=(s.mode==='world'&&this.w<600?Math.max:Math.min)(this.w/(s.mode==='battle'?FIELD_W:WORLD_W),this.h/(s.mode==='battle'?FIELD_H:WORLD_H))
    if(s.mode==='world')this.camera.y=WORLD_H/2
  }
  private on(target:EventTarget,event:string,fn:EventListener,options?:AddEventListenerOptions){target.addEventListener(event,fn,options);this.cleanup.push(()=>target.removeEventListener(event,fn,options))}
  private worldPoint(x:number,y:number){const scale=this.zoomBase*this.camera.zoom;return{x:(x-this.w/2)/scale+this.camera.x,y:(y-this.h/2)/scale+this.camera.y}}
  private coords(e:PointerEvent){const r=this.canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
  private bind(){
    this.on(this.canvas,'contextmenu',e=>e.preventDefault())
    this.on(this.canvas,'pointerdown',((e:PointerEvent)=>{
      e.preventDefault();this.canvas.focus();this.canvas.setPointerCapture(e.pointerId)
      const p=this.coords(e),wp=this.worldPoint(p.x,p.y);this.pointer=p;this.down={...p,wx:wp.x,wy:wp.y,button:e.button,shift:e.shiftKey}
    }) as EventListener)
    this.on(this.canvas,'pointermove',((e:PointerEvent)=>{
      const p=this.coords(e),s=this.state()
      if(this.down&&(this.down.button===1||(s.mode==='world'&&!s.moveMode&&this.down.button===0))){
        const scale=this.zoomBase*this.camera.zoom;this.camera.x-=(p.x-this.pointer.x)/scale;this.camera.y-=(p.y-this.pointer.y)/scale
      }
      this.pointer=p
    })as EventListener)
    this.on(this.canvas,'pointerup',((e:PointerEvent)=>{
      if(!this.down)return
      const down=this.down;this.down=null;const p=this.coords(e),wp=this.worldPoint(p.x,p.y),s=this.state(),a=this.actions(),drag=Math.hypot(p.x-down.x,p.y-down.y)
      if(s.mode==='world'){
        if(s.moveMode&&(e.button===0||e.button===2)){a.moveArmy(wp.x,wp.y);return}
        if(drag>7||e.button===1)return
        const target=this.mapHit(wp.x,wp.y)
        a.selectMap(target);return
      }
      const formations=s.world.formations.filter(f=>f.battle_id===s.battle?.id)
      const hit=this.formationHit(wp.x,wp.y,formations)
      if(e.button===2||s.touchOrder==='move'||s.touchOrder==='attack'){
        if(!s.selectedIds.length)return
        if(hit&&hit.owner_id!==s.playerId&&s.battle?.phase==='combat'){a.order({kind:'attack',ids:s.selectedIds,target:hit.id});return}
        if(drag>18&&e.button===2){
          const start=this.worldPoint(down.x,down.y),dx=wp.x-start.x,dy=wp.y-start.y
          a.order({kind:'move',ids:s.selectedIds,x:(wp.x+start.x)/2,y:(wp.y+start.y)/2,facing:Math.atan2(dy,dx)*180/Math.PI-90,columns:clamp(Math.round(Math.hypot(dx,dy)/8),4,20)})
        }else a.order({kind:'move',ids:s.selectedIds,x:wp.x,y:wp.y})
        return
      }
      if(e.button!==0)return
      if(drag>8){
        const start=this.worldPoint(down.x,down.y),x1=Math.min(start.x,wp.x),x2=Math.max(start.x,wp.x),y1=Math.min(start.y,wp.y),y2=Math.max(start.y,wp.y)
        const ids=formations.filter(f=>f.owner_id===s.playerId&&f.soldiers>0&&f.status!=='routed'&&f.x>=x1&&f.x<=x2&&f.y>=y1&&f.y<=y2).map(f=>f.id)
        a.selectUnits(down.shift?[...new Set([...s.selectedIds,...ids])]:ids)
      }else if(hit?.owner_id===s.playerId){
        a.selectUnits(down.shift?(s.selectedIds.includes(hit.id)?s.selectedIds.filter(id=>id!==hit.id):[...s.selectedIds,hit.id]):[hit.id])
      }else a.selectUnits([])
    })as EventListener)
    this.on(this.canvas,'pointercancel',()=>{this.down=null})
    this.on(this.canvas,'wheel',((e:WheelEvent)=>{
      e.preventDefault();const before=this.worldPoint(this.pointer.x,this.pointer.y);this.camera.zoom=clamp(this.camera.zoom*Math.exp(-e.deltaY*.001),.65,3.2)
      const after=this.worldPoint(this.pointer.x,this.pointer.y);this.camera.x+=before.x-after.x;this.camera.y+=before.y-after.y
    })as EventListener,{passive:false})
    this.on(window,'keydown',((e:KeyboardEvent)=>{
      if((e.target as HTMLElement)?.closest('input,select,textarea')||e.ctrlKey||e.metaKey)return
      const k=e.key.toLowerCase();this.keys.add(k);const s=this.state(),a=this.actions()
      if(s.mode!=='battle')return
      if([' ','a','h','g','r','f'].includes(k))e.preventDefault()
      const own=s.world.formations.filter(f=>f.battle_id===s.battle?.id&&f.owner_id===s.playerId&&f.soldiers>0&&f.status!=='routed')
      if(k==='a')a.selectUnits(own.map(f=>f.id))
      if(k==='h')a.order({kind:'halt',ids:s.selectedIds})
      if(k==='g')a.order({kind:'stance',ids:s.selectedIds,stance:'guard'})
      if(k==='r')a.rally()
      if(k===' ')a.pause()
      if(k==='escape')a.selectUnits([])
      if(/^[1-9]$/.test(k)){const f=own[Number(k)-1];if(f)a.selectUnits([f.id])}
      if(k==='f'&&s.selectedIds.length){const f=own.find(f=>f.id===s.selectedIds[0]);if(f){this.camera.x=f.x;this.camera.y=f.y}}
    })as EventListener)
    this.on(window,'keyup',((e:KeyboardEvent)=>{this.keys.delete(e.key.toLowerCase())})as EventListener)
    this.on(window,'blur',()=>{this.keys.clear();this.down=null})
  }
  private mapHit(x:number,y:number):MapSelection{
    const s=this.state();for(const a of s.world.armies){if(dist(armyPosition(a),{x,y})<22)return{kind:'army',id:a.id}}
    for(const town of s.world.settlements){if(dist({x:town.x,y:town.y-12},{x,y})<32)return{kind:'settlement',id:town.id}}
    for(const camp of s.world.camps){if(dist(camp,{x,y})<30)return{kind:'camp',id:camp.id}}
    return null
  }
  private formationHit(x:number,y:number,fs:Formation[]){
    return fs.filter(f=>f.soldiers>0).find(f=>{
      const pos=this.positions.get(f.id)??f,angle=-pos.facing*Math.PI/180,dx=x-pos.x,dy=y-pos.y
      const lx=dx*Math.cos(angle)-dy*Math.sin(angle),ly=dx*Math.sin(angle)+dy*Math.cos(angle),size=formationSize(f)
      return Math.abs(lx)<size.depth/2+12&&Math.abs(ly)<size.width/2+8
    })
  }
  private label(x:number,y:number,text:string,color='#efe3bd',small=false){
    const c=this.c;c.font=`${small?'10':'12'}px ${small?'Arial':'Georgia'}`;c.textAlign='center';c.textBaseline='middle';const width=c.measureText(text).width+16
    c.fillStyle='#222b27df';c.fillRect(x-width/2,y-9,width,18);c.fillStyle=color;c.fillText(text,x,y)
  }
  private drawWorld(t:number){
    const c=this.c,s=this.state(),pulse=.65+Math.sin(t/550)*.2
    for(const town of s.world.settlements){
      const mine=town.owner_id===s.playerId,selected=s.selection?.kind==='settlement'&&s.selection.id===town.id
      c.strokeStyle=selected?'#f1d995':mine?'#ecc58a99':'#6d8ead99';c.lineWidth=selected?2.5:1;c.beginPath();c.ellipse(town.x,town.y,43,21,0,0,Math.PI*2);c.stroke()
      house(c,town.x-19,town.y+2,.65);house(c,town.x+23,town.y+8,.7);house(c,town.x,town.y,1,'keep',mine?'#ad473b':'#5c7692')
      this.label(town.x,town.y+30,town.name,mine?'#f0dba6':'#d3ddec')
    }
    for(const camp of s.world.camps){
      const cleared=s.world.progress.some(p=>p.camp_id===camp.id&&p.defeated>0),selected=s.selection?.kind==='camp'&&s.selection.id===camp.id
      c.fillStyle='#20291d48';c.beginPath();c.ellipse(camp.x+4,camp.y+8,24,10,0,0,Math.PI*2);c.fill()
      c.fillStyle=cleared?'#5c775d':'#6e4036';c.beginPath();c.moveTo(camp.x-20,camp.y+5);c.lineTo(camp.x-3,camp.y-18);c.lineTo(camp.x+15,camp.y+5);c.closePath();c.fill()
      c.fillStyle=cleared?'#91a17b':'#ab7955';c.beginPath();c.moveTo(camp.x-20,camp.y+5);c.lineTo(camp.x-3,camp.y-18);c.lineTo(camp.x-3,camp.y+5);c.fill()
      c.strokeStyle='#584e35';c.lineWidth=1;c.beginPath();c.moveTo(camp.x+13,camp.y+5);c.lineTo(camp.x+13,camp.y-28);c.stroke();c.fillStyle=cleared?'#8aaa74':'#a9503b';c.fillRect(camp.x+13,camp.y-28,12,9)
      if(selected){c.strokeStyle='#f6dc9b';c.lineWidth=2;c.beginPath();c.arc(camp.x,camp.y,30,0,Math.PI*2);c.stroke()}
      this.label(camp.x,camp.y+23,camp.name,cleared?'#b9d2a1':'#efd1b4')
      this.label(camp.x,camp.y+40,`TIER ${camp.tier}${cleared?' · CONQUERED':''}`,'#bab99e',true)
    }
    for(const army of s.world.armies){
      const pos=armyPosition(army),mine=army.owner_id===s.playerId,color=mine?'#cf6c53':'#6c9fbc'
      if(army.status==='moving'&&Date.parse(army.arrival_at)>Date.now()){
        c.strokeStyle=mine?'#f0d49ab0':'#8eb9ca66';c.lineWidth=2;c.setLineDash([5,7]);c.lineDashOffset=-t/80;c.beginPath();c.moveTo(pos.x,pos.y);c.lineTo(army.target_x,army.target_y);c.stroke();c.setLineDash([])
        c.lineWidth=1;c.beginPath();c.arc(army.target_x,army.target_y,10+pulse*4,0,Math.PI*2);c.stroke()
      }
      c.fillStyle='#242b2290';c.beginPath();c.ellipse(pos.x+2,pos.y+3,16,8,0,0,Math.PI*2);c.fill()
      c.fillStyle=color;c.beginPath();c.moveTo(pos.x,pos.y-17);c.lineTo(pos.x+11,pos.y-4);c.lineTo(pos.x,pos.y+9);c.lineTo(pos.x-11,pos.y-4);c.closePath();c.fill();c.strokeStyle='#efdbac';c.lineWidth=1;c.stroke()
      c.strokeStyle='#f0e0bf';c.lineWidth=1.5;c.beginPath();c.moveTo(pos.x-4,pos.y-9);c.lineTo(pos.x+4,pos.y+1);c.moveTo(pos.x+4,pos.y-9);c.lineTo(pos.x-4,pos.y+1);c.stroke()
      this.label(pos.x,pos.y+19,`${army.infantry+army.archers+army.cavalry}`,mine?'#f1d6ac':'#c9deea',true)
    }
    if(s.moveMode){const wp=this.worldPoint(this.pointer.x,this.pointer.y);c.strokeStyle='#f8e3af';c.lineWidth=2;c.beginPath();c.arc(wp.x,wp.y,12,0,Math.PI*2);c.moveTo(wp.x-20,wp.y);c.lineTo(wp.x+20,wp.y);c.moveTo(wp.x,wp.y-20);c.lineTo(wp.x,wp.y+20);c.stroke()}
  }
  private soldier(x:number,y:number,f:Formation,index:number,time:number,dead=false){
    const c=this.c,own=f.owner_id===this.state().playerId,moving=f.status==='moving'||f.status==='routed',jitter=moving?Math.sin(time/100+index*1.7)*1.2:Math.sin(time/450+index)*.2
    c.save();c.translate(x,y+jitter);if(dead)c.rotate(index*2.3)
    c.fillStyle='#26302360';c.beginPath();c.ellipse(1.5,2.5,f.unit_type==='cavalry'?7:3.2,2,0,0,Math.PI*2);c.fill()
    if(f.unit_type==='cavalry'){
      c.fillStyle=own?'#705039':'#595343';c.beginPath();c.ellipse(-1,0,5.8,2.8,0,0,Math.PI*2);c.fill();c.fillRect(3,-1.4,3,2.4)
      c.strokeStyle='#393f30';c.lineWidth=1;for(const side of [-1,1]){c.beginPath();c.moveTo(-3,side*2);c.lineTo(-4+(moving?Math.sin(time/75+index)*2:0),side*4);c.moveTo(2,side*2);c.lineTo(2+(moving?Math.cos(time/75+index)*2:0),side*4);c.stroke()}
    }
    c.fillStyle=dead?'#644039':own?(f.unit_type==='archers'?'#697249':'#a54235'):(f.unit_type==='archers'?'#556448':'#567587');c.fillRect(-2,-2,5,4)
    c.fillStyle='#d3c396';c.beginPath();c.arc(1,0,1.75,0,Math.PI*2);c.fill();c.fillStyle='#8a917a';c.fillRect(1,-1.5,1.4,3)
    if(f.unit_type==='infantry'){
      c.fillStyle=own?'#b7533c':'#668ba2';c.fillRect(2.5,-3,2.5,4.5);c.strokeStyle='#e4cd94';c.lineWidth=.6;c.strokeRect(2.5,-3,2.5,4.5)
      c.strokeStyle='#dbd5b2';c.lineWidth=.7;c.beginPath();c.moveTo(3,3);c.lineTo(9,2.5);c.stroke()
    }else if(f.unit_type==='archers'){
      c.strokeStyle='#c3aa73';c.lineWidth=.8;c.beginPath();c.arc(4,0,2.6,-Math.PI*.55,Math.PI*.55);c.stroke()
    }else{c.strokeStyle='#cbbb8c';c.lineWidth=.8;c.beginPath();c.moveTo(0,3);c.lineTo(11,3);c.stroke()}
    c.restore()
  }
  private drawBattle(time:number,dt:number){
    const c=this.c,s=this.state(),b=s.battle!,fs=s.world.formations.filter(f=>f.battle_id===b.id),rng=seeded(Math.floor(time/100))
    if(b.phase==='deployment'){
      c.fillStyle='#b7633523';c.fillRect(25,30,340,640);c.strokeStyle='#e4c67c55';c.lineWidth=2;c.strokeRect(25,30,340,640)
      c.fillStyle='#57748d23';c.fillRect(835,30,340,640);c.strokeStyle='#7b9dba55';c.strokeRect(835,30,340,640)
      c.font='18px Georgia';c.fillStyle='#f3d6a577';c.textAlign='center';c.fillText('DEPLOYMENT',195,65);c.fillStyle='#c4d3d877';c.fillText('DEPLOYMENT',1005,65)
    }
    for(const d of this.deaths){c.save();c.translate(d.x,d.y);c.rotate(d.angle);c.fillStyle=d.side==='attacker'?'#804e3690':'#46565a90';c.fillRect(-3,-1,6,3);c.fillStyle='#b5ad8970';c.fillRect(2,-1,2,2);c.restore()}
    const volley=Math.floor(b.elapsed*2),newVolley=volley!==this.lastVolley;this.lastVolley=volley
    for(const f of fs){
      const own=f.owner_id===s.playerId,selected=s.selectedIds.includes(f.id),size=formationSize(f)
      let pos=this.positions.get(f.id)
      if(!pos){pos={x:f.x,y:f.y,facing:f.facing,soldiers:f.soldiers};this.positions.set(f.id,pos)}
      if(pos.soldiers>f.soldiers){for(let i=0;i<Math.min(5,pos.soldiers-f.soldiers);i++){this.deaths.push({x:pos.x+(rng()-.5)*size.depth,y:pos.y+(rng()-.5)*size.width,side:f.side,angle:rng()*6.28})}pos.soldiers=f.soldiers;if(this.deaths.length>700)this.deaths.splice(0,this.deaths.length-700)}
      const amount=1-Math.exp(-dt*(s.world.version===6?7:8));pos.x+=(f.x-pos.x)*amount;pos.y+=(f.y-pos.y)*amount;pos.facing+=angleDiff(f.facing,pos.facing)*amount
      if(f.soldiers<=0)continue
      if(own&&(f.target_formation_id||f.status==='moving')&&b.phase==='combat'){
        const target=fs.find(t=>t.id===f.target_formation_id),tx=target?.x??f.target_x,ty=target?.y??f.target_y
        c.strokeStyle=target?'#d9876999':'#eed49888';c.lineWidth=1.2;c.setLineDash([4,6]);c.beginPath();c.moveTo(pos.x,pos.y);c.lineTo(tx,ty);c.stroke();c.setLineDash([])
        c.strokeStyle=target?'#d98769':'#eed498';c.beginPath();c.arc(tx,ty,6,0,Math.PI*2);c.stroke()
      }
      if(selected&&f.unit_type==='archers'){c.fillStyle='#ecd39008';c.strokeStyle='#ead09744';c.lineWidth=1;c.beginPath();c.arc(pos.x,pos.y,220,0,Math.PI*2);c.fill();c.stroke()}
      if(newVolley&&b.phase==='combat'&&f.unit_type==='archers'&&f.target_formation_id&&f.status==='engaged'){
        const target=fs.find(t=>t.id===f.target_formation_id)
        if(target&&dist(f,target)>65&&dist(f,target)<224)for(let i=0;i<4;i++)this.particles.push({kind:'arrow',x:pos.x,y:pos.y,startx:pos.x+(rng()-.5)*25,starty:pos.y+(rng()-.5)*25,tx:target.x+(rng()-.5)*25,ty:target.y+(rng()-.5)*25,vx:0,vy:0,life:.65,max:.65,color:'#f0deac'})
      }
      c.save();c.translate(pos.x,pos.y);c.rotate(pos.facing*Math.PI/180)
      if(selected){c.strokeStyle='#ffe3a0';c.lineWidth=1.8;c.fillStyle='#f7dd960d';c.fillRect(-size.depth/2-6,-size.width/2-6,size.depth+12,size.width+12);c.strokeRect(-size.depth/2-6,-size.width/2-6,size.depth+12,size.width+12)}
      if(f.status==='routed')c.globalAlpha=.55
      const count=Math.min(120,f.soldiers),cols=Math.min(f.columns,count),rows=Math.ceil(count/cols)
      for(let i=0;i<count;i++){
        const col=i%cols,row=Math.floor(i/cols),sx=(row-(rows-1)/2)*8,sy=(col-(cols-1)/2)*8
        this.soldier(sx,sy,f,i,time)
      }
      c.restore()
      // A small raised standard identifies a formation without covering its soldiers.
      const bx=pos.x,by=pos.y-size.width/2-21
      c.strokeStyle='#595b44';c.lineWidth=1;c.beginPath();c.moveTo(bx,by+12);c.lineTo(bx,by-7);c.stroke();c.fillStyle=own?'#ac4c38':'#557991';c.fillRect(bx,by-7,12,8)
      this.label(pos.x,pos.y+size.width/2+16,`${f.soldiers} ${f.status==='routed'?'· ROUTING':f.charge_ready?'· CHARGE':''}`,own?'#f5dba2':'#d3e2e8',true)
      c.fillStyle='#273124';c.fillRect(pos.x-20,pos.y+size.width/2+27,40,3);c.fillStyle=f.morale<30?'#b5583f':own?'#cab071':'#779ca6';c.fillRect(pos.x-20,pos.y+size.width/2+27,40*f.morale/100,3)
      const previous=this.previousStatus.get(f.id)
      if(previous!==f.status&&f.status==='engaged'&&f.unit_type==='cavalry'){
        for(let i=0;i<12;i++)this.particles.push({kind:'charge',x:pos.x+(rng()-.5)*30,y:pos.y+(rng()-.5)*30,vx:(rng()-.5)*50,vy:(rng()-.5)*50,life:.65,max:.65,color:'#dcbe80'})
      }
      this.previousStatus.set(f.id,f.status)
      if(f.status==='moving'&&rng()>.85)this.particles.push({kind:'dust',x:pos.x,y:pos.y,vx:-6,vy:5,life:.6,max:.6,color:'#d3c28a'})
    }
    for(const p of this.particles){
      p.life-=dt;c.globalAlpha=clamp(p.life/p.max,0,1)
      if(p.kind==='arrow'){
        const progress=1-p.life/p.max,tx=p.startx!+(p.tx!-p.startx!)*progress,ty=p.starty!+(p.ty!-p.starty!)*progress-Math.sin(progress*Math.PI)*20
        c.strokeStyle=p.color;c.lineWidth=1;c.beginPath();c.moveTo(tx,ty);c.lineTo(tx-(p.tx!-p.startx!)*.025,ty-(p.ty!-p.starty!)*.025);c.stroke()
      }else{p.x+=p.vx*dt;p.y+=p.vy*dt;c.fillStyle=p.color;c.beginPath();c.arc(p.x,p.y,p.kind==='charge'?3:2.5,0,Math.PI*2);c.fill()}
    }c.globalAlpha=1;this.particles=this.particles.filter(p=>p.life>0)
  }
  private minimap(){
    const c=this.c,s=this.state(),w=160,h=s.mode==='battle'?94:103,x=this.w-w-14,y=14,worldW=s.mode==='battle'?FIELD_W:WORLD_W,worldH=s.mode==='battle'?FIELD_H:WORLD_H
    c.fillStyle='#17251de0';c.fillRect(x-4,y-4,w+8,h+8);c.drawImage(this.terrain!,x,y,w,h);c.strokeStyle='#d3c38d70';c.lineWidth=1;c.strokeRect(x,y,w,h)
    if(s.mode==='battle')for(const f of s.world.formations.filter(f=>f.battle_id===s.battle?.id&&f.soldiers>0)){c.fillStyle=f.owner_id===s.playerId?'#f0bd75':'#8bb5d0';c.fillRect(x+f.x/worldW*w-2,y+f.y/worldH*h-2,4,4)}
    else{for(const town of s.world.settlements){c.fillStyle=town.owner_id===s.playerId?'#f4cf7f':'#8ab3c4';c.fillRect(x+town.x/worldW*w-2,y+town.y/worldH*h-2,4,4)}}
    const scale=this.zoomBase*this.camera.zoom,viewW=this.w/scale,viewH=this.h/scale
    c.strokeStyle='#f0e0bdaa';c.strokeRect(x+(this.camera.x-viewW/2)/worldW*w,y+(this.camera.y-viewH/2)/worldH*h,viewW/worldW*w,viewH/worldH*h)
  }
  private loop(time:number){
    if(!this.running)return;const dt=Math.min(.1,(time-(this.last||time))/1000);this.last=time
    const s=this.state(),c=this.c,key=`${s.mode}:${s.battle?.terrain??'plains'}`
    if(key!==this.terrainKey){this.terrainKey=key;this.terrain=makeTerrain(s.mode==='world'?'world':'battle',s.battle?.terrain);this.positions.clear();this.deaths=[];this.setSize()}
    if(s.mode==='world'&&this.w<600&&s.selection){const key=`${s.selection.kind}:${s.selection.id}`;if(key!==this.lastSelection){this.lastSelection=key;const item=s.selection.kind==='camp'?s.world.camps.find(c=>c.id===s.selection!.id):s.selection.kind==='settlement'?s.world.settlements.find(c=>c.id===s.selection!.id):s.world.armies.find(c=>c.id===s.selection!.id);if(item){const pos='target_x' in item?armyPosition(item):item;this.camera.x=pos.x+150;this.camera.y=WORLD_H/2}}}
    const scale=this.zoomBase*this.camera.zoom,pan=260*dt/this.camera.zoom
    if(this.keys.has('arrowleft')||this.keys.has('j'))this.camera.x-=pan
    if(this.keys.has('arrowright')||this.keys.has('l'))this.camera.x+=pan
    if(this.keys.has('arrowup')||this.keys.has('i'))this.camera.y-=pan
    if(this.keys.has('arrowdown')||this.keys.has('k'))this.camera.y+=pan
    this.camera.x=clamp(this.camera.x,0,1200);this.camera.y=clamp(this.camera.y,0,s.mode==='world'?770:700)
    c.setTransform(this.dpr,0,0,this.dpr,0,0);c.fillStyle='#30362b';c.fillRect(0,0,this.w,this.h);c.save();c.translate(this.w/2,this.h/2);c.scale(scale,scale);c.translate(-this.camera.x,-this.camera.y);c.drawImage(this.terrain!,0,0)
    if(s.mode==='world')this.drawWorld(time);else this.drawBattle(time,dt)
    c.restore()
    if(this.down&&s.mode==='battle'){
      if(this.down.button===0&&Math.hypot(this.pointer.x-this.down.x,this.pointer.y-this.down.y)>8){
        c.fillStyle='#f1d79712';c.strokeStyle='#f4d896';c.lineWidth=1;c.fillRect(this.down.x,this.down.y,this.pointer.x-this.down.x,this.pointer.y-this.down.y);c.strokeRect(this.down.x,this.down.y,this.pointer.x-this.down.x,this.pointer.y-this.down.y)
      }else if(this.down.button===2){c.strokeStyle='#f1dfad';c.lineWidth=3;c.beginPath();c.moveTo(this.down.x,this.down.y);c.lineTo(this.pointer.x,this.pointer.y);c.stroke()}
    }
    this.minimap();this.frame=requestAnimationFrame(t=>this.loop(t))
  }
  zoom(delta:number){this.camera.zoom=clamp(this.camera.zoom*delta,.65,3.2)}
  center(x=600,y=this.state().mode==='world'?385:350){this.camera.x=x;this.camera.y=y;this.camera.zoom=1}
  destroy(){this.running=false;cancelAnimationFrame(this.frame);this.resize.disconnect();this.cleanup.forEach(fn=>fn())}
}
