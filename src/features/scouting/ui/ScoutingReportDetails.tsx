import type {ScoutingResult} from '../domain/types';
import {FACTIONS} from '../../factions/domain/factions';
import {TroopSummary} from '../../army/ui/TroopSummary';
import {Cost} from '../../../shared/ui/Shared';
import {Icon} from '../../../shared/ui/Icons';
import {CELL_SIZE} from '../../map/domain/dimensions';

/** Render the saved observation only. Live enemy state is never an intel source. */
export function ScoutingReportDetails({scouting,defender=false}:{scouting:ScoutingResult;defender?:boolean}){
 const intel=scouting.success&&!defender,title=defender?'Scouts detected':scouting.success?'Scouting successful':'Scouting failed';
 return <div className="report-detail-body scouting-report">
  <header className="report-detail-heading"><span className={`report-outcome outcome-${intel?'victory':'defeat'}`}><Icon name="focus" size={22}/></span><div><span className="report-detail-kicker">{title}</span><h2>{scouting.target.name}</h2><p>{FACTIONS[scouting.target.faction].name} · ({Math.floor(scouting.target.x/CELL_SIZE)} | {Math.floor(scouting.target.y/CELL_SIZE)})</p></div></header>
  <p className="scouting-observed"><Icon name="time" size={15}/><span>Observed at <time dateTime={scouting.observed_at}>{new Date(scouting.observed_at).toLocaleString()}</time></span></p>
  {defender?<><p className="report-note">{scouting.sender_name?`${scouting.sender_name}'s scouts were detected at this location.`:'Foreign scouts were detected at this location.'} Your troops took no losses.</p><dl className="scouting-intercepted"><div><dt>Scouts intercepted</dt><dd>{scouting.scouts_lost.toLocaleString()}</dd></div></dl></>:<>
   <div className="report-key-stats"><div><small>Scouts sent</small><strong>{scouting.scouts_sent.toLocaleString()}</strong></div><div><small>Scouts lost</small><strong className={scouting.scouts_lost?'has-losses':''}>{scouting.scouts_lost.toLocaleString()}</strong></div><div><small>Survived</small><strong>{scouting.scouts_survived.toLocaleString()}</strong></div></div>
   <p className="report-note">{scouting.success?<>{scouting.detected?'Your scouts were detected.':'Your scouts passed unnoticed.'} Survivors return to a safe home city.</>:'No enemy intelligence was recovered.'}</p>
  </>}
  {!intel&&scouting.reason&&<p className="report-note">{scouting.reason}</p>}
  {intel&&<>
   {scouting.troops&&<section className="report-troops" aria-label="Observed troops"><h3>Observed troops</h3><TroopSummary troops={scouting.troops} faction={scouting.target.faction}/></section>}
   {scouting.mode==='resources'&&scouting.resources&&<section className="report-resource-detail" aria-label="Observed resources"><h3>Observed resources</h3><Cost cost={scouting.resources} compact showZero/></section>}
   {scouting.mode==='defences'&&scouting.target.kind==='city'&&scouting.defences&&<section className="scouting-defences" aria-label="Observed defences"><h3>Observed defences</h3><dl><div><dt>Wall</dt><dd>Level {scouting.defences.wall}</dd></div><div><dt>Main building</dt><dd>Level {scouting.defences.main}</dd></div></dl></section>}
   {scouting.mode==='defences'&&scouting.target.kind==='camp'&&<p className="report-note">Camps have no wall or Main building.</p>}
   <p className="report-note">This is an arrival-time snapshot. Troops and resources may have changed since this observation.</p>
  </>}
 </div>;
}
