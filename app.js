import { getGames, importGame, updateGame, deleteGame, getMemstick, getStates, getSetting, setSetting, exportBackup, importBackup, requestPersistence } from './storage.js';
import {bindEvent} from './events.js';

const $ = (s) => document.querySelector(s);
const paths = {
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  save:'<path d="M5 3h12l4 4v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M7 3v6h10V3M7 21v-8h10v8M14 5v2"/>',
  settings:'<path d="M9 4 10 2h4l1 2 2 1 2-.1 2 3-1 2v3l1 2-2 3-2-.1-2 1-1 2h-4l-1-2-2-1-2 .1-2-3 1-2v-3l-1-2 2-3L7 5Z"/><circle cx="12" cy="11.5" r="3"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.5 1-1.5 1.5-1.5 3M12 17h.01"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',download:'<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',play:'<path d="m8 4 12 8-12 8Z"/>',more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.help}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
const escape = (value) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const bytes = (n) => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;
let games = [], route = 'library', busy = false, selectedGame = null, renderVersion = 0, toastTimer;
const palette = [['#ccd5b7','#3c4930'],['#e4b99f','#754532'],['#bdcbd6','#354a5b'],['#d2c6db','#594365'],['#dfcf98','#66552c'],['#a9c9bb','#2f5846']];
function toast(message, error = false, duration = 5500) { clearTimeout(toastTimer); const el = $('#toast'); el.textContent = message; el.classList.toggle('error', error); el.hidden = false; if (duration) toastTimer = setTimeout(() => el.hidden = true, duration); }
function fail(error) { console.error(error); toast(error?.message || 'Something went wrong. Please try again.', true, 10000); }
function listen(selector, event, fn) { bindEvent($(selector),event,fn,fail); }
async function refresh() { games = await getGames(); $('#nav-count').textContent = games.length; await render(); }
function currentRoute() { const hash = location.hash.slice(1); return ['library','favorites','saves','settings','help'].includes(hash) ? hash : 'library'; }
const pageCopy = {
  library:['PLAY IT YOUR WAY','Good games.<br><em>Anywhere.</em>','Your PSP collection, with a new place to call home.','LIBRARY'],
  favorites:['THE ONES YOU COME BACK TO','A little<br><em>closer to heart.</em>','Keep your all-time favorites within reach.','FAVORITES'],
  saves:['EVERY ADVENTURE COUNTS','Progress worth<br><em>keeping.</em>','A little peace of mind for your memory stick.','MEMORY STICK'],
  settings:['MAKE YOURSELF AT HOME','Your pocket.<br><em>Your way.</em>','A few details to keep everything running smoothly.','SETTINGS'],
  help:['WELCOME TO POCKET','Ready,<br><em>player one.</em>','Everything you need to get your next adventure started.','GETTING STARTED']
};
async function render() {
  const generation = ++renderVersion; route = currentRoute();
  document.querySelectorAll('[data-nav]').forEach(el => { const active = el.dataset.nav === route; el.classList.toggle('active', active); active ? el.setAttribute('aria-current','page') : el.removeAttribute('aria-current'); });
  const [eye,title,description,label] = pageCopy[route]; $('#eyebrow').textContent = eye; $('#page-title').innerHTML = title; $('#page-description').textContent = description; $('#section-label').textContent = label;
  $('#import-button').hidden = !['library','favorites'].includes(route);
  for (const section of ['library','saves','settings','help']) $(`#${section}-section`).hidden = section === 'library' ? !['library','favorites'].includes(route) : section !== route;
  if (['library','favorites'].includes(route)) renderGames();
  if (route === 'saves') { const [memory, states] = await Promise.all([getMemstick(),getStates()]); if (generation !== renderVersion) return; renderSaves(memory,states); }
  if (route === 'settings') { await renderSettings(generation); }
}
function renderGames() {
  const source = route === 'favorites' ? games.filter(g => g.favorite) : games;
  const query = $('#search').value.trim().toLocaleLowerCase();
  const visible = source.filter(g => `${g.name} ${g.filename}`.toLocaleLowerCase().includes(query));
  const sort = $('#sort').value; visible.sort(sort === 'name' ? (a,b)=>a.name.localeCompare(b.name) : sort === 'added' ? (a,b)=>(b.addedAt||0)-(a.addedAt||0) : (a,b)=>(b.lastPlayed||0)-(a.lastPlayed||0)||(b.addedAt||0)-(a.addedAt||0));
  $('#game-count').textContent = `${source.length} ${source.length === 1 ? 'game' : 'games'}`; $('#collection-title').textContent = route === 'favorites' ? 'Your favorites' : 'Your collection';
  $('#empty-state').hidden = source.length > 0; $('.below-library').hidden = source.length > 0;
  $('#empty-title').textContent = route === 'favorites' ? 'Keep the good ones close.' : 'Big adventures start here.';
  $('#empty-description').innerHTML = route === 'favorites' ? 'Tap the heart on a game in your library.<br>Your favorites will be waiting right here.' : 'Drop in a PSP game and make yourself at home.<br>Your progress will be here when you get back.';
  $('#empty-import').hidden = route === 'favorites'; $('.empty-copy .file-hint').hidden = route === 'favorites';
  $('#game-grid').innerHTML = !visible.length && source.length ? '<p class="no-results">No games found. Try a different search.</p>' : visible.map((g,i) => {
    const [bg,fg] = palette[parseInt(g.id.replace(/[^a-f0-9]/gi,'').slice(0,6) || '0',16) % palette.length];
    const played = g.lastPlayed ? new Date(g.lastPlayed).toLocaleDateString(undefined,{month:'short',day:'numeric'}) : 'Ready to play';
    return `<article class="game-card" style="--cover-bg:${bg};--cover-color:${fg};animation-delay:${Math.min(i,8)*30}ms"><button class="game-cover" data-play="${escape(g.id)}" aria-label="Play ${escape(g.name)}"><span class="cover-top"><span>PSP™</span><span>${escape(g.filename.split('.').pop().toUpperCase())}</span></span><span class="cover-title">${escape(g.name)}</span><span class="cover-play">${icon('play')}</span></button><div class="game-meta"><h3 title="${escape(g.name)}">${escape(g.name)}</h3><p>${bytes(g.size)} <span>·</span> ${escape(played)}</p></div><div class="game-actions"><button class="icon-button ${g.favorite ? 'is-favorite' : ''}" data-favorite="${escape(g.id)}" aria-label="${g.favorite ? 'Unfavorite' : 'Favorite'} ${escape(g.name)}" aria-pressed="${g.favorite}">${icon('heart')}</button><button class="icon-button" data-details="${escape(g.id)}" aria-label="Details for ${escape(g.name)}">${icon('more')}</button></div></article>`;
  }).join('');
}
function renderSaves(memory, states) {
  const entries = [];
  const groups = new Map();
  for (const f of memory.files) { const segments = f.path.split('/'); const savedata = segments.indexOf('SAVEDATA'); const name = savedata >= 0 ? segments[savedata+1] || 'PSP saves' : 'PSP settings & other files'; const value = groups.get(name) || {count:0,size:0}; value.count++; value.size += f.data.byteLength; groups.set(name,value); }
  for (const [name, group] of groups) entries.push(`<div class="save-row"><div><strong>${escape(name)}</strong><br><span class="subtle">${group.count} ${group.count === 1 ? 'file' : 'files'} on the PSP memory stick</span></div><small>${bytes(group.size)}</small></div>`);
  for (const s of states) { const game = games.find(g=>g.id===s.gameId); entries.push(`<div class="save-row"><div><strong>${escape(game?.name || 'Game not in this library')}</strong><br><span class="subtle">Quick state · Slot ${s.slot}</span></div><small>${new Date(s.updatedAt).toLocaleString()}</small></div>`); }
  $('#save-list').innerHTML = entries.join('') || '<p class="subtle">A clean slate. In-game saves and quick states will appear here after you play.</p>';
}
async function renderSettings(generation) {
  const [estimate,persisted] = await Promise.all([navigator.storage?.estimate?.() || {},navigator.storage?.persisted?.() || false]); if (generation !== renderVersion) return;
  const usage = estimate.usage || games.reduce((sum,g)=>sum+g.size,0), quota = estimate.quota || 0;
  $('#storage-usage').textContent = quota ? `${bytes(usage)} used of ${bytes(quota)} available` : `${bytes(usage)} stored · storage quota unavailable`;
  $('#storage-bar').style.width = `${quota ? usage / quota * 100 : 0}%`; $('#persistence-label').textContent = persisted ? 'Persistent storage enabled' : 'Best-effort browser storage'; $('#persist-button').textContent = persisted ? 'Storage protected' : 'Protect storage'; $('#persist-button').disabled = persisted;
  const canvas = document.createElement('canvas'); const gl = canvas.getContext('webgl2'); const webgl = !!gl; gl?.getExtension('WEBGL_lose_context')?.loseContext();
  $('#system-details').innerHTML = [['Engine','PPSSPP WebAssembly'],['Game storage','IndexedDB · on this device'],['WebAssembly',typeof WebAssembly === 'object' ? 'Available' : 'Unavailable'],['WebGL 2',webgl ? 'Available' : 'Unavailable'],['Secure context',window.isSecureContext ? 'Yes' : 'HTTPS required'],['Threads',window.crossOriginIsolated ? 'Isolated and ready' : 'Enabled when player opens']].map(([k,v])=>`<div><span>${k}</span><strong>${v}</strong></div>`).join('');
}
async function addFiles(files) {
  if (busy || !files.length) return; busy = true; $('#import-button').disabled = true; $('#empty-import').disabled = true;
  let count = 0; const errors = [];
  try {
    for (let i = 0; i < files.length; i++) { toast(`Adding ${i+1} of ${files.length}: ${files[i].name}`, false, 0); try { await importGame(files[i]); count++; } catch (e) { errors.push(`${files[i].name}: ${e.message}`); } }
    if (count) { location.hash = 'library'; await refresh(); }
    if (errors.length) toast(`${count ? `${count} game(s) added. ` : ''}${errors.join(' · ')}`, true, 14000); else toast(`${count === 1 ? 'Game ready.' : `${count} games ready.`} Choose a game to press start.`);
  } finally { busy = false; $('#import-button').disabled = false; $('#empty-import').disabled = false; $('#game-input').value = ''; }
}
const chooseGames = () => { if (!busy) $('#game-input').click(); };
listen('#import-button','click',chooseGames); listen('#empty-import','click',chooseGames); listen('#game-input','change',ev=>addFiles([...ev.target.files]));
listen('#search','input',renderGames); listen('#sort','change',async()=>{ await setSetting('sort',$('#sort').value); renderGames(); });
listen('#help-button','click',()=>{ location.hash='help'; });
listen('#game-grid','click',async ev=>{
  const play = ev.target.closest('[data-play]'); if (play && !busy) { location.href = `./player.html?game=${encodeURIComponent(play.dataset.play)}`; return; }
  const favorite = ev.target.closest('[data-favorite]'); if (favorite) { const game = games.find(g=>g.id===favorite.dataset.favorite); await updateGame(game.id,{favorite:!game.favorite}); await refresh(); return; }
  const details = ev.target.closest('[data-details]'); if (details) { selectedGame = games.find(g=>g.id===details.dataset.details); $('#game-title').value = selectedGame.name; $('#game-details').textContent = `${selectedGame.filename} · ${bytes(selectedGame.size)}`; $('#remove-game').textContent = 'Remove game'; $('#remove-game').dataset.confirm = ''; $('#game-dialog').showModal(); }
});
listen('#rename-game','click',async()=>{ const name = $('#game-title').value.trim(); if (!name) { $('#game-title').reportValidity(); return; } await updateGame(selectedGame.id,{name}); $('#game-dialog').close(); await refresh(); });
listen('#game-dialog form','submit',ev=>{ if (ev.submitter?.classList.contains('dialog-close')) return; ev.preventDefault(); $('#rename-game').click(); });
listen('#remove-game','click',async ev=>{ const button = ev.currentTarget; if (!button.dataset.confirm) { button.dataset.confirm = 'yes'; button.textContent = 'Confirm removal'; return; } button.disabled = true; try { await deleteGame(selectedGame.id); $('#game-dialog').close(); await refresh(); toast('Game removed. In-game memory-stick saves kept.'); } finally { button.disabled = false; } });
listen('#export-backup','click',async ev=>{ const button = ev.currentTarget; button.disabled = true; try { const blob = await exportBackup(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `pocket-saves-${new Date().toISOString().slice(0,10)}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),60000); toast('Backup exported. Keep it somewhere safe.'); } finally { button.disabled = false; } });
listen('#import-backup','click',()=>$('#backup-input').click());
listen('#backup-input','change',async ev=>{ const file = ev.target.files[0]; if (!file) return; try { if (!confirm('Restore this backup? This replaces the current memory-stick saves, quick states, and settings. Export your current backup first if you want to keep it. Your game files stay in the library.')) return; $('#import-backup').disabled = true; await importBackup(file); await refresh(); toast('Backup restored. Your progress is ready.'); } finally { ev.target.value = ''; $('#import-backup').disabled = false; } });
listen('#persist-button','click',async()=>{ const granted = await requestPersistence(); toast(granted ? 'Browser storage is protected from automatic eviction.' : 'Your browser did not grant persistent storage. Export backups to keep a copy of your progress.', !granted, 9000); await render(); });
window.addEventListener('hashchange',()=>render().catch(fail));
let dragDepth = 0;
window.addEventListener('dragenter',ev=>{ if ([...ev.dataTransfer.types].includes('Files')) { ev.preventDefault(); dragDepth++; $('#drop-overlay').hidden = false; } });
window.addEventListener('dragleave',()=>{ if (--dragDepth <= 0) { dragDepth=0; $('#drop-overlay').hidden=true; } });
window.addEventListener('dragover',ev=>{ ev.preventDefault(); if (ev.dataTransfer) ev.dataTransfer.dropEffect='copy'; });
window.addEventListener('drop',ev=>{ ev.preventDefault(); dragDepth=0; $('#drop-overlay').hidden=true; addFiles([...ev.dataTransfer.files]).catch(fail); });
window.addEventListener('beforeunload',ev=>{ if (busy) { ev.preventDefault(); ev.returnValue=''; } });
try { $('#sort').value = await getSetting('sort','recent'); await refresh(); } catch (e) { fail(new Error(`Unable to open browser storage. ${e.message} Try a normal browser window with site storage enabled.`)); }
