/* Support Management uses the shared CRM session and Apps Script action router. */
(() => {
  'use strict';

  const workspace = document.createElement('div');
  workspace.className = 'support-workspace';
  const statuses = ['NEW', 'ASSIGNED', 'IN PROGRESS', 'WAITING FOR CUSTOMER', 'WAITING FOR INTERNAL TEAM', 'RESOLVED', 'CLOSED', 'REOPENED'];
  const priorities = ['Critical', 'High', 'Medium', 'Low'];
  const workingStatuses = ['IN PROGRESS', 'WAITING FOR CUSTOMER', 'WAITING FOR INTERNAL TEAM'];
  const customerTypes = ['Customer', 'Dealer', 'Distributor', 'Hospital', 'Internal', 'Other'];
  const pageSize = 25;
  const maxFileBytes = 240000;
  const dateTime = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
  const dateOnly = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium' });
  const isoDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
  const number = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
  const queueTabs = [
    ['', 'All assigned'], ['new', 'New assignments'], ['in_progress', 'In progress'], ['waiting', 'Waiting for customer'],
    ['due_today', 'Due today'], ['overdue', 'Overdue'], ['resolution', 'Awaiting approval'], ['recently_closed', 'Recently closed']
  ];
  const kpiLabels = {
    total: 'Total tickets received', open: 'Open tickets', unassigned: 'Unassigned', in_progress: 'In progress',
    waiting_for_customer: 'Waiting for customer', resolved: 'Resolved', closed: 'Closed', overdue: 'Overdue', escalated: 'Escalated'
  };
  const state = {
    session: null, uid: '', view: '', version: 0, bootstrap: null, bootstrapPending: null, filters: {}, page: 1, ticketId: '',
    report: null, reportExport: null, readController: null, notice: ''
  };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const api = (action, payload = {}, options) => UMAuth.api('support.' + action, payload, options);
  const id = () => crypto.randomUUID();
  const can = permission => UMAuth.can('support.' + permission);
  const get = selector => workspace.querySelector(selector);
  const humanize = value => String(value ?? '').replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());
  const minutes = value => value === '' || value == null ? '—' : number.format(Number(value)) + ' min';
  const pct = value => value === '' || value == null ? '—' : number.format(Number(value)) + '%';
  const displayDate = (value, withTime = true) => {
    if (!value) return '—';
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T00:00:00+05:30' : value);
    return Number.isNaN(date.getTime()) ? '—' : (withTime ? dateTime : dateOnly).format(date);
  };
  const button = (action, label, attributes = '', tone = '') =>
    '<button type="button" class="sup-btn' + (tone ? ' sup-' + tone : '') + '" data-sup-action="' + action + '" ' + attributes + '>' + esc(label) + '</button>';
  const submit = (label, tone = 'primary') => '<button type="submit" class="sup-btn sup-' + tone + '">' + esc(label) + '</button>';
  const options = (items, selected, placeholder) => [
    placeholder == null ? '' : '<option value="">' + esc(placeholder) + '</option>',
    ...items.map(item => {
      const [value, label] = Array.isArray(item) ? item : [item, item];
      return '<option value="' + esc(value) + '"' + (String(value) === String(selected) ? ' selected' : '') + '>' + esc(label) + '</option>';
    })
  ].join('');
  const select = (name, title, items, selected, placeholder, attributes = '') =>
    '<label>' + esc(title) + '<select name="' + name + '" aria-label="' + esc(title) + '" ' + attributes + '>' + options(items, selected, placeholder) + '</select></label>';
  const input = (name, title, type = 'text', value = '', attributes = '') =>
    '<label>' + esc(title) + '<input name="' + name + '" type="' + type + '" value="' + esc(value) + '" ' + attributes + '></label>';
  const textarea = (name, title, value = '', attributes = '') =>
    '<label class="sup-full">' + esc(title) + '<textarea name="' + name + '" ' + attributes + '>' + esc(value) + '</textarea></label>';
  const activeCheck = (value = true) =>
    '<label class="sup-check"><input type="checkbox" name="active_status"' + (truthy(value) ? ' checked' : '') + '> Active</label>';
  const truthy = value => !['', '0', 'false', 'no', 'inactive'].includes(String(value ?? '').toLowerCase());
  const data = form => Object.fromEntries(new FormData(form));
  const categoryRows = () => state.bootstrap?.categories || [];
  const employeeRows = () => state.bootstrap?.employees || [];
  const categories = (activeOnly = false) => categoryRows()
    .filter(row => !activeOnly || row.active_status == null || truthy(row.active_status))
    .map(row => row.category_name);
  const activePriorities = () => state.bootstrap?.priorities || priorities;
  const canViewCustomer = () => can('agent') || can('manage');
  const managers = () => (state.bootstrap?.managers || []).map(row => [row.employee_id, row.employee_name || row.employee_id]);
  const employees = () => employeeRows().map(row => [row.employee_id, row.employee_name || row.employee_id]);
  const departmentChoices = () => [...new Set([...categoryRows(), ...employeeRows()].map(row => row.department).filter(Boolean))].sort();
  const activeEmployees = () => employeeRows().filter(row => row.active_status == null || truthy(row.active_status))
    .map(row => [row.employee_id, row.employee_name || row.employee_id]);
  const ticketURLButton = (ticketId, label = ticketId) =>
    button('ticket', label, 'data-ticket-id="' + esc(ticketId) + '"', 'link');
  const empty = message => '<p class="sup-empty">' + esc(message) + '</p>';
  const problem = message => '<p class="sup-problem" role="alert">' + esc(message) + '</p>';
  const loading = message => '<p class="sup-empty" role="status"><span class="spinner" aria-hidden="true"></span>' + esc(message) + '</p>';
  const busy = value => workspace.setAttribute('aria-busy', String(value));

  function panel(title, body) {
    return '<section class="sup-panel"><h3>' + esc(title) + '</h3>' + body + '</section>';
  }

  function table(labels, rows, className = '') {
    if (!rows.length) return empty('No matching records.');
    return '<div class="sup-table-wrap" tabindex="0" role="region" aria-label="' + esc(labels[0] + ' table') + '"><table class="sup-table ' + className + '"><thead><tr>' +
      labels.map(label => '<th scope="col">' + esc(label) + '</th>').join('') +
      '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map(cell => '<td>' + cell + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  }

  function badge(value) {
    if (!value) return '';
    const slug = String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return '<span class="sup-badge sup-badge-' + slug + '">' + esc(value) + '</span>';
  }

  function filterForm(values, showQueue = false) {
    const report = state.view === 'reports';
    const canSearchCustomer = report ? can('manage') : canViewCustomer();
    const query = canSearchCustomer ? 'Ticket ID, subject or email' : 'Ticket ID, status or employee';
    return '<form class="sup-panel sup-form sup-filters" data-sup-form="filter" aria-label="Ticket filters">' +
      input('q', 'Search tickets', 'search', values.q, 'placeholder="' + query + '" maxlength="150"') +
      input('from', report ? 'Activity from' : 'Received from', 'date', values.from) +
      input('to', report ? 'Activity through' : 'Received through', 'date', values.to) +
      select('category', 'Category', categories(), values.category, 'All categories') +
      select('priority', 'Priority', priorities, values.priority, 'All priorities') +
      select('status', 'Status', statuses, values.status, 'All statuses') +
      (can('manage') || can('reports') ? select('employeeId', 'Employee', employees(), values.employeeId, 'All employees') +
        select('managerId', 'Manager', managers(), values.managerId, 'All managers') +
        select('department', 'Department', departmentChoices(), values.department, 'All departments') : '') +
      (canSearchCustomer ? input('customer', 'Customer', 'text', values.customer, 'placeholder="Name or email" maxlength="150"') : '') +
      select('escalationLevel', 'Escalation level', [['0', 'None'], ['1', 'Level 1'], ['2', 'Level 2'], ['3', 'Level 3'], ['4', 'Level 4']], values.escalationLevel, 'All levels') +
      (showQueue ? select('myQueue', 'My workspace', queueTabs, values.myQueue, null) : '') +
      '<div class="sup-actions sup-full">' + submit('Apply filters') + button('reset', 'Clear filters') + '</div></form>';
  }

  function ticketRows(tickets) {
    const showCustomer = canViewCustomer();
    const rows = tickets.map(ticket => [
      '<div class="sup-ticket-cell">' + (canOpenTicket(ticket) ? ticketURLButton(ticket.ticket_id) : esc(ticket.ticket_id)) + (showCustomer ? '<strong>' + esc(ticket.subject) + '</strong>' : '') + '</div>',
      showCustomer ? '<div class="sup-ticket-cell"><strong>' + esc(ticket.customer_name || ticket.customer_email) + '</strong>' + esc(ticket.category_name || ticket.category) + '</div>'
        : esc(ticket.category_name || ticket.category),
      badge(ticket.priority), badge(ticket.status), esc(ticket.assigned_employee_name || ticket.assigned_employee_id || 'Unassigned'),
      esc(displayDate(ticket.created_at)), esc(minutes(ticket.pending_age_minutes)),
      deadlineCell(ticket)
    ]);
    return table(['Ticket', showCustomer ? 'Customer / Category' : 'Category', 'Priority', 'Status', 'Assigned to', 'Received', 'Working age', 'SLA deadline'], rows, 'sup-ticket-table');
  }

  function resolutionOverdue(ticket) {
    return !!(ticket.resolution_overdue || (
      ticket.resolution_deadline && new Date(ticket.resolution_deadline).getTime() < Date.now() &&
      !['RESOLVED', 'CLOSED', 'WAITING FOR CUSTOMER'].includes(ticket.status)
    ));
  }

  function responseOverdue(ticket) {
    return !!(ticket.first_response_overdue || (
      ticket.first_response_deadline && new Date(ticket.first_response_deadline).getTime() < Date.now() &&
      !ticket.first_response_at && !['RESOLVED', 'CLOSED'].includes(ticket.status)
    ));
  }

  function deadlineCell(ticket) {
    const breached = resolutionOverdue(ticket) || responseOverdue(ticket);
    const deadline = !ticket.first_response_at && ticket.first_response_deadline &&
      (!ticket.resolution_deadline || ticket.first_response_deadline <= ticket.resolution_deadline)
      ? ticket.first_response_deadline : ticket.resolution_deadline;
    return (breached ? '<span class="sup-breach">Overdue</span><br>' : '') + esc(displayDate(deadline)) +
      (Number(ticket.escalation_level) > 0 ? '<br><span class="sup-muted">Escalation ' + esc(ticket.escalation_level) + '</span>' : '');
  }

  function kpis(values = {}) {
    return '<dl class="sup-kpis">' + Object.entries(kpiLabels).map(([key, label]) => {
      const value = values[key];
      if (value == null) return '';
      return '<div' + (key === 'overdue' && value ? ' class="sup-kpi-overdue"' : '') + '><dt>' +
        esc(label) + '</dt><dd>' + esc(number.format(Number(value))) + '</dd></div>';
    }).join('') + '</dl>';
  }

  function breakdown(title, items, label = 'Group') {
    const rows = Array.isArray(items) ?
      items.map(item => Array.isArray(item) ? item : [item.label || item.name || item.date || item.period || item.key, item.count ?? item.total]) :
      Object.entries(items || {});
    return panel(title, table([label, 'Tickets'], rows.map(([group, count]) => [esc(group), esc(number.format(Number(count || 0)))])));
  }

  function workload(items = []) {
    const rows = items.map(entry => [
      entry.employee_name || entry.employee_id, entry.total_assigned, entry.total_resolved, entry.total_closed, entry.pending,
      minutes(entry.average_first_response_minutes), minutes(entry.average_resolution_minutes), pct(entry.sla_compliance), entry.reopened
    ].map(esc));
    return panel('Employee performance', table(['Employee', 'Assigned', 'Resolved', 'Closed', 'Pending', 'Avg. response', 'Avg. resolution', 'SLA compliance', 'Reopened'], rows));
  }

  function dailySummary(values = {}) {
    const labels = {
      received: 'Received today', resolved: 'Resolved today', pending: 'Pending tickets',
      assignments: 'Assignments today', overdue: 'Overdue tickets', escalations: 'Escalations today'
    };
    return panel('Daily support report', facts(Object.entries(labels).map(([key, label]) => [label, values[key]])));
  }

  function metrics(values = {}) {
    return panel('Service performance', facts([
      ['Average first response', minutes(values.average_first_response_minutes)],
      ['Average resolution', minutes(values.average_resolution_minutes)],
      ['SLA compliance', pct(values.sla_compliance)],
      ['Reopened tickets', pct(values.reopened_percentage)]
    ]));
  }

  function facts(pairs) {
    return '<dl class="sup-facts">' + pairs.map(([label, value]) =>
      '<div><dt>' + esc(label) + '</dt><dd>' + esc(value == null || value === '' ? '—' : value) + '</dd></div>'
    ).join('') + '</dl>';
  }

  function noticeMarkup() {
    return state.notice ? '<p class="sup-notice" role="status">' + esc(state.notice) + '</p>' : '';
  }

  function refreshButton() {
    return '<div class="sup-actions">' + button('refresh', 'Refresh') + '</div>';
  }

  function renderList(data) {
    const total = Number(data.total || 0);
    const size = Number(data.pageSize || pageSize);
    const current = Number(data.page || state.page);
    state.page = current;
    const last = Math.max(1, Math.ceil(total / size));
    const position = total ? (current - 1) * size + 1 + '–' + Math.min(total, current * size) + ' of ' + total + ' tickets' : '0 tickets';
    workspace.innerHTML = noticeMarkup() + filterForm(state.filters, state.view === 'mine') +
      '<section class="sup-panel"><div class="sup-section-head"><h3>' + esc(position) + '</h3>' + refreshButton() + '</div>' +
      ticketRows(data.tickets || []) + (last > 1 ? '<div class="sup-pagination">' +
        button('previous', 'Previous', current <= 1 ? 'disabled' : '') + '<span>Page ' + current + ' of ' + last + '</span>' +
        button('next', 'Next', current >= last ? 'disabled' : '') + '</div>' : '') + '</section>';
  }

  function renderOverview(response) {
    workspace.innerHTML = noticeMarkup() + refreshButton() + kpis(response.kpis) +
      '<div class="sup-grid">' + dailySummary(response.daily) + metrics(response.metrics) + '</div>' +
      (response.employees?.length ? workload(response.employees) : '');
  }

  function renderReports(report) {
    const counts = report.periodCounts || (report.reportEvents && {
      received: report.reportEvents.received?.length ?? 0, resolved: report.reportEvents.resolved?.length ?? 0
    });
    const receivedResolved = counts ? '<p class="sup-report-period">' +
      esc(counts.received) + ' received · ' + esc(counts.resolved) + ' resolved in this period</p>' : '';
    workspace.innerHTML = filterForm(state.filters) +
      '<section class="sup-panel"><div class="sup-section-head"><h3>Support activity</h3><div class="sup-actions">' +
      button('csv', 'Download CSV') + button('excel', 'Download Excel') + '</div></div>' +
      '<p class="sup-muted">Received and resolved activity use their respective event dates.</p>' + receivedResolved +
      '<div data-sup-report-result aria-live="polite"></div>' + kpis(report.kpis) + '</section>' +
      '<div class="sup-grid">' + dailySummary(report.daily) + metrics(report.metrics) +
      breakdown('Daily ticket inflow', report.dailyInflow, 'Date') + breakdown('Monthly ticket inflow', report.monthlyInflow, 'Month') +
      breakdown('Categories', report.categories, 'Category') + breakdown('Priorities', report.priorities, 'Priority') +
      breakdown('Pending age', report.ageing, 'Working days') + breakdown(can('manage') ? 'Root causes' : 'Resolved tickets by category', report.rootCauses, can('manage') ? 'Root cause' : 'Category') +
      '</div>' + workload(report.employees);
  }

  function renderNew() {
    workspace.innerHTML = noticeMarkup() + '<section class="sup-panel"><h3>Customer request</h3>' +
      '<form data-sup-form="create" class="sup-form">' +
      input('customerName', 'Customer name', 'text', '', 'required maxlength="150"') +
      input('customerEmail', 'Customer email', 'email', '', 'required maxlength="254"') +
      input('customerMobile', 'Mobile number', 'tel', '', 'maxlength="40"') +
      select('customerType', 'Customer type', customerTypes, '', 'Select customer type') +
      input('companyName', 'Company name', 'text', '', 'maxlength="150"') +
      select('category', 'Category', categories(true), '', 'Select category', 'required') +
      select('priority', 'Priority', activePriorities(), '', 'Use category default') +
      input('subcategory', 'Subcategory', 'text', '', 'maxlength="120"') +
      input('subject', 'Subject', 'text', '', 'required maxlength="240"') +
      textarea('message', 'Message', '', 'required maxlength="20000" rows="7"') +
      '<div class="sup-full sup-actions">' + submit('Create ticket') + '</div><div class="sup-full" data-sup-form-result aria-live="polite"></div></form></section>';
  }

  function canOpenTicket(ticket) {
    return can('manage') || (can('agent') && String(ticket.assigned_employee_id).toLowerCase() === state.uid.toLowerCase());
  }

  function attachments(refs) {
    if (typeof refs === 'string') {
      try { refs = JSON.parse(refs || '[]'); }
      catch (_) { refs = []; }
    }
    if (!Array.isArray(refs) || !refs.length) return '';
    return '<div class="sup-attachments">' + refs.map(file => {
      const reference = typeof file === 'string' ? file : file?.id;
      if (!reference && !file?.unavailable) return '';
      const filename = typeof file === 'string' ? 'Download attachment' : file?.name || 'Download attachment';
      return file?.unavailable ? '<span class="sup-muted">' + esc(filename) + ' (unavailable)</span>' :
        button('download', filename, 'data-attachment-id="' + esc(reference) + '"');
    }).join('') + '</div>';
  }

  function messageMarkup(row) {
    const internal = [row.direction, row.message_type, row.sender_type].some(value => /INTERNAL|NOTE/i.test(String(value || '')));
    const incoming = /INBOUND|INCOMING|CUSTOMER/i.test([row.direction, row.sender_type].join(' '));
    const type = internal ? 'Internal note' : incoming ? 'Customer message' : humanize(row.message_type || 'Customer email');
    return '<article class="sup-message' + (internal ? ' sup-internal' : '') + '">' +
      '<div class="sup-message-head"><strong>' + esc(type) + '</strong><span>' + esc(displayDate(row.sent_at)) + '</span></div>' +
      '<p class="sup-muted">' + esc(row.sender) + (row.recipient && !internal ? ' → ' + esc(row.recipient) : '') + '</p>' +
      '<p class="sup-message-body">' + esc(row.message_body) + '</p>' + attachments(row.attachment_references) +
      (!internal && row.delivery_status ? '<p class="sup-muted">' + esc(humanize(row.delivery_status.toLowerCase())) + '</p>' : '') + '</article>';
  }

  function historyMarkup(row) {
    const transition = row.new_status ?
      (row.previous_status ? row.previous_status + ' → ' : '') + row.new_status : '';
    return '<article class="sup-history"><div class="sup-message-head"><strong>' + esc(humanize(row.action)) +
      '</strong><span>' + esc(displayDate(row.timestamp)) + '</span></div><p class="sup-muted">' +
      esc([row.performed_by_name || row.performed_by, transition].filter(Boolean).join(' · ')) +
      '</p>' + (row.remarks ? '<p class="sup-message-body">' + esc(row.remarks) + '</p>' : '') + '</article>';
  }

  function conversationTimeline(detail) {
    const entries = [
      ...(detail.conversations || []).map(row => ({ time: row.sent_at, render: () => messageMarkup(row) })),
      ...(detail.history || []).map(row => ({ time: row.timestamp, render: () => historyMarkup(row) }))
    ];
    entries.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    return entries.length ? '<ol class="sup-timeline">' + entries.map(entry => '<li>' + entry.render() + '</li>').join('') + '</ol>' :
      empty('No conversations or activity have been recorded.');
  }

  function assignmentTable(items) {
    const rows = items.map(row => [row.assigned_employee_name || row.assigned_employee_id, row.assigned_manager_id,
      displayDate(row.assigned_at), displayDate(row.reassigned_at), row.assignment_remarks].map(esc));
    return table(['Assigned employee', 'Manager', 'Assigned', 'Reassigned', 'Remarks'], rows);
  }

  function escalationTable(items) {
    const hasRecipient = items.some(row => row.notified_person);
    const rows = items.map(row => [row.escalation_level, row.escalation_reason,
      ...(hasRecipient ? [row.notified_person] : []), displayDate(row.notification_timestamp), row.notification_status].map(esc));
    return table(['Level', 'Reason', ...(hasRecipient ? ['Recipient'] : []), 'Time', 'Delivery'], rows);
  }

  function actionForm(action, title, controls, primary, description = '') {
    return '<details class="sup-action-card"><summary>' + esc(title) + '</summary>' +
      (description ? '<p class="sup-muted">' + esc(description) + '</p>' : '') +
      '<form class="sup-form" data-sup-form="' + action + '">' + controls +
      '<div class="sup-full sup-actions">' + primary + '</div><div class="sup-full" data-sup-form-result aria-live="polite"></div></form></details>';
  }

  function fileInput(required = false) {
    return '<label class="sup-full">Attachment (' + (required ? 'required, ' : 'optional, ') +
      'up to 240 KB)<input name="attachment" type="file"' + (required ? ' required' : '') + '></label>';
  }

  function ticketActions(ticket) {
    const manager = can('manage');
    const assigned = !!ticket.assigned_employee_id;
    const open = !['CLOSED', 'RESOLVED'].includes(ticket.status);
    const canWork = open && assigned && canOpenTicket(ticket);
    let actions = '';
    if (manager && open) {
      actions += actionForm('assign', 'Assign or reassign', select('employeeId', 'Employee', activeEmployees(), ticket.assigned_employee_id, assigned ? 'Keep current employee' : 'Leave unassigned') +
        select('priority', 'Priority', [...new Set([ticket.priority, ...activePriorities()])], ticket.priority) + textarea('remarks', 'Assignment remarks', '', 'maxlength="4000" rows="3"'), submit('Save assignment'));
    }
    if (canWork) {
      actions += actionForm('status', 'Change status', select('status', 'New status', workingStatuses.filter(status => status !== ticket.status), '', 'Select status', 'required') +
        textarea('remarks', 'Investigation remarks', '', 'maxlength="4000" rows="3"'), submit('Update status'));
      actions += actionForm('reply', 'Reply to customer', textarea('body', 'Customer message', '', 'required maxlength="20000" rows="5"') + fileInput(), submit('Queue customer reply'),
        'The message and file will be sent to ' + ticket.customer_email + '.');
      actions += actionForm('resolve', 'Submit for resolution', textarea('rootCause', 'Root cause', '', 'required maxlength="4000" rows="3"') +
        textarea('resolutionRemarks', 'Resolution remarks', '', 'required maxlength="4000" rows="4"') +
        textarea('customerMessage', 'Message to customer (optional)', '', 'maxlength="20000" rows="3"'), submit('Submit for review'));
    }
    if (canOpenTicket(ticket) && ticket.status !== 'CLOSED') {
      actions += actionForm('note', 'Add internal note', textarea('body', 'Internal note', '', 'required maxlength="20000" rows="4"') +
        fileInput(), submit('Save internal note'), 'This note is visible only to authorized staff.');
      actions += actionForm('attachment-note', 'Upload internal attachment', fileInput(true), submit('Upload attachment'));
    }
    if (manager && ticket.status === 'RESOLVED') {
      actions += actionForm('review', 'Review resolution', select('decision', 'Decision', [['approve', 'Approve and close'], ['reject', 'Return to in progress']], '', 'Select decision', 'required') +
        textarea('remarks', 'Review remarks', '', 'maxlength="4000" rows="4"') +
        textarea('customerMessage', 'Message to customer (optional)', '', 'maxlength="20000" rows="3"'), submit('Save closure decision'));
    }
    if (manager && Number(ticket.escalation_level) > 0) {
      actions += actionForm('escalationAction', 'Record escalation follow-up', textarea('remarks', 'Actions taken', '', 'required maxlength="4000" rows="4"'),
        submit('Record follow-up'));
    }
    return actions ? panel('Ticket actions', '<div class="sup-action-list">' + actions + '</div>') : '';
  }

  function ticketTiming(ticket) {
    return panel('Working-hours SLA', facts([
      ['First response due', displayDate(ticket.first_response_deadline)],
      ['First human response', displayDate(ticket.first_response_at)],
      ['Response working time', minutes(ticket.first_response_elapsed_minutes)],
      ['Resolution due', ticket.status === 'WAITING FOR CUSTOMER' ? 'Paused' : displayDate(ticket.resolution_deadline)],
      ['Resolution working time', minutes(ticket.resolution_elapsed_minutes)],
      ['Pending working age', minutes(ticket.pending_age_minutes)],
      ['Resolved', displayDate(ticket.resolved_at)],
      ['Closed', displayDate(ticket.closed_at)],
      ['Reopen count', Number(ticket.reopened_count || 0)]
    ]));
  }

  function renderTicket(detail) {
    const t = detail.ticket;
    const fromOriginal = (detail.conversations || []).some(row => /INBOUND/i.test(row.direction) || /ORIGINAL/i.test(row.message_type));
    const original = !fromOriginal && t.original_message ? '<article class="sup-message"><strong>Original request</strong><p class="sup-message-body">' +
      esc(t.original_message) + '</p>' + attachments(t.attachment_references) + '</article>' : '';
    const related = t.linked_ticket_id ?
      '<p class="sup-related">Related ticket ' + (can('manage') ? ticketURLButton(t.linked_ticket_id) : esc(t.linked_ticket_id)) + '</p>' : '';
    const resolution = t.root_cause || t.resolution_remarks ? panel('Resolution', facts([
      ['Root cause', t.root_cause], ['Resolution remarks', t.resolution_remarks]
    ])) : '';
    workspace.innerHTML = '<div class="sup-section-head">' + button('back', 'Back to tickets') + refreshButton() + '</div>' + noticeMarkup() +
      '<section class="sup-panel sup-ticket-heading"><div><p class="sup-ticket-id">' + esc(t.ticket_id) +
      '</p><h3 tabindex="-1" data-sup-ticket-heading>' + esc(t.subject) + '</h3>' + related + '</div><div class="sup-badges">' +
      badge(t.priority) + badge(t.status) + (responseOverdue(t) || resolutionOverdue(t) ? badge('OVERDUE') : '') +
      (Number(t.escalation_level) > 0 ? badge('ESCALATED ' + t.escalation_level) : '') + '</div></section>' +
      '<div class="sup-grid">' + panel('Customer', facts([
        ['Name', t.customer_name], ['Email', t.customer_email], ['Mobile', t.customer_mobile],
        ['Customer type', t.customer_type], ['Company', t.company_name]
      ])) + panel('Ticket information', facts([
        ['Category', t.category_name || t.category], ['Subcategory', t.subcategory], ['Department', t.department],
        ['Assigned employee', t.assigned_employee_name || t.assigned_employee_id], ['Manager', t.assigned_manager_name || t.assigned_manager_id],
        ['Received', displayDate(t.created_at)], ['Source', humanize(t.source)]
      ])) + ticketTiming(t) + resolution + '</div>' +
      '<div class="sup-detail-layout"><div>' + panel('Conversation and history', original + conversationTimeline(detail)) + '</div><div>' +
      ticketActions(t) + '</div></div>' +
      panel('Assignment history', assignmentTable(detail.assignments || [])) +
      ((detail.escalations || []).length ? panel('Escalation log', escalationTable(detail.escalations)) : '');
    if (state.focusDetail) get('[data-sup-ticket-heading]')?.focus({ preventScroll: true });
    state.focusDetail = false;
  }

  function hidden(name, value) {
    return '<input type="hidden" name="' + name + '" value="' + esc(value) + '">';
  }

  function settingForm(section, fields, text = 'Save changes') {
    return '<form class="sup-form" data-sup-form="setting" data-section="' + section + '">' + fields +
      '<div class="sup-full sup-actions">' + submit(text) + '</div><div class="sup-full" data-sup-form-result aria-live="polite"></div></form>';
  }

  function settingRows(title, existing, create) {
    const forms = existing.map(([label, form]) => '<details class="sup-action-card"><summary>' +
      esc(label) + '</summary>' + form + '</details>').join('');
    if (!forms && !create) return panel(title, empty('No eligible records are available.'));
    return panel(title, '<div class="sup-action-list">' + forms +
      (create ? '<details class="sup-action-card"><summary>' + esc(create[0]) + '</summary>' + create[1] + '</details>' : '') + '</div>');
  }

  function breaksText(breaks) {
    if (typeof breaks === 'string') {
      try { breaks = JSON.parse(breaks || '[]'); }
      catch (_) { return ''; }
    }
    return (breaks || []).map(period => period.start + '–' + period.end).join('\n');
  }

  function departmentText(value) {
    return Object.entries(value || {}).map(([department, emails]) => department + ' = ' + emails).join('\n');
  }

  function calendarForm(settings) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return settingForm('settings', '<fieldset class="sup-full sup-days"><legend>Working days</legend>' +
      days.map((day, index) => {
        const checked = (settings.working_days || []).map(Number).includes(index) ? ' checked' : '';
        return '<label class="sup-check"><input type="checkbox" name="working_days" value="' + index + '"' + checked + '> ' + day + '</label>';
      }).join('') + '</fieldset>' + input('opening_time', 'Opening time', 'time', settings.opening_time, 'required') +
      input('closing_time', 'Closing time', 'time', settings.closing_time, 'required') +
      textarea('breaks', 'Break periods (one HH:MM–HH:MM range per line)', breaksText(settings.breaks), 'rows="3"') +
      '<p class="sup-muted sup-full">All calendar times use India Standard Time.</p>');
  }

  function notificationForm(settings) {
    return settingForm('settings', input('manager_email', 'Support manager emails', 'email', settings.manager_email, 'multiple') +
      input('department_head_email', 'Default department head emails', 'email', settings.department_head_email, 'multiple') +
      input('management_email', 'Management emails', 'email', settings.management_email, 'multiple') +
      input('summary_hour', 'Daily summary hour (IST)', 'number', settings.summary_hour, 'required min="0" max="23" step="1"') +
      textarea('escalation_department_heads', 'Department contacts (one Department = email list per line)', departmentText(settings.escalation_department_heads), 'rows="4"') +
      '<label class="sup-check"><input type="checkbox" name="summary_enabled"' + (truthy(settings.summary_enabled) ? ' checked' : '') + '> Send daily management summary</label>');
  }

  function settingsCategories(items, active) {
    const form = row => settingForm('category', hidden('category_id', row.category_id || '') +
      input('category_name', 'Category name', 'text', row.category_name, 'required maxlength="120"') +
      select('default_priority', 'Default priority', [...new Set([...active, row.default_priority].filter(Boolean))], row.default_priority || 'Medium') +
      input('department', 'Default department', 'text', row.department, 'maxlength="100"') +
      textarea('description', 'Description', row.description || '', 'rows="3" maxlength="500"') + activeCheck(row.active_status));
    return settingRows('Categories', items.map(row => [row.category_name, form(row)]), ['Add category', form({})]);
  }

  function settingsTargets(items) {
    return settingRows('SLA targets', items.map(row => [row.priority, settingForm('sla', hidden('priority', row.priority) +
      input('first_response_minutes', 'First response (working minutes)', 'number', row.first_response_minutes, 'required min="1" step="1"') +
      input('resolution_minutes', 'Resolution (working minutes)', 'number', row.resolution_minutes, 'required min="1" step="1"') +
      activeCheck(row.active_status))]));
  }

  function settingsHolidays(items) {
    const fields = row => (row.holiday_date ? hidden('holiday_date', row.holiday_date) : input('holiday_date', 'Holiday date', 'date', '', 'required')) +
      input('holiday_name', 'Holiday name', 'text', row.holiday_name, 'required maxlength="120"') + activeCheck(row.active_status);
    return settingRows('Company holidays', items.map(row => [
      displayDate(row.holiday_date, false) + ' · ' + row.holiday_name, settingForm('holiday', fields(row), 'Save holiday')
    ]), ['Add holiday', settingForm('holiday', fields({}), 'Save holiday')]);
  }

  function settingsSpecialDays(items) {
    const form = row => settingForm('specialDay', (row.working_date ? hidden('working_date', row.working_date) :
      input('working_date', 'Working date', 'date', '', 'required')) +
      input('opening_time', 'Opening time', 'time', row.opening_time, 'required') +
      input('closing_time', 'Closing time', 'time', row.closing_time, 'required') +
      textarea('breaks', 'Break periods (one HH:MM–HH:MM range per line)', breaksText(row.breaks), 'rows="3"') +
      activeCheck(row.active_status), 'Save special day');
    return settingRows('Special working days', items.map(row => [
      displayDate(row.working_date, false) + ' · ' + row.opening_time + '–' + row.closing_time, form(row)
    ]), ['Add special working day', form({})]);
  }

  function settingsEmployees(items, users) {
    const roles = [['Agent', 'Support agent'], ['Manager', 'Support manager']];
    const registered = new Set(items.map(row => row.employee_id));
    const choices = users.filter(row => !registered.has(row.id || row.employee_id)).map(row => {
      const id = row.id || row.employee_id;
      return [id, (row.name || row.employee_name || id) + ' (' + id + ')'];
    });
    const form = row => settingForm('employee', (row.employee_id ? hidden('employee_id', row.employee_id) :
      select('employee_id', 'CRM user', choices, '', 'Select CRM user', 'required')) +
      input('email', 'Support notification email', 'email', row.email, 'required maxlength="254"') +
      input('department', 'Department', 'text', row.department, 'maxlength="100"') +
      select('support_role', 'Roster role', roles, row.support_role, 'Use CRM access') + activeCheck(row.active_status), 'Save employee');
    return settingRows('Support employees', items.map(row => [
      (row.employee_name || row.employee_id) + ' (' + row.employee_id + ')', form(row)
    ]), choices.length ? ['Add support employee', form({})] : null);
  }

  function renderSettings(response) {
    const settings = response.settings;
    workspace.innerHTML = noticeMarkup() + '<div class="sup-grid">' +
      panel('Working calendar', calendarForm(settings)) + panel('Escalation and summary recipients', notificationForm(settings)) +
      settingsTargets(response.slas || []) + settingsCategories(response.categories || [],
        response.slas?.length ? response.slas.filter(row => truthy(row.active_status)).map(row => row.priority) : priorities) +
      settingsHolidays(response.holidays || []) + settingsSpecialDays(response.specialDays || []) +
      settingsEmployees(response.employees || [], response.users || []) + '</div>';
  }

  function parseBreaks(value) {
    return String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
      const match = /^(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})$/.exec(line);
      if (!match) throw new Error('Enter each break as a time range such as 13:00–14:00.');
      return { start: match[1], end: match[2] };
    });
  }

  function parseDepartmentHeads(value) {
    return Object.fromEntries(String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
      const match = /^([^=]+?)\s*=\s*(\S.*)$/.exec(line);
      if (!match) throw new Error('Enter each department contact as Department = email@example.com.');
      return [match[1].trim(), match[2].trim()];
    }));
  }

  function settingsPayload(form, values) {
    const section = form.dataset.section;
    if ('breaks' in values) values.breaks = parseBreaks(values.breaks);
    if ('opening_time' in values && section === 'settings') {
      values.working_days = new FormData(form).getAll('working_days').map(Number);
    }
    if ('summary_hour' in values) {
      values.summary_hour = Number(values.summary_hour);
      values.summary_enabled = form.elements.summary_enabled.checked;
      values.escalation_department_heads = parseDepartmentHeads(values.escalation_department_heads);
    }
    if (section === 'sla') {
      values.first_response_minutes = Number(values.first_response_minutes);
      values.resolution_minutes = Number(values.resolution_minutes);
    }
    if (form.elements.active_status) values.active_status = form.elements.active_status.checked;
    return { section, record: values };
  }

  function resetBootstrap() {
    state.bootstrap = null;
    state.bootstrapPending = null;
  }

  function updateSession(session) {
    if (session === state.session) return false;
    state.session = session;
    state.uid = session?.id || '';
    state.report = null;
    state.reportExport = null;
    resetBootstrap();
    return true;
  }

  function getBootstrap() {
    if (state.bootstrap) return state.bootstrap;
    if (!state.bootstrapPending) {
      const pending = api('bootstrap').then(response => {
        if (state.bootstrapPending === pending && state.session === UMAuth.user) state.bootstrap = response;
        return response;
      }).finally(() => {
        if (state.bootstrapPending === pending) state.bootstrapPending = null;
      });
      state.bootstrapPending = pending;
    }
    return state.bootstrapPending;
  }

  function viewRead(view, ticketId, filters, page) {
    if (ticketId) return { action: 'get', payload: { ticketId }, render: renderTicket, bootstrap: true };
    if (view === 'new') return { render: renderNew, bootstrap: true };
    if (view === 'settings') return { action: 'settings', render: renderSettings };
    if (view === 'overview') return { action: 'overview', render: renderOverview };
    if (view === 'reports') return { action: 'reports', payload: { filters, summaryOnly: true }, render: renderReports, bootstrap: true };
    return { action: 'list', payload: { view, filters, page, pageSize }, render: renderList, bootstrap: true };
  }

  async function renderCurrent() {
    const run = ++state.version;
    const session = UMAuth.user;
    updateSession(session);
    const current = () => state.version === run && UMAuth.user === session;
    const { action, payload, render, bootstrap } = viewRead(state.view, state.ticketId, state.filters, state.page);
    state.readController?.abort();
    const controller = new AbortController();
    state.readController = controller;
    if (action === 'reports') {
      state.report = null;
      state.reportExport = null;
    }
    busy(true);
    workspace.innerHTML = loading(state.ticketId ? 'Loading ticket…' : 'Loading support workspace…');
    try {
      const [response] = await Promise.all([
        action ? api(action, payload, { signal: controller.signal }) : undefined,
        bootstrap ? getBootstrap() : undefined
      ]);
      if (!current()) return;
      if (action === 'reports') state.report = response;
      render(response);
    } catch (error) {
      if (current()) {
        workspace.innerHTML = problem(error.message || 'The support workspace could not load.') + '<div class="sup-actions">' +
          (state.ticketId ? button('back', 'Back to tickets') : '') + button('refresh', 'Retry') + '</div>';
      }
    } finally {
      controller.abort();
      if (state.readController === controller) state.readController = null;
      if (state.version === run) busy(false);
    }
  }

  function open(page, slot, entered = false) {
    const session = UMAuth.user;
    if (!session?.id) return;
    const view = page.replace(/^support-/, '');
    if (updateSession(session)) state.view = '';
    if (view === state.view && workspace.parentNode === slot &&
      (!entered || workspace.getAttribute('aria-busy') === 'true')) return;
    if (view !== state.view) {
      Object.assign(state, { view, filters: {}, page: 1, ticketId: '', report: null, reportExport: null, notice: '' });
    }
    slot.replaceChildren(workspace);
    return renderCurrent();
  }

  function goToTicket(ticketId, focus = true) {
    if (!ticketId) return;
    state.ticketId = ticketId;
    state.notice = '';
    state.focusDetail = focus;
    if (focus) document.getElementById('workspaceMain').scrollTop = 0;
    return renderCurrent();
  }

  function showList() {
    state.ticketId = '';
    state.notice = '';
    return renderCurrent();
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function downloadAttachment(attachmentId) {
    const response = await api('download', { ticketId: state.ticketId, attachmentId });
    const attachment = response.attachment;
    const bytes = Uint8Array.from(atob(attachment.data ?? attachment.base64), char => char.charCodeAt(0));
    saveBlob(new Blob([bytes], { type: 'application/octet-stream' }), attachment.name || 'attachment');
  }

  function reportExportRows(report) {
    const columns = ['Event', 'Event timestamp (ISO 8601)', 'Ticket ID', 'Category', 'Priority', 'Status', 'Employee ID', 'Department',
      'Working age (minutes)', 'Escalation level', 'First response (working minutes)', 'Resolution (working minutes)', 'Reopened count'];
    const rows = [columns];
    const labels = { received: 'Received', resolved: 'Resolved', closed: 'Closed', assignments: 'Assigned', escalations: 'Escalated' };
    for (const [kind, label] of Object.entries(labels)) {
      for (const event of report.reportEvents?.[kind] || []) {
        rows.push([label, event.date, event.ticket_id, event.category, event.priority, event.status, event.employee_id, event.department, '', event.escalation_level, '', '', '']);
      }
    }
    for (const ticket of report.tickets || []) {
      rows.push(['Ticket snapshot', '', ticket.ticket_id, ticket.category_name || ticket.category, ticket.priority,
        ticket.status, ticket.assigned_employee_id, ticket.department, ticket.pending_age_minutes ?? '', ticket.escalation_level ?? '',
        ticket.first_response_at ? ticket.first_response_elapsed_minutes : '', ticket.resolved_at ? ticket.resolution_elapsed_minutes : '', ticket.reopened_count]);
    }
    return rows.map(row => row.map(cell => typeof cell === 'number' ? cell : String(cell ?? '')));
  }

  function csvRow(row) {
    return row.map(cell => {
      if (typeof cell === 'number') return String(cell);
      const safe = /^[\s\uFEFF]*[=+\-@]|^[\t\n\r]/.test(cell) ? "'" + cell : cell;
      return '"' + safe.replaceAll('"', '""') + '"';
    }).join(',');
  }

  function excelFile(rows, filename) {
    return new Promise((resolve, reject) => {
      const worker = new Worker('./lead-import-worker.js');
      const timer = setTimeout(() => finish(new Error('Excel export took too long. Narrow the report filters and retry.')), 25000);
      function finish(error, buffer) {
        clearTimeout(timer);
        worker.terminate();
        if (error) return reject(error);
        saveBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
        resolve();
      }
      worker.onerror = () => finish(new Error('Could not generate the Excel workbook.'));
      worker.onmessage = ({ data }) => data.ok ? finish(null, data.buffer) : finish(new Error(data.message || 'Could not generate the Excel workbook.'));
      worker.postMessage({ op: 'write', rows, sheetName: 'Support activity' });
    });
  }

  async function exportReport(format) {
    const report = state.report;
    const session = state.session;
    if (!report || UMAuth.user !== session) return;
    if (!report.reportEvents && !report.tickets && !state.reportExport) {
      const pending = api('reports', { filters: state.filters }).catch(error => {
        if (state.reportExport === pending) state.reportExport = null;
        throw error;
      });
      state.reportExport = pending;
    }
    const fullReport = report.reportEvents || report.tickets ? report : await state.reportExport;
    if (UMAuth.user !== session || state.report !== report) return;
    const rows = reportExportRows(fullReport);
    if (rows.length === 1) throw new Error('No matching support activity to export.');
    const filename = 'UM-support-' + isoDay.format(new Date());
    if (format === 'excel') {
      await excelFile(rows, filename + '.xlsx');
    } else {
      saveBlob(new Blob(['\uFEFF', rows.map(csvRow).join('\r\n')], { type: 'text/csv;charset=utf-8' }), filename + '.csv');
    }
  }

  function readAttachment(file) {
    if (!file || !file.name) return Promise.resolve('');
    if (!file.size || file.size > maxFileBytes) return Promise.reject(new Error('Choose a non-empty file up to 240 KB.'));
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('The attachment could not be read.'));
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.readAsDataURL(file);
    });
  }

  const attempts = new WeakMap();
  function getAttempt(form, values) {
    const signature = JSON.stringify(values);
    const last = attempts.get(form);
    if (last?.signature === signature) return last;
    const attempt = { signature, requestId: id(), uploadId: id() };
    attempts.set(form, attempt);
    return attempt;
  }
  workspace.addEventListener('change', event => {
    const element = event.target;
    if (element.type === 'file' && element.form) attempts.delete(element.form);
    if (element.name === 'decision') element.form.elements.remarks.required = element.value === 'reject';
  });

  async function mutation(form) {
    const values = data(form);
    const { attachment } = values;
    delete values.attachment;
    const action = form.dataset.supForm;
    if (action === 'setting') {
      const payload = settingsPayload(form, values);
      return api('saveSetting', { ...payload, requestId: getAttempt(form, payload).requestId });
    }
    const attempt = getAttempt(form, values);
    const requestId = attempt.requestId;
    if (action === 'create') return api('create', { ...values, requestId });
    const ticketId = state.ticketId;
    if (action === 'review') {
      values.approve = values.decision === 'approve';
      delete values.decision;
    }
    if (action === 'assign' && !values.employeeId) delete values.employeeId;
    if (['reply', 'note', 'attachment-note'].includes(action)) {
      const encoded = await readAttachment(attachment);
      values.attachments = [];
      if (encoded) {
        const payload = { ticketId, requestId: attempt.uploadId, name: attachment.name,
          mimeType: attachment.type || 'application/octet-stream', data: encoded };
        const result = await api('upload', payload);
        values.attachments.push(result.attachment.id);
      }
      if (action === 'attachment-note') values.body = 'Internal attachment';
    }
    return api(action === 'attachment-note' ? 'note' : action, { ...values, ticketId, requestId });
  }

  function noteSubmission(action, response) {
    if (action === 'create') return 'Ticket ' + response.ticket.ticket_id + ' created.';
    if (action === 'reply') return 'Customer reply queued.';
    if (action === 'review') return 'Closure decision recorded.';
    if (action === 'setting') return 'Support settings saved.';
    if (action === 'resolve') return 'Resolution submitted for manager review.';
    return 'Ticket updated.';
  }

  workspace.addEventListener('submit', async event => {
    const form = event.target.closest('[data-sup-form]');
    if (!form) return;
    event.preventDefault();
    if (form.dataset.supForm === 'filter') {
      const filters = data(form);
      if (filters.from && filters.to && filters.to < filters.from) {
        form.elements.to.setCustomValidity('Choose an end date on or after the start date.');
        form.reportValidity();
        form.elements.to.setCustomValidity('');
        return;
      }
      state.page = 1;
      state.notice = '';
      state.filters = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ''));
      return renderCurrent();
    }
    if (form.dataset.busy) return;
    form.dataset.busy = '1';
    const run = state.version;
    const session = UMAuth.user;
    const action = form.dataset.supForm;
    const trigger = event.submitter || form.querySelector('[type="submit"]');
    const resultBox = form.querySelector('[data-sup-form-result]');
    if (trigger) trigger.disabled = true;
    resultBox.innerHTML = loading('Saving…');
    try {
      const response = await mutation(form);
      if (UMAuth.user !== session) return;
      if (action === 'setting') resetBootstrap();
      if (state.version !== run) return;
      state.notice = noteSubmission(action, response);
      if (action === 'create' && canOpenTicket(response.ticket)) {
        state.ticketId = response.ticket.ticket_id;
        state.focusDetail = true;
      }
      return await renderCurrent();
    } catch (error) {
      if (state.version === run && UMAuth.user === session) resultBox.innerHTML = problem(error.message || 'The changes could not be saved.');
    } finally {
      delete form.dataset.busy;
      if (trigger) trigger.disabled = false;
    }
  });

  workspace.addEventListener('click', async event => {
    const trigger = event.target.closest('[data-sup-action]');
    if (!trigger || trigger.disabled) return;
    const action = trigger.dataset.supAction;
    if (action === 'ticket') return goToTicket(trigger.dataset.ticketId);
    if (action === 'back') return showList();
    if (action === 'previous' || action === 'next') {
      state.page = Math.max(1, state.page + (action === 'next' ? 1 : -1));
      return renderCurrent();
    }
    if (action === 'reset' || action === 'refresh') {
      if (action === 'reset') {
        state.filters = {};
        state.page = 1;
      }
      state.notice = '';
      if (action === 'refresh' && !state.ticketId) resetBootstrap();
      return renderCurrent();
    }
    trigger.disabled = true;
    const resultBox = get('[data-sup-report-result]');
    try {
      if (action === 'download') await downloadAttachment(trigger.dataset.attachmentId);
      if (action === 'csv' || action === 'excel') {
        resultBox.innerHTML = loading('Preparing export…');
        await exportReport(action);
        resultBox.textContent = '';
      }
    } catch (error) {
      if (resultBox) resultBox.innerHTML = problem(error.message);
      else showToast(error.message || 'The attachment could not be downloaded.', 'error');
    } finally {
      trigger.disabled = false;
    }
  });

  window.UMSupportWorkspace = { open };
})();
