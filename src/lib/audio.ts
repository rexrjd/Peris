let context:AudioContext|undefined
let enabled=localStorage.getItem('peris-sound')==='on'
export function audioEnabled(){return enabled}
export function setAudio(value:boolean){enabled=value;localStorage.setItem('peris-sound',value?'on':'off');if(value)tone('order')}
export function tone(kind:'order'|'success'|'error'){
 if(!enabled)return
 try{
  context??=new AudioContext();void context.resume();const at=context.currentTime
  const notes=kind==='success'?[220,277,330,440]:kind==='error'?[180,120]:[330,440]
  notes.forEach((freq,i)=>{const o=context!.createOscillator(),g=context!.createGain();o.type='triangle';o.frequency.value=freq;g.gain.setValueAtTime(0,at+i*.065);g.gain.linearRampToValueAtTime(.035,at+i*.065+.01);g.gain.exponentialRampToValueAtTime(.001,at+i*.065+.14);o.connect(g);g.connect(context!.destination);o.start(at+i*.065);o.stop(at+i*.065+.16)})
 }catch{/* Audio is optional. */}
}
