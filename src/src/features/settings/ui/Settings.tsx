import { useRef } from 'react';
import { useState } from 'react';
import { useSyncExternalStore } from 'react';
import { type World } from '../../../shared/model/world';
import { type Command } from '../../../shared/model/commands';
import { preferences, setPreferences, subscribePreferences } from '../../../platform/preferences/preferences';
import { readSolo } from '../../../platform/storage/solo';
import { exportSave, importSave, readBackup } from '../../../platform/storage/saves';
import { unlockAudio } from '../../../platform/audio/audio';
import { Modal } from '../../../shared/ui/Shared';
import { Icon } from '../../../shared/ui/Icons';
import { conquered } from '../../campaign/domain/progression';
export function Settings({ onClose, world, playerId, onLoad, run }: {
    onClose: () => void;
    world?: World;
    playerId?: string;
    onLoad?: (world: World) => void;
    run?: (cmd: Command, message?: string) => void;
}) {
    const prefs = useSyncExternalStore(subscribePreferences, preferences), [tab, setTab] = useState<'sound' | 'play' | 'saves'>('sound'), [message, setMessage] = useState(''), [pending, setPending] = useState<World | null>(null);
    const town = world?.settlements.find(s => s.owner_id === playerId), [name, setName] = useState(town?.name ?? ''), input = useRef<HTMLInputElement>(null);
    const save = world?.players[0]?.id === 'solo-ruler' ? world : !world ? readSolo() : null, backup = readBackup();
    const toggle = (key: 'sound' | 'music' | 'effects' | 'reducedMotion' | 'simpleOrders', label: string, description: string) => <label className="setting-toggle"><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={prefs[key]} onChange={e => { setPreferences({ [key]: e.target.checked }); unlockAudio(); }}/><i aria-hidden="true"/></label>;
    return <Modal title="Settings" className="settings-modal" onClose={onClose}>
  <div className="modal-tabs" role="tablist">{(['sound', 'play', 'saves'] as const).map(t => <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setMessage(''); }}>{t === 'sound' ? 'Sound & music' : t === 'play' ? 'Game & display' : 'Campaign saves'}</button>)}</div>
  {tab === 'sound' ? <><p className="muted">A quiet original score for your realm. Drums and command sounds follow you onto the field.</p>{toggle('sound', 'Command & battle sounds', 'Orders, arrows, charges and battlefield signals.')}<label className="setting-slider">Effects volume <b>{prefs.volume}%</b><input aria-label="Effects volume" type="range" min="0" max="100" value={prefs.volume} onChange={e => setPreferences({ volume: Number(e.target.value) })}/></label>{toggle('music', 'Original ambient score', 'A procedural theme with a stronger rhythm in battle.')}<label className="setting-slider">Music volume <b>{prefs.musicVolume}%</b><input aria-label="Music volume" type="range" min="0" max="100" value={prefs.musicVolume} onChange={e => setPreferences({ musicVolume: Number(e.target.value) })}/></label></> :
            tab === 'play' ? <>{toggle('simpleOrders', 'Click to command', 'Select your troops, then click open ground to move or an enemy to attack. Right-click always works.')} {toggle('effects', 'Detailed battlefield effects', 'Arrows, dust, charge impacts and moving water.')} {toggle('reducedMotion', 'Reduce interface motion', 'Fewer interface animations and camera transitions.')}<button className="settings-action" onClick={async () => { try {
                if (document.fullscreenElement)
                    await document.exitFullscreen();
                else
                    await document.documentElement.requestFullscreen();
            }
            catch {
                setMessage('Full screen is unavailable in this browser.');
            } }}><Icon name="expand"/><span>Toggle full screen</span></button>{town && run && <div className="rename-setting"><label className="field-label" htmlFor="settlement-name">SETTLEMENT NAME</label><div><input id="settlement-name" value={name} maxLength={32} onChange={e => setName(e.target.value)}/><button className="button gold" disabled={name.trim().length < 2} onClick={() => { run({ type: 'rename', name }, 'Settlement renamed'); setMessage('Your settlement name has been updated.'); }}>Save</button></div></div>}</> :
                <><p className="muted">Solo campaigns save automatically in this browser. Keep an exported copy to move your realm to another computer.</p>{save ? <div className="save-summary"><Icon name="town" size={32}/><div><strong>{save.settlements[0].name}</strong><span>{conquered(save, 'solo-ruler').size} of 6 hosts reclaimed · {save.players[0].prestige} prestige</span></div><span className="save-live">Saved</span></div> : <div className="empty-save">{world ? 'Multiplayer progress is saved in the shared world.' : 'You have not started a solo campaign yet.'}</div>}
    <div className="save-actions"><button className="button outline" disabled={!save} onClick={() => exportSave(save)}><Icon name="download"/>Export save</button><button className="button outline" disabled={!onLoad} onClick={() => input.current?.click()}><Icon name="report"/>Import save</button></div>
    <input hidden ref={input} type="file" accept=".json,application/json" aria-label="Import campaign save" onChange={async (e) => { const file = e.target.files?.[0]; if (!file)
                    return; try {
                    setPending(await importSave(file));
                    setMessage('');
                }
                catch (err) {
                    setMessage((err as Error).message);
                } e.target.value = ''; }}/>
    {backup && onLoad && <button className="settings-action" onClick={() => setPending(backup)}><Icon name="time"/><span>Restore previous realm</span><small>{backup.players[0].display_name}</small></button>}
    {pending && <div className="import-confirm"><strong>Open {pending.settlements[0].name}?</strong><p>Your current solo realm will be kept as the previous realm. Multiplayer is unaffected.</p><button className="button gold" onClick={() => { onLoad?.(pending); onClose(); }}>Open this campaign</button><button className="button text" onClick={() => setPending(null)}>Cancel</button></div>}
   </>}
  {message && <div className="alert" role="status">{message}</div>}<div className="settings-version"><span>PERIS · THE SIX STANDARDS</span><span>V0.7</span></div>
 </Modal>;
}
