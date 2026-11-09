// ==== Конфигурация страницы: один app.js работает и для видеокарт (index.html), и для процессоров (cpu.html).
// На страницах задан window.PAGE_TYPE ('gpu' или 'cpu'); если не задан — определяем по имени файла.
var PAGE = (window.PAGE_TYPE === 'cpu' || /cpu\.html/i.test(location.pathname)) ? {
  kind:'cpu', api:'api/cpus.php', hitApi:'api/cpu_hit.php', hitsKey:'cpuCompareHitsV1',
  favKey:'cpuCompareFavoritesV1', drawKey:'cpuCompareDrawingNoteV1', orientKey:'cpuCompareOrientV1',
  themeKey:'cpuCompareThemeV1', orientKeyLegacy:'gpuCompareOrientV1', noun:'процессор', nounGen:'процессора', nounPl:'процессоров', nounAccPl:'процессоры',
  retroYear:2010, shareParam:'cpus', perfHeader:null
} : {
  kind:'gpu', api:'api/gpus.php', hitApi:'api/hit.php', hitsKey:'gpuCompareHitsV1',
  favKey:'gpuCompareFavoritesV1', drawKey:'gpuCompareDrawingNoteV1', orientKey:'gpuCompareOrientV1',
  themeKey:'gpuCompareThemeV1', orientKeyLegacy:null, noun:'видеокарта', nounGen:'видеокарты', nounPl:'видеокарт', nounAccPl:'видеокарты',
  retroYear:2015, shareParam:'gpus', perfHeader:null
};
// Класс страницы для CSS (напр., расширенные квадраты марок только на cpu.html)
document.body.classList.add('page-' + PAGE.kind);
const viewport=document.getElementById('viewport'), table=document.getElementById('gpuTable');
let activeFilter='all', hoverMode=true, raf=0;
// Position-based scroll: cursor at the viewport's center = table's center;
// cursor left/right of center moves the horizontal view proportionally.
viewport.addEventListener('pointermove', (event) => {
    if (window.rowDragging || event.pointerType !== 'mouse') return;
    const rect = viewport.getBoundingClientRect();

    // Интерактивная зона: от 25% до 92% ширины. Правее 92% — сразу конец таблицы.
    // (Раньше конец был только в последних 1% ширины — это ~10 px у самого края, где ещё и полоса прокрутки:
    //  при быстром движении мыши или другой ширине полосы до конца таблицы можно было не доехать.)
    const zoneStart = rect.width * 0.25;
    const zoneEnd = rect.width * 0.92;

    // Положение мыши относительно левого края таблицы
    const mouseX = event.clientX - rect.left;

    // Левее зоны прокрутка не управляется (как и раньше — там закреплённые столбцы)
    if (mouseX < zoneStart) {
        return;
    }

    // Преобразуем положение мыши в диапазон от 0 до 1 (правее зоны — 1, то есть конец таблицы)
    const progress = Math.min(1, (mouseX - zoneStart) / (zoneEnd - zoneStart));

    // Прокручиваем таблицу слева направо
    const maxScroll = viewport.scrollWidth - viewport.clientWidth;
    viewport.scrollLeft = progress * maxScroll;
});
viewport.addEventListener('pointerleave',()=>{if(raf)cancelAnimationFrame(raf)});


const filterBoxes = [...document.querySelectorAll('.gpu-filter')];
// Каталог пуст по умолчанию: строки видеокарт подгружаются ТОЛЬКО из базы данных MySQL
// через api/gpus.php. Резервных источников (JSON/CSV) больше нет.
const tableBody = table.tBodies[0];
let catalogRows = [];
let catalogResolve, catalogReject;
// catalogReady — промис каталога: запрос к API стартует СРАЗУ при открытии страницы
// (моментальная загрузка данных для списков поиска). При этом таблица остаётся ПУСТОЙ:
// строки каталога скрыты, и в сравнение попадает только то, что пользователь выбрал сам.
const catalogReady = new Promise((res, rej) => { catalogResolve = res; catalogReject = rej; });
catalogReady.catch(e => { console.error('Не удалось загрузить каталог (' + PAGE.kind + ')', e); });
// Заглушка в списках фильтров, пока данные из БД ещё не пришли.
const CATALOG_PENDING_MSG = 'Загружаем данные…';
// Кэш каталога в sessionStorage + localStorage: при повторном заходе на страницу,
// при переходе index.html <-> cpu.html и после F5 данные берутся из памяти МГНОВЕННО,
// без ожидания ответа базы. Параллельно идёт фоновое обновление из БД.
const CATALOG_CACHE_KEY = 'umoCatalogCacheV2_' + PAGE.kind;
const CATALOG_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 часов
function readCatalogCache(){
  const stores = [sessionStorage, localStorage];
  for (const st of stores) {
    try {
      if (!st) continue;
      const raw = st.getItem(CATALOG_CACHE_KEY); if (!raw) continue;
      const o = JSON.parse(raw);
      if (!o || !Array.isArray(o.rows) || !o.rows.length) continue;
      if (Date.now() - (+o.t || 0) > CATALOG_CACHE_TTL) continue;
      return o.rows;
    } catch(e){}
  }
  return null;
}
function writeCatalogCache(rows){
  const payload = JSON.stringify({t: Date.now(), rows});
  try { sessionStorage.setItem(CATALOG_CACHE_KEY, payload); } catch(e){}
  try { localStorage.setItem(CATALOG_CACHE_KEY, payload); } catch(e){
    // Не хватило квоты браузера — чистим старый кэш этого типа и пробуем ещё раз.
    try { localStorage.removeItem(CATALOG_CACHE_KEY); localStorage.setItem(CATALOG_CACHE_KEY, payload); } catch(e2){}
  }
}
let catalogResolvedOnce = false;
function resolveCatalog(rows){
  if (catalogResolvedOnce) return;
  catalogResolvedOnce = true;
  catalogResolve(rows);
}
async function loadCatalog() {
  const cached = readCatalogCache();
  if (cached) {
    // Мгновенная отдача из памяти браузера — без обращения к БД (страница открывается сразу).
    resolveCatalog(cached);
  }
  let rows = null;
  try {
    const r = await fetch(PAGE.api, {cache: cached ? 'default' : 'no-store'});
    if (!r.ok) throw new Error(PAGE.api + ' недоступен: HTTP ' + r.status + '. Проверьте, что сайт запущен через PHP (OpenServer/Beget) и база данных импортирована.');
    const j = await r.json();
    if (Array.isArray(j)) rows = j;
    else if (j && j.error) throw new Error('Ошибка БД: ' + j.error + ' — ' + (j.detail || ''));
    else throw new Error('Некорректный ответ от ' + PAGE.api);
  } catch(e) {
    // Если из кэша данные уже отданы — фоновая ошибка не критична, тихо игнорируем.
    if (!catalogResolvedOnce) catalogReject(e);
    return;
  }
  if (!rows.length) {
    if (!catalogResolvedOnce) catalogReject(new Error('Таблица ' + (PAGE.kind==='cpu'?'cpus':'gpus') + ' в базе данных пуста. Импортируйте соответствующий SQL из database/ через phpMyAdmin.'));
    return;
  }
  writeCatalogCache(rows);
  resolveCatalog(rows);
}
loadCatalog(); // старт запроса немедленно при открытии страницы
function plural(n, forms) { // forms: [1, 2-4, 5+] ('видеокарта','карты','карт')
  n = Math.abs(n) % 100; const n1 = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (n1 > 1 && n1 < 5) return forms[1];
  if (n1 === 1) return forms[0];
  return forms[2];
}
// Синонимы бренда для поиска: «intel i7» -> «core i7», «амд райзен» -> «ryzen» и т.п.
const BRAND_SYNONYMS = [['intel','интел','кор','core'],['amd','амд','райзен','ryzen','атлон','athlon','эпик','epyc','радеон'],
  ['nvidia','энвидиа','нвидиа','гефорс','geforce'],['apple','аппл']];
function expandQuery(q) {
  q = q.toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const out = [];
  for (const w of words) {
    out.push(w);
    if (w === 'i3' || w === 'i5' || w === 'i7' || w === 'i9') out.push('core ' + w);
    if (BRAND_SYNONYMS.some(g => g.includes(w))) continue; // само название бренда уже матчится по brand
  }
  return out;
}
function matchName(tr, q) {
  const name = tr.querySelector('.brand-name').textContent.toLowerCase();
  const brand = (tr.dataset.brand || '').toLowerCase();
  const qs = expandQuery(q);
  return qs.every(w => name.includes(w) || brand.includes(w) || tr.dataset.year.includes(w));
}
function gpuDisplayName(raw) {
  // «NVIDIA GeForce RTX 5090» -> оставляем как есть; короткие имена из колонок name/perf уже содержат бренд
  return raw.trim();
}
// ---- преобразование данных CSV в ячейки таблицы (формат верстки сохранен) ----
const MON = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
function fmtInt(n){ n = Math.round(n); return n.toLocaleString('ru-RU'); }
function numOf(s){ if(!s) return null; const m = String(s).replace(',','.').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; }
function relCell(rel){ const m = (rel||'').match(/^(\d{2})\.(\d{2})\.(\d{4})$/); if(!m) return rel||'—'; return MON[+m[2]-1] + ' ' + m[3]; }
function yearOf(rel){ const m = (rel||'').match(/(\d{4})$/); return m ? m[1] : ''; }
function ramCell(v, type, year){
  const n = numOf(v); if (n === null) return (type||'').trim() ? type.trim() + ' / —' : '—';
  const y = parseInt(year,10) || 2026; let unit;
  // В базе старые карты (до 2005 г.) хранят объём в МБ, современные — в ГБ. Определяем по году релиза и размеру значения.
  if (y <= 2005 && n < 512) unit = fmtInt(n) + ' МБ';
  else if (n >= 1024) { const g = +(n/1024).toFixed(2); unit = String(g % 1 === 0 ? g : g).replace('.', ',') + ' ГБ'; }
  else unit = String(n % 1 ? n : fmtInt(n)).replace('.', ',') + ' ГБ';
  const t = (type||'').trim();
  return (t ? t + ' / ' : '') + unit;
}
function freqCell(base, boost){
  const b = numOf(base), u = numOf(boost);
  if (b === null && u === null) return '—';
  if (b !== null && u !== null && Math.abs(u-b) > 0.01) return fmtInt(b) + ' - ' + fmtInt(u) + ' МГц';
  return fmtInt(u !== null ? u : b) + ' МГц';
}
const MARK_RULES = [
  [/^RTX PRO/i,'RPRO'],[/^RTX A(\d+)/i,(m)=>'A'+m[1]],[/^RTX(?! ?5880)/i,'RTX'],[/^GeForce RTX( \d{3,4} ?Ti? ?\d?G?B? ?Laptop)?/i,'RTX'],
  [/^GeForce GTX( \d{3,4}.*| .*|)$/i,'GTX'],[/^GeForce GTS( .*|)$/i,'GTS'],[/^GeForce GT( \d.*|)$/i,'GT'],
  [/^GeForce Go (\d{3,4})/i,(m)=>'GO'+m[1].slice(-2)],[/^GeForce (\d{3,4})/i,(m)=>'GF'+m[1].slice(-2)],
  [/^GeForce (\d{3,4}M)/i,(m)=>'GM'+m[1].replace(/\D/g,'').slice(0,2)],[/^GeForce/,'GF'],
  [/^Titan (\w*)/i,'TTN'],[/^Tesla /i,'TSL'],[/^Quadro GP(\d+)/i,'QGP'],[/^Quadro NVS( \d+.*|)/i,'NVS'],
  [/^Quadro P(\d+)/i,'QP'],[/^Quadro RTX( .*|)/i,'QRT'],[/^Quadro (K|M|S|Series )?(\d+.*)/i,'QDR'],[/^DGX/,'DGX'],
  [/^RTX 5880 Ada$/i,'ADA'],[/^T(\d{3}) Mobile$/i,(m)=>'T'+m[1]],[/^CMP( .*|)/i,'CMP'],[/^A(10G|10|40|16|800)( |$)/i,'ACCL'],[/^L(\d{2})( |$)/i,'ACC'],
  [/^Radeon Instinct MI(\d+.*)/i,'INST'],[/^Radeon RX Vega( \d+.*)?/i,'RXV'],[/^Radeon RX( \d+.*|)/i,'RX'],
  [/^Radeon R9( \d+.*|)/i,'R9'],[/^Radeon R7( \d+.*|)/i,'R7'],[/^Radeon R5( \d+.*|)/i,'R5'],
  [/^Radeon HD (\d{3,4})/i,(m)=>'HD'+m[1].slice(-2)],[/^Radeon HD/,'HD'],
  [/^Radeon (\d{3,4})( |$)/i,(m)=>'RD'+m[1].slice(-2)],[/^Radeon VII/i,'VII'],[/^Radeon (Pro )?\d*M?\w*/i,'RDNA'],
  [/^FirePro/i,'FPRO'],[/^FireGL/i,'FGL'],[/^ATI Radeon 9(\d{3})/i,(m)=>'AT9'+m[1][0]],
  [/^AMD Ryzen (Z\d \w+)/i,'RYZE'],[/^AMD (Mobility )?Radeon/i,'RADE'],[/^AMD/,'AMD'],
  [/^Arc( .*|)/i,'ARC'],[/^Iris Xe( .*|)/i,'IXE'],[/^Iris( .*|)/i,'IRIS'],[/^UHD Graphics (\d{3,4})/i,(m)=>'UHD'],
  [/^UHD/,'UHD'],[/^HD Graphics (\d{3,4})/i,'HD'],[/^HD/,'HD'],[/^P\d{4}/,'PGFX'],[/^Xe-HPG( .*|)/i,'XEPG'],[/^GMA/,'GMA'],
  [/^Intel/,'INTC']
];
function shortMark(name){
  name = String(name||'').replace(/^(NVIDIA|AMD|Intel)\s+/i,'').trim();
  for (const rule of MARK_RULES) {
    const m = name.match(rule[0]);
    if (m) { const r = typeof rule[1]==='function' ? rule[1](m) : rule[1]; if (r) return String(r).toUpperCase().slice(0,4); }
  }
  const w = name.match(/[A-Za-z]+|\d+/g);
  return (w ? w[0] : 'GPU').toUpperCase().slice(0,4);
}
function buildRows(rows) {
  const frag = document.createDocumentFragment();
  rows.forEach(item => {
    const full = (item['name']||'').trim(); if (!full) return;
    const perfName = (item['Videocard Name_perf']||full).trim();
    const braw = (item['vendor']||'').toUpperCase();
    const bkey = braw.includes('NVD')||braw.includes('NVIDIA') ? 'NVIDIA' : braw.includes('AMD') ? 'AMD' : braw.includes('INT') ? 'INTEL' : (braw||'OTHER');
    const rel = item['card_release_date']||''; const year = yearOf(rel); const arch = (item['arch_name']||'').trim();
    const perf = numOf(item['Passmark G3D Mark']) || 0;
    const cores = numOf(item['cores']), rop = numOf(item['Rasterization blocks']), tmu = numOf(item['Texture blocks']);
    const shaders = (cores!==null&&rop!==null&&tmu!==null) ? fmtInt(cores)+' / '+fmtInt(rop)+' / '+fmtInt(tmu) : '—';
    const rates = (numOf(item['pixelRate'])!==null||numOf(item['textureRate'])!==null) ? decC(item['pixelRate'])+' / '+decC(item['textureRate']) : '—';
    // Колонка «Тип памяти / объём / шина»: тип, объём и разрядность шины.
    const mem = ramCell(item['ram'], item['ram_type'], year);
    const bw = numOf(item['bus_width']);
    const memFull = mem + ' / ' + (bw!==null ? fmtInt(bw)+' бит' : '—');
    // Колонка «Частота / пропускная способность»: частота памяти и bandwidth.
    const mf = numOf(item['Memory frequency']); const band = numOf(item['ram_bandwidth']);
    const bus = (mf!==null ? fmtInt(mf)+' МГц' : '—') + ' / ' + (band!==null?decC(item['ram_bandwidth'])+' ГБ/с':'—');
    const tdpv = numOf(item['tdp']), psuv = numOf(item['suggested_psu']);
    const power = (tdpv!==null?fmtInt(tdpv)+' Вт':'—') + ' / ' + (psuv!==null?fmtInt(psuv)+' Вт':'—');
    const tc = numOf(item['tensor_cores']), rc = numOf(item['rt_cores']);
    const tens = (tc!==null?fmtInt(tc):'—') + ' / ' + (rc!==null?fmtInt(rc):'—');
    const proc = (item['proc_process_size']||'').trim(); const nuc = (item['nucleus']||'').trim();
    const tech = (proc||'—') + ' / ' + (nuc||'—');
    const iface = (item['bus_interface']||'').trim(); const conn = (item['power_connectors']||'').trim(); const dx = (item['directX']||'').trim();
    const io = [iface||'—', conn||'—', dx?('DX '+dx):'—'].join(' / ');
    const tr = document.createElement('tr');
    tr.dataset.brand = bkey; tr.dataset.year = year; tr.dataset.perf = String(perf);
    // Данные тензорных/RT-ядер храним в атрибутах строки (а не по тексту ячейки):
    // текст «— / —» содержит дефисы, которые нельзя надёжно отличить от пустых значений.
    tr.dataset.tensor = (tc !== null && tc > 0) ? '1' : '';
    tr.dataset.rt = (rc !== null && rc > 0) ? '1' : '';
    const mark = shortMark(perfName || full);
    tr.innerHTML = '<td class="remove-cell"></td>'
      + '<td><div class="gpu-name"><span class="gpu-mark ' + bkey.toLowerCase() + '-mark">' + escapeHtml(mark) + '</span><span><span class="brand-name ' + bkey.toLowerCase() + '">' + escapeHtml(full) + '</span><small>' + escapeHtml(bkey + (arch ? ' · ' + arch : '')) + '</small></span></div></td>'
      + '<td>' + escapeHtml(relCell(rel)) + '</td>'
      + '<td>' + escapeHtml(tech) + '</td>'
      + '<td>' + escapeHtml(freqCell(item['base_clock'], item['boost_clock'])) + '</td>'
      + '<td>' + shaders + '</td>'
      + '<td class="nc">' + rates + '</td>'
      + '<td>' + escapeHtml(memFull) + '</td>'
      + '<td>' + escapeHtml(bus) + '</td>'
      + '<td>' + escapeHtml(power) + '</td>'
      + '<td class="col-tensor">' + tens + '</td>'
      + '<td>' + escapeHtml(io) + '</td>';
    frag.appendChild(tr);
  });
  tableBody.appendChild(frag);
  // Колонка «Тензорные ядра / RT-ядра» по умолчанию СКРЫТА полностью
  // (заголовок + все ячейки), даже если в базе есть карты со значениями.
  // Она появляется только когда в сравнение выбрана хотя бы одна карта
  // с тензорными или RT-ядрами — см. updateTensorColumn() (вызывается при
  // добавлении/удалении карт из сравнения).
  updateTensorColumn();
  catalogRows = [...tableBody.querySelectorAll('tr')];
  hideUnselectedRows(); // страховка: каталог существует, но в таблице не видно ни одной строки
  applyHitsToRows();
  decorateRowCells(catalogRows);
}
// ---- построение строк таблицы процессоров (данные из таблицы cpus / api/cpus.php) ----
const CPU_MON=['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
function cpuRelCell(item){ // релиз как у видеокарт: «мар 2022»; если месяца нет — просто год
  const y=+item.rel_year||0, mth=+item.rel_month||0;
  if(!y) return '—';
  return (mth?CPU_MON[mth-1]+' ':'')+y;
}
function cpuFreqCell(base,boost){ // частоты в ГГц: «2,5 - 5,4 ГГц» (подпись база/буст — маленьким шрифтом в заголовке)
  const b=(base===null||base===undefined)?null:+base, u=(boost===null||boost===undefined)?null:+boost;
  const g=v=>String(v%1?v.toFixed(2).replace(/0$/,'').replace('.',','):v);
  if(b===null&&u===null) return '—';
  if(b!==null&&u!==null&&Math.abs(u-b)>0.001) return g(b)+' - '+g(u)+' ГГц';
  return g(u!==null?u:b)+' ГГц';
}
function cpuCachePart(s){ // «64 Кб (на ядро)» -> «64 Кб», «N/A»/пусто -> ''
  s=String(s||'').replace(/\u00a0/g,' ').trim();
  if(!s||/^n\/?a$/i.test(s)||s==='—') return '';
  return s.replace(/\s*\((на ядро|всего)\).*$/i,'').trim();
}
function cpuCacheCell(l1,l2,l3){
  const parts=[l1,l2,l3].map(cpuCachePart);
  if(parts.every(p=>!p)) return '—';
  return parts.map(p=>p||'—').join(' / ');
}
// Значение поля из CSV может быть «n/a», «N/A», «—» или пустым — считаем, что значения нет.
function cpuVal(s){ s=String(s==null?'':s).replace(/\u00a0/g,' ').trim(); return (!s||/^n\/?a$/i.test(s)||s==='—')?'':s; }
// Тип процессора: только «десктопный/ноутбучный/серверный» (в виде иконки в столбце «Тип»), без лишних слов.
function cpuTypeKey(t){
  t=cpuVal(t).toLowerCase();
  if(/ноутб|мобил|mobile|notebook/.test(t)) return 'laptop';
  if(/сервер|server|embedded|рабоч. станц|workstation|w-?\d/.test(t)) return 'server';
  if(/настол|дескт|desktop/.test(t)) return 'desktop';
  return '';
}
// Иконка типа: ноутбуук / компьютер / сервер (SVG, цвет наследуется от темы).
const CPU_TYPE_ICONS = {
  desktop:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/></svg>',
  laptop:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="10" rx="1.5"/><path d="M2 19h20"/></svg>',
  server:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="6" rx="1.5"/><rect x="4" y="15" width="16" height="6" rx="1.5"/><path d="M4 9v6M20 9v6M8 6h.01M8 18h.01"/></svg>'
};
function cpuArchName(s){ // «Turin (2024−2025)» -> «Turin»; убираем скобки с годами и приписки вида «(server)»
  s = cpuVal(s).replace(/\s*\((?:[^)]*?)\)\s*/g,' ').replace(/\s+/g,' ').trim();
  return s;
}
// Название процессора без служебных приписок («для ноутбуков», «Skylake (server) (2017?2018)» и т.п.)
function cpuCleanName(name){
  let n = String(name||'').replace(/\u00a0/g,' ').trim();
  n = n.replace(/\s*[[(]\s*(?:для\s*)?(?:ноутбу\w*|сервер\w*|настольн\w*|десктоп\w*|мобильн\w*|workstation|server|desktop|mobile|notebook|laptop)[^)\]]*[)\]]\s*/gi,' ');
  n = n.replace(/\s+for\s+(?:laptops?|desktops?|servers?|mobile)\b/gi,' ');
  n = n.replace(/\s*(?:для\s+(?:ноутбуков|настольных\s+пк|серверов)|для\s+ноутбука)\s*$/i,'');
  n = n.replace(/\s{2,}/g,' ').trim().replace(/[,–—-]\s*$/,'').trim();
  return n;
}
function cpuShortMark(name,brand){
  name=String(name||'').trim();
  let m;
  if((m=name.match(/^Ryzen\s*Threadripper\s*(PRO)?\s*/i))) return m[1]?'RTP':'TRP';
  if((m=name.match(/^Threadripper\s*(PRO)?\s*/i))) return m[1]?'RTP':'TRP';
  if((m=name.match(/^EPYC[\s-]*(\w*)/i))) return 'EPYC';
  if((m=name.match(/^Ryzen\s*(\d)/i))) return 'R'+m[1];
  if((m=name.match(/^Athlon\s*(X)?(\d\w*)/i))) return 'ATH';
  if((m=name.match(/^Sempron/i))) return 'SEM';
  if((m=name.match(/^Phenom/i))) return 'PHN';
  if((m=name.match(/^Opteron/i))) return 'OPT';
  if((m=name.match(/^Turion/i))) return 'TUR';
  if((m=name.match(/^A\(?\s*(\d{3})/i))) return 'APU'+m[1];
  if((m=name.match(/^Core\s*(Ultra)\s*(X\d|\d+)/i))) return 'CUX';
  if((m=name.match(/^Core\s*i(\d)(\w*)/i))) return 'I'+m[1];
  if((m=name.match(/^Core\s*(\w+)\s*(\w+)/i))) return (m[1][0]+m[2]).toUpperCase().slice(0,4);
  if((m=name.match(/^Pentium\s*(D|Dual|G|4)?/i))) return 'PEN';
  if((m=name.match(/^Celeron/i))) return 'CEL';
  if((m=name.match(/^Xeon\s*(W|D)?/i))) return m[1]?'XN'+m[1]:'Xeon'.toUpperCase();
  if((m=name.match(/^Itanium/i))) return 'ITA';
  if((m=name.match(/^Atom/i))) return 'ATOM';
  if((m=name.match(/^Apple\s*(M\d)/i))) return m[1].toUpperCase();
  if((m=name.match(/^Snapdragon\s*(\w+)/i))) return 'SD';
  if((m=name.match(/^GeForce\s*(\w+)/i))) return 'GF';
  if((m=name.match(/^Tegra\s*(\w+)/i))) return 'TEG';
  if((m=name.match(/^K\d+\s*(\w+)/i))) return 'ARM';
  const w=name.match(/[A-Za-z]+|\d+/g);
  return (w?w[0]:(brand||'CPU')).toUpperCase().slice(0,4);
}
// Порядок колонок на странице процессоров (соответствует <th> в cpu.html):
// Процессор | Сокет/техпроцесс | Тип | Релиз | Ядра/потоки | Частота | Кэш | Max t°/TDP | Тип памяти | Видеоядро | Ревизия PCI/линий | Архитектура
function buildCpuRows(rows){
  const frag=document.createDocumentFragment();
  rows.forEach(item=>{
    const fullRaw=(item['name']||'').trim(); if(!fullRaw) return;
    const full=cpuCleanName(fullRaw); // без приписок «для ноутбуков», «(server) (2017?2018)» и т.п.
    const braw=(item['brand']||'').toUpperCase();
    const bkey=braw.includes('AMD')?'AMD':braw.includes('INT')?'INTEL':braw.includes('NVD')?'NVIDIA':'OTHER';
    const year=+item['rel_year']||'';
    const perf=+item['perf']||0;
    const cores=+item['cores']||null, threads=+item['threads']||null;
    const ct=(cores!==null?fmtInt(cores):'—')+' / '+(threads!==null?fmtInt(threads):'—');
    const socket=cpuVal(item['socket']), lith=cpuVal(item['lithography']);
    const sockLith=[socket,lith].filter(Boolean).join(' / ')||'—';
    const temp=+item['max_temp']||null, tdp=+item['tdp']||null;
    const power=(temp!==null?fmtInt(temp)+' °C':'—')+' / '+(tdp!==null?fmtInt(tdp)+' Вт':'—');
    const memtype=cpuVal(item['mem_type'])||'—';
    const igpu=cpuVal(item['igpu'])||'—';
    // «Ревизия PCI / линий»: только значения, например «5 / 48»; n/a = нет значения.
    const prec=cpuVal(item['pci_rev']).replace(/,/g,'.'), plan=cpuVal(item['pci_lanes']);
    const pciCell=[prec,plan].filter(Boolean).join(' / ')||'—';
    const arch=cpuArchName(item['arch_name']);
    const typeKey=cpuTypeKey(item['cpu_type']);
    const typeName=cpuVal(item['cpu_type']);
    const tr=document.createElement('tr');
    tr.dataset.brand=bkey; tr.dataset.year=year; tr.dataset.perf=String(perf);
    const mark=cpuShortMark(full,bkey);
    const typeIcon=typeKey?CPU_TYPE_ICONS[typeKey]:'—';
    // Пустые ячейки помечаются классом is-empty: мини-шкала производительности под ними не рисуется.
    const emptyCls=perf>0?'':' is-empty';
    tr.innerHTML='<td class="remove-cell"></td>'
      + '<td class="cpu-name-cell'+emptyCls+'"><div class="gpu-name"><span class="gpu-mark '+bkey.toLowerCase()+'-mark">'+escapeHtml(mark)+'</span><span><span class="brand-name '+bkey.toLowerCase()+'">'+escapeHtml(full)+'</span><small>'+escapeHtml([bkey!=='OTHER'?bkey:'',arch].filter(Boolean).join(' · '))+'</small></span></div></td>'
      + '<td>'+escapeHtml(sockLith)+'</td>'
      + '<td class="cpu-type-cell" title="'+escapeHtml(typeName||'Тип не указан')+'">'+typeIcon+'</td>'
      + '<td>'+escapeHtml(cpuRelCell(item))+'</td>'
      + '<td>'+ct+'</td>'
      + '<td class="cpu-freq-cell">'+escapeHtml(cpuFreqCell(item['base_clock'],item['boost_clock']))+'</td>'
      + '<td>'+escapeHtml(cpuCacheCell(item['cache_l1'],item['cache_l2'],item['cache_l3']))+'</td>'
      + '<td>'+escapeHtml(power)+'</td>'
      + '<td>'+escapeHtml(memtype)+'</td>'
      + '<td>'+escapeHtml(igpu)+'</td>'
      + '<td>'+escapeHtml(pciCell)+'</td>'
      + '<td>'+escapeHtml(arch||'—')+'</td>';
    frag.appendChild(tr);
  });
  tableBody.appendChild(frag);
  catalogRows=[...tableBody.querySelectorAll('tr')];
  hideUnselectedRows(); // страховка: каталог существует, но в таблице не видно ни одной строки
  applyHitsToRows();
  decorateRowCells(catalogRows);
}
// Мини-шкала производительности + ручка перетаскивания в ячейке названия.
function decorateRowCells(rows){
  if (PAGE.kind !== 'gpu') return; // на cpu.html колонка «Производительность» добавляется отдельным блоком ниже
  rows.forEach(tr => {
    const cell = tr.cells[1];
    if (!cell || cell.querySelector('.mini-perf')) return;
    cell.insertAdjacentHTML('beforeend','<div class="mini-perf"><span class="mini-track"><i class="mini-fill"></i></span><b>0%</b></div>');
    const nameEl = cell.querySelector('.gpu-name');
    if (nameEl && !nameEl.querySelector('.row-grip')) nameEl.insertAdjacentHTML('afterbegin','<span class="row-grip" title="Потяните, чтобы изменить порядок" aria-hidden="true"></span>');
  });
}
// Главное правило таблиц (обе страницы): В ТАБЛИЦЕ НЕТ НИ ОДНОЙ СТРОКИ, пока пользователь
// сам не выбрал модель для сравнения. Строки каталога существуют в DOM (для поиска/фильтров),
// но скрыты; видимыми становятся только добавленные через addGpu (или восстановленные из
// ссылки «поделиться»).
function hideUnselectedRows(){
  catalogRows.forEach(tr => {
    if (tr.dataset.selected !== 'true') { tr.dataset.selected = 'false'; tr.style.display = 'none'; }
    tr.dataset.favorite = favoriteNames.has(gpuName(tr)) ? 'true' : 'false';
    renderRemoveCell(tr);
  });
}
function decC(s){ const n = numOf(s); if (n===null) return '—'; return (Math.round(n*10)/10).toString().replace('.', ','); }
function escapeHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
let selectedModel = '';
// Каталог хранится в строках таблицы, но до выбора модели они не участвуют в сравнении.
// Основной проход (после загрузки данных из БД) — ниже, catalogReady.then(...).
// Строка выше с «до загрузки пусто» оставляется только как страховка на случай, если строки появятся до готовности каталога.
function rowsForScope(scope) {
  return catalogRows.filter(tr => {
    if (scope === 'all') return true;
    if (scope === 'favorites') return tr.dataset.favorite === 'true';
    if (scope === 'retro') return tr.dataset.year !== '' && Number(tr.dataset.year) < PAGE.retroYear;
    return tr.dataset.brand === scope;
  });
}
function closeFilterMenus(except) {
  filterBoxes.forEach(box => { if (box !== except) box.classList.remove('open'); });
}
function updateCounts() {
  const selected = catalogRows.filter(tr => tr.dataset.selected === 'true');
  const shown = document.getElementById('shown');
  if (shown) shown.textContent = 'В сравнении ' + selected.length + ' ' + plural(selected.length, [PAGE.noun, PAGE.nounPl.slice(0,-1)+'ы', PAGE.nounPl]);
  updateTensorColumn();
  if (perfReady) renderPerf();
  if (tReady) renderT();
}
// Колонка «Тензорные ядра / RT-ядра»: скрыта, пока в сравнении нет ни одной
// карты со значениями. Показывается целиком (заголовок + все ячейки), как только
// такая карта выбрана; прячется обратно при удалении последней такой карты.
function updateTensorColumn() {
  // Колонка показывается, только если среди ВЫБРАННЫХ карт есть хотя бы одна
  // с реальными значениями (tensor_cores > 0 или rt_cores > 0). Карты с «— / —»
  // не учитываются.
  const on = catalogRows.some(tr => tr.dataset.selected === 'true' && (tr.dataset.tensor === '1' || tr.dataset.rt === '1'));
  table.querySelectorAll('.col-tensor').forEach(el => {
    if (on) el.removeAttribute('hidden'); else el.setAttribute('hidden','');
  });
}
const favoriteStorageKey = PAGE.favKey;
let favoriteNames = new Set();
try { favoriteNames = new Set(JSON.parse(localStorage.getItem(favoriteStorageKey) || '[]')); } catch(e) {}
function persistFavorites() { try { localStorage.setItem(favoriteStorageKey, JSON.stringify([...favoriteNames])); } catch(e) {} }
function gpuName(tr) { return tr.querySelector('.brand-name').textContent.trim(); }
function renderRemoveCell(tr) {
  const cell = tr.querySelector('.remove-cell');
  cell.replaceChildren();
  if (tr.dataset.selected === 'true') {
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'remove-gpu'; remove.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 10v6M14 10v6"/></svg>';
    remove.title = 'Убрать ' + PAGE.noun + ' из сравнения';
    remove.setAttribute('aria-label', 'Убрать ' + gpuName(tr) + ' из сравнения');
    remove.addEventListener('click', () => { tr.dataset.selected = 'false'; tr.style.display = 'none'; renderRemoveCell(tr); updateCounts(); });
    cell.appendChild(remove);
  }
  const star = document.createElement('button');
  star.type = 'button'; star.className = 'favorite-star' + (tr.dataset.favorite === 'true' ? ' is-favorite' : '');
  star.textContent = tr.dataset.favorite === 'true' ? '★' : '☆';
  star.title = tr.dataset.favorite === 'true' ? 'Убрать из избранного' : 'Добавить в избранное';
  star.setAttribute('aria-label', star.title + ': ' + gpuName(tr));
  star.addEventListener('click', () => {
    const name = gpuName(tr);
    if (favoriteNames.has(name)) favoriteNames.delete(name); else favoriteNames.add(name);
    tr.dataset.favorite = favoriteNames.has(name) ? 'true' : 'false';
    persistFavorites(); renderRemoveCell(tr);
    filterBoxes.forEach(box => { if (box.dataset.scope === 'favorites' && box.classList.contains('open')) updateFilterOptions(box); });
  });
  cell.appendChild(star);
}

function addGpu(tr) {
  if (tr.dataset.selected === 'true') {
    tr.style.display = '';
    tr.classList.add('already-selected');
    setTimeout(() => tr.classList.remove('already-selected'), 650);
    return;
  }
  tr.dataset.selected = 'true';
  table.tBodies[0].appendChild(tr);
  tr.style.display = '';
  renderRemoveCell(tr);
  registerGpuHit(tr);
  updateCounts();
}

// Внутренний счётчик popularity: сколько раз карту выбрали в сравнение.
// Хранится в localStorage браузера и (при наличии backend) синхронизируется с базой данных через api/hit.php.
const GPU_HITS_KEY = PAGE.hitsKey;
function loadLocalHits(){ try { return JSON.parse(localStorage.getItem(GPU_HITS_KEY)) || {}; } catch(e){ return {}; } }
function saveLocalHits(h){ try { localStorage.setItem(GPU_HITS_KEY, JSON.stringify(h)); } catch(e){} }
function applyHitsToRows(){ const h = loadLocalHits(); catalogRows.forEach(tr => { const n = (tr.querySelector('.brand-name')?.textContent || '').trim(); if (h[n]) tr.dataset.hits = String(h[n]); }); }
function registerGpuHit(tr){
  const name = (tr.querySelector('.brand-name')?.textContent || '').trim();
  if (!name) return;
  const h = loadLocalHits(); h[name] = (h[name] || 0) + 1; saveLocalHits(h);
  tr.dataset.hits = String(h[name]);
  fetch(PAGE.hitApi, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name}) }).catch(()=>{});
}

function updateFilterOptions(box) {
  const input = box.querySelector('input');
  const options = box.querySelector('.filter-options');
  // Каталог ещё не загружен из БД (запрос стартует по фокусу/клику или через 1,5 с):
  // показываем заглушку вместо пустого списка и перерисовываем меню, когда данные придут.
  if (!catalogRows.length) {
    options.innerHTML = '';
    const pending = document.createElement('div');
    pending.className = 'filter-option filter-pending';
    pending.textContent = CATALOG_PENDING_MSG;
    pending.style.cursor = 'default';
    options.appendChild(pending);
    catalogReady.then(() => { if (box.classList.contains('open')) updateFilterOptions(box); }).catch(() => {});
    return;
  }
  const q = input.value.trim().toLowerCase();
  const matches = rowsForScope(box.dataset.scope).filter(tr => matchName(tr, q));
  options.innerHTML = '';
  if (!matches.length) {
    const empty = document.createElement('div');
    empty.className = 'filter-option';
    empty.textContent = box.dataset.scope === 'favorites' ? 'Пока нет избранных ' + PAGE.nounPl : 'Ничего не найдено';
    empty.style.cursor = 'default';
    options.appendChild(empty);
    return;
  }
  // Сортировка: сначала самые популярные (сколько раз выбирали в сравнение), затем — более короткие названия
  const hitsOf = tr => +(tr.dataset.hits || 0);
  const nameOf = tr => (tr.querySelector('.brand-name')?.textContent || '').trim();
  matches.sort((a, b) => (hitsOf(b) - hitsOf(a)) || (nameOf(a).length - nameOf(b).length) || nameOf(a).localeCompare(nameOf(b)));
  matches.forEach(tr => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'filter-option';
    item.textContent = (tr.dataset.selected === 'true' ? '✓ ' : '+ ') + (tr.dataset.favorite === 'true' ? '★ ' : '') + tr.querySelector('.brand-name').textContent;
    item.addEventListener('click', () => {
      addGpu(tr);
      // Текст запроса (например, «5090») остаётся в поле — можно выбрать следующую карту из того же списка.
      closeFilterMenus(null);
      updateCounts();
    });
    options.appendChild(item);
  });
}
filterBoxes.forEach(box => {
  const input = box.querySelector('input');
  const arrow = box.querySelector('.filter-arrow');
  input.addEventListener('focus', () => { closeFilterMenus(box); updateFilterOptions(box); box.classList.add('open'); });
  input.addEventListener('input', () => {
    selectedModel = '';
    closeFilterMenus(box);
    updateFilterOptions(box);
    box.classList.add('open');
  });
  arrow.addEventListener('click', () => {
    const wasOpen = box.classList.contains('open');
    closeFilterMenus(box);
    if (!wasOpen) { updateFilterOptions(box); box.classList.add('open'); if (!matchMedia('(hover:none)').matches) input.focus(); }
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') box.classList.remove('open');
    if (event.key === 'Enter') {
      const first = box.querySelector('.filter-option');
      if (first && first.tagName === 'BUTTON') first.click();
    }
  });
});
document.addEventListener('click', event => {
  if (!event.target.closest('.gpu-filter')) closeFilterMenus(null);
});
document.getElementById('clearSearch').addEventListener('click', () => {
  filterBoxes.forEach(box => { box.querySelector('input').value = ''; box.classList.remove('open'); });
  catalogRows.forEach(tr => { tr.dataset.selected = 'false'; tr.style.display = 'none'; renderRemoveCell(tr); });
  updateCounts();
});

function applyFilters() { updateCounts(); }
updateCounts();
// Рисовалка: карандаш с курсором, текст прямо на листе и надёжная отмена.
const drawingCanvas = document.getElementById('drawingCanvas');
const drawingCtx = drawingCanvas.getContext('2d');
const drawingCard = document.querySelector('.drawing-card');
const drawingPaper = document.querySelector('.drawing-paper-wrap');
let drawing = false, erasing = false, lastPoint = null, drawingMode = 'draw';
let drawingHistory = [];
const drawingStorageKey = PAGE.drawKey;
function saveDrawingSnapshot(){try{drawingHistory.push(drawingCtx.getImageData(0,0,drawingCanvas.width,drawingCanvas.height));if(drawingHistory.length>50)drawingHistory.shift();}catch(e){}}
function restoreDrawingSnapshot(data){if(!data)return;drawingCtx.save();drawingCtx.setTransform(1,0,0,1,0,0);drawingCtx.clearRect(0,0,drawingCanvas.width,drawingCanvas.height);drawingCtx.putImageData(data,0,0);drawingCtx.restore();}
function undoDrawing(){if(!drawingHistory.length)return;restoreDrawingSnapshot(drawingHistory.pop());}
function resizeDrawingCanvas(){
  const rect=drawingCanvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
  const oldCanvas=document.createElement('canvas');oldCanvas.width=drawingCanvas.width;oldCanvas.height=drawingCanvas.height;
  if(oldCanvas.width&&oldCanvas.height)oldCanvas.getContext('2d').drawImage(drawingCanvas,0,0);
  const dpr=window.devicePixelRatio||1;drawingCanvas.width=Math.round(rect.width*dpr);drawingCanvas.height=Math.round(rect.height*dpr);
  drawingCtx.setTransform(dpr,0,0,dpr,0,0);drawingCtx.lineCap='round';drawingCtx.lineJoin='round';
  if(oldCanvas.width&&oldCanvas.height)drawingCtx.drawImage(oldCanvas,0,0,oldCanvas.width,oldCanvas.height,0,0,rect.width,rect.height);
  drawingHistory=[];
}
function getDrawingPoint(event){const rect=drawingCanvas.getBoundingClientRect();return{x:event.clientX-rect.left,y:event.clientY-rect.top};}
function getDrawingTextColor(){return document.body.classList.contains('theme-light')?'#111111':'#ffffff';}
function setDrawingMode(mode){const activeEditor=drawingPaper.querySelector('.drawing-text-editor');if(activeEditor)finishInlineText(activeEditor,true);drawingMode=mode;drawingCard.classList.toggle('text-mode',mode==='text');document.getElementById('drawTool').classList.toggle('active',mode==='draw');document.getElementById('textTool').classList.toggle('active',mode==='text');document.getElementById('drawTool').setAttribute('aria-pressed',String(mode==='draw'));document.getElementById('textTool').setAttribute('aria-pressed',String(mode==='text'));}
function finishInlineText(editor,commit=true){
  if(!editor||!editor.isConnected)return;
  const text=editor.innerText.replace(/\u00a0/g,' ').trim();
  try{if(commit&&text){saveDrawingSnapshot();const rect=drawingCanvas.getBoundingClientRect();const x=parseFloat(editor.dataset.x)||0,y=parseFloat(editor.dataset.y)||0;drawingCtx.save();drawingCtx.fillStyle=getDrawingTextColor();drawingCtx.font='16px Segoe UI, Arial, sans-serif';const lines=text.split('\n');lines.forEach((line,i)=>drawingCtx.fillText(line,x,y+16+i*21,Math.max(30,rect.width-x-8)));drawingCtx.restore();}}catch(err){console.error('Не удалось сохранить текст на листе',err);}finally{editor.remove();}
}
drawingPaper.addEventListener('pointerdown',e=>{const editor=drawingPaper.querySelector('.drawing-text-editor');if(editor&&!editor.contains(e.target)&&e.target!==drawingCanvas)finishInlineText(editor,true);});
drawingCanvas.addEventListener('contextmenu',e=>e.preventDefault());
drawingCanvas.addEventListener('pointerdown',event=>{
  if(drawingMode==='text'){
    event.preventDefault();const point=getDrawingPoint(event);
    const existing=drawingPaper.querySelector('.drawing-text-editor');if(existing)finishInlineText(existing,true);
    const editor=document.createElement('div');editor.className='drawing-text-editor';editor.contentEditable='true';editor.setAttribute('role','textbox');editor.setAttribute('aria-label','Текст заметки');editor.dataset.x=String(Math.max(4,Math.min(point.x,drawingCanvas.clientWidth-100)));editor.dataset.y=String(Math.max(0,Math.min(point.y,drawingCanvas.clientHeight-24)));editor.style.left=editor.dataset.x+'px';editor.style.top=editor.dataset.y+'px';editor.style.setProperty('--draw-editor-bg',document.body.classList.contains('theme-light')?'#ffffff':'#101820');editor.style.setProperty('--draw-editor-color',document.body.classList.contains('theme-light')?'#111111':'#ffffff');drawingPaper.appendChild(editor);editor.focus();
    editor.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();finishInlineText(editor,false);drawingCanvas.focus();}else if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();finishInlineText(editor,true);drawingCanvas.focus();}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undoDrawing();}});
    editor.addEventListener('blur',()=>finishInlineText(editor,true),{once:true});return;
  }
  if(event.button!==0&&event.button!==2)return;event.preventDefault();saveDrawingSnapshot();drawing=true;erasing=event.button===2;lastPoint=getDrawingPoint(event);drawingCanvas.setPointerCapture(event.pointerId);
  drawingCtx.globalCompositeOperation=erasing?'destination-out':'source-over';drawingCtx.beginPath();drawingCtx.arc(lastPoint.x,lastPoint.y,erasing?12:1.4,0,Math.PI*2);drawingCtx.fillStyle='#c4dff7';drawingCtx.fill();drawingCtx.beginPath();drawingCtx.moveTo(lastPoint.x,lastPoint.y);
});
drawingCanvas.addEventListener('pointermove',event=>{if(!drawing||!lastPoint)return;const point=getDrawingPoint(event);drawingCtx.globalCompositeOperation=erasing?'destination-out':'source-over';drawingCtx.strokeStyle='#c4dff7';drawingCtx.lineWidth=erasing?24:2.4;drawingCtx.lineTo(point.x,point.y);drawingCtx.stroke();drawingCtx.beginPath();drawingCtx.moveTo(point.x,point.y);lastPoint=point;});
function stopDrawing(){drawing=false;lastPoint=null;drawingCtx.beginPath();drawingCtx.globalCompositeOperation='source-over';}
drawingCanvas.addEventListener('pointerup',stopDrawing);drawingCanvas.addEventListener('pointercancel',stopDrawing);drawingCanvas.addEventListener('lostpointercapture',stopDrawing);
document.getElementById('drawTool').addEventListener('click',()=>setDrawingMode('draw'));document.getElementById('textTool').addEventListener('click',()=>setDrawingMode('text'));document.getElementById('undoDrawing').addEventListener('click',undoDrawing);
window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!e.target.closest('input,textarea,[contenteditable="true"]')){e.preventDefault();e.stopPropagation();undoDrawing();}},true);
window.addEventListener('resize',resizeDrawingCanvas);resizeDrawingCanvas();
try{const saved=localStorage.getItem(drawingStorageKey);if(saved){const img=new Image();img.onload=()=>drawingCtx.drawImage(img,0,0,drawingCanvas.clientWidth,drawingCanvas.clientHeight);img.src=saved;}}catch(e){}
// Основной проход после загрузки каталога из БД:
// 1) ВСЕ строки скрыты и не выбраны — на пустом сайте карты не должны выглядеть «выбранными»;
//    карта появляется в таблице только когда пользователь добавил её в сравнение (addGpu).
//    Исключение — ссылки «поделиться» с параметром ?gpus=... (востановление ниже).
// 2) Восстанавливаем флаги избранного из localStorage.
if (PAGE.kind === 'cpu') {
  // Подпись под столбцом «Частота»: база - буст (мелким шрифтом, как у видеокарт в «Частота ядра»)
  const thFreq=[...table.tHead.rows[0].cells].find(th=>/^частота$/i.test(th.textContent.trim()));
  if (thFreq) thFreq.innerHTML='Частота<small style="display:block;font-weight:400;font-size:.72em;opacity:.75">база - буст</small>';
}
catalogReady.then(() => { hideUnselectedRows(); updateCounts(); });
// Modal helpers: these are front-end placeholders until an account/contact backend is connected.
const modalBackdrop = document.getElementById('modalBackdrop'), modalTitle = document.getElementById('modalTitle'), modalBody = document.getElementById('modalBody'), modalSubmit = document.getElementById('modalSubmit');
let modalAction = null;
function openModal(title, body, actionLabel='Продолжить', action=null) {
  modalTitle.textContent = title; modalBody.innerHTML = body; modalSubmit.textContent = actionLabel; modalAction = action;
  document.querySelector('.site-modal').classList.remove('rate-modal');
  document.getElementById('modalCancel').textContent = 'Закрыть';
  modalBackdrop.classList.add('open');
}
function closeModal(){modalBackdrop.classList.remove('open');modalAction=null;document.querySelector('.site-modal').classList.remove('rate-modal');document.getElementById('modalCancel').textContent='Закрыть';}
document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalCancel').addEventListener('click', closeModal);
let modalPointerStartedOutside=false;
modalBackdrop.addEventListener('pointerdown', e => { modalPointerStartedOutside = e.target===modalBackdrop; });
modalBackdrop.addEventListener('click', e => { if(e.target===modalBackdrop && modalPointerStartedOutside) closeModal(); modalPointerStartedOutside=false; });
modalSubmit.addEventListener('click', () => { if(modalAction) modalAction(); else closeModal(); });
document.getElementById('loginButton').addEventListener('click', () => openModal('Вход и регистрация', '<p>В демонстрационной версии аккаунты ещё не подключены. После подключения регистрации избранные видеокарты будут синхронизироваться между устройствами.</p><input type="email" placeholder="Электронная почта" aria-label="Электронная почта"><input type="password" placeholder="Пароль" aria-label="Пароль">', 'Понятно'));
const pageInfo = {
  processors:null,
  error:['Нашли ошибку?','<p>Сообщите модель видеокарты, характеристику с ошибкой и правильное значение (если оно известно).</p><textarea id="modalMessage" rows="4" placeholder="Опишите ошибку"></textarea>'],
  contact:['Напишите нам','<input id="contactEmail" type="email" placeholder="Ваш email (необязательно)"><textarea id="modalMessage" rows="4" placeholder="Ваше сообщение"></textarea>'],
  faq:['Часто задаваемые вопросы о видеокартах','<article class="faq-page"><p class="faq-intro">Ответы на популярные вопросы о сравнении видеокарт NVIDIA GeForce, AMD Radeon и Intel Arc, игровых FPS, видеопамяти и выборе GPU для компьютера.</p><h2>Как сравнить видеокарты между собой?</h2><p>Выберите две или несколько моделей в разделе сравнения видеокарт. Сопоставляйте поколение графического процессора, частоты, количество вычислительных блоков, тип и объём видеопамяти, пропускную способность, энергопотребление и требования к блоку питания. Одной характеристики недостаточно, чтобы определить победителя во всех задачах.</p><h2>Какая видеокарта лучше для игр?</h2><p>Лучшая видеокарта зависит от бюджета, разрешения монитора, игр и желаемой частоты кадров. Для корректного выбора сравнивайте независимые игровые тесты в одинаковом разрешении и на одинаковых настройках. Самая дорогая модель нужна не каждому.</p><h2>Как узнать, сколько FPS будет в игре?</h2><p>FPS зависит не только от видеокарты, но и от процессора, оперативной памяти, разрешения, графических настроек, драйверов и конкретной игры. Ищите тесты именно в тех играх и условиях, в которых планируете играть. Результат одной игры нельзя автоматически переносить на все остальные.</p><h2>Что важнее: объём видеопамяти или мощность видеокарты?</h2><p>Важны оба параметра. Объём VRAM влияет на возможность использовать текстуры высокого качества и работать с большими сценами, но сам по себе не гарантирует высокий FPS. Сравнивайте видеопамять вместе с реальными тестами производительности и пропускной способностью.</p><h2>Что означают NVIDIA Blackwell, AMD RDNA и Intel Xe?</h2><p>Это названия архитектур графических процессоров. Архитектура определяет устройство GPU и поддерживаемые возможности. При сравнении старых и новых моделей учитывайте не только поколение, но и результаты тестов, объём памяти и поддержку нужных технологий.</p><h2>Что лучше — NVIDIA GeForce или AMD Radeon?</h2><p>Универсального ответа нет. Сравните производительность в ваших играх, трассировку лучей, технологии масштабирования изображения, кодирование видео, поддержку программ и энергопотребление. Для рабочих задач совместимость с конкретным приложением может быть важнее игрового рейтинга.</p><h2>Подойдёт ли видеокарта к моему компьютеру?</h2><p>Перед покупкой проверьте длину и толщину карты, свободное место в корпусе, мощность и разъёмы блока питания, слот PCI Express и возможности охлаждения. Также убедитесь, что процессор не будет существенно ограничивать производительность в ваших играх.</p><h2>Какой блок питания нужен для видеокарты?</h2><p>Ориентируйтесь на рекомендации производителя конкретной модели, разъёмы питания и энергопотребление всей системы. Учитывайте качество блока питания и запас мощности; не выбирайте его только по максимальной цифре на наклейке.</p><h2>Как сравнивать видеокарты для 1080p, 1440p и 4K?</h2><p>Чем выше разрешение, тем больше нагрузка на GPU и видеопамять. Сравнивайте FPS отдельно для Full HD (1080p), 1440p и 4K: производительность и относительный разрыв между моделями могут отличаться в зависимости от разрешения и игры.</p><h2>Можно ли сравнивать мобильную видеокарту ноутбука с настольной?</h2><p>Нужно учитывать конкретную модель, лимит мощности, охлаждение и настройки ноутбука. Названия с одинаковым номером не всегда означают одинаковую производительность в мобильной и настольной версиях. Лучше опираться на тесты конкретного устройства.</p><h2>Что такое частота ядра, шина памяти и TDP?</h2><p>Частота ядра показывает рабочую частоту GPU; шина памяти влияет на обмен данными с видеопамятью; TDP/TGP помогает оценить тепловые и энергетические требования, но определения различаются у производителей. Ни один из этих показателей отдельно не является точным рейтингом производительности.</p><h2>Можно ли доверять одному рейтингу видеокарт?</h2><p>Любой общий рейтинг упрощает картину: порядок моделей меняется в зависимости от игры, разрешения и технологий. Для выбора используйте несколько независимых тестов и проверяйте условия измерений. Если данные на сайте обозначены как ориентировочные, не воспринимайте их как гарантированный FPS.</p><h2>Как сообщить об ошибке в характеристиках?</h2><p>Откройте пункт «Нашли ошибку?» и укажите модель видеокарты, характеристику и ссылку на источник, если он есть. Это поможет проверить информацию и исправить возможную неточность.</p></article>']
};
// Форма пользовательской оценки: все три значения можно вводить вручную.
const popularGames = [
 'Counter-Strike 2','Dota 2','Cyberpunk 2077','Grand Theft Auto V','Grand Theft Auto VI',
 'Fortnite','PUBG: Battlegrounds','Call of Duty: Warzone','Apex Legends','Minecraft',
 'Hogwarts Legacy','Red Dead Redemption 2','The Witcher 3: Wild Hunt','Baldur’s Gate 3',
 'Helldivers 2','Forza Horizon 5','Alan Wake 2','Escape from Tarkov','World of Tanks',
 'Valorant','Overwatch 2','Starfield','S.T.A.L.K.E.R. 2: Heart of Chornobyl','Black Myth: Wukong',
 'League of Legends','A Plague Tale: Requiem','Assassin’s Creed Shadows','Assassin’s Creed Valhalla',
 'Battlefield 2042','Battlefield 6','Call of Duty: Black Ops 6','Diablo IV','Elden Ring',
 'F1 25','Farming Simulator 25','Final Fantasy XVI','God of War Ragnarök','Horizon Forbidden West',
 'Kingdom Come: Deliverance II','Marvel Rivals','Microsoft Flight Simulator 2024','Monster Hunter Wilds',
 'Path of Exile 2','Resident Evil 4','Silent Hill 2','The Last of Us Part I','The Last of Us Part II',
 'The Sims 4','War Thunder','Warframe','World of Warcraft'
];
const gameAliases = {
 'Counter-Strike 2':['кс2','кс 2','кс','контр страйк 2','контрстрайк 2','контр страйк','контрстрайк','контра','counter strike','cs2','ксго','cs go','ксерка'],
 'Dota 2':['дота 2','дота','дота2'],
 'Cyberpunk 2077':['киберпанк','кибер панк','киберпанк 2077','cyberpunk'],
 'Grand Theft Auto V':['гта 5','гта5','гта в','гта 5','gta 5','gta v','гта','гта 5 рп','гта онлайн'],
 'Grand Theft Auto VI':['гта 6','гта6','gta 6','gta vi'],
 'Fortnite':['фортнайт','фортнайт','форт'],
 'PUBG: Battlegrounds':['пубг','пабг','пабджи','пабг батлграундс','pubg'],
 'Call of Duty: Warzone':['кол оф дьюти','колда','варзон','warzone','кал оф дьюти','кол оф дьюти варзон'],
 'Apex Legends':['апекс','апекс легендс','апекс легенды'],
 'Minecraft':['майнкрафт','минекрафт','майн','minecraft'],
 'Hogwarts Legacy':['хогвартс','хогвартс легаси','хогвартс наследие'],
 'Red Dead Redemption 2':['ред дед редемпшен 2','ред дед 2','рдр 2','рдр2','rdr2','ред дед'],
 'The Witcher 3: Wild Hunt':['ведьмак','ведьмак 3','ведьмак 3 дикая охота','ведьмак дикая охота'],
 'Baldur’s Gate 3':['балдурс гейт 3','балдурс гейт','балдур','бг3'],
 'Helldivers 2':['хеллдайверс 2','хеллдайверс','хелл дайверс'],
 'Forza Horizon 5':['форза хорайзон 5','форза горизонт 5','форза 5','форза'],
 'Alan Wake 2':['алан вейк 2','алан вейк'],
 'Escape from Tarkov':['тарков','эскейп фром тарков','побег из таркова'],
 'World of Tanks':['мир танков','ворлд оф танкс','вот','wot','танки'],
 'Valorant':['валорант','валик'],
 'Overwatch 2':['оверwatch 2','оверватч 2','оверватч','овервотч'],
 'Starfield':['старфилд'],
 'S.T.A.L.K.E.R. 2: Heart of Chornobyl':['сталкер 2','сталкер','сталкер сердце чернобыля','stalker 2'],
 'Black Myth: Wukong':['блэк миф вуконг','блэк миф','black myth','вуконг'],
 'League of Legends':['лига легенд','лол','league of legends'],
 'A Plague Tale: Requiem':['плаг тейл','плейг тейл','чума реквием'],
 'Assassin’s Creed Shadows':['ассасин крид шэдоус','ассасин шэдоус','ассасинс крид'],
 'Assassin’s Creed Valhalla':['ассасин крид вальгалла','вальгалла'],
 'Battlefield 2042':['батлфилд 2042','батла 2042','батлфилд'],
 'Battlefield 6':['батлфилд 6','батла 6'],
 'Call of Duty: Black Ops 6':['блэк опс 6','блэк опс','black ops 6','колда блэк опс'],
 'Diablo IV':['диабло 4','диабло iv','диабло'],
 'Elden Ring':['элден ринг','елден ринг','elden ring'],
 'F1 25':['ф1 25','формула 1 25','f1 25'],
 'Farming Simulator 25':['фарминг симулятор 25','симулятор фермера','фермер симулятор'],
 'Final Fantasy XVI':['финал фэнтези 16','финал фэнтези xvi','final fantasy 16'],
 'God of War Ragnarök':['год оф вар рагнарёк','год оф вар рагнарек','бог войны рагнарёк','год оф вар'],
 'Horizon Forbidden West':['хорайзон форбидден вест','хорайзон запретный запад','horizon forbidden west'],
 'Kingdom Come: Deliverance II':['кингдом кам 2','кингдом кам деливеранс 2','kingdom come 2'],
 'Marvel Rivals':['марвел райвалс','марвел ривалс','ривалс'],
 'Microsoft Flight Simulator 2024':['симулятор полётов','симулятор полетов','флайт симулятор','microsoft flight simulator'],
 'Monster Hunter Wilds':['монстер хантер вайлдс','монстер хантер','monster hunter'],
 'Path of Exile 2':['путь изгнанника 2','пое 2','поэ 2','path of exile 2'],
 'Resident Evil 4':['резидент ивил 4','обитель зла 4','резидент эвил 4'],
 'Silent Hill 2':['сайлент хилл 2','сайлент хилл'],
 'The Last of Us Part I':['одни из нас','ласт оф ас','the last of us','последние из нас'],
 'The Last of Us Part II':['одни из нас 2','ласт оф ас 2','последние из нас 2'],
 'The Sims 4':['симс 4','симс','sims 4'],
 'War Thunder':['вар тандер','вар тандер','war thunder'],
 'Warframe':['варфрейм','warframe'],
 'World of Warcraft':['ворлд оф варкрафт','варкрафт','вов','wow']
};
function gameMatches(query){
  const q=query.trim().toLocaleLowerCase('ru'); if(!q)return [];
  return popularGames.filter(g=>g.toLocaleLowerCase('ru').includes(q)||(gameAliases[g]||[]).some(a=>{a=a.toLocaleLowerCase('ru');return a.includes(q)||(a.length>3&&q.includes(a));})).slice(0,8);
}
function showGameSuggestions(input,showAll){
  const wrap=input.closest('.rate-game-wrap'), box=wrap.querySelector('.rate-suggestions'), toggle=wrap.querySelector('.rate-game-toggle');
  const list=showAll?popularGames:gameMatches(input.value);
  if(!list.length||(!showAll&&!input.value.trim())){box.hidden=true;toggle.setAttribute('aria-expanded','false');return;}
  box.innerHTML=list.map(g=>'<button type="button" class="rate-suggestion" data-game="'+escapeRateHtml(g)+'">'+escapeRateHtml(g)+'</button>').join('');
  box.hidden=false;toggle.setAttribute('aria-expanded','true');
}
function hideRateSuggestions(){document.querySelectorAll('.rate-suggestions').forEach(b=>{b.hidden=true;b.parentElement.querySelector('.rate-game-toggle').setAttribute('aria-expanded','false');});}
document.addEventListener('click',e=>{if(!e.target.closest('.rate-game-wrap'))hideRateSuggestions();});
const fpsOptions=Array.from({length:60},(_,i)=>String((i+1)*5)).concat(['350','400','450','500','600']);
const gpuRateOptions=()=>catalogRows.map(tr=>gpuName(tr));
function escapeRateHtml(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
let rateSeq=0;
function rateSeg(key,label,items,def){
  return '<div class="rate-seg-wrap"><span class="rate-label">'+label+'</span><div class="rate-seg" data-setting="'+key+'">'+items.map(v=>'<button type="button" class="rate-choice'+(v===def?' active':'')+'" data-value="'+v+'">'+v+'</button>').join('')+'</div></div>';
}
function rateRowHtml(){
  const n=++rateSeq, opt=a=>a.map(v=>'<option value="'+escapeRateHtml(v)+'"></option>').join('');
  return '<div class="rate-row"><div class="rate-grid">'
   +'<label class="rate-field"><span class="rate-label">Видеокарта</span><input class="rate-gpu" type="text" list="rg'+n+'" placeholder="Например, GeForce RTX 5090" autocomplete="off"><datalist id="rg'+n+'">'+opt(gpuRateOptions())+'</datalist></label>'
   +'<div class="rate-field"><span class="rate-label">Игра</span><div class="rate-game-wrap"><input class="rate-game" type="text" placeholder="Введите или выберите игру" autocomplete="off" aria-label="Игра"><button class="rate-game-toggle" type="button" aria-label="Список игр" aria-expanded="false">▾</button><div class="rate-suggestions" hidden></div></div></div>'
   +'<label class="rate-field"><span class="rate-label">Средний FPS</span><input class="rate-fps" type="number" inputmode="numeric" min="1" max="1000" list="rf'+n+'" placeholder="FPS"><datalist id="rf'+n+'">'+opt(fpsOptions)+'</datalist></label></div>'
   +'<div class="rate-settings">'+rateSeg('resolution','Разрешение',['Full HD','2K','4K'],'Full HD')+rateSeg('quality','Графика',['Низкие','Средние','Ультра'],'Средние')
   +'<button class="remove-rate-row" type="button">Удалить результат</button></div></div>';
}
function maybeAppendRateRow(){
  const c=document.getElementById('rateRows'); if(!c)return;
  const last=c.lastElementChild;
  if(last&&last.querySelector('.rate-game').value.trim()&&+last.querySelector('.rate-fps').value>0)c.insertAdjacentHTML('beforeend',rateRowHtml());
}
function openRateModal(){
  openModal('Моя видеокарта','<p class="rate-sub">Укажите видеокарту, игру, средний FPS и настройки теста. Игру можно вводить по-русски — подскажем английское название.</p><div id="rateRows">'+rateRowHtml()+'</div><p class="rate-hint">Новая строка добавится сама, когда заполнены игра и FPS.</p>','Отправить результаты',submitRateForm);
  document.querySelector('.site-modal').classList.add('rate-modal');
  document.getElementById('modalCancel').textContent='Отмена';
  const rows=document.getElementById('rateRows');
  rows.addEventListener('input',e=>{if(e.target.matches('.rate-game'))showGameSuggestions(e.target);maybeAppendRateRow();});
  rows.addEventListener('change',maybeAppendRateRow);
  rows.addEventListener('click',e=>{
    const t=e.target, wrap=t.closest('.rate-game-wrap');
    if(t.closest('.rate-game-toggle')){const box=wrap.querySelector('.rate-suggestions');if(box.hidden){showGameSuggestions(wrap.querySelector('.rate-game'),true);box.scrollTop=0;}else hideRateSuggestions();return;}
    const sug=t.closest('.rate-suggestion');
    if(sug){wrap.querySelector('.rate-game').value=sug.dataset.game;hideRateSuggestions();maybeAppendRateRow();return;}
    const ch=t.closest('.rate-choice');
    if(ch){ch.parentElement.querySelectorAll('.rate-choice').forEach(b=>b.classList.toggle('active',b===ch));return;}
    const rm=t.closest('.remove-rate-row');if(rm)rm.closest('.rate-row').remove();
  });
}
function submitRateForm(){
  const rows=[...document.querySelectorAll('#rateRows .rate-row')];
  const results=rows.map(row=>({gpu:row.querySelector('.rate-gpu').value.trim(),game:row.querySelector('.rate-game').value.trim(),fps:row.querySelector('.rate-fps').value,resolution:row.querySelector('[data-setting="resolution"] .rate-choice.active')?.dataset.value||'Full HD',quality:row.querySelector('[data-setting="quality"] .rate-choice.active')?.dataset.value||'Средние'})).filter(x=>x.game||x.fps||x.gpu);
  if(!results.length || results.some(x=>!x.gpu||!x.game||!x.fps||Number(x.fps)<=0)){
    openModal('Заполните результаты','<p>В каждой заполненной строке укажите видеокарту, игру и положительное значение FPS. Названия видеокарты и игры разрешено вводить вручную. Пустую последнюю строку можно оставить без заполнения.</p>','Вернуться к форме',()=>{closeModal();openRateModal();});return;
  }
  const summary=results.map(x=>`<div style="padding:9px 0;border-bottom:1px solid #203b58"><b>${escapeRateHtml(x.gpu)}</b> — ${escapeRateHtml(x.game)}: <b>${escapeRateHtml(x.fps)} FPS</b><br><small style="color:#91aec7">${escapeRateHtml(x.resolution)} · графика: ${escapeRateHtml(x.quality)}</small></div>`).join('');
  openModal('Результаты подготовлены',`<p>Спасибо! Вы указали:</p>${summary}<p>Отправка на сайт пока не подключена. Когда появится серверная часть, эти данные можно будет передавать на проверку и использовать для объективного рейтинга.</p>`,'Понятно');
}

document.getElementById('clearDrawing').addEventListener('click',()=>{const editor=drawingPaper.querySelector('.drawing-text-editor');if(editor)finishInlineText(editor,false);saveDrawingSnapshot();drawingCtx.clearRect(0,0,drawingCanvas.width,drawingCanvas.height);});
document.getElementById('saveDrawing').addEventListener('click',()=>{try{localStorage.setItem(drawingStorageKey,drawingCanvas.toDataURL('image/png'));openModal('Заметка сохранена','<p>Заметка сохранена в этом браузере на этом устройстве. Вы сможете открыть её при следующем посещении сайта.</p>','Понятно');}catch(e){openModal('Не удалось сохранить заметку','<p>В браузере недостаточно места для сохранения. Попробуйте скачать рисунок через «Поделиться».</p>','Закрыть');}});
async function exportDrawingFile(){const blob=await new Promise(resolve=>drawingCanvas.toBlob(resolve,'image/png'));if(!blob){openModal('Не удалось подготовить рисунок','<p>Попробуйте ещё раз.</p>','Закрыть');return null;}return new File([blob],(PAGE.kind==='cpu'?'cpu':'gpu')+'-compare-zametka.png',{type:'image/png'});}
document.getElementById('sendDrawing').addEventListener('click',()=>{
  openModal('Поделиться заметкой','<p>Выберите, что сделать с рисунком.</p><div class="drawing-share-actions"><button type="button" class="btn primary" id="drawingShareOthers">Поделиться</button><button type="button" class="btn" id="drawingSendUs">Отправить нам</button></div>','Закрыть');
  document.getElementById('drawingSendUs').addEventListener('click',async()=>{const file=await exportDrawingFile();if(!file)return;const blob=new Blob([await file.arrayBuffer()],{type:'image/png'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);closeModal();openModal('Рисунок подготовлен к отправке','<p>Файл заметки скачан. Прикрепите его к письму или сообщению нам. Автоматическая отправка будет доступна после подключения адреса обратной связи.</p>','Понятно');});
  document.getElementById('drawingShareOthers').addEventListener('click',async()=>{const file=await exportDrawingFile();if(!file)return;try{if(navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:'Заметка GPU Compare',text:'Моя заметка'});closeModal();return;}}catch(e){if(e.name==='AbortError')return;}const url=URL.createObjectURL(new Blob([await file.arrayBuffer()],{type:'image/png'}));const a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);closeModal();openModal('Заметка сохранена','<p>Браузер не поддерживает прямую отправку файла — скачайте изображение и прикрепите его к нужному приложению.</p>','Понятно');});
});
document.querySelectorAll('.sidebar .navitem').forEach(item => item.addEventListener('click', () => {
  const page = item.dataset.page;
  // Переход между страницами видеокарт и процессоров — через загрузку новой страницы.
  if(page==='processors'){ location.href='cpu.html'; return; }
  if(page==='compare'){ location.href='index.html'; return; }
  document.querySelectorAll('.sidebar .navitem').forEach(n => n.classList.remove('active')); item.classList.add('active');
  if(page==='rate'){openRateModal();return;} if(pageInfo[page]) { openModal(pageInfo[page][0], pageInfo[page][1], 'Понятно'); if(page==='faq') document.querySelector('.site-modal')?.classList.add('faq-reading'); }
}));
document.getElementById('shareComparison').addEventListener('click', async () => {
  const selected = [...table.tBodies[0].rows].filter(tr => tr.dataset.selected==='true').map(tr => gpuName(tr));
  const url = new URL(window.location.href); url.searchParams.set(PAGE.shareParam, selected.join('|'));
  const shareUrl = url.href;
  try { await navigator.clipboard.writeText(shareUrl); openModal('Ссылка скопирована','<p>Ссылка содержит выбранные '+PAGE.nounPl+'. После размещения сайта на домене ею можно будет поделиться с другими пользователями.</p><input readonly value="'+shareUrl.replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'">','Готово'); }
  catch(e) { openModal('Ссылка на сравнение','<p>Скопируйте ссылку ниже.</p><input id="shareUrlInput" readonly value="'+shareUrl.replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'">','Выделить ссылку',()=>{const f=document.getElementById('shareUrlInput');f.select();document.execCommand('copy');closeModal();}); }
});
document.getElementById('siteFeedback').addEventListener('click', () => openModal('Отзыв о сайте','<p>Что понравилось или что стоит улучшить?</p><textarea id="feedbackText" rows="4" placeholder="Напишите отзыв"></textarea><input id="feedbackEmail" type="email" placeholder="Email для ответа (необязательно)">','Подготовить письмо',()=>{
  const msg=document.getElementById('feedbackText')?.value||''; const email=document.getElementById('feedbackEmail')?.value||'';
  window.location.href='mailto:?subject='+encodeURIComponent('Отзыв о GPU Compare')+'&body='+encodeURIComponent(msg+(email?'\n\nEmail для ответа: '+email:'')); closeModal();
}));
// Данные из БД получены — строим строки таблицы.
catalogReady.then(rows => { if (PAGE.kind === 'cpu') buildCpuRows(rows); else buildRows(rows); });
// Restore selected cards from a shared URL (?gpus=... — выбор пользователя, не «все карты»).
catalogReady.then(() => { try { const shared = new URL(window.location.href).searchParams.get(PAGE.shareParam); if(shared) { shared.split('|').forEach(n => { const tr=catalogRows.find(t => gpuName(t)===n); if(tr) addGpu(tr); }); } } catch(e) {} });


/* ===== v7: поля в одну строку, перетаскивание строк, шкалы производительности ===== */
var perfReady=false;
const reduceMotion=matchMedia('(prefers-reduced-motion:reduce)').matches;

// 1. Подпись поля подбирается под его ширину — все поля помещаются в одну строку.
const PH = PAGE.kind==='cpu'
  ? {'filter-all':['Все процессоры','Все'],'filter-amd':['AMD — выбрать модель','AMD — модель','AMD'],'filter-intel':['INTEL — выбрать модель','INTEL — модель','INTEL'],'filter-retro':['Ретро процессоры до 2010г','Ретро до 2010г','Ретро'],'filter-favorites':['Избранные','Избр.','★']}
  : {'filter-all':['Все видеокарты','Все'],'filter-nvidia':['NVIDIA — выбрать модель','NVIDIA — модель','NVIDIA'],'filter-amd':['AMD — выбрать модель','AMD — модель','AMD'],'filter-intel':['INTEL — выбрать модель','INTEL — модель','INTEL'],'filter-retro':['Ретро карты до 2015г','Ретро до 2015г','Ретро'],'filter-favorites':['Избранные','Избр.','★']};
const phCtx=document.createElement('canvas').getContext('2d');
function fitPlaceholders(){
  for(const [id,list] of Object.entries(PH)){
    const inp=document.getElementById(id), cs=getComputedStyle(inp);
    phCtx.font='800 '+cs.fontSize+' '+cs.fontFamily;
    const room=inp.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight)-4;
    inp.placeholder=list.find(t=>phCtx.measureText(t).width<=room)||list[list.length-1];
  }
}
new ResizeObserver(fitPlaceholders).observe(document.querySelector('.filters'));
if(document.fonts)document.fonts.ready.then(fitPlaceholders);

// 2. Шкалы производительности.
// Производительность = Passmark G3D Mark (data-perf у каждой строки); шкала показывает % от лучшей карты среди выбранных.
// С базой данных достаточно выводить <tr data-perf="..."> — таблица GPU_PERF тогда не нужна.
const GPU_PERF={}; // демо-таблица убрана, используется data-perf
const perfList=document.getElementById('perfList'), perfEmpty=document.getElementById('perfEmpty'), perfPanel=document.getElementById('perfPanel'), perfEls=new Map(); // на странице cpu.html этих элементов нет — весь блок «график производительности» там отключён
const fmtPct=v=>(v>=10?Math.round(v):v.toFixed(1).replace('.',','))+'%';
catalogReady.then(()=>{ catalogRows.forEach(tr=>{
  tr.dataset.perf=tr.dataset.perf||GPU_PERF[gpuName(tr)]||0;
}); updateCounts(); });
// Шкала плавно вырастает/уменьшается (CSS transition), число меняется синхронно с ней.
function setBar(fill,label,pct,instant){
  if(!fill||!label) return; // на странице процессоров мини-шкал нет — пропускаем
  cancelAnimationFrame(label._r);
  const from=instant?0:(+label.dataset.v||0);
  label.dataset.v=pct; fill.style.width=pct+'%';
  if(instant||reduceMotion){label.textContent=fmtPct(pct);return;}
  const t0=performance.now();
  const step=t=>{const k=Math.min(1,(t-t0)/800), e=1-Math.pow(1-k,3);label.textContent=fmtPct(from+(pct-from)*e);if(k<1)label._r=requestAnimationFrame(step);};
  label._r=requestAnimationFrame(step);
}
function renderPerf(){
  const sel=catalogRows.filter(tr=>tr.dataset.selected==='true').sort((a,b)=>b.dataset.perf-a.dataset.perf);
  const max=sel.length?+sel[0].dataset.perf:0, keep=new Set(sel.map(gpuName));
  // На странице процессоров боковой панели «Производительность» нет — обновляем только мини-шкалы в таблице.
  if(!perfList||!perfEmpty){
    sel.forEach(tr=>{const pct=max?tr.dataset.perf/max*100:0; setBar(tr.querySelector('.mini-fill'),tr.querySelector('.mini-perf b'),pct);});
    catalogRows.forEach(tr=>{if(tr.dataset.selected!=='true')setBar(tr.querySelector('.mini-fill'),tr.querySelector('.mini-perf b'),0,true);});
    return;
  }
  perfEmpty.hidden=sel.length>0;
  const first=new Map([...perfEls].map(([k,el])=>[k,el.offsetTop]));
  for(const [k,el] of perfEls) if(!keep.has(k)){el.style.top=el.offsetTop+'px';el.classList.add('leaving');perfEls.delete(k);setTimeout(()=>el.remove(),300);}
  sel.forEach((tr,i)=>{
    const k=gpuName(tr); let el=perfEls.get(k);
    if(!el){
      el=document.createElement('div');el.className='perf-row entering';el.dataset.brand=tr.dataset.brand;
      el.innerHTML='<span class="perf-rank"></span><span class="perf-name"></span><span class="perf-track"><i class="perf-fill"></i></span><b class="perf-val">0%</b>';
      el.querySelector('.perf-name').textContent=k;perfEls.set(k,el);
    }
    perfList.appendChild(el);el.querySelector('.perf-rank').textContent=i+1;
  });
  catalogRows.forEach(tr=>{if(tr.dataset.selected!=='true')setBar(tr.querySelector('.mini-fill'),tr.querySelector('.mini-perf b'),0,true);});
  // FLIP: строки плавно «перетекают» на новые места
  if(!reduceMotion)for(const [k,el] of perfEls){const dy=first.has(k)?first.get(k)-el.offsetTop:0;if(dy){el.style.transition='none';el.style.transform='translateY('+dy+'px)';}}
  void perfList.offsetHeight;
  for(const el of perfEls.values()){el.style.transition='';el.style.transform='';el.classList.remove('entering');}
  sel.forEach(tr=>{
    const pct=max?tr.dataset.perf/max*100:0, el=perfEls.get(gpuName(tr));
    setBar(el.querySelector('.perf-fill'),el.querySelector('.perf-val'),pct);
    setBar(tr.querySelector('.mini-fill'),tr.querySelector('.mini-perf b'),pct);
  });
}


// 3. Перетаскивание строк мышью (за название; на сенсорных экранах — за значок ).
(function(){
  const tbody=table.tBodies[0];
  let d=null, raf=0;
  const rowsNow=()=>[...tbody.rows].filter(r=>r.style.display!=='none');
  const tTop=()=>table.getBoundingClientRect().top;
  const shift=(r,y,anim)=>{for(const c of r.cells){c.style.transition=anim?'transform .25s cubic-bezier(.22,.8,.3,1)':'none';c.style.transform=y?'translateY('+y+'px)':'';}};
  function place(){
    if(!d||!d.on)return;
    const rows=rowsNow(), others=rows.filter(r=>r!==d.tr);
    const want=d.cy-tTop()-d.off, mid=want+d.tr.offsetHeight/2;
    const target=others.filter(r=>mid>r.offsetTop+r.offsetHeight/2).length;
    if(target!==rows.indexOf(d.tr)){
      const was=new Map(others.map(r=>[r,r.offsetTop]));
      if(target>=others.length)tbody.appendChild(d.tr);else tbody.insertBefore(d.tr,others[target]);
      others.forEach(r=>{const dy=was.get(r)-r.offsetTop;if(dy)shift(r,dy,false);});
      void tbody.offsetHeight;
      others.forEach(r=>{if(r.cells[0].style.transform)shift(r,0,true);});
    }
    shift(d.tr,want-d.tr.offsetTop,false);
  }
  function loop(){
    if(!d||!d.on)return;
    const vr=viewport.getBoundingClientRect(), top=vr.top+(table.tHead?table.tHead.offsetHeight:0);
    const sp=d.cy<top+24?-8:d.cy>vr.bottom-36?8:0;
    if(sp){viewport.scrollTop+=sp;place();}
    raf=requestAnimationFrame(loop);
  }
  tbody.addEventListener('pointerdown',e=>{
    const cell=e.target.closest('td:nth-child(2)');
    if(!cell||e.button!==0||(e.pointerType!=='mouse'&&!e.target.closest('.row-grip')))return;
    const tr=cell.parentElement;
    d={tr,id:e.pointerId,y0:e.clientY,cy:e.clientY,off:e.clientY-tTop()-tr.offsetTop,on:false};
    cell.setPointerCapture(e.pointerId);
  });
  tbody.addEventListener('pointermove',e=>{
    if(!d||e.pointerId!==d.id)return;
    d.cy=e.clientY;
    if(!d.on){
      if(Math.abs(d.cy-d.y0)<5)return;
      d.on=true;window.rowDragging=true;
      d.tr.classList.add('row-dragging');document.body.classList.add('is-row-dragging');loop();
    }
    place();
  });
  const end=e=>{
    if(!d||e.pointerId!==d.id)return;
    const w=d;d=null;cancelAnimationFrame(raf);
    if(!w.on)return;
    window.rowDragging=false;document.body.classList.remove('is-row-dragging');
    shift(w.tr,0,true);
    setTimeout(()=>{w.tr.classList.remove('row-dragging');for(const c of w.tr.cells)c.style.transition='';},280);
  };
  tbody.addEventListener('pointerup',end);
  tbody.addEventListener('pointercancel',end);
})();

perfReady=true;renderPerf();

/* ===== v17: меню-«шторка» на планшетах и телефонах ===== */
(function(){
  const root=document.documentElement, btn=document.getElementById('menuToggle');
  const set=on=>{root.classList.toggle('menu-open',on);btn.setAttribute('aria-expanded',String(on));};
  btn.addEventListener('click',()=>set(!root.classList.contains('menu-open')));
  document.getElementById('drawerBackdrop').addEventListener('click',()=>set(false));
  document.querySelector('.sidebar').addEventListener('click',e=>{if(e.target.closest('.navitem,#siteFeedback,.help-link'))set(false);});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')set(false);});
  matchMedia('(min-width:1151px)').addEventListener('change',e=>{if(e.matches)set(false);});
})();

/* ===== v18: ориентация таблицы (видеокарты в строках / в столбцах) ===== */
var tReady=false;
const gridT=document.getElementById('gridT'), tPanel=document.querySelector('.table-panel'), orientBtn=document.getElementById('orientToggle'), ORIENT_KEY=PAGE.orientKey;
function renderT(){
  const rows=[...table.tBodies[0].rows].filter(r=>r.dataset.selected==='true');
  // Список видимых колонок строится по реальным <th>: скрытые (hidden, напр. «Тензорные ядра / RT-ядра») пропускаются,
  // а индексы ячеек (<td>) остаются корректными за счёт map+filter ниже.
  const thAll=[...table.tHead.rows[0].cells];
  const labels=thAll.map((th,idx)=>({th,idx})).filter(o=>o.idx>=2 && !o.th.hasAttribute('hidden'));
  const esc=escapeRateHtml;
  const max=rows.reduce((m,r)=>Math.max(m,+r.dataset.perf||0),0);
  let h='<div class="tg-row" role="row"><div class="tg-corner" role="columnheader"></div>';
  if(!rows.length)h+='<div class="tg-head t-empty" role="columnheader">Выберите '+PAGE.nounAccPl+' в полях выше</div>';
  rows.forEach(r=>{
    const n=gpuName(r), pct=max?(+r.dataset.perf||0)/max*100:0, fav=r.dataset.favorite==='true', sub=r.cells[1].querySelector('small');
    h+='<div class="tg-head" role="columnheader" data-name="'+esc(n)+'" data-brand="'+r.dataset.brand+'"><div class="t-acts"><span class="t-grip" title="Потяните, чтобы изменить порядок" aria-hidden="true"></span>'
     +'<button type="button" class="t-btn fav'+(fav?' is-favorite':'')+'" data-act="fav" title="'+(fav?'Убрать из избранного':'Добавить в избранное')+'" aria-label="Избранное: '+esc(n)+'">'+(fav?'★':'☆')+'</button>'
     +'<button type="button" class="t-btn rm" data-act="rm" title="Убрать из сравнения" aria-label="Убрать '+esc(n)+' из сравнения"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 10v6M14 10v6"/></svg></button></div>'
     +'<span class="t-name">'+esc(n)+'</span><small>'+esc(sub?sub.textContent:'')+'</small>'
     +'<div class="mini-perf"><span class="mini-track"><i class="mini-fill" style="width:'+pct+'%"></i></span><b>'+fmtPct(pct)+'</b></div></div>';
  });
  h+='</div>';
  labels.forEach((o,i)=>{
    const th=o.th;
    h+='<div class="tg-row'+(i%2?' alt':'')+'" role="row"><div class="tg-label'+(th.classList.contains('nc')?' nc':'')+'" role="rowheader"'+(th.title?' title="'+esc(th.title)+'"':'')+'>'+th.innerHTML+'</div>';
    if(!rows.length)h+='<div class="tg-cell" role="cell"></div>';
    rows.forEach(r=>{const cell=r.cells[o.idx];if(!cell)return;h+='<div class="tg-cell" role="cell">'+cell.textContent.split(' / ').map(x=>esc(x).replace(/ /g,'\u00a0')).join(' / ')+'</div>';});
    h+='</div>';
  });
  gridT.style.setProperty('--n',Math.max(rows.length,1));
  gridT.innerHTML=h;
}
gridT.addEventListener('click',e=>{
  const b=e.target.closest('button[data-act]'); if(!b)return;
  const tr=catalogRows.find(t=>gpuName(t)===b.closest('.tg-head').dataset.name); if(!tr)return;
  tr.querySelector(b.dataset.act==='rm'?'.remove-gpu':'.favorite-star').click();
  if(b.dataset.act==='fav')renderT();
});
// Перетаскивание столбцов (за название мышью; на сенсорных экранах — за значок )
(function(){
  let d=null;
  const heads=()=>[...gridT.firstElementChild.children];
  gridT.addEventListener('pointerdown',e=>{
    const h=e.target.closest('.tg-head[data-name]');
    if(!h||e.button!==0||e.target.closest('button')||(e.pointerType!=='mouse'&&!e.target.closest('.t-grip')))return;
    d={h,id:e.pointerId,x0:e.clientX,on:false}; h.setPointerCapture(e.pointerId);
  });
  gridT.addEventListener('pointermove',e=>{
    if(!d||e.pointerId!==d.id)return;
    if(!d.on){if(Math.abs(e.clientX-d.x0)<5)return;d.on=true;window.rowDragging=true;d.h.classList.add('col-dragging');}
    const hs=heads(), from=hs.indexOf(d.h), vr=viewport.getBoundingClientRect(), lw=hs[0].getBoundingClientRect().width;
    if(e.clientX<vr.left+lw+28)viewport.scrollLeft-=12;else if(e.clientX>vr.right-36)viewport.scrollLeft+=12;
    let to=hs.length;
    for(let i=1;i<hs.length;i++){const r=hs[i].getBoundingClientRect();if(e.clientX<r.left+r.width/2){to=i;break;}}
    if(to===from||to===from+1)return;
    for(const row of gridT.children)row.insertBefore(row.children[from],row.children[to]||null);
    const tb=table.tBodies[0];
    heads().slice(1).forEach(x=>{const tr=catalogRows.find(t=>gpuName(t)===x.dataset.name);if(tr)tb.appendChild(tr);});
  });
  const end=e=>{if(!d||e.pointerId!==d.id)return;d.h.classList.remove('col-dragging');window.rowDragging=false;d=null;};
  gridT.addEventListener('pointerup',end);gridT.addEventListener('pointercancel',end);
})();
function setOrient(h,save){
  tPanel.classList.toggle('orient-h',h);
  orientBtn.setAttribute('aria-pressed',String(h));
  orientBtn.title=h?'Вернуть таблицу: видеокарты в строках':'Повернуть таблицу: видеокарты в столбцах';
  if(h)renderT();
  viewport.scrollTo(0,0);
  if(save)try{localStorage.setItem(ORIENT_KEY,h?'h':'v');}catch(e){}
}
orientBtn.addEventListener('click',()=>setOrient(!tPanel.classList.contains('orient-h'),true));
try{if(localStorage.getItem(ORIENT_KEY)==='h')setOrient(true,false);}catch(e){}
tReady=true;renderT();

// Выбор темы: сохранённая настройка имеет приоритет; по умолчанию на мобильных — чёрно-белая.
(function(){const picker=document.getElementById('themePicker'),key=PAGE.themeKey,themes={default:'',mono:'theme-mono',light:'theme-light',purple:'theme-purple',forest:'theme-forest'};let saved='';try{saved=localStorage.getItem(key)||'';}catch(e){}const initial=saved||((window.matchMedia&&window.matchMedia('(max-width: 760px)').matches)?'mono':'default');picker.value=themes[initial]!==undefined?initial:'default';function applyTheme(value){document.body.classList.remove(...Object.values(themes).filter(Boolean));if(themes[value])document.body.classList.add(themes[value]);picker.value=value;try{localStorage.setItem(key,value);}catch(e){}}applyTheme(initial);picker.addEventListener('change',()=>applyTheme(picker.value));})();

/* ===== Уведомление о cookie (включается/выключается переключателем FEATURES.cookies) ===== */
(function(){
  var bar=document.getElementById('cookieBar'); if(!bar)return;
  var KEY='umoCookieNoticeV1', ok=false;
  try{ok=localStorage.getItem(KEY)==='1';}catch(e){}
  if(!ok)bar.classList.add('show');
  document.getElementById('cookieOk').addEventListener('click',function(){bar.classList.remove('show');try{localStorage.setItem(KEY,'1');}catch(e){}
  // Cookie для метрик: аналитические скрипты проверяют наличие umo_metrics_consent=1 перед загрузкой.
  try{var d=new Date();d.setFullYear(d.getFullYear()+1);document.cookie='umo_metrics_consent=1;path=/;max-age=31536000;SameSite=Lax'+(location.protocol==='https:'?';Secure':'');}catch(e){}
  try{window.dispatchEvent(new CustomEvent('umo:metrics-consent'));}catch(e){}
});
  document.getElementById('cookieMore').addEventListener('click',function(){openModal('Как сайт использует cookie и память браузера','<p>Сайт хранит в вашем браузере ваши настройки: тему оформления, избранные '+PAGE.nounPl+', заметку на листе и ориентацию таблицы. Эти данные остаются на вашем устройстве и никуда не передаются.</p><p>Также сайт использует аналитические cookie (метрики): после нажатия «Понятно» устанавливается файл согласия <b>umo_metrics_consent</b> (срок — 1 год), по которому системы статистики собирают анонимные данные о посещении страниц — без персональных данных и без передачи адреса электронной почты.</p><p>Удалить эти данные можно в настройках браузера (очистка данных сайта). Отказ от метрик: удалите cookie <b>umo_metrics_consent</b> — аналитические скрипты перестанут загружаться.</p>','Понятно');});
})();
