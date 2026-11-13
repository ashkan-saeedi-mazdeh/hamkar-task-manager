const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const faNumbers = new Intl.NumberFormat('fa-IR');
const faDates = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium' });
const faTimes = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' });
const faNumber = value => faNumbers.format(value);
const date = value => value ? faDates.format(new Date(value.length === 10 ? `${value}T12:00:00` : value)) : 'بدون مهلت';
const time = value => faTimes.format(new Date(value));
const states = { new: 'آماده شروع', in_progress: 'در حال انجام', in_review: 'در انتظار بازبینی', changes_requested: 'نیازمند اصلاح', done: 'تکمیل‌شده' };
const actions = { created: 'کار را ایجاد کرد', edited: 'اطلاعات کار را ویرایش کرد', start: 'کار را شروع کرد', submit: 'نتیجه را برای بازبینی فرستاد', request_changes: 'درخواست اصلاح ثبت کرد', approve: 'کار را تایید کرد' };
const views = { dashboard: 'نمای کلی', mine: 'کارهای من', review: 'بازبینی‌های من', created: 'ساخته‌های من', all: 'همه کارها', users: 'اعضای تیم' };
const emptyFilter = () => ({ search: '', status: '', assignee: '', reviewer: '' });
const state = { user: null, csrf: '', tasks: [], users: [], directory: [], people: new Map(), view: 'dashboard', filter: emptyFilter(), detail: null };
const pendingStarts = new Set();
const paths = {
  mark: 'M4 7h9M4 12h6M4 17h4m6-1 3 3 5-7',
  dashboard: 'M4 4h6v7H4zm10 0h6v4h-6zM4 15h6v5H4zm10-3h6v8h-6z',
  mine: 'M8 4h8m-8 0v3h8V4m-8 1H5v15h14V5h-3m-7 9 2 2 4-5',
  review: 'M3 12s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6zm11.5 0a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  created: 'M6 3h8l4 4v14H6zm8 0v5h4M9 12h6m-6 4h6',
  all: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  users: 'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m16 0v-2a4 4 0 0 0-3-4m-3-7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zm3-4a4 4 0 0 1 0 8',
  plus: 'M12 5v14M5 12h14', refresh: 'M20 11a8 8 0 1 0-2 6m2-12v6h-6',
  back: 'M4 12h15m-6-6 6 6-6 6', next: 'M20 12H5m6-6-6 6 6 6',
  search: 'M15.5 15.5 21 21m-3.5-10.5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z',
  filters: 'M4 6h16M7 12h10m-7 6h4', menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'm6 6 12 12M18 6 6 18', check: 'm5 12 4 4L19 6',
  revise: 'M9 7H4V2m0 5h9a6 6 0 0 1 0 12h-2',
  calendar: 'M4 6h16v14H4zm0 4h16M8 4v4m8-4v4',
  start: 'm8 5 11 7-11 7z', send: 'm21 3-7 18-3-8-8-3zm0 0L11 13',
  clock: 'M12 8v5l3 2m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  edit: 'm13 6 5 5M4 20l5-1L21 7l-5-5L4 14z', account: 'M4 20h16M5 15h14M7 10h10M9 5h6',
  lock: 'M6 11h12v9H6zm3 0V8a3 3 0 0 1 6 0v3',
  flag: 'M5 21V4m0 1c4-4 8 4 14 0v9c-6 4-10-4-14 0'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
let toastTimer;
let loadGeneration = 0;
let routeGeneration = 0;
let taskAccessGeneration = 0;
function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5000);
}
async function api(path, { method = 'GET', body } = {}) {
  const owner = state.user;
  const csrf = state.csrf;
  let response;
  try {
    response = await fetch(`/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'TaskManager', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  } catch { throw new Error('ارتباط با سرور برقرار نشد. اتصال را بررسی کنید و دوباره تلاش کنید.'); }
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || 'درخواست انجام نشد.'); error.status = response.status;
    if (response.status === 401 && owner && state.user === owner && state.csrf === csrf) {
      clearSession(); await initialize(); toast('نشست پایان یافته است. دوباره وارد شوید.');
    }
    throw error;
  }
  return result;
}
function userName(id) { return state.people.get(id) || 'کاربر'; }
function initials(name) { return escapeHtml((name || '').split(/\s+/).slice(0, 2).map(v => [...v][0]).join('')); }
function avatar(name) { return `<span class="avatar" aria-hidden="true">${initials(name)}</span>`; }
function person(id) { const name = userName(id); return `<span class="person">${avatar(name)}<span>${escapeHtml(name)}</span></span>`; }
function badge(status) { return `<span class="badge ${status}">${states[status]}</span>`; }
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function overdue(task) { return task.due_date && task.status !== 'done' && task.due_date < today(); }
function brand(extra = '') { return `<div class="brand ${extra}" translate="no"><span class="brand-mark">${icon('mark')}</span><span>همکار</span></div>`; }
function showError(container, message) {
  let error = container.querySelector('.error');
  if (!error) { error = document.createElement('div'); error.className = 'error'; error.setAttribute('role', 'alert'); error.tabIndex = -1; container.prepend(error); }
  error.textContent = message;
  error.focus();
}
function formValues(form) { return Object.fromEntries(new FormData(form)); }
async function submitForm(form, callback) {
  if (form.getAttribute('aria-busy') === 'true') return;
  const buttons = [...form.querySelectorAll('button[type=submit]')];
  form.setAttribute('aria-busy', 'true');
  buttons.forEach(button => { button.disabled = true; });
  form.querySelector('.error')?.remove();
  try { await callback(formValues(form)); }
  catch (error) { if (form.isConnected) showError(form, error.message); }
  finally { form.removeAttribute('aria-busy'); buttons.forEach(button => { button.disabled = false; }); }
}
function renderAuth(setup, canSetup) {
  $('#app').innerHTML = `<main id="main" class="auth-page"><section class="auth-story">${brand()}<div class="auth-intro"><p class="auth-headline">از شروع کار<br>تا تایید نتیجه</p><p>مسئول هر کار، قدم بعدی و بازخورد همکاران، همه در یک مسیر روشن.</p><ol class="steps"><li>${icon('start')}<span>انجام کار</span></li><li>${icon('review')}<span>بازبینی</span></li><li>${icon('check')}<span>تایید نتیجه</span></li></ol></div><p class="auth-caption">مدیریت کارهای تیم</p></section><section class="auth-form-wrap"><div class="auth-form">${brand('auth-mobile-brand')}<h1>${setup ? 'حساب مدیر سیستم' : 'ورود به همکار'}</h1><p>${setup ? 'حساب خود را بسازید؛ سپس همکاران را به فضای کار اضافه کنید.' : 'برای دیدن کارها و بازبینی‌ها وارد حساب خود شوید.'}</p>${setup && !canSetup ? '<div class="notice">راه‌اندازی اولیه را با دستور راه‌اندازی روی سرور انجام دهید.</div>' : `<form id="auth-form">${setup ? '<div class="field"><label for="name">نام و نام خانوادگی</label><input id="name" name="name" autocomplete="name" required maxlength="100"></div>' : ''}<div class="field"><label for="username">نام کاربری</label><input class="ltr" id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required minlength="3" maxlength="64" pattern="[a-zA-Z0-9][a-zA-Z0-9._\\-]+" placeholder="your.name"></div><div class="field"><label for="password">رمز عبور</label><input class="ltr" id="password" name="password" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" required ${setup ? 'minlength="12"' : ''} maxlength="128">${setup ? '<small>حداقل ۱۲ نویسه؛ از یک عبارت طولانی استفاده کنید.</small>' : ''}</div><button type="submit" class="primary">${setup ? 'ساخت حساب و ورود' : 'ورود به فضای کار'}${icon('next')}</button></form>`}<div class="auth-foot">${setup ? 'حساب همکاران را مدیر سیستم ایجاد می‌کند.' : 'برای دریافت حساب یا بازیابی رمز با مدیر سیستم تماس بگیرید.'}</div></div></section></main>`;
  $('#auth-form')?.addEventListener('submit', event => {
    event.preventDefault(); submitForm(event.currentTarget, async values => {
      const result = await api(setup ? '/setup' : '/login', { method: 'POST', body: values });
      state.user = result.user; state.csrf = result.csrf;
      if (!location.hash) history.replaceState(null, '', '#dashboard');
      await loadWorkspace();
    });
  });
}
async function initialize() {
  try {
    const result = await api('/session');
    state.user = result.user; state.csrf = result.csrf || '';
    if (!state.user) renderAuth(result.setupRequired, result.canSetup);
    else await loadWorkspace();
  } catch (error) {
    $('#app').innerHTML = '<main id="main" class="empty"><h1>ارتباط برقرار نشد</h1><p id="initial-error"></p><button id="retry">تلاش دوباره</button></main>';
    $('#initial-error').textContent = error.message; $('#retry').onclick = initialize;
  }
}
async function loadWorkspace() {
  const generation = ++loadGeneration;
  const owner = state.user;
  const [taskResult, userResult] = await Promise.all([api('/tasks'), api('/users')]);
  if (generation !== loadGeneration || !owner || state.user !== owner) return;
  state.tasks = taskResult.tasks; state.users = userResult.users; state.directory = userResult.directory;
  state.people = new Map(state.directory.map(user => [user.id, user.name]));
  ++taskAccessGeneration;
  await route();
}
function renderShell() {
  const pending = state.tasks.filter(task => task.reviewer_id === state.user.id && task.status === 'in_review').length;
  const nav = key => `<a href="#${key}" data-view="${key}" ${state.view === key ? 'aria-current="page"' : ''}>${icon(key)}<span>${views[key]}</span>${key === 'review' ? `<span class="count" id="review-count" ${pending ? '' : 'hidden'}>${faNumber(pending)}</span>` : ''}</a>`;
  $('#app').innerHTML = `<div class="shell"><aside id="sidebar" class="sidebar" aria-label="منوی اصلی"><div class="sidebar-head">${brand()}<button id="nav-close" class="mobile-menu icon-button ghost" aria-label="بستن منو">${icon('close')}</button></div><nav class="nav" aria-label="فضای کار"><div class="nav-label">فضای کار</div>${['dashboard', 'mine', 'review', 'created', 'all'].map(nav).join('')}${state.user.admin ? `<div class="nav-label nav-separator">مدیریت</div>${nav('users')}` : ''}</nav><button class="profile" id="account" aria-label="تنظیمات حساب">${avatar(state.user.name)}<span class="profile-copy"><strong>${escapeHtml(state.user.name)}</strong><small>${state.user.admin ? 'مدیر سیستم' : 'عضو تیم'}</small></span>${icon('account')}</button></aside><div class="sidebar-scrim" aria-hidden="true"></div><div class="content"><header class="topbar"><button class="mobile-menu icon-button" id="menu" aria-label="باز کردن منو" aria-controls="sidebar" aria-expanded="false">${icon('menu')}</button><div class="crumb"><span>فضای کار</span><span aria-hidden="true">/</span><strong>${views[state.view] || 'جزئیات کار'}</strong></div><div class="topbar-meta">${icon('calendar')}<span>${date(new Date().toISOString())}</span></div></header><main id="main" class="page" tabindex="-1"></main></div></div>`;
  document.querySelectorAll('[data-view]').forEach(link => link.onclick = event => {
    if (plainClick(event) && (location.hash.split('?')[0] || '#dashboard') === link.hash) { event.preventDefault(); closeSidebar(); }
  });
  syncSidebar();
  $('#menu').onclick = () => { const open = $('.sidebar').classList.toggle('open'); syncSidebar(); if (open) $('#nav-close').focus(); };
  $('#nav-close').onclick = closeSidebar;
  $('.sidebar-scrim').onclick = closeSidebar;
  $('#account').onclick = accountModal;
}
function syncSidebar() {
  const sidebar = $('.sidebar');
  if (!sidebar) return;
  const mobile = matchMedia('(max-width:760px)').matches;
  if (!mobile) sidebar.classList.remove('open');
  const open = sidebar.classList.contains('open');
  const hidden = mobile && !open;
  sidebar.inert = hidden;
  sidebar.setAttribute('aria-hidden', String(hidden));
  $('.content').inert = open;
  $('.sidebar-scrim').classList.toggle('open', open);
  $('#menu').setAttribute('aria-expanded', String(open));
}
function closeSidebar() {
  const sidebar = $('.sidebar');
  if (!sidebar?.classList.contains('open')) return;
  sidebar.classList.remove('open');
  syncSidebar();
  $('#menu').focus();
}
const plainClick = event => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
const listViews = ['dashboard', 'mine', 'review', 'created', 'all'];
function listHash(view, filter = {}) {
  const params = new URLSearchParams();
  for (const key of Object.keys(emptyFilter())) if (filter[key]) params.set(key, filter[key]);
  return `#${view}${params.size ? `?${params}` : ''}`;
}
function returnHash() {
  const hash = history.state?.returnTo;
  return typeof hash === 'string' && listViews.includes(hash.slice(1).split('?')[0]) ? hash : '#dashboard';
}
function bindBack() {
  $('#back')?.addEventListener('click', event => {
    if (!plainClick(event) || !history.state?.returnTo) return;
    event.preventDefault(); history.back();
  });
}
function openTaskLink(event) {
  if (!plainClick(event)) return;
  event.preventDefault();
  const link = event.currentTarget;
  const returnTo = location.hash || '#dashboard';
  history.replaceState({ ...history.state, focusTask: link.dataset.task, scrollY: window.scrollY }, '', returnTo);
  history.pushState({ returnTo }, '', link.hash);
  window.scrollTo(0, 0);
  route(null, true);
}
async function route(savedTask = null, focus = false) {
  if (!state.user) return;
  const generation = ++routeGeneration;
  const owner = state.user;
  const hash = location.hash.slice(1) || 'dashboard';
  const current = () => generation === routeGeneration && (location.hash.slice(1) || 'dashboard') === hash && state.user === owner;
  if (hash.startsWith('task/')) {
    const id = hash.slice(5);
    state.view = 'detail'; renderShell();
    $('#main').innerHTML = '<div class="detail-loading" role="status"><span class="sr-only">در حال دریافت کار...</span><div></div><div></div></div>';
    try {
      const detail = savedTask?.id === id ? savedTask : await api(`/tasks/${encodeURIComponent(id)}`);
      if (!current()) return;
      rememberTask(detail);
      state.detail = detail;
      syncTaskCounts();
      renderDetail();
      if (focus) $('#detail-title').focus();
    }
    catch (error) {
      if (!current()) return;
      state.detail = null;
      if (error.status === 404) {
        state.tasks = state.tasks.filter(task => task.id !== id);
        ++loadGeneration;
        ++taskAccessGeneration;
        renderShell();
      }
      $('#main').innerHTML = `<div class="empty"><h1>دریافت کار ممکن نشد</h1><p id="detail-error"></p><a class="button" id="back" href="${escapeHtml(returnHash())}">بازگشت به کارها</a></div>`;
      $('#detail-error').textContent = error.message;
      bindBack();
    }
    return;
  }
  const [view, params] = hash.split('?', 2);
  state.view = Object.hasOwn(views, view) && (view !== 'users' || state.user.admin) ? view : 'dashboard'; state.detail = null;
  const query = new URLSearchParams(params);
  state.filter = emptyFilter();
  for (const key of Object.keys(state.filter)) state.filter[key] = query.get(key) || '';
  if (!Object.hasOwn(states, state.filter.status) && !(state.view === 'mine' && state.filter.status === 'open')) state.filter.status = '';
  if (state.view === 'review') state.filter.status = '';
  renderShell(); if (state.view === 'users') renderUsers(); else renderList();
  if (focus) {
    const task = history.state?.focusTask;
    const link = task && [...document.querySelectorAll('.task-link')].find(node => node.dataset.task === task && node.getClientRects().length);
    (link || $('#main')).focus({ preventScroll: true });
    window.scrollTo(0, history.state?.scrollY || 0);
  }
}
function headingActions() {
  return `<div class="heading-actions"><button id="refresh" class="icon-button" aria-label="تازه‌سازی اطلاعات" title="تازه‌سازی اطلاعات">${icon('refresh')}</button><button id="new-task" class="primary" aria-label="کار جدید" aria-keyshortcuts="Alt+N">${icon('plus')}<span>کار جدید</span></button></div>`;
}
function pageHeading(title, subtitle) {
  return `<div class="page-heading"><div><h1>${escapeHtml(title)}</h1><p>${subtitle}</p></div>${headingActions()}</div>`;
}
function bindHeading() {
  $('#new-task')?.addEventListener('click', () => taskModal());
  $('#refresh')?.addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    try { await loadWorkspace(); toast('اطلاعات به‌روز شد.'); }
    catch (error) { if (state.user) toast(error.message); $('#refresh') && ($('#refresh').disabled = false); }
  });
}
function optionUsers(selected = '', empty = 'همه افراد', includeInactive = false) {
  return `<option value="">${empty}</option>${(includeInactive ? state.directory : state.users.filter(user => user.active)).map(user => `<option value="${user.id}" ${selected === user.id ? 'selected' : ''}>${escapeHtml(user.name)}</option>`).join('')}`;
}
function summaryStats() {
  const mine = state.tasks.filter(task => task.assignee_id === state.user.id);
  return [
    ['mine', 'open', 'کارهای باز من', mine.filter(task => task.status !== 'done').length, 'mine'],
    ['review', '', 'منتظر بازبینی من', state.tasks.filter(task => task.reviewer_id === state.user.id && task.status === 'in_review').length, 'review'],
    ['mine', 'changes_requested', 'نیازمند اصلاح', mine.filter(task => task.status === 'changes_requested').length, 'revise'],
    ['mine', 'done', 'تکمیل‌شده', mine.filter(task => task.status === 'done').length, 'check']
  ].map(([view, status, label, count, symbol]) => `<a class="stat stat-${symbol}" href="${listHash(view, { status })}"><span class="stat-icon">${icon(symbol)}</span><span>${label}</span><strong>${faNumber(count)}</strong></a>`).join('');
}
function syncTaskCounts() {
  const count = $('#review-count');
  if (count) {
    const pending = state.tasks.filter(task => task.reviewer_id === state.user.id && task.status === 'in_review').length;
    count.hidden = !pending; count.textContent = faNumber(pending);
  }
  if ($('.stats')) $('.stats').innerHTML = summaryStats();
}
function normalizedTitle(value) {
  return value.toLocaleLowerCase('fa').replaceAll('ي', 'ی').replaceAll('ك', 'ک').replace(/[\u200c\s]+/gu, ' ').trim();
}
const listLabels = { dashboard: 'کارهای اخیر و اقدام‌هایی که به شما مربوط‌اند.', mine: 'کارهایی که انجامشان با شماست.', review: 'نتیجه‌هایی که برای تصمیم شما فرستاده شده‌اند.', created: 'کارهایی که برای خودتان یا همکاران ساخته‌اید.', all: 'کارهایی که اجازه دیدنشان را دارید.' };
let renderFrame = 0;
let visibleTasks = 50;
function updateFilters() {
  history.replaceState(null, '', listHash(state.view, state.filter));
  visibleTasks = 50;
  cancelAnimationFrame(renderFrame);
  renderFrame = requestAnimationFrame(() => { if ($('#task-results')) renderTaskResults(); });
}
function renderList() {
  const dashboard = state.view === 'dashboard';
  const statuses = { ...(state.view === 'mine' ? { open: 'کارهای باز' } : {}), ...states };
  const filtersOpen = state.filter.assignee || state.filter.reviewer || state.filter.status;
  visibleTasks = history.state?.visibleTasks || 50;
  $('#main').innerHTML = `${pageHeading(views[state.view], listLabels[state.view])}${dashboard ? `<section class="stats" aria-label="وضعیت کارهای شما">${summaryStats()}</section>` : ''}${state.users.filter(user => user.active).length < 2 ? `<div class="notice">برای ساخت کار، دست‌کم دو حساب فعال لازم است. ${state.user.admin ? '<a href="#users">افزودن همکار</a>' : 'از مدیر سیستم بخواهید یک حساب دیگر اضافه کند.'}</div>` : ''}<section class="panel" aria-label="فهرست کارها"><div class="list-head"><h2>${dashboard ? 'تابلوی کار' : 'فهرست کارها'}</h2><p id="result-count" aria-live="polite"></p></div><div class="filters"><div class="search-field">${icon('search')}<input id="search" name="search" type="search" maxlength="200" autocomplete="off" aria-label="جست‌وجوی عنوان کار" aria-keyshortcuts="Alt+F" placeholder="جست‌وجوی عنوان کار..." value="${escapeHtml(state.filter.search)}"><kbd class="search-shortcut" aria-hidden="true" dir="ltr">Alt+F</kbd></div><button id="toggle-filters" aria-expanded="${Boolean(filtersOpen)}" aria-controls="filter-options">${icon('filters')}فیلترها<span id="filter-count" class="count" hidden></span></button></div><div id="filter-options" class="filter-options" ${filtersOpen ? '' : 'hidden'}>${state.view === 'review' ? '' : `<div><label for="status-filter">وضعیت</label><select id="status-filter" name="status" aria-label="فیلتر وضعیت"><option value="">همه وضعیت‌ها</option>${Object.entries(statuses).map(([key, label]) => `<option value="${key}" ${state.filter.status === key ? 'selected' : ''}>${label}</option>`).join('')}</select></div>`}<div><label for="assignee-filter">انجام‌دهنده</label><select id="assignee-filter" name="assignee" aria-label="فیلتر انجام‌دهنده">${optionUsers(state.filter.assignee, 'همه انجام‌دهنده‌ها', true)}</select></div><div><label for="reviewer-filter">مدیر پیگیری</label><select id="reviewer-filter" name="reviewer" aria-label="فیلتر مدیر پیگیری">${optionUsers(state.filter.reviewer, 'همه مدیران پیگیری', true)}</select></div><button id="clear-filters" class="ghost">پاک کردن فیلترها</button></div><div id="task-results"></div></section>`;
  bindHeading();
  $('#search').oninput = event => { state.filter.search = event.target.value; updateFilters(); };
  for (const select of document.querySelectorAll('#filter-options select')) select.onchange = event => { state.filter[select.name] = event.target.value; updateFilters(); };
  $('#toggle-filters').onclick = event => {
    const expanded = $('#filter-options').hidden;
    $('#filter-options').hidden = !expanded;
    event.currentTarget.setAttribute('aria-expanded', String(expanded));
  };
  $('#clear-filters').onclick = () => {
    state.filter = { ...emptyFilter(), search: state.filter.search };
    for (const select of document.querySelectorAll('#filter-options select')) select.value = '';
    updateFilters(); $('#toggle-filters').focus();
  };
  renderTaskResults();
}
function nextAction(task) {
  if (task.assignee_id === state.user.id) {
    if (task.status === 'new') return ['start', 'شروع کار', 'start'];
    if (task.status === 'in_progress') return ['submit', 'ارسال نتیجه', 'send'];
    if (task.status === 'changes_requested') return ['revise', 'دیدن دلیل اصلاح', 'revise'];
  }
  if (task.reviewer_id === state.user.id && task.status === 'in_review') return ['review', 'بازبینی نتیجه', 'review'];
  return null;
}
function renderTaskResults() {
  const scope = state.view;
  const { search, status, assignee, reviewer } = state.filter;
  const term = normalizedTitle(search);
  const filterCount = [status, assignee, reviewer].filter(Boolean).length;
  const tasks = state.tasks.filter(task => {
    if (scope === 'mine' && task.assignee_id !== state.user.id) return false;
    if (scope === 'created' && task.creator_id !== state.user.id) return false;
    if (scope === 'review' && (task.reviewer_id !== state.user.id || task.status !== 'in_review')) return false;
    return (!term || normalizedTitle(task.title).includes(term)) && (!status || (status === 'open' ? task.status !== 'done' : task.status === status)) && (!assignee || task.assignee_id === assignee) && (!reviewer || task.reviewer_id === reviewer);
  });
  if (scope === 'dashboard') tasks.sort((a, b) => Number(Boolean(nextAction(b))) - Number(Boolean(nextAction(a))));
  $('#filter-count').hidden = !filterCount; $('#filter-count').textContent = faNumber(filterCount);
  $('#result-count').textContent = `${faNumber(tasks.length)} کار`;
  if (!tasks.length) {
    const filtered = term || filterCount;
    $('#task-results').innerHTML = `<div class="empty"><span class="empty-mark">${icon(filtered ? 'search' : scope === 'review' ? 'review' : 'mine')}</span><h3>در این فهرست کاری نیست</h3><p>${filtered ? 'جست‌وجو یا فیلترها را تغییر دهید.' : scope === 'review' ? 'نتیجه‌ای منتظر بازبینی شما نیست.' : 'کارهای مرتبط با شما اینجا نمایش داده می‌شوند.'}</p>${filtered ? '<button id="reset-list">پاک کردن جست‌وجو و فیلترها</button>' : scope === 'review' ? '' : '<button id="empty-create">ساخت کار</button>'}</div>`;
    $('#empty-create')?.addEventListener('click', () => taskModal());
    $('#reset-list')?.addEventListener('click', () => { $('#search').value = ''; state.filter.search = ''; $('#clear-filters').click(); $('#search').focus(); });
    return;
  }
  const rows = tasks.slice(0, visibleTasks);
  const due = task => `<span class="due ${overdue(task) ? 'overdue' : 'muted'}">${date(task.due_date)}${overdue(task) ? '<small>مهلت گذشته</small>' : ''}</span>`;
  const link = task => `<a class="task-link" href="#task/${task.id}" data-task="${task.id}"><bdi>${escapeHtml(task.title)}</bdi></a>`;
  const action = task => {
    const next = nextAction(task);
    if (!next) return '';
    const [name, label, symbol] = next;
    if (name === 'review' || name === 'revise') return `<a class="row-action button" href="#task/${task.id}" data-task="${task.id}">${icon(symbol)}${label}</a>`;
    const busy = name === 'start' && pendingStarts.has(task.id);
    return `<button class="row-action" data-quick="${name}" data-task-id="${task.id}" ${busy ? 'disabled aria-busy="true"' : ''}>${icon(symbol)}${label}</button>`;
  };
  $('#task-results').innerHTML = `<div class="table-scroll"><table><thead><tr><th scope="col">عنوان کار</th><th scope="col">وضعیت</th><th scope="col">انجام‌دهنده</th><th scope="col">مدیر پیگیری</th><th scope="col">مهلت انجام</th><th scope="col">قدم بعدی</th></tr></thead><tbody>${rows.map(task => `<tr><td>${link(task)}</td><td>${badge(task.status)}</td><td>${person(task.assignee_id)}</td><td>${person(task.reviewer_id)}</td><td>${due(task)}</td><td>${action(task)}</td></tr>`).join('')}</tbody></table></div><div class="mobile-cards">${rows.map(task => `<article class="mobile-card"><div class="mobile-card-head">${link(task)}${badge(task.status)}</div><div class="mobile-card-meta"><span>${person(task.assignee_id)}</span><span>${icon('calendar')}${due(task)}</span></div><div class="mobile-card-footer"><span>پیگیری: <bdi>${escapeHtml(userName(task.reviewer_id))}</bdi></span>${action(task)}</div></article>`).join('')}</div>${rows.length < tasks.length ? '<div class="list-footer"><button id="show-more">نمایش کارهای بیشتر</button></div>' : ''}`;
  document.querySelectorAll('a[data-task]').forEach(anchor => anchor.onclick = openTaskLink);
  document.querySelectorAll('[data-quick]').forEach(button => button.onclick = () => {
    const task = state.tasks.find(row => row.id === button.dataset.taskId);
    if (!task || nextAction(task)?.[0] !== button.dataset.quick) return;
    if (button.dataset.quick === 'start') quickStart(task, button); else actionModal(task, 'submit', true);
  });
  $('#show-more')?.addEventListener('click', () => {
    const first = rows.length;
    visibleTasks += 50;
    history.replaceState({ ...history.state, visibleTasks }, '');
    renderTaskResults();
    const link = [...document.querySelectorAll('.task-link')].find(node => node.dataset.task === tasks[first].id && node.getClientRects().length);
    link?.focus();
  });
}
function openModal(title, content, bind) {
  closeModal();
  const dialog = $('#modal');
  dialog.innerHTML = `<div class="modal-head"><h2 id="modal-title">${title}</h2><button id="modal-close" class="icon-button ghost" aria-label="بستن پنجره">${icon('close')}</button></div><div class="modal-body">${content}</div>`;
  $('#modal-close').onclick = closeModal;
  dialog.showModal();
  const first = dialog.querySelector('form input, form textarea, form select');
  if (first && !matchMedia('(pointer: coarse)').matches && innerWidth > 760) first.focus();
  bind?.();
}
function closeModal() { if ($('#modal').open) $('#modal').close(); $('#modal').innerHTML = ''; }
function clearSession() {
  closeModal();
  state.user = null; state.csrf = ''; state.tasks = []; state.users = []; state.directory = []; state.people.clear(); state.detail = null; pendingStarts.clear();
}
function rememberTask(detail) {
  const { events, ...summary } = detail;
  const newer = task => task?.id === summary.id && task.version > summary.version;
  if (newer(state.detail) || state.tasks.some(newer)) return false;
  state.tasks = [...state.tasks.filter(task => task.id !== summary.id), summary]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
  return true;
}
function taskSaveContext(form, existing, inList = false) {
  return { form, owner: state.user, existing, inList, accessGeneration: taskAccessGeneration, view: state.view };
}
function focusTaskRow(id, preferAction = false) {
  const candidates = [...document.querySelectorAll('[data-task], [data-task-id]')].filter(node =>
    (node.dataset.task || node.dataset.taskId) === id && node.getClientRects().length && !node.disabled);
  const action = preferAction && candidates.find(node => node.matches('.row-action'));
  (action || candidates[0] || $('#search'))?.focus({ preventScroll: true });
}
async function finishTaskSave({ form, owner, existing, accessGeneration, inList, view }, task, message) {
  if (state.user !== owner) return;
  // A later list or detail read may have shown that reassignment removed access.
  if (existing && accessGeneration !== taskAccessGeneration && !state.tasks.some(row => row.id === task.id)) return;
  if (!rememberTask(task)) return;
  ++loadGeneration;
  syncTaskCounts();
  const target = `#task/${task.id}`;
  if (inList) {
    const activeForm = form?.isConnected && $('#modal').open;
    const restoreFocus = activeForm || document.activeElement?.dataset.taskId === task.id;
    if (activeForm) closeModal();
    if (location.hash === target) await route(task);
    else if ($('#task-results')) {
      renderTaskResults();
      if (restoreFocus && view === state.view) focusTaskRow(task.id, true);
    }
  } else if (form?.isConnected && $('#modal').open) {
    closeModal();
    if (location.hash !== target) {
      const returnTo = listViews.includes(state.view) ? location.hash || '#dashboard' : null;
      history.pushState({ returnTo }, '', target);
      window.scrollTo(0, 0);
    }
    await route(task, true);
  } else if (location.hash === target) {
    await route(task);
  } else if ($('#task-results')) {
    renderTaskResults();
  }
  toast(message);
}
async function refreshListConflict(id, owner) {
  const generation = taskAccessGeneration;
  const current = () => state.user === owner && generation === taskAccessGeneration;
  let latest;
  try {
    latest = await api(`/tasks/${id}`);
    if (!current() || !rememberTask(latest)) return;
    ++loadGeneration;
  } catch (error) {
    if (!current() || error.status !== 404) return;
    state.tasks = state.tasks.filter(task => task.id !== id);
    ++loadGeneration;
    ++taskAccessGeneration;
  }
  syncTaskCounts();
  if (location.hash === `#task/${id}`) await route(latest);
  else if ($('#task-results')) renderTaskResults();
}
async function quickStart(task, button) {
  if (pendingStarts.has(task.id)) return;
  const save = taskSaveContext(null, true, true);
  pendingStarts.add(task.id);
  button.disabled = true; button.setAttribute('aria-busy', 'true');
  try {
    const result = await api(`/tasks/${task.id}/actions`, { method: 'POST', body: { action: 'start', note: '', version: task.version } });
    await finishTaskSave(save, result, 'کار شروع شد.');
    if (state.user === save.owner && !$('#modal').open && document.activeElement === document.body && state.view === save.view) focusTaskRow(task.id, true);
  } catch (error) {
    if (state.user !== save.owner) return;
    if ([404, 409].includes(error.status)) await refreshListConflict(task.id, save.owner);
    if (state.user === save.owner) toast(error.message);
  } finally {
    if (state.user === save.owner) {
      pendingStarts.delete(task.id);
      for (const control of document.querySelectorAll('[data-quick="start"]')) {
        if (control.dataset.taskId === task.id) { control.disabled = false; control.removeAttribute('aria-busy'); }
      }
    }
  }
}
function taskModal(task) {
  const editing = !!task;
  const users = state.users.filter(user => user.active);
  openModal(editing ? 'ویرایش اطلاعات کار' : 'کار جدید', `<form id="task-form" autocomplete="off"><div class="field"><label for="task-title">عنوان کار</label><input id="task-title" name="title" dir="auto" required maxlength="200" placeholder="مثلا: آماده‌سازی گزارش ماهانه" value="${escapeHtml(task?.title || '')}"></div><div class="field"><label for="description">توضیح کار و نتیجه مورد انتظار</label><textarea id="description" name="description" dir="auto" required maxlength="10000" placeholder="چه کاری باید انجام شود و نتیجه قابل قبول چیست؟">${escapeHtml(task?.description || '')}</textarea></div><div class="form-grid"><div class="field"><label for="assignee">انجام‌دهنده</label><select id="assignee" name="assignee_id" required>${optionUsers(task?.assignee_id, 'انتخاب انجام‌دهنده')}</select></div><div class="field"><label for="reviewer">مدیر پیگیری</label><select id="reviewer" name="reviewer_id" required>${optionUsers(task?.reviewer_id, 'انتخاب مدیر پیگیری')}</select></div><div class="field span-2"><label for="due-date">مهلت انجام (اختیاری)</label><input class="ltr" type="date" id="due-date" name="due_date" value="${escapeHtml(task?.due_date || '')}"><small>ورود تاریخ میلادی است؛ تاریخ‌ها در فهرست به تقویم فارسی نمایش داده می‌شوند.</small></div></div>${users.length < 2 ? '<div class="notice">ابتدا مدیر سیستم باید حداقل دو حساب فعال ایجاد کند.</div>' : ''}<div class="form-actions"><button type="button" id="cancel-task">انصراف</button><button type="submit" class="primary" ${users.length < 2 ? 'disabled' : ''}>${editing ? 'ذخیره تغییرات' : 'ایجاد کار'}</button></div></form>`, () => {
    $('#cancel-task').onclick = closeModal;
    $('#task-form').onsubmit = event => {
      event.preventDefault();
      const form = event.currentTarget;
      const save = taskSaveContext(form, editing);
      submitForm(form, async values => {
        if (values.assignee_id === values.reviewer_id) throw new Error('انجام‌دهنده و مدیر پیگیری باید متفاوت باشند.');
        try {
          const result = await api(task ? `/tasks/${task.id}` : '/tasks', { method: editing ? 'PATCH' : 'POST', body: { ...values, ...(editing ? { version: task.version } : {}) } });
          await finishTaskSave(save, result, editing ? 'تغییرات ذخیره شد.' : 'کار جدید ساخته شد.');
        } catch (error) { if (error.status === 409) await refreshConflict(task?.id); throw error; }
      });
    };
  });
}
async function refreshConflict(id) {
  const owner = state.user;
  const generation = routeGeneration;
  const hash = `#task/${id}`;
  const current = () => state.user === owner && routeGeneration === generation && location.hash === hash;
  if (!id || !owner || !current()) return;
  try {
    const detail = await api(`/tasks/${id}`);
    if (!current() || detail.version === state.detail?.version || !rememberTask(detail)) return;
    state.detail = detail;
    renderDetail();
    toast('نسخه تازه دریافت شد. نوشته خود را نگه دارید، پنجره را ببندید و دوباره اقدام کنید.');
  } catch {
    if (current()) toast('دریافت نسخه تازه ممکن نشد. نوشته شما در فرم باقی مانده است.');
  }
}
function renderDetail() {
  const task = state.detail;
  const editable = (task.creator_id === state.user.id || state.user.admin) && !['in_review', 'done'].includes(task.status);
  const isAssignee = task.assignee_id === state.user.id;
  const isReviewer = task.reviewer_id === state.user.id;
  let allowed = [];
  if (isAssignee && ['new', 'changes_requested'].includes(task.status)) allowed.push(['start', task.status === 'new' ? 'شروع کار' : 'شروع اصلاحات']);
  if (isAssignee && ['in_progress', 'changes_requested'].includes(task.status)) allowed.push(['submit', 'ارسال نتیجه برای بازبینی']);
  if (isReviewer && task.status === 'in_review') allowed = [['approve', 'تایید و تکمیل کار'], ['request_changes', 'برگشت برای اصلاح']];
  const latestFeedback = task.events.find(event => event.action === 'request_changes');
  const latestResult = task.events.find(event => event.action === 'submit');
  const feedback = latestFeedback && (task.status === 'changes_requested' || (task.status === 'in_progress' && latestFeedback.id > (latestResult?.id || 0)));
  const note = feedback ? latestFeedback : ['in_review', 'done'].includes(task.status) ? latestResult : null;
  const noteTitle = feedback ? 'چه چیزی نیاز به اصلاح دارد؟' : 'آخرین نتیجه ارسال‌شده';
  const actionButtons = allowed.map(([action, label], index) => `<button class="${action === 'request_changes' ? 'danger' : index === 0 ? 'primary' : ''}" data-action="${action}">${icon({ start: 'start', submit: 'send', approve: 'check', request_changes: 'revise' }[action])}${label}</button>`).join('');
  const locked = ['in_review', 'done'].includes(task.status);
  const next = note || allowed.length ? `<section class="detail-card action-card ${feedback ? 'feedback' : ''}"><div class="section-head"><h2>${note ? noteTitle : 'قدم بعدی شما'}</h2><span class="section-icon">${icon(feedback ? 'revise' : note ? 'review' : 'flag')}</span></div>${note ? `<div class="description" dir="auto">${escapeHtml(note.note)}</div><p class="note-byline"><bdi>${escapeHtml(note.actor_name)}</bdi> / ${time(note.created_at)}</p>` : `<p>${task.status === 'new' ? 'با شروع کار، وضعیت آن برای همکاران به‌روز می‌شود.' : 'نتیجه را بنویسید تا مدیر پیگیری بتواند آن را بررسی کند.'}</p>`}${actionButtons ? `<div class="action-buttons">${actionButtons}</div>` : ''}</section>` : '';
  $('#main').innerHTML = `<a class="back" id="back" href="${escapeHtml(returnHash())}">${icon('back')}بازگشت به کارها</a><div class="page-heading detail-heading"><div><div class="detail-status">${badge(task.status)}${locked ? `<span class="locked" title="اطلاعات این کار فقط خواندنی است" aria-label="فقط خواندنی">${icon('lock')}</span>` : ''}</div><h1 id="detail-title" tabindex="-1"><bdi>${escapeHtml(task.title)}</bdi></h1><p>آخرین تغییر: ${time(task.updated_at)}</p></div>${headingActions()}</div><div class="detail-layout"><div class="detail-main">${next}<section class="detail-card"><div class="section-head"><h2>درباره این کار</h2>${editable ? `<button id="edit-task" class="small">${icon('edit')}ویرایش اطلاعات</button>` : ''}</div><div class="description" dir="auto">${escapeHtml(task.description)}</div></section><section class="detail-card"><div class="section-head"><h2>مسیر این کار</h2><span class="section-icon">${icon('clock')}</span></div><ol class="timeline">${task.events.map(event => `<li><div class="event-title"><bdi>${escapeHtml(event.actor_name)}</bdi> ${actions[event.action]}</div><div class="event-time">${time(event.created_at)} / نسخه ${faNumber(event.snapshot.version)}</div>${event.note ? `<div class="event-note" dir="auto">${escapeHtml(event.note)}</div>` : ''}<details><summary>اطلاعات کار در این مرحله</summary><div class="snapshot">${escapeHtml(event.snapshot.title)}<br>${escapeHtml(event.snapshot.description)}<br>انجام‌دهنده: ${escapeHtml(userName(event.snapshot.assignee_id))}<br>مدیر پیگیری: ${escapeHtml(userName(event.snapshot.reviewer_id))}<br>وضعیت: ${states[event.snapshot.status]}<br>مهلت: ${date(event.snapshot.due_date)}</div></details></li>`).join('')}</ol></section></div><aside class="detail-side"><section class="detail-card"><div class="section-head"><h2>مشخصات کار</h2></div><dl class="meta-list"><dt>انجام‌دهنده</dt><dd>${person(task.assignee_id)}</dd><dt>مدیر پیگیری</dt><dd>${person(task.reviewer_id)}</dd><dt>سازنده</dt><dd><bdi>${escapeHtml(userName(task.creator_id))}</bdi></dd><dt>مهلت انجام</dt><dd class="${overdue(task) ? 'overdue' : ''}">${date(task.due_date)}${overdue(task) ? ' / مهلت گذشته' : ''}</dd><dt>تاریخ ایجاد</dt><dd>${date(task.created_at)}</dd><dt>نسخه</dt><dd>${faNumber(task.version)}</dd></dl></section>${locked ? `<p class="detail-lock">${icon('lock')}${task.status === 'done' ? 'کار تایید و تکمیل شده و فقط خواندنی است.' : 'اطلاعات کار تا تصمیم مدیر پیگیری قابل تغییر نیست.'}</p>` : ''}</aside></div>`;
  bindHeading(); bindBack();
  $('#edit-task')?.addEventListener('click', () => taskModal(task));
  document.querySelectorAll('[data-action]').forEach(button => button.onclick = () => actionModal(task, button.dataset.action));
}
function actionModal(task, action, inList = false) {
  const titles = { start: 'شروع انجام کار', submit: 'ارسال نتیجه برای بازبینی', approve: 'تایید نهایی نتیجه', request_changes: 'درخواست اصلاح' };
  const required = ['submit', 'request_changes'].includes(action);
  const label = action === 'request_changes' ? 'چه چیزی باید اصلاح شود؟' : action === 'submit' ? 'نتیجه انجام کار' : 'توضیح (اختیاری)';
  openModal(titles[action], `<form id="action-form" autocomplete="off"><p class="form-context"><bdi>${escapeHtml(task.title)}</bdi></p>${action === 'approve' ? '<div class="notice">با تایید شما کار تکمیل می‌شود و قابل بازگشایی نیست.</div>' : ''}<div class="field"><label for="action-note">${label}</label><textarea id="action-note" name="note" dir="auto" maxlength="10000" ${required ? 'required' : ''}></textarea></div><div class="form-actions"><button type="button" id="cancel-action">انصراف</button><button type="submit" class="${action === 'request_changes' ? 'danger' : 'primary'}">${titles[action]}</button></div></form>`, () => {
    $('#cancel-action').onclick = closeModal;
    $('#action-form').onsubmit = event => {
      event.preventDefault();
      const form = event.currentTarget;
      const save = taskSaveContext(form, true, inList);
      submitForm(form, async values => {
        try {
          const result = await api(`/tasks/${task.id}/actions`, { method: 'POST', body: { action, note: values.note, version: task.version } });
          const message = { start: 'کار شروع شد.', submit: 'نتیجه برای بازبینی فرستاده شد.', approve: 'کار تایید و تکمیل شد.', request_changes: 'کار برای اصلاح برگشت داده شد.' }[action];
          await finishTaskSave(save, result, message);
        } catch (error) {
          if (inList && [404, 409].includes(error.status)) await refreshListConflict(task.id, save.owner);
          else if (error.status === 409) await refreshConflict(task.id);
          throw error;
        }
      });
    };
  });
}
function renderUsers() {
  $('#main').innerHTML = `<div class="page-heading"><div><h1>اعضای تیم</h1><p>حساب‌ها را مدیریت کنید. غیرفعال‌کردن حساب، تاریخچه کارها را حذف نمی‌کند.</p></div><button class="primary" id="new-user">${icon('plus')}عضو جدید</button></div><section class="panel user-list" aria-label="فهرست اعضای تیم"><div class="list-head"><h2>حساب‌های کاربری</h2><p>${faNumber(state.users.length)} عضو</p></div>${state.users.map(user => `<article class="user-card"><div class="person">${avatar(user.name)}<div><strong><bdi>${escapeHtml(user.name)}</bdi></strong><small dir="ltr" translate="no">${escapeHtml(user.username)}</small></div></div><div class="user-status"><span class="badge ${user.active ? 'done' : 'changes_requested'}">${user.active ? 'فعال' : 'غیرفعال'}</span><span class="badge">${user.admin ? 'مدیر سیستم' : 'عضو تیم'}</span></div><div class="user-tools"><button class="small" data-edit-user="${user.id}">مدیریت حساب</button><button class="small ghost" data-reset-user="${user.id}">تغییر رمز</button></div></article>`).join('')}</section>`;
  $('#new-user').onclick = () => userModal();
  document.querySelectorAll('[data-edit-user]').forEach(button => button.onclick = () => userModal(state.users.find(user => user.id === button.dataset.editUser)));
  document.querySelectorAll('[data-reset-user]').forEach(button => button.onclick = () => resetPasswordModal(state.users.find(user => user.id === button.dataset.resetUser)));
}
async function finishAccountSave(form, owner, userId, message) {
  if (state.user !== owner) return;
  if (userId === owner.id) {
    clearSession(); await initialize(); toast(message);
    return;
  }
  if (form.isConnected && $('#modal').open) closeModal();
  try {
    await loadWorkspace();
    if (state.user === owner) toast(message);
  } catch {
    if (state.user === owner) toast(`${message} تازه‌سازی فهرست ممکن نشد. صفحه را دوباره بارگیری کنید.`);
  }
}
function userModal(user) {
  openModal(user ? 'مدیریت حساب همکار' : 'افزودن همکار جدید', `<form id="user-form" autocomplete="off"><div class="field"><label for="user-name">نام و نام خانوادگی</label><input id="user-name" name="name" required maxlength="100" value="${escapeHtml(user?.name || '')}"></div>${user ? '' : '<div class="field"><label for="user-login">نام کاربری</label><input class="ltr" id="user-login" name="username" required minlength="3" maxlength="64" pattern="[a-zA-Z0-9][a-zA-Z0-9._\\-]+" autocomplete="off" autocapitalize="none" spellcheck="false"></div><div class="field"><label for="user-pass">رمز عبور اولیه</label><input class="ltr" id="user-pass" name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"><small>رمز را از مسیر امن به همکارتان بدهید. او می‌تواند از بخش حساب رمز را تغییر دهد.</small></div>'}<div class="field"><label class="checkbox"><input name="admin" type="checkbox" ${user?.admin ? 'checked' : ''}>مدیر سیستم (مدیریت حساب‌ها و مشاهده همه کارها)</label></div>${user ? `<div class="field"><label class="checkbox"><input name="active" type="checkbox" ${user.active ? 'checked' : ''}>حساب فعال باشد</label><small>با ذخیره تغییرات، نشست‌های این حساب پایان می‌یابد.</small></div>` : ''}<div class="form-actions"><button type="button" id="cancel-user">انصراف</button><button type="submit" class="primary">${user ? 'ذخیره تغییرات' : 'ساخت حساب'}</button></div></form>`, () => {
    $('#cancel-user').onclick = closeModal;
    $('#user-form').onsubmit = event => {
      event.preventDefault();
      const form = event.currentTarget;
      const owner = state.user;
      submitForm(form, async values => {
        await api(user ? `/users/${user.id}` : '/users', { method: user ? 'PATCH' : 'POST', body: { ...values, admin: values.admin === 'on', ...(user ? { active: values.active === 'on', version: user.version } : {}) } });
        await finishAccountSave(form, owner, user?.id, 'اطلاعات حساب ذخیره شد.');
      });
    };
  });
}
function resetPasswordModal(user) {
  openModal('تعیین رمز عبور جدید', `<form id="reset-form"><p class="muted">حساب ${escapeHtml(user.name)}؛ با تغییر رمز، همه نشست‌های این کاربر پایان می‌یابد.</p><div class="field"><label for="new-pass">رمز جدید (حداقل ۱۲ نویسه)</label><input class="ltr" id="new-pass" name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></div><div class="form-actions"><button type="submit" class="primary">ثبت رمز جدید</button></div></form>`, () => {
    $('#reset-form').onsubmit = event => {
      event.preventDefault();
      const form = event.currentTarget;
      const owner = state.user;
      submitForm(form, async values => {
        await api(`/users/${user.id}/password`, { method: 'POST', body: { ...values, version: user.version } });
        await finishAccountSave(form, owner, user.id, 'رمز جدید ثبت شد.');
      });
    };
  });
}
function accountModal() {
  openModal('حساب من', `<p>${escapeHtml(state.user.name)} / <span dir="ltr">${escapeHtml(state.user.username)}</span></p><form id="password-form"><div class="field"><label for="current-password">رمز فعلی</label><input class="ltr" id="current-password" name="current_password" type="password" required maxlength="128" autocomplete="current-password"></div><div class="field"><label for="next-password">رمز جدید (حداقل ۱۲ نویسه)</label><input class="ltr" id="next-password" name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></div><div class="form-actions"><button class="primary" type="submit">تغییر رمز</button></div></form><div class="form-actions"><button class="danger" id="logout">خروج از حساب</button></div>`, () => {
    $('#logout').onclick = async event => {
      const button = event.currentTarget;
      const owner = state.user;
      button.disabled = true;
      try {
        await api('/logout', { method: 'POST', body: {} });
        if (state.user === owner) { clearSession(); location.hash = ''; await initialize(); }
      } catch (error) { if (state.user === owner) toast(error.message); button.disabled = false; }
    };
    $('#password-form').onsubmit = event => {
      event.preventDefault();
      const form = event.currentTarget;
      const owner = state.user;
      submitForm(form, async values => {
        await api('/password', { method: 'POST', body: values });
        await finishAccountSave(form, owner, owner.id, 'رمز تغییر کرد. با رمز جدید وارد شوید.');
      });
    };
  });
}
$('#modal').addEventListener('cancel', event => { event.preventDefault(); closeModal(); });
window.addEventListener('hashchange', () => { closeModal(); window.scrollTo(0, 0); route(null, true); });
window.addEventListener('keydown', event => {
  if ($('#modal').open) return;
  if (event.key === 'Escape') { closeSidebar(); return; }
  if (!state.user || $('.sidebar')?.classList.contains('open') || event.defaultPrevented || event.repeat || event.isComposing || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.target instanceof Element && event.target.closest('input, select, textarea, [contenteditable]')) return;
  const control = event.code === 'KeyN' ? $('#new-task') : event.code === 'KeyF' ? $('#search') : null;
  if (!control) return;
  event.preventDefault();
  if (control.matches('input')) control.focus(); else control.click();
});
matchMedia('(max-width:760px)').addEventListener('change', syncSidebar);
$('.skip').onclick = event => { event.preventDefault(); $('#main').tabIndex = -1; $('#main').focus(); };
initialize();
