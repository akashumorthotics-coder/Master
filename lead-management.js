
(() => {
  'use strict';
  const statuses = ['New','Contact Attempted','Connected','Interested','Follow-up Required','Converted','Not Interested','Lost'];
  const closed = statuses.slice(5);
  const priorities = ['Low','Medium','High'];
  const outcomes = ['Connected','Not Answered','Busy','Switched Off','Call Back Requested','Interested','Not Interested','Converted'];
  const conversations = ['Interested','Product Details Shared','Quotation Requested','Follow-up Required','Call Back Requested','Not Interested','Converted','Other'];
  const missedOutcomes = ['Not Answered','Busy','Switched Off','Other'];
  const callOutcomes = [...new Set([...outcomes,...conversations])];
  const catalogueField = 'whatsapp_catalogue_shared';
  const catalogueOptions = [['Yes','Catalogue Shared – Yes'],['No','Catalogue Not Shared – No']];
  const catalogueFilter = () => select(catalogueField,'WhatsApp catalogue',catalogueOptions);
  const catalogueText = lead => lead[catalogueField] === 'Yes' ? 'Yes' : lead[catalogueField] === 'No' ? 'No' : 'Not available';
  const fields = [
    ['name','Full name','text',120], ['mobile','Mobile number','tel',32], ['email','Email ID','email',254],
    ['address','Address','textarea',500], ['city','City','text',100], ['state','State','text',100], ['dob','DOB','date'],
    ['doa','DOA','date'], ['source','Lead source','text',120], ['product','Interested product','text',160],
    ['priority','Lead priority','select'], ['remarks','Remarks','textarea',1500],
    [catalogueField,'Catalogue Shared on WhatsApp?','checkbox']
  ];
  const listColumns = [
    ['name','Lead Name'],['mobile','Mobile Number'],['city','City'],['state','State'],['source','Lead Source'],
    ['ownerName','Lead Owner'],['status','Lead Status'],['priority','Priority'],['lastContactAt','Last Contact Date'],
    ['nextFollowUpAt','Next Follow-up Date'],['lastRemarks','Last Remarks'],[catalogueField,'Catalogue Shared on WhatsApp?']
  ];
  const reportColumns = [
    ['name','Salesperson'],['imported','Leads imported'],['manual','Manually created'],['active','Active leads'],
    ['attempted','Calls attempted'],['connected','Successful connections'],['completed','Follow-ups completed'],
    ['pending','Follow-ups pending'],['overdue','Overdue follow-ups'],['converted','Leads converted'],['conversionRate','Conversion %']
  ];
  const categories = {today:'Today',upcoming:'Upcoming',overdue:'Overdue',completed:'Completed'};
  const pageState = new Map();
  const esc = v => String(v ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const api = (action, data = {}) => UMAuth.api(action, data);
  const canManage = () => UMAuth.can('lead.manage');
  const timeZone = 'Asia/Kolkata';
  const dateTimeFmt = new Intl.DateTimeFormat('en-IN',{timeZone,day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'});
  const dateFmt = new Intl.DateTimeFormat('en-IN',{timeZone,day:'numeric',month:'short',year:'numeric'});
  const monthFmt = new Intl.DateTimeFormat('en-IN',{timeZone,month:'short',year:'numeric'});
  const localFmt = new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const formatted = (value, fmt = dateTimeFmt) => value && Number.isFinite(new Date(value).getTime()) ? fmt.format(new Date(value)) : '—';
  const fmtNumber = new Intl.NumberFormat('en-IN').format;
  const ist = value => {
    const p = Object.fromEntries(localFmt.formatToParts(new Date(value || Date.now())).map(part => [part.type,part.value]));
    return {date:p.year + '-' + p.month + '-' + p.day, time:p.hour + ':' + p.minute};
  };
  const icon = uiIcon;
  const skeleton = (message = 'Syncing your leads…') => `<div class="lm-skeleton" role="status"><p class="lm-note">${esc(message)}</p><i></i><i></i><i></i></div>`;
  const empty = (title, copy) => `<div class="lm-empty">${icon('inbox')}<strong>${esc(title)}</strong><p>${esc(copy)}</p></div>`;
  const btn = (action, label, glyph, data = '', primary = false) => `<button class="lm-btn${primary ? ' lm-btn-primary' : ''}" type="button" data-lm-action="${action}" ${data}>${glyph ? icon(glyph) : ''}${esc(label)}</button>`;
  const badge = (text, tone = '') => `<span class="lm-badge ${tone}">${esc(text || '—')}</span>`;
  const statusBadge = status => badge(status, status === 'Converted' ? 'is-green' : closed.includes(status) ? 'is-red' :
    status === 'Interested' || status === 'Connected' ? 'is-blue' : status === 'Follow-up Required' ? 'is-amber' : '');
  const options = (values, placeholder) => `<option value="">${esc(placeholder)}</option>` + values.map(item => {
    const [value, label] = Array.isArray(item) ? item : [item,item];
    return `<option value="${esc(value)}">${esc(label)}</option>`;
  }).join('');
  const select = (key, label, values = [], placeholder = 'All', extra = '') =>
    `<label class="lm-field">${esc(label)}<select name="${key}" ${extra}>${options(values, placeholder)}</select></label>`;
  const input = (key, label, type = 'text', extra = '') =>
    `<label class="lm-field">${esc(label)}<input name="${key}" type="${type}" ${extra}></label>`;
  const textarea = (key, label, extra = '') =>
    `<label class="lm-field lm-full">${esc(label)}<textarea name="${key}" ${extra}></textarea></label>`;
  const error = message => `<p class="lm-error" role="alert">${esc(message)}</p>`;
  const readForm = form => Object.fromEntries(new FormData(form));
  const node = (scope, name) => scope.querySelector('[data-lm-' + name + ']');
  const activeState = () => pageState.get(document.querySelector('.lead-workspace.active')?.id.slice(4));
  const idAttr = id => `data-id="${esc(id)}"`;
  const attr = (key, value) => `data-${key}="${esc(value)}"`;
  const dial = (mobile) => {
    const number = mobile.replace(/[^\d+]/g,'').replace(/^00/,'+');
    return `<a class="lm-btn" href="tel:${esc(number)}">${icon('phone')}Dial</a>`;
  };

  function mount(page) {
    const root = document.getElementById('tab-' + page);
    const view = page.slice('lead-'.length);
    const state = {root,view,filters:{},page:1,group:view === 'calls' ? 'calls' : 'today',options:null,sort:'createdAt',dir:'desc',sequence:0};
    const isList = view === 'list', analytics = view === 'dashboard' || view === 'reports';
    const search = !analytics || view === 'reports' ? input('q','Search leads','search','placeholder="Name, mobile, or Lead ID" maxlength="150"') : '';
    const dates = analytics ? input('from','From date','date') + input('to','To date','date') : '';
    const filters = select('status','Status',statuses) + (canManage() ? select('owner','Salesperson') : '') + select('source','Lead source') + catalogueFilter();
    const more = (isList || view === 'reports' ? select('city','City') + select('state','State') : '') +
      (isList ? select('priority','Priority',priorities) + input('followUp','Next follow-up','date') : '') +
      (view === 'reports' ? select('connection','Call connection',['Connected','Not Connected','Not Recorded']) +
        select('outcome','Call outcome',[...callOutcomes,['__unrecorded__','Not recorded (historical)']]) : '');
    node(root,'filters').innerHTML = `<form class="lm-toolbar" data-lm-filter-form>${search}${dates}${filters}${more}
      <div class="lm-actions"><button type="submit" class="lm-btn lm-btn-primary">${icon('search')}Apply</button>${btn('clear','Clear')}</div></form>`;
    pageState.set(page, state);
    return state;
  }
  function fillOptions(state, data) {
    state.options = data;
    const form = node(state.root,'filter-form');
    for (const [key, values] of [['owner',data.owners.map(person => [person.id,person.name])],
      ['city',data.cities],['state',data.states],['source',data.sources],
      ['outcome',[...(data.callOutcomes || callOutcomes),['__unrecorded__','Not recorded (historical)']]]]) {
      const control = form.elements.namedItem(key);
      if (!control) continue;
      const value = control.value;
      const previous = control.selectedOptions[0]?.textContent;
      control.innerHTML = options(values, 'All');
      if (value && ![...control.options].some(option => option.value === value)) control.add(new Option(previous || value, value));
      control.value = value;
    }
  }
  function setFilterBusy(state, busy) {
    node(state.root,'filter-form').querySelector('button[type="submit"]').disabled = busy;
    node(state.root,'data').setAttribute('aria-busy', String(busy));
    state.root.querySelectorAll('[data-lm-action="refresh"],[data-lm-action="export"],[data-lm-action="export-csv"]').forEach(button => { button.disabled = busy; });
  }
  async function load(state, refreshOptions = false) {
    const run = ++state.sequence, panel = node(state.root,'data');
    setFilterBusy(state, true);
    panel.innerHTML = skeleton();
    const options = refreshOptions || !state.options;
    const common = {filters:state.filters,page:state.page,options};
    try {
      let result;
      if (state.view === 'list') result = await api('leadList', {...common,sort:state.sort,dir:state.dir});
      else if (state.view === 'schedule' || state.view === 'calls') result = await api('leadQueue', {...common,category:state.group});
      else result = await api('leadAnalytics', {...common,view:state.view});
      if (run !== state.sequence) return;
      if (result.options) fillOptions(state, result.options);
      state.result = result;
      if (result.page) state.page = result.page;
      if (state.view === 'schedule' || state.view === 'calls') renderQueue(state, panel);
      else if (state.view === 'list') renderList(state, panel);
      else if (state.view === 'reports') renderReport(result, panel);
      else renderDashboard(result, panel);
    } catch (e) {
      if (run !== state.sequence) return;
      state.result = null;
      panel.innerHTML = error(e.message) + '<div class="lm-actions" style="margin-top:8px">' + btn('refresh','Retry','refresh') + '</div>';
    } finally {
      if (run === state.sequence) setFilterBusy(state, false);
    }
  }
  function open(page) {
    const state = pageState.get(page) || mount(page);
    if (node(state.root,'data').getAttribute('aria-busy') !== 'true') load(state, true);
  }

  function pager(data, action = 'page') {
    const first = data.total ? (data.page - 1) * data.size + 1 : 0;
    const last = Math.min(data.page * data.size, data.total);
    return `<div class="lm-pager"><p class="lm-note">${fmtNumber(first)}–${fmtNumber(last)} of ${fmtNumber(data.total)}</p>
      <div class="lm-actions">${btn(action,'Previous',null,attr('page',data.page - 1) + (data.page <= 1 ? ' disabled' : ''))}
      <span class="lm-note">Page ${data.page} of ${data.pages}</span>
      ${btn(action,'Next',null,attr('page',data.page + 1) + (data.page >= data.pages ? ' disabled' : ''))}</div></div>`;
  }
  function table(title, headers, rows, tip = '') {
    return `<section class="lm-panel"><div class="lm-panel-head"><h3>${esc(title)}</h3><p class="lm-note">${esc(tip)}</p></div>
      <div class="lm-table-scroll" tabindex="0" role="region" aria-label="${esc(title)}">
        <table class="lm-table"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>
      </div></section>`;
  }
  function renderList(state, panel) {
    const result = state.result;
    const counts = result.catalogueCounts;
    const summary = counts ? 'Catalogue shared: ' + fmtNumber(counts.shared) + ' · Catalogue pending: ' + fmtNumber(counts.notShared) + ' (all matching leads).' : '';
    if (!result.total) {
      const filtered = Object.values(state.filters).some(Boolean);
      panel.innerHTML = '<div class="lm-panel">' + empty(filtered ? 'No matching leads' : 'No leads yet',
        filtered ? 'Clear a filter or try another search.' : 'Add your first lead or import a spreadsheet.') + (summary ? '<p class="lm-note">' + esc(summary) + '</p>' : '') + '</div>';
      return;
    }
    const head = listColumns.map(([key,label]) => {
      const sorted = state.sort === key;
      return `<th scope="col"${sorted ? ` aria-sort="${state.dir === 'asc' ? 'ascending' : 'descending'}"` : ''}>
        <button type="button" class="lm-sort" data-lm-action="sort" data-sort="${key}">${esc(label)}${sorted ? state.dir === 'asc' ? ' ↑' : ' ↓' : ''}</button></th>`;
    }).join('') + '<th scope="col">Actions</th>';
    const rows = result.items.map(lead => {
      const id = idAttr(lead.id);
      return '<tr>' + listColumns.map(([key]) => {
        if (key === 'name') return `<td class="lm-wrap"><button type="button" class="lm-link" data-lm-action="view" ${id}>${esc(lead.name)}</button></td>`;
        if (key === 'status') return '<td>' + statusBadge(lead.status) + '</td>';
        if (key === 'priority') return '<td>' + badge(lead.priority, lead.priority === 'High' ? 'is-amber' : '') + '</td>';
        if (key === catalogueField) return '<td>' + badge(catalogueText(lead),lead[key] === 'Yes' ? 'is-green' : lead[key] === 'No' ? 'is-amber' : '') + '</td>';
        const value = key.endsWith('At') ? formatted(lead[key]) : lead[key] || '—';
        return `<td${key === 'lastRemarks' ? ' class="lm-wrap"' : ''}>${esc(value)}</td>`;
      }).join('') + `<td><div class="lm-actions">${btn('view','View',null,id)}${btn('edit','Edit',null,id)}
        ${btn('call','Call','phone',id)}${btn('schedule','Follow-up',null,id)}${btn('status','Status',null,id)}</div></td></tr>`;
    }).join('');
    panel.innerHTML = table('Lead directory', head, rows, summary + ' Scroll to see every column. Times shown in IST.') + pager(result);
  }
  function queueCard(task, lead, group, withLead) {
    const meta = idAttr(lead.id) + ' ' + attr('task',task.id);
    const actions = group === 'completed' ? '' : `<div class="lm-actions">${withLead ? dial(lead.mobile) : ''}
      ${btn('call','Log call','phone',meta,withLead)}${btn('reschedule','Reschedule',null,meta)}${btn('complete','Complete',null,meta)}</div>`;
    const owner = withLead && lead.ownerName ? ' · ' + esc(lead.ownerName) : '';
    return `<article class="lm-queue-item"><div class="lm-queue-info">
      <div>${withLead ? `<button type="button" class="lm-link" data-lm-action="view" ${idAttr(lead.id)}>${esc(lead.name)}</button>` : ''}
      ${badge(categories[group],group === 'overdue' ? 'is-red' : group === 'completed' ? 'is-green' : 'is-blue')}</div>
      <strong>${esc(task.purpose)}</strong><p class="lm-note">${esc(formatted(task.dueAt))} IST${owner}</p>
      ${group === 'completed' ? `<p class="lm-note">Completed by ${esc(task.completedByName)} · ${esc(formatted(task.completedAt))} IST</p>` : ''}
      </div>${actions}</article>`;
  }
  function renderQueue(state, panel) {
    const result = state.result;
    node(state.root,'tabs').innerHTML = state.view === 'schedule' ? `<nav class="lm-queue-nav" aria-label="Follow-up categories">${Object.entries(categories)
      .map(([key, label]) => btn('group',label + ' · ' + fmtNumber(result.counts[key]),null,
        attr('group',key) + ` aria-pressed="${state.group === key}"`)).join('')}</nav>` : '';
    const title = state.view === 'calls' ? "Today's call queue" : categories[state.group] + ' follow-ups';
    const list = result.items.map(item => queueCard(item.task,item.lead,item.group,true)).join('');
    panel.innerHTML = `<section class="lm-panel"><div class="lm-panel-head"><h3>${esc(title)}</h3>
      <p class="lm-note">${fmtNumber(result.total)} tasks · IST</p></div>
      ${list ? '<div class="lm-queue-grid">' + list + '</div>' + pager(result) :
        empty('No follow-ups here', state.view === 'calls' ? 'There are no matching overdue or due-today calls.' : 'Try another category or open a lead to schedule a follow-up.')}</section>`;
  }
  function kpis(items) {
    return '<div class="lm-kpis">' + items.map(([label,value,glyph,mode]) =>
      `<article class="lm-kpi${mode ? ' lm-kpi-interactive' : ''}">${icon(glyph)}<span>${esc(label)}</span><strong>${mode ?
        `<button type="button" class="lm-kpi-link" data-lm-action="call-report" data-mode="${esc(mode)}" aria-label="View ${esc(label)}: ${esc(value)}">${esc(value)}<small>View calls →</small></button>` : esc(value)}</strong></article>`).join('') + '</div>';
  }
  function chart(title, points, isTime = false) {
    const max = points.reduce((highest, point) => Math.max(highest,point.value),1);
    const rows = points.map(point => {
      const label = isTime ? formatted(point.label.length === 7 ? point.label + '-01' : point.label, point.label.length === 7 ? monthFmt : dateFmt) : point.label;
      return `<div class="lm-bar"><span>${esc(label)}</span><div class="lm-track" aria-hidden="true">
        <i style="width:${100 * point.value / max}%"></i></div><b>${fmtNumber(point.value)}</b></div>`;
    }).join('');
    return `<section class="lm-panel"><div class="lm-panel-head"><h3>${esc(title)}</h3></div>
      <div class="lm-chart">${rows || '<p class="lm-note">No activity for these filters.</p>'}</div></section>`;
  }
  function renderDashboard(result, panel) {
    const m = result.metrics;
    panel.innerHTML = kpis([
      ['Total leads',fmtNumber(m.total),'users'],['New leads',fmtNumber(m.newLeads),'user'],
      ['Contacted leads',fmtNumber(m.contacted),'phone'],['Interested leads',fmtNumber(m.interested),'spark'],
      ['Follow-ups due today',fmtNumber(m.dueToday),'calendar'],['Overdue follow-ups',fmtNumber(m.overdue),'clock'],
      ['Converted leads',fmtNumber(m.converted),'check'],['Lost leads',fmtNumber(m.lost),'warning'],
      ['Conversion rate',fmtNumber(m.conversionRate) + '%','percent'],
      ['Catalogue shared',result.catalogueTrackingVersion === 1 ? fmtNumber(m.catalogueShared) : 'Unavailable','check'],
      ['Catalogue pending',result.catalogueTrackingVersion === 1 ? fmtNumber(m.cataloguePending) : 'Unavailable','clock']
    ]) + '<div class="lm-charts">' +
      chart('Leads created over time',result.created,true) + chart('Lead status distribution',result.statuses) +
      chart('Conversion trends',result.converted,true) +
      chart('Conversions by salesperson',result.people.map(person => ({label:person.name,value:person.converted}))) +
      chart('Follow-up completion',Object.entries(categories).map(([key,label]) => ({label,value:result.tasks[key]}))) +
      '</div><p class="lm-note" style="margin-top:10px">Conversion rate uses unique converted leads divided by leads created in the selected date range. Contacted means at least one connected call.</p>';
  }
  function renderReport(result, panel) {
    if (!result.calls) { panel.innerHTML = error('Publish the updated Apps Script backend and run setupLeadManagement before opening call reports.'); return; }
    const totals = result.people.reduce((sum, person) => {
      sum.attempted += person.attempted; sum.connected += person.connected; sum.completed += person.completed; return sum;
    }, {attempted:0,connected:0,completed:0});
    const heads = reportColumns.map(([,label]) => `<th scope="col">${esc(label)}</th>`).join('');
    const rows = result.people.map(person => '<tr>' + reportColumns.map(([key]) => `<td>${['attempted','connected'].includes(key) ?
      `<button type="button" class="lm-link" data-lm-action="call-report" data-mode="${key === 'connected' ? 'connected' : 'attempted'}" data-owner="${esc(person.id)}" aria-label="View ${esc(person.name)} ${key} calls">${fmtNumber(person[key])}</button>` : esc(key === 'name' ? person.name :
      fmtNumber(person[key]) + (key === 'conversionRate' ? '%' : ''))}</td>`).join('') + '</tr>').join('');
    const c = result.calls;
    panel.innerHTML = kpis([
      ['Calls Attempted',fmtNumber(c.attempted),'phone','attempted'],['Successful Connections',fmtNumber(c.connected),'check','connected'],
      ['Unique leads contacted',fmtNumber(c.uniqueLeadsContacted),'users'],['Unique leads connected',fmtNumber(c.uniqueLeadsConnected),'user'],
      ['Connection rate',Number(c.connectionRate).toFixed(2) + '%','percent'],
      ['Follow-ups completed',fmtNumber(totals.completed),'calendar'],['Converted leads',fmtNumber(result.metrics.converted),'target']
    ]) + (rows ? table('Salesperson performance',heads,rows,'Scroll to see all metrics.') :
      '<div class="lm-panel">' + empty('No activity for these filters','Choose another date range or clear the filters.') + '</div>') +
      '<p class="lm-note">Call KPIs count unique activity IDs using call date and the salesperson who logged the call. Connection, outcome, search, location, and current lead status filters apply to call KPIs and drill-down records. Lead workload and conversion metrics retain their creation-date cohort. Times use IST.</p>' + callWarnings(result.callDiagnostics);
  }


  function createDialog(id, side = false) {
    const dialog = document.createElement('dialog');
    dialog.className = 'lm-dialog' + (side ? ' lm-side' : '');
    dialog.setAttribute('aria-labelledby', id);
    dialog.innerHTML = `<div class="lm-dialog-head"><h3 id="${id}" tabindex="-1"></h3>
      <button class="ui-icon-button" type="button" data-lm-action="close" aria-label="Close">${icon('close')}</button></div>`;
    document.body.appendChild(dialog);
    return dialog;
  }
  const detail = createDialog('lmDetailTitle', true);
  detail.insertAdjacentHTML('beforeend','<div class="lm-dialog-body" data-lm-detail-body></div>');
  const detailBody = node(detail,'detail-body');
  let detailId = '', detailData = null, detailRun = 0;
  const actionDialog = createDialog('lmActionTitle');
  actionDialog.insertAdjacentHTML('beforeend', `<form autocomplete="off">
    <div class="lm-dialog-body" data-lm-action-body></div><div data-lm-action-message></div>
    <div class="lm-modal-actions" data-lm-action-footer></div></form>`);
  const actionForm = actionDialog.querySelector('form');
  const actionBody = node(actionDialog,'action-body');
  const actionFooter = node(actionDialog,'action-footer');
  const actionMessage = node(actionDialog,'action-message');
  let dialogMode = null, saving = false, opening = false;

  const callReportDialog = createDialog('lmCallReportTitle');
  callReportDialog.classList.add('lm-call-report');
  callReportDialog.insertAdjacentHTML('beforeend','<div class="lm-dialog-body" data-lm-call-report-body></div>');
  const callReportBody = node(callReportDialog,'call-report-body');
  let callReportState = null;
  const callColumns = [
    ['callDate','Call Date (IST)'],['callTime','Call Time (IST)'],['activityId','Activity ID'],['leadId','Lead ID'],
    ['name','Lead Name'],['mobile','Mobile Number'],['city','City'],['state','State'],['salespersonName','Call Salesperson'],
    ['ownerName','Current Lead Owner'],['connectionStatus','Connection Status'],['outcome','Call Outcome / Result'],
    ['notes','Call Remarks'],['discussionSummary','Discussion Summary'],['interest','Customer Interest'],
    ['nextFollowUpAt','Next Follow-up At Call (IST)'],['currentStatus','Current Lead Status'],['leadStatusAfter','Lead Status After Call'],['ownerNameAtCall','Lead Owner At Call'],
    [catalogueField,'Current Catalogue Shared on WhatsApp?']
  ];
  function callWarnings(diagnostics) {
    if (!diagnostics) return '';
    const notes = [];
    if (diagnostics.invalidDates) notes.push(fmtNumber(diagnostics.invalidDates) + ' call activities have missing or invalid call dates and are excluded from date-based counts');
    if (diagnostics.missingIds) notes.push(fmtNumber(diagnostics.missingIds) + ' call activities have no activity ID and are excluded');
    if (diagnostics.duplicates) notes.push(fmtNumber(diagnostics.duplicates) + ' duplicate activity IDs were counted once');
    return notes.length ? '<p class="lm-note lm-report-quality" role="status">' + esc(notes.join('. ') + '.') + '</p>' : '';
  }
  function fillCallReportOptions(state) {
    const form = node(callReportBody,'call-filter-form'), data = state.options;
    for (const [key,values] of [['owner',(data.owners || []).map(p => [p.id,p.name])],['city',data.cities || []],
      ['state',data.states || []],['source',data.sources || []],
      ['outcome',[...(data.callOutcomes || callOutcomes),['__unrecorded__','Not recorded (historical)']]]]) {
      const control = form.elements.namedItem(key);
      if (!control) continue;
      control.innerHTML = options(values,'All');
      const value = state.filters[key];
      if (value && ![...control.options].some(o => o.value === value)) control.add(new Option(value,value));
    }
    setFields(form,state.filters);
  }
  function openCallReport(mode, owner) {
    const main = activeState();
    if (!main || main.view !== 'reports') return;
    if (callReportState) callReportState.sequence++;
    const state = {mode,filters:{...main.filters},page:1,size:25,dir:'desc',options:main.options || {},sequence:0,result:null};
    if (owner) state.filters.owner = owner;
    callReportState = state;
    callReportDialog.querySelector('h3').textContent = mode === 'connected' ? 'Successful Connections · Call activities' : 'Calls Attempted · Call activities';
    callReportBody.innerHTML = '<p class="lm-note lm-report-intro">One row per unique call activity. Lead details and owner are current. Follow-up and status snapshots reflect what was saved with the call; historical gaps are labelled. All times use IST.</p>' +
      `<form class="lm-toolbar" data-lm-call-filter-form>
        ${input('q','Search leads','search','placeholder="Name, mobile, or Lead ID" maxlength="150"')}
        ${input('from','From call date','date')}${input('to','To call date','date')}
        ${canManage() ? select('owner','Call salesperson') : ''}${select('connection','Connection status',['Connected','Not Connected','Not Recorded'])}
        ${select('outcome','Call outcome')}${select('status','Current lead status',statuses)}${select('state','State')}${select('city','City')}${select('source','Lead source')}${catalogueFilter()}
        <div class="lm-actions"><button type="submit" class="lm-btn lm-btn-primary">Apply filters</button>${btn('report-clear','Clear filters')}</div>
      </form><div class="lm-report-tools"><div class="lm-actions">${btn('report-refresh','Refresh report','refresh')}${btn('report-export','Export Excel','download')}</div>
      <label class="lm-field">Call date order<select data-lm-report-order><option value="desc">Newest first</option><option value="asc">Oldest first</option></select></label>
      <label class="lm-field">Rows per page<select data-lm-report-size><option>25</option><option>50</option><option>100</option></select></label></div>
      <div data-lm-report-message role="status"></div><div data-lm-report-data aria-live="polite"></div>`;
    fillCallReportOptions(state);
    if (!callReportDialog.open) callReportDialog.showModal();
    loadCallReport(state,true);
  }
  function callCell(item, key) {
    if (key === 'callDate') return formatted(item.callAt,dateFmt);
    if (key === 'callTime') return ist(item.callAt).time;
    if (key === 'nextFollowUpAt') return item.snapshotAvailable ? item.nextFollowUpAt ? formatted(item.nextFollowUpAt) : 'None scheduled' : 'Not recorded (historical)';
    if (key === 'leadStatusAfter') return item.leadStatusAfter || (item.snapshotAvailable ? 'Not recorded' : 'Not recorded (historical)');
    if (key === 'ownerNameAtCall') return item.ownerNameAtCall || item.ownerIdAtCall || (item.snapshotAvailable ? 'Not recorded' : 'Not recorded (historical)');
    if (key === 'outcome' || key === 'discussionSummary') return item[key] || (item.snapshotAvailable ? 'Not recorded' : 'Not recorded (historical)');
    return item[key] || '—';
  }
  function renderCallReport(state) {
    const result = state.result, c = result.metrics, panel = node(callReportBody,'report-data');
    let summary = '';
    if (state.mode === 'connected') {
      summary = '<section class="lm-panel"><div class="lm-panel-head"><h3>Conversation outcomes</h3><p class="lm-note">' + fmtNumber(result.total) + ' connected call activities</p></div>' +
        '<div class="lm-outcomes">' + btn('report-outcome','All outcomes',null,'data-outcome="" aria-pressed="' + !state.filters.outcome + '"') +
        result.outcomes.map(outcome => `<button type="button" class="lm-outcome" data-lm-action="report-outcome" data-outcome="${esc(outcome.key)}" aria-pressed="${state.filters.outcome === outcome.key}"><span>${esc(outcome.label)}</span><strong>${fmtNumber(outcome.value)}</strong></button>`).join('') +
        (!result.outcomes.length ? '<p class="lm-note">No recorded connections match these filters.</p>' : '') + '</div></section>';
    }
    const head = callColumns.map(([,label]) => '<th scope="col">' + esc(label) + '</th>').join('') + '<th scope="col">View Lead</th>';
    const rows = result.items.map(item => '<tr>' + callColumns.map(([key]) => {
      const value = callCell(item,key);
      if (key === 'connectionStatus') return '<td>' + badge(value,value === 'Connected' ? 'is-green' : value === 'Not Connected' ? 'is-red' : '') + '<p class="lm-note">' + esc(item.connectionSource) + '</p></td>';
      if (key === 'currentStatus') return '<td>' + statusBadge(value) + '</td>';
      return '<td class="lm-wrap' + (['notes','discussionSummary'].includes(key) ? ' lm-call-notes' : '') + '">' + esc(value) + '</td>';
    }).join('') + '<td>' + btn('view','View Lead',null,idAttr(item.leadId)) + '</td></tr>').join('');
    panel.innerHTML = kpis([
      ['Calls Attempted',fmtNumber(c.attempted),'phone'],['Successful Connections',fmtNumber(c.connected),'check'],
      ['Unique leads contacted',fmtNumber(c.uniqueLeadsContacted),'users'],['Unique leads connected',fmtNumber(c.uniqueLeadsConnected),'user'],
      ['Connection rate',Number(c.connectionRate).toFixed(2) + '%','percent']
    ]) + summary + (rows ? table(state.mode === 'connected' ? 'Connected call records' : 'All call activity records',head,rows,
      fmtNumber(result.total) + ' activities · ' + fmtNumber(result.reportMetrics.uniqueLeadsContacted) + ' unique leads in this report') + pager(result,'report-page') :
      '<div class="lm-panel">' + empty('No call activities match','Change a filter, clear filters, or refresh after logging a call.') + '</div>') +
      '<p class="lm-note">The call KPIs above use all applied filters. This table ' + (state.mode === 'connected' ? 'shows only Connected activities.' : 'shows every matching call activity.') + '</p>' + callWarnings(result.diagnostics);
  }
  async function loadCallReport(state, withOptions = false) {
    if (!state || state !== callReportState || !callReportDialog.open) return;
    const run = ++state.sequence, panel = node(callReportBody,'report-data');
    state.loading = true;
    panel.setAttribute('aria-busy','true');
    panel.innerHTML = skeleton('Loading call activities…');
    callReportBody.querySelectorAll('button[type="submit"],[data-lm-action="report-export"]').forEach(b => { b.disabled = true; });
    node(callReportBody,'report-message').replaceChildren();
    try {
      const result = await api('leadCallReport',{mode:state.mode,filters:state.filters,page:state.page,size:state.size,dir:state.dir,options:withOptions});
      if (run !== state.sequence || state !== callReportState || !callReportDialog.open) return;
      state.result = result; state.page = result.page;
      if (result.options) { state.options = result.options; fillCallReportOptions(state); }
      renderCallReport(state);
    } catch (e) {
      if (run !== state.sequence || state !== callReportState) return;
      state.result = null;
      panel.innerHTML = error(e.message) + btn('report-refresh','Retry','refresh');
    } finally {
      if (run === state.sequence && state === callReportState) {
        state.loading = false; panel.setAttribute('aria-busy','false');
        callReportBody.querySelector('button[type="submit"]').disabled = false;
        callReportBody.querySelector('[data-lm-action="report-export"]').disabled = !state.result || !!state.exporting;
      }
    }
  }
  async function exportCallReport(trigger) {
    const state = callReportState;
    if (!state || state.loading || state.exporting || !state.result) return;
    state.exporting = true; setButtonBusy(trigger,true);
    const filters = {...state.filters};
    try {
      const data = await api('leadCallExport',{mode:state.mode,filters,dir:state.dir});
      if (!data.items.length) { showToast('There are no call activities to export.'); return; }
      await downloadWorkbook('Call-' + state.mode + '-' + ist().date + '.xlsx','Call activities',
        [callColumns.map(([,label]) => label),...data.items.map(item => callColumns.map(([key]) => callCell(item,key)))]);
      showToast(fmtNumber(data.items.length) + ' filtered call activities exported.','success');
    } catch (e) {
      if (state === callReportState) node(callReportBody,'report-message').innerHTML = error(e.message);
      showToast(e.message,'error');
    } finally { state.exporting = false; setButtonBusy(trigger,false); }
  }
  callReportDialog.addEventListener('close',() => {
    if (callReportState) callReportState.sequence++;
    callReportState = null; callReportBody.replaceChildren();
  });
  callReportDialog.addEventListener('submit',event => {
    if (!event.target.matches('[data-lm-call-filter-form]')) return;
    event.preventDefault();
    if (!callReportState) return;
    callReportState.filters = readForm(event.target); callReportState.page = 1; loadCallReport(callReportState);
  });
  callReportDialog.addEventListener('change',event => {
    const state = callReportState;
    if (!state) return;
    if (event.target.matches('[data-lm-report-order]')) state.dir = event.target.value;
    else if (event.target.matches('[data-lm-report-size]')) state.size = Number(event.target.value);
    else return;
    state.page = 1; loadCallReport(state);
  });

  const detailGrid = items => '<dl class="lm-detail-grid">' + items.map(([label,value]) =>
    `<div><dt>${esc(label)}</dt><dd>${esc(value || '—')}</dd></div>`).join('') + '</dl>';
  function eventChanges(activity) {
    if (!activity.changes) return '';
    let before, after;
    try { ({before,after} = JSON.parse(activity.changes)); } catch (_) { return 'Saved change details are unavailable.'; }
    if (!after) return '';
    if (Object.prototype.hasOwnProperty.call(after,catalogueField)) return 'Catalogue shared on WhatsApp: ' + (before?.[catalogueField] || 'No') + ' → ' + after[catalogueField];
    if (after.status && !activity.followUpId) return (before?.status || 'Not recorded') + ' → ' + after.status;
    if (after.ownerId) return (before?.ownerName || before?.ownerId || 'Not recorded') + ' → ' + (after.ownerName || after.ownerId);
    if (after.dueAt) {
      const due = formatted(after.dueAt) + ' IST';
      return (before && before.dueAt !== after.dueAt ? formatted(before.dueAt) + ' IST → ' : '') + due + ' · ' + after.purpose;
    }
    return '';
  }
  function timeline(data) {
    const rows = data.items.map(activity => {
      const changes = eventChanges(activity);
      const date = formatted(activity.occurredAt) + ' IST';
      const recorded = activity.occurredAt !== activity.recordedAt && activity.outcome ? ' · Logged ' + formatted(activity.recordedAt) + ' IST' : '';
      return `<li><b>${esc(activity.type)}${activity.outcome ? ' · ' + esc(activity.outcome) : ''}</b>
        <p class="lm-note">${esc(date + ' · ' + activity.actorName + recorded)}</p>
        ${changes ? '<p class="lm-note">' + esc(changes) + '</p>' : ''}
        ${activity.notes ? '<p>' + esc(activity.notes) + '</p>' : ''}
        ${activity.connectionStatus ? '<p class="lm-note">Connection · ' + esc(activity.connectionStatus) + ' · ' + esc(activity.connectionSource) + '</p>' : ''}
        ${activity.discussionSummary ? '<p>Discussion summary · ' + esc(activity.discussionSummary) + '</p>' : ''}
        ${activity.interest ? '<p class="lm-note">Customer interest · ' + esc(activity.interest) + '</p>' : ''}
        ${Number(activity.callSchema) >= 2 ? '<p class="lm-note">Next follow-up at call · ' + esc(activity.nextFollowUpAt ? formatted(activity.nextFollowUpAt) + ' IST' : 'None scheduled') +
          ' · Lead status after call · ' + esc(activity.leadStatusAfter) + ' · Owner at call · ' + esc(activity.ownerNameAtCall || activity.ownerIdAtCall || 'Not recorded') + '</p>' : activity.connectionStatus ? '<p class="lm-note">Historical discussion summary, follow-up snapshot, and lead status after call were not recorded.</p>' : ''}</li>`;
    }).join('');
    return rows ? '<ol class="lm-timeline">' + rows + '</ol>' + pager(data,'history-page') : '<p class="lm-note">Activity will appear here.</p>';
  }
  function localGroup(task) {
    if (task.status === 'Completed') return 'completed';
    const day = ist(task.dueAt).date, today = ist().date;
    return day < today ? 'overdue' : day === today ? 'today' : 'upcoming';
  }
  function renderDetail(data) {
    const lead = data.lead, id = idAttr(lead.id);
    const pending = data.tasks.filter(task => task.status === 'Pending');
    detail.querySelector('h3').textContent = lead.name;
    detailBody.innerHTML = `<div class="lm-actions">
        ${statusBadge(lead.status)}${btn('call','Call','phone',id,true)}${btn('edit','Edit details',null,id)}
        ${btn('schedule','Add follow-up','calendar',id)}
        ${!closed.includes(lead.status) || canManage() ? btn('status','Update status',null,id) : ''}
        ${canManage() ? btn('assign','Assign lead','users',id) : ''}
      </div>
      <section class="lm-detail-block"><h4>Contact details</h4>${detailGrid([
        ['Mobile',lead.mobile],['Email ID',lead.email],['Address',lead.address],['City',lead.city],
        ['State',lead.state],['DOB',formatted(lead.dob,dateFmt)],['DOA',formatted(lead.doa,dateFmt)]
      ])}</section>
      <section class="lm-detail-block"><h4>Lead information</h4>${detailGrid([
        ['Lead ID',lead.id],
        ['Lead owner',lead.ownerName],['Lead source',lead.source],['Interested product',lead.product],
        ['Catalogue Shared on WhatsApp?',catalogueText(lead)],
        ['Lead priority',lead.priority],['Created',formatted(lead.createdAt)],['Last updated',formatted(lead.updatedAt)],
        ['Last contact',formatted(lead.lastContactAt)],['Next follow-up',formatted(lead.nextFollowUpAt)],
        ['Remarks',lead.remarks],['Latest remarks',lead.lastRemarks]
      ])}</section>
      <section class="lm-detail-block"><h4>Pending follow-ups</h4>
        ${pending.length ? pending.map(task => queueCard(task,lead,localGroup(task),false)).join('') : '<p class="lm-note">No follow-ups are pending.</p>'}
      </section>
      <section class="lm-detail-block"><h4>Activity timeline</h4><div data-lm-timeline>${timeline(data.history)}</div></section>`;
  }
  async function showDetail(id, historyPage = 1, historyOnly = false) {
    const run = ++detailRun;
    detailId = id;
    if (!detail.open) detail.showModal();
    const target = historyOnly ? node(detailBody,'timeline') : detailBody;
    if (!historyOnly) { detail.querySelector('h3').textContent = 'Lead details'; detailData = null; }
    target.setAttribute('aria-busy','true');
    target.innerHTML = skeleton(historyOnly ? 'Loading activity…' : 'Loading lead details…');
    try {
      const response = await api('leadGet',{id,page:historyPage,historyOnly});
      if (run !== detailRun || !detail.open) return;
      if (historyOnly) {
        detailData.history = response.history;
        target.innerHTML = timeline(response.history);
      } else {
        detailData = response;
        renderDetail(response);
      }
    } catch (e) {
      if (run === detailRun) target.innerHTML = error(e.message) +
        btn(historyOnly ? 'history-page' : 'view','Retry','refresh',historyOnly ? attr('page',historyPage) : idAttr(id));
    } finally { if (run === detailRun) target.setAttribute('aria-busy','false'); }
  }
  detail.addEventListener('close',() => { detailRun++; detailData = null; detailId = ''; });

  function setDialogBusy(busy, label) {
    saving = busy;
    actionDialog.setAttribute('aria-busy',String(busy));
    actionDialog.querySelectorAll('button,input,select,textarea').forEach(control => {
      if (busy) {
        if (!control.disabled) { control.disabled = true; control.dataset.lmBusyDisabled = '1'; }
      } else if (control.dataset.lmBusyDisabled) {
        control.disabled = false; delete control.dataset.lmBusyDisabled;
      }
    });
    const submit = actionFooter.querySelector('button[type="submit"]');
    if (busy && label && submit) {
      submit.dataset.lmLabel = submit.textContent;
      submit.textContent = label;
    } else if (!busy && submit?.dataset.lmLabel) {
      submit.textContent = submit.dataset.lmLabel;
      delete submit.dataset.lmLabel;
    }
  }
  function setFooter(label, extras = '') {
    actionFooter.innerHTML = extras + btn('close',label ? 'Cancel' : 'Close') +
      (label ? `<button type="submit" class="lm-btn lm-btn-primary">${esc(label)}</button>` : '');
  }
  function showAction(title, body, label, mode) {
    dialogMode = mode;
    actionDialog.querySelector('h3').textContent = title;
    actionBody.innerHTML = body;
    actionMessage.replaceChildren();
    setFooter(label);
    if (!actionDialog.open) actionDialog.showModal();
  }
  actionDialog.addEventListener('cancel',e => { if (saving) e.preventDefault(); });
  actionDialog.addEventListener('close',() => {
    dialogMode = null;
    actionBody.replaceChildren();
    actionMessage.replaceChildren();
    actionFooter.replaceChildren();
  });
  function setFields(form, values) {
    for (const [name, value] of Object.entries(values)) {
      const control = form.elements.namedItem(name);
      if (control && value != null) {
        if (control.type === 'checkbox') control.checked = value === 'Yes' || value === true || value === 1 || value === '1';
        else control.value = value;
      }
    }
  }
  function leadForm(lead) {
    if (lead ? !Object.prototype.hasOwnProperty.call(lead,catalogueField) : activeState()?.result?.catalogueTrackingVersion !== 1) {
      showAction('Catalogue tracking needs an update',error('Catalogue tracking is not ready. Ask your administrator to finish the update, then refresh this page.'),'',null);
      return;
    }
    const label = lead ? 'Save changes' : 'Create lead';
    const scope=UMStateAccess.forUser(UMAuth.user);
    const controls = fields.map(([key,name,type,max]) => {
      const rules = (max ? 'maxlength="' + max + '" ' : '') + (key === 'name' || key === 'mobile' ? 'required ' : '');
      if (type === 'checkbox') return '<div class="lm-full"><label class="lm-check"><input type="checkbox" name="' + key + '" value="Yes">' + esc(name) + '</label><p class="lm-note">Checked = Yes · Unchecked = No. Tick after you have shared the catalogue with this lead.</p></div>';
      if(key==='state'&&!scope.all)return select(key,name,scope.states,'Choose an assigned state','required');
      if (type === 'select') return select(key,name,priorities,'Choose priority');
      if (type === 'textarea') return textarea(key,name,rules);
      return input(key,name,type,rules + (type === 'date' ? 'min="1900-01-01" max="2099-12-31"' :
        key === 'mobile' ? 'inputmode="tel" placeholder="10 digits or +country code"' : ''));
    }).join('');
    showAction(lead ? 'Edit lead' : 'New lead','<p class="lm-note">Full name and mobile number are required.</p><div class="lm-form-grid" style="margin-top:12px">' +
      controls + '</div>',label,{kind:'mutation',action:lead ? 'leadUpdate' : 'leadCreate',lead,
      payload:data => ({fields:{...data,[catalogueField]:data[catalogueField] === 'Yes' ? 'Yes' : 'No'}}), success:lead ? 'Lead updated.' : 'Lead created.'});
    if (lead) setFields(actionForm,lead);
    if(!scope.all){const chosen=scope.states.find(s=>UMStateAccess.key(s)===UMStateAccess.key(lead?.state || lead?.accessState || '')) || (scope.states.length===1?scope.states[0]:'');actionForm.elements.namedItem('state').value=chosen;}
  }
  function followUpFields(prefix = '', required = true) {
    const flags = required ? 'required ' : '';
    return '<div class="lm-form-grid">' +
      input(prefix + 'date','Follow-up date','date',flags + 'min="1900-01-01" max="2099-12-31"') +
      input(prefix + 'time','Follow-up time (IST)','time',flags) +
      textarea(prefix + 'purpose','Follow-up purpose',flags + 'maxlength="500"') + '</div>';
  }
  function callForm(lead, task) {
    const now = ist();
    const reopening = closed.includes(lead.status);
    const statusChoices = reopening ? canManage() ? statuses.slice(1,5) : [] : statuses.slice(1).filter(s => s !== lead.status);
    const controls = `<div class="lm-actions">${dial(lead.mobile)}<p class="lm-note">${esc(lead.name)} · ${esc(lead.mobile)}</p></div>
      <div class="lm-form-grid" style="margin:12px 0">
        ${input('date','Contact date','date','required min="1900-01-01" max="' + now.date + '"')}
        ${input('time','Contact time (IST)','time','required')}
        ${select('connectionStatus','Call connection status',['Connected','Not Connected'],'Choose connection','required')}
        ${select('outcome','Call outcome / result',[],'Choose connection first','required')}
        ${input('interest','Customer interest','text','maxlength="500"')}
        ${textarea('discussionSummary','Discussion summary','maxlength="500"')}
        ${textarea('notes','Detailed call remarks','maxlength="1500"')}
        ${statusChoices.length ? select('updatedLeadStatus','Lead status after this call',statusChoices,'Keep current: ' + lead.status) : ''}
        ${reopening && canManage() ? input('statusReason','Reason for reopening','text','maxlength="500"') : ''}</div>
      <p class="lm-note">Connection status, call outcome, and lead status are saved separately. Logging an outcome does not automatically change the lead status.</p>
      ${task ? `<label class="lm-check"><input type="checkbox" name="complete" checked>Complete this follow-up</label>` : ''}
      <label class="lm-check" style="margin:8px 0"><input type="checkbox" name="next">Schedule another follow-up</label>
      <div data-lm-next-fields hidden>${followUpFields('next',false)}</div>`;
    showAction('Log a call',controls,'Save call',{kind:'mutation',action:'leadCall',lead,payload:data => ({
      date:data.date,time:data.time,connectionStatus:data.connectionStatus,outcome:data.outcome,notes:data.notes,interest:data.interest,
      discussionSummary:data.discussionSummary,updatedLeadStatus:data.updatedLeadStatus || '',statusReason:data.statusReason || '',
      completeId:data.complete ? task.id : '',next:data.next ? {date:data.nextdate,time:data.nexttime,purpose:data.nextpurpose} : null
    }),success:'Call saved.'});
    setFields(actionForm,{date:now.date,time:now.time,nextdate:now.date});
  }
  function followUpForm(lead, task, op) {
    const complete = op === 'complete';
    const title = complete ? 'Complete follow-up' : task ? 'Reschedule follow-up' : 'Schedule follow-up';
    const copy = complete ? `<p><strong>${esc(task.purpose)}</strong></p><p class="lm-note">Due ${esc(formatted(task.dueAt))} IST</p>` : followUpFields();
    showAction(title,'<p class="lm-note" style="margin-bottom:10px">' + esc(lead.name) + '</p>' + copy,
      complete ? 'Mark complete' : task ? 'Save new time' : 'Schedule',{kind:'mutation',action:'leadFollowUp',lead,
        payload:data => ({op,taskId:task?.id || '',task:data}),
        success:complete ? 'Follow-up completed.' : task ? 'Follow-up rescheduled.' : 'Follow-up scheduled.'});
    if (!complete) setFields(actionForm,task ? {...ist(task.dueAt),purpose:task.purpose} : {date:ist().date});
  }
  function statusForm(lead) {
    const reopening = closed.includes(lead.status);
    if (reopening && !canManage()) { showToast('A manager can reopen this lead.','error'); return; }
    const choices = (reopening ? statuses.slice(1,5) : statuses.slice(1)).filter(status => status !== lead.status);
    showAction('Update lead status',`<div class="lm-form-grid">${select('status','New status',choices,'Choose status','required')}
      ${textarea('reason',reopening ? 'Reason for reopening' : 'Reason (optional)',(reopening ? 'required ' : '') + 'maxlength="500"')}</div>`,
      'Save status',{kind:'mutation',action:'leadStatus',lead,payload:data => data,success:'Lead status updated.'});
  }
  async function assignForm(lead) {
    const result = await api('leadAssignees');
    const people = result.people.filter(person => person.id !== lead.ownerId)
      .map(person => [person.id,person.name + (person.state ? ' · ' + person.state : '')]);
    showAction('Assign lead', people.length ? select('ownerId','Salesperson',people,'Choose salesperson','required') :
      '<p class="lm-note">No other active salespeople are available in your access scope.</p>',people.length ? 'Assign' : '',
      {kind:'mutation',action:'leadAssign',lead,payload:data => data,success:'Lead assigned.'});
  }
  function resolveLead(id) {
    if (detail.open && detailData?.lead.id === id) return detailData.lead;
    const state = activeState();
    return state?.result?.items?.map(item => item.lead || item).find(lead => lead.id === id);
  }
  function resolveTask(leadId, taskId) {
    if (!taskId) return null;
    if (detail.open && detailData?.lead.id === leadId) return detailData.tasks.find(task => task.id === taskId);
    return activeState()?.result?.items?.find(item => item.task?.id === taskId && item.lead.id === leadId)?.task;
  }
  async function openMutation(trigger) {
    if (opening || actionDialog.open) return;
    const {id,task, lmAction:action} = trigger.dataset;
    opening = true;
    setButtonBusy(trigger,true);
    try {
      const current = resolveLead(id);
      const lead = (!current || (action === 'edit' && current.email === undefined)) ? (await api('leadGet',{id,recordOnly:true})).lead : current;
      const followUp = resolveTask(id,task);
      if (task && !followUp) throw new Error('This follow-up is unavailable. Refresh the page and try again.');
      if (!trigger.isConnected || (!trigger.closest('.lm-dialog') && !trigger.closest('.lead-workspace.active'))) return;
      if (action === 'edit') leadForm(lead);
      else if (action === 'call') callForm(lead,followUp);
      else if (action === 'status') statusForm(lead);
      else if (action === 'assign') await assignForm(lead);
      else followUpForm(lead,followUp,action);
    } catch (e) { showToast(e.message,'error'); }
    finally { opening = false; setButtonBusy(trigger,false); }
  }
  function requestId() {
    return [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2,'0')).join('');
  }
  function saveWithReceipt(mode, action, payload) {
    const serialized = JSON.stringify(payload);
    if (mode.attempt?.serialized !== serialized) mode.attempt = {serialized,id:requestId()};
    return api(action,{...payload,requestId:mode.attempt.id});
  }
  function refreshAfterWrite(id) {
    const state = activeState();
    if (state) load(state,true);
    if (detail.open && detailId === id) showDetail(id);
    if (callReportDialog.open && callReportState) loadCallReport(callReportState,true);
  }
  async function submitMutation(mode, data) {
    const keys = mode.lead ? {id:mode.lead.id,revision:mode.lead.revision} : {};
    const result = await saveWithReceipt(mode,mode.action,{...keys,...mode.payload(data)});
    actionDialog.close();
    showToast(mode.success,'success');
    refreshAfterWrite(result.id);
  }


  function workbook(data, transfers = []) {
    return new Promise((resolve,reject) => {
      const worker = new Worker('./lead-import-worker.js');
      const timeout = setTimeout(() => finish(new Error('The workbook took too long to process. Use a smaller file.')),25000);
      function finish(problem, result) {
        clearTimeout(timeout);
        worker.terminate();
        if (problem) reject(problem); else resolve(result);
      }
      worker.onmessage = ({data}) => data.ok ? finish(null,data) : finish(new Error(data.message));
      worker.onerror = event => {
        event.preventDefault();
        finish(new Error('The workbook tool could not load. Refresh the CRM and retry.'));
      };
      try { worker.postMessage(data,transfers); } catch (e) { finish(e); }
    });
  }
  async function downloadWorkbook(name, sheetName, rows) {
    const {buffer} = await workbook({op:'write',sheetName,rows});
    const url = URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url),1500);
  }
  function leadExportRows(items) {
    return [listColumns.map(([,label]) => label),...items.map(lead => listColumns.map(([key]) => key === catalogueField ? catalogueText(lead) : key.endsWith('At') && lead[key] ? formatted(lead[key]) + ' IST' : lead[key]))];
  }
  function csvText(rows) {
    return '\uFEFF' + rows.map(row => row.map(value => {
      let text = String(value ?? '');
      if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g,'""') + '"';
    }).join(',')).join('\r\n');
  }
  function downloadCSV(name, rows) {
    const url = URL.createObjectURL(new Blob([csvText(rows)],{type:'text/csv;charset=utf-8;'}));
    const anchor = document.createElement('a');anchor.href = url;anchor.download = name;
    document.body.appendChild(anchor);anchor.click();anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url),1500);
  }
  async function exportLeads(state, trigger, format = 'xlsx') {
    setButtonBusy(trigger,true);
    try {
      const data = await api('leadExport',{filters:state.filters,sort:state.sort,dir:state.dir});
      if (!data.items.length) { showToast('There are no leads to export.'); return; }
      if (data.catalogueTrackingVersion !== 1) throw new Error('Catalogue status is unavailable. Ask your administrator to finish the update, then refresh before exporting.');
      const rows = leadExportRows(data.items);
      if (format === 'csv') downloadCSV('Leads-' + ist().date + '.csv',rows);
      else await downloadWorkbook('Leads-' + ist().date + '.xlsx','Leads',rows);
      showToast(fmtNumber(data.items.length) + ' leads exported.','success');
    } catch (e) { showToast(e.message,'error'); }
    finally { setButtonBusy(trigger,false); }
  }
  const columnAliases = {
    name:['name','fullname','leadname','customername'],mobile:['mobile','mobilenumber','mobilephone','phone','phonenumber','contactnumber','mobileno'],
    email:['email','emailid','emailaddress'],address:['address'],city:['city'],state:['state','region'],dob:['dob','dateofbirth','birthdate'],
    doa:['doa','dateofanniversary','anniversary'],source:['leadsource','source'],product:['interestedproduct','product','productinterest'],
    priority:['leadpriority','priority'],remarks:['remarks','notes','leadremarks'],
    whatsapp_catalogue_shared:['whatsappcatalogueshared','cataloguesharedonwhatsapp','catalogueshared','catalogshared']
  };
  const headerKey = value => String(value).toLowerCase().replace(/[^a-z0-9]/g,'');
  const templateButton = () => btn('template','Download template','download');
  function importPicker() {
    showAction('Import leads', `<div class="lm-import-pick">
        ${input('file','Choose an XLSX, XLS, or CSV file','file','accept=".xlsx,.xls,.csv"')}
        <p class="lm-note">Use the first worksheet with a header row. Up to 500 data rows and 5 MB per file.</p></div>`,
      '',{kind:'import',phase:'pick'});
    setFooter('',templateButton());
  }
  function importMap(mode) {
    mode.phase = 'map';
    const headers = mode.workbook.headers;
    const columns = headers.map((label,i) => [String(i),label ? 'Column ' + (i + 1) + ' · ' + label : 'Column ' + (i + 1) + ' · unnamed']);
    const mapping = fields.map(([key,label]) => select('map_' + key,label,columns,'Skip column',key === 'name' || key === 'mobile' ? 'required' : '')).join('');
    const previewHead = columns.map(([,label]) => '<th scope="col">' + esc(label) + '</th>').join('');
    const previewRows = mode.workbook.rows.slice(0,4).map(row => '<tr>' + row.cells.map(value =>
      '<td>' + esc(value.length > 120 ? value.slice(0,120) + '…' : value) + '</td>').join('') + '</tr>').join('');
    actionBody.innerHTML = `<p class="lm-note">${esc(mode.fileName)} · ${esc(mode.workbook.sheetName)} · ${fmtNumber(mode.workbook.rows.length)} data rows</p>
      <div class="lm-form-grid lm-map">${mapping}</div>
      <div class="lm-import-table">${table('File preview',previewHead,previewRows)}</div>`;
    setFooter('Validate rows',btn('pick-file','Choose another file'));
    const suggested = {};
    fields.forEach(([key]) => {
      const index = headers.findIndex(header => columnAliases[key].includes(headerKey(header)));
      if (index >= 0) suggested['map_' + key] = String(index);
    });
    setFields(actionForm,suggested);
  }
  function normalizeImportDate(raw) {
    const value = raw.trim();
    const india = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(value);
    return india ? india[3] + '-' + india[2].padStart(2,'0') + '-' + india[1].padStart(2,'0') : value;
  }
  function mapRows(mode, data) {
    const picked = fields.filter(([key]) => data['map_' + key] != null && data['map_' + key] !== '').map(([key]) => [key,Number(data['map_' + key])]);
    if (!picked.some(([key]) => key === 'name') || !picked.some(([key]) => key === 'mobile')) {
      throw new Error('Map Full name and Mobile number before validating.');
    }
    if (new Set(picked.map(([,index]) => index)).size !== picked.length) throw new Error('Map each column to only one lead field.');
    return mode.workbook.rows.map(row => ({sourceRow:row.sourceRow,fields:Object.fromEntries(picked.map(([key,index]) => {
      const value = row.cells[index] || '';
      return [key,key === 'dob' || key === 'doa' ? normalizeImportDate(value) : value];
    }))}));
  }
  function checkImportSize(rows) {
    if (JSON.stringify(rows).length > 390000) throw new Error('These rows exceed the CRM request size. Split the file and validate each part.');
  }
  function renderImportRows(mode, page) {
    const rows = mode.mapped, byRow = mode.issues;
    const perPage = 20, pages = Math.max(1,Math.ceil(rows.length / perPage));
    page = Math.max(1,Math.min(pages,page));
    const heads = ['Row','Full name','Mobile number','Result','Reason'].map(label => '<th scope="col">' + label + '</th>').join('');
    const body = rows.slice((page - 1) * perPage,page * perPage).map(item => {
      const issue = byRow.get(item.sourceRow);
      return `<tr><td>${item.sourceRow}</td><td>${esc(item.fields.name)}</td><td>${esc(item.fields.mobile)}</td>
        <td>${badge(issue?.kind || 'Valid',issue ? issue.kind === 'Duplicate' ? 'is-amber' : 'is-red' : 'is-green')}</td>
        <td>${esc(issue?.message || 'Ready to import')}</td></tr>`;
    }).join('');
    node(actionBody,'import-review').innerHTML = table('Row review',heads,body) + pager({total:rows.length,page,size:perPage,pages},'import-page');
  }
  async function validateImport(mode, data) {
    if (data) {
      mode.mapping = data;
      mode.mapped = mapRows(mode,data);
    }
    checkImportSize(mode.mapped);
    const result = await api('leadImportPreview',{rows:mode.mapped});
    mode.phase = 'review';
    mode.preview = result;
    mode.attempt = null;
    mode.needsReview = false;
    mode.issues = new Map(result.issues.map(issue => [issue.sourceRow,issue]));
    const {valid,invalid,duplicate} = result.counts;
    actionBody.innerHTML = `<p class="lm-note">Review the results. The import will add ${fmtNumber(valid)} valid rows and skip the rows listed as invalid or duplicate.</p>
      <div class="lm-actions" style="margin-top:10px">
        ${badge(fmtNumber(valid) + ' valid','is-green')}${badge(fmtNumber(invalid) + ' invalid','is-red')}${badge(fmtNumber(duplicate) + ' duplicate','is-amber')}
      </div><div class="lm-import-table" data-lm-import-review></div>`;
    setFooter(valid ? 'Import ' + fmtNumber(valid) + (valid === 1 ? ' valid lead' : ' valid leads') : '',
      (result.issues.length ? btn('import-errors','Download errors','download') : '') + btn('remap','Edit mapping'));
    renderImportRows(mode,1);
  }
  async function commitImport(mode) {
    if (mode.needsReview) return validateImport(mode);
    const {approved,proof,counts} = mode.preview;
    checkImportSize(approved);
    const result = await saveWithReceipt(mode,'leadImportCommit',{rows:approved,proof});
    mode.phase = 'done';
    actionBody.innerHTML = `<div class="lm-detail-block"><h4>Import complete</h4>
      ${detailGrid([['Leads added',String(result.created)],['Invalid rows skipped',String(counts.invalid)],
        ['Duplicates skipped',String(counts.duplicate)],['Batch ID',result.batchId]])}</div>`;
    setFooter('',mode.preview.issues.length ? btn('import-errors','Download errors','download') : '');
    showToast(fmtNumber(result.created) + ' leads imported.','success');
    refreshAfterWrite();
  }
  async function handleImportFile(file) {
    const mode = dialogMode;
    if (!file || mode?.kind !== 'import' || saving) return;
    actionMessage.replaceChildren();
    setDialogBusy(true);
    actionBody.insertAdjacentHTML('beforeend',skeleton('Reading your workbook…'));
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Choose a file up to 5 MB.');
      const extension = file.name.split('.').pop().toLowerCase();
      const buffer = await file.arrayBuffer();
      const {workbook:parsed} = await workbook({op:'read',buffer,extension},[buffer]);
      mode.workbook = parsed;
      mode.fileName = file.name;
      importMap(mode);
    } catch (e) {
      actionBody.querySelector('.lm-skeleton')?.remove();
      actionForm.elements.namedItem('file').value = '';
      actionMessage.innerHTML = error(e.message);
    } finally { setDialogBusy(false); }
  }
  async function importDownload(key) {
    if (saving) return;
    const mode = dialogMode;
    setDialogBusy(true);
    actionMessage.replaceChildren();
    try {
      if (key === 'template') await downloadWorkbook('Lead-Import-Template.xlsx','Lead template',[fields.map(([,label]) => label)]);
      else {
        const rows = mode.mapped.filter(row => mode.issues.has(row.sourceRow)).map(row => {
          const issue = mode.issues.get(row.sourceRow);
          return [row.sourceRow,row.fields.name || '',row.fields.mobile || '',issue.kind,issue.message];
        });
        await downloadWorkbook('Lead-Import-Errors.xlsx','Row errors',[['Row','Full name','Mobile number','Result','Reason'],...rows]);
      }
    } catch (e) { actionMessage.innerHTML = error(e.message); }
    finally { setDialogBusy(false); }
  }

  actionForm.addEventListener('submit',async event => {
    event.preventDefault();
    if (!dialogMode || saving) return;
    const mode = dialogMode, data = readForm(actionForm);
    if (mode.kind === 'import' && !['map','review'].includes(mode.phase)) return;
    actionMessage.replaceChildren();
    setDialogBusy(true, mode.kind === 'import' && mode.phase === 'map' ? 'Validating…' : 'Saving…');
    try {
      if (mode.kind === 'mutation') await submitMutation(mode,data);
      else if (mode.phase === 'map') await validateImport(mode,data);
      else await commitImport(mode);
    } catch (e) {
      actionMessage.innerHTML = error(e.message);
      if (mode.kind === 'mutation') showToast(e.message,'error');
      if (e.code === 'IMPORT_CHANGED' && mode.kind === 'import') {
        mode.needsReview = true;
        setFooter('Recheck rows',btn('remap','Edit mapping'));
      }
    } finally { setDialogBusy(false); }
  });
  actionForm.addEventListener('change',event => {
    const {name,files,checked,value} = event.target;
    if (name === 'file') handleImportFile(files[0]);
    if (name === 'next') {
      const group = node(actionForm,'next-fields');
      group.hidden = !checked;
      group.querySelectorAll('input,textarea').forEach(control => { control.required = checked; });
    }
    if (name === 'connectionStatus') {
      const control = actionForm.elements.namedItem('outcome'), previous = control.value;
      control.innerHTML = options(value === 'Connected' ? conversations : value === 'Not Connected' ? missedOutcomes : [], value ? 'Choose outcome' : 'Choose connection first');
      if ([...control.options].some(o => o.value === previous)) control.value = previous;
    }
    if (name === 'updatedLeadStatus' && actionForm.elements.namedItem('statusReason')) actionForm.elements.namedItem('statusReason').required = !!value;
  });

  function onAction(event) {
    const trigger = event.target.closest('button[data-lm-action]');
    if (!trigger || trigger.disabled) return;
    const {lmAction:action,id,group,page,sort} = trigger.dataset;
    const state = activeState();
    switch (action) {
      case 'call-report': openCallReport(trigger.dataset.mode,trigger.dataset.owner); break;
      case 'report-refresh': loadCallReport(callReportState,true); break;
      case 'report-export': exportCallReport(trigger); break;
      case 'report-clear':
        node(callReportBody,'call-filter-form').reset();
        callReportState.filters = {}; callReportState.page = 1; loadCallReport(callReportState,true);
        break;
      case 'report-outcome':
        callReportState.filters.outcome = trigger.dataset.outcome;
        setFields(node(callReportBody,'call-filter-form'),callReportState.filters);
        callReportState.page = 1; loadCallReport(callReportState);
        break;
      case 'report-page': callReportState.page = Number(page); loadCallReport(callReportState); break;
      case 'add': leadForm(); break;
      case 'import': case 'pick-file': importPicker(); break;
      case 'remap':
        importMap(dialogMode);
        setFields(actionForm,dialogMode.mapping);
        actionMessage.replaceChildren();
        break;
      case 'template': case 'import-errors': importDownload(action); break;
      case 'import-page': renderImportRows(dialogMode,Number(page)); break;
      case 'export': exportLeads(state,trigger); break;
      case 'export-csv': exportLeads(state,trigger,'csv'); break;
      case 'view': showDetail(id); break;
      case 'history-page': showDetail(detailId,Number(page),true); break;
      case 'close':
        if (!saving) trigger.closest('dialog').close();
        break;
      case 'edit': case 'call': case 'schedule': case 'reschedule': case 'complete': case 'status': case 'assign':
        openMutation(trigger); break;
      case 'goto-calls': document.querySelector('.nav-item[data-tab="lead-calls"]').click(); break;
      case 'refresh': load(state,true); break;
      case 'clear':
        node(state.root,'filter-form').reset();
        state.filters = {}; state.page = 1; load(state);
        break;
      case 'page':
        state.page = Number(page); load(state);
        break;
      case 'sort':
        state.dir = state.sort === sort && state.dir === 'asc' ? 'desc' : 'asc';
        state.sort = sort; state.page = 1; load(state);
        break;
      case 'group':
        if (state.group === group) break;
        state.group = group; state.page = 1; load(state);
        break;
    }
  }
  detail.addEventListener('click',onAction);
  actionDialog.addEventListener('click',onAction);
  callReportDialog.addEventListener('click',onAction);
  workspaceMain.addEventListener('click',onAction);
  workspaceMain.addEventListener('submit',event => {
    const form = event.target;
    if (!form.matches('[data-lm-filter-form]')) return;
    event.preventDefault();
    const state = activeState();
    state.filters = readForm(form);
    state.page = 1;
    load(state);
  });

  window.UMLeadWorkspace = {open};
})();

