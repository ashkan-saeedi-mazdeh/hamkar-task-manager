const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const faNumber = value => new Intl.NumberFormat('fa-IR').format(value);
const date = value => value ? new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium' }).format(new Date(value.length === 10 ? `${value}T12:00:00` : value)) : 'بدون مهلت';
const time = value => new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const states = { new: 'آماده شروع', in_progress: 'در حال انجام', in_review: 'در انتظار بازبینی', changes_requested: 'نیازمند اصلاح', done: 'تکمیل‌شده' };
const actions = { created: 'کار را ایجاد کرد', edited: 'اطلاعات کار را ویرایش کرد', start: 'کار را شروع کرد', submit: 'نتیجه را برای بازبینی فرستاد', request_changes: 'درخواست اصلاح ثبت کرد', approve: 'کار را تایید کرد' };
const views = { dashboard: 'نمای کلی', mine: 'کارهای من', review: 'بازبینی‌های من', created: 'ساخته‌های من', all: 'همه کارهای مجاز', users: 'اعضای تیم' };
const state = { user: null, csrf: '', tasks: [], users: [], directory: [], view: 'dashboard', filter: { search: '', status: '', assignee: '', reviewer: '' }, tab: 'all', detail: null, loading: false };
let toastTimer;
let loadGeneration = 0;
let routeGeneration = 0;
let taskAccessGeneration = 0;
let modalCleanup;
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
function userName(id) { return state.directory.find(user => user.id === id)?.name || 'کاربر'; }
function initials(name) { return escapeHtml((name || '').split(/\s+/).slice(0, 2).map(v => [...v][0]).join('')); }
function avatar(name) { return `<span class="avatar" aria-hidden="true">${initials(name)}</span>`; }
function person(id) { const name = userName(id); return `<span class="person">${avatar(name)}<span>${escapeHtml(name)}</span></span>`; }
function badge(status) { return `<span class="badge ${status}">${states[status]}</span>`; }
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function overdue(task) { return task.due_date && task.status !== 'done' && task.due_date < today(); }
function brand(extra = '') { return `<div class="brand ${extra}"><span class="brand-mark" aria-hidden="true">✓</span><span>همکار<small>فضایی برای پیش بردن کارها</small></span></div>`; }
function showError(container, message) {
  let error = container.querySelector('.error');
  if (!error) { error = document.createElement('div'); error.className = 'error'; error.setAttribute('role', 'alert'); container.prepend(error); }
  error.textContent = message;
}
function formValues(form) { return Object.fromEntries(new FormData(form)); }
async function submitForm(form, callback) {
  const buttons = [...form.querySelectorAll('button[type=submit]')];
  buttons.forEach(button => { button.disabled = true; });
  form.querySelector('.error')?.remove();
  try { await callback(formValues(form)); }
  catch (error) { if (form.isConnected) showError(form, error.message); }
  finally { buttons.forEach(button => { button.disabled = false; }); }
}
function renderAuth(setup, canSetup) {
  $('#app').innerHTML = `<main id="main" class="auth-page"><section class="auth-story">${brand()}<div class="eyebrow">هر کار، یک قدم رو به جلو</div><h1>از شروع یک کار<br>تا تایید نتیجه،<br>همراه تیم باشید.</h1><p>مسئولیت‌ها روشن، بازخوردها در دسترس و مسیر هر کار قابل پیگیری است.</p><div class="steps"><span>انجام کار</span><span>بازبینی</span><span class="selected">تایید نتیجه</span></div></section><section class="auth-form-wrap"><div class="auth-form">${brand('auth-mobile-brand')}<div class="eyebrow">مدیریت وظایف تیم</div><h2>${setup ? 'اولین قدم، ساخت حساب شما' : 'خوش آمدید'}</h2><p>${setup ? 'حساب مدیر سیستم را بسازید؛ سپس همکاران خود را اضافه کنید.' : 'برای دیدن کارها و بازبینی‌ها وارد حساب خود شوید.'}</p>${setup && !canSetup ? '<div class="notice">راه‌اندازی اولیه را با دستور راه‌اندازی روی سرور انجام دهید.</div>' : `<form id="auth-form">${setup ? '<div class="field"><label for="name">نام و نام خانوادگی</label><input id="name" name="name" autocomplete="name" required maxlength="100"></div>' : ''}<div class="field"><label for="username">نام کاربری</label><input class="ltr" id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required minlength="3" maxlength="64" pattern="[a-zA-Z0-9][a-zA-Z0-9._-]+" placeholder="your.name"></div><div class="field"><label for="password">رمز عبور</label><input class="ltr" id="password" name="password" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" required ${setup ? 'minlength="12"' : ''} maxlength="128">${setup ? '<small>حداقل ۱۲ نویسه؛ از یک عبارت طولانی استفاده کنید.</small>' : ''}</div><button type="submit" class="primary">${setup ? 'ساخت حساب و ورود' : 'ورود به فضای کار'}</button></form>`}<div class="auth-foot">${setup ? 'ثبت‌نام عمومی نداریم. حساب همکاران را مدیر سیستم ایجاد می‌کند.' : 'حساب ندارید یا رمز را فراموش کرده‌اید؟ با مدیر سیستم شرکت تماس بگیرید.'}</div></div></section></main>`;
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
  ++taskAccessGeneration;
  await route();
}
function renderShell() {
  const pending = state.tasks.filter(task => task.reviewer_id === state.user.id && task.status === 'in_review').length;
  const nav = [['dashboard', '▦'], ['mine', '☑'], ['review', '◎'], ['created', '▤'], ['all', '≡'], ...(state.user.admin ? [['users', '♙']] : [])];
  $('#app').innerHTML = `<div class="shell"><aside class="sidebar" aria-label="منوی اصلی"><button id="nav-close" class="mobile-menu ghost" aria-label="بستن منو">×</button>${brand()}<div class="workspace"><span class="workspace-dot"></span><span>فضای کار تیم ما</span></div><div class="nav-label">مدیریت کارها</div><nav class="nav">${nav.map(([key, symbol]) => `<button data-view="${key}" class="${state.view === key ? 'active' : ''}" ${state.view === key ? 'aria-current="page"' : ''}><span class="nav-symbol" aria-hidden="true">${symbol}</span>${views[key]}${key === 'review' && pending ? `<span class="count">${faNumber(pending)}</span>` : ''}</button>`).join('')}</nav><div class="side-bottom"><div class="side-tip">هر نتیجه با بازبینی بهتر می‌شود.<br>تاریخچه کارها همیشه در دسترس است.</div><div class="profile">${avatar(state.user.name)}<div><div class="profile-name">${escapeHtml(state.user.name)}</div><small>${state.user.admin ? 'مدیر سیستم' : 'عضو تیم'}</small></div><button class="ghost" id="account" aria-label="تنظیمات حساب">حساب</button></div></div></aside><div class="content"><header class="topbar"><button class="mobile-menu" id="menu" aria-label="باز کردن منو" aria-expanded="false">☰</button><div class="crumb">فضای کار تیم ما / ${views[state.view] || 'جزئیات کار'}</div><div class="topbar-meta"><span class="today">${date(new Date().toISOString())}</span><span><i class="live-dot"></i>فضای کار شما</span></div></header><main id="main" class="page"></main></div></div>`;
  document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => navigate(button.dataset.view));
  syncSidebar();
  $('#menu').onclick = () => { const open = $('.sidebar').classList.toggle('open'); syncSidebar(); if (open) $('#nav-close').focus(); };
  $('#nav-close').onclick = closeSidebar;
  $('#account').onclick = accountModal;
}
function syncSidebar() {
  const sidebar = $('.sidebar');
  if (!sidebar) return;
  const hidden = matchMedia('(max-width:760px)').matches && !sidebar.classList.contains('open');
  sidebar.inert = hidden;
  sidebar.setAttribute('aria-hidden', String(hidden));
  $('#menu').setAttribute('aria-expanded', String(sidebar.classList.contains('open')));
}
function closeSidebar() {
  const sidebar = $('.sidebar');
  if (!sidebar?.classList.contains('open')) return;
  sidebar.classList.remove('open');
  syncSidebar();
  $('#menu').focus();
}
function navigate(view) {
  if ((location.hash.slice(1) || 'dashboard') === view) { closeSidebar(); return; }
  state.filter = { search: '', status: '', assignee: '', reviewer: '' };
  state.tab = 'all';
  location.hash = view;
}
async function route(savedTask = null) {
  if (!state.user) return;
  const generation = ++routeGeneration;
  const owner = state.user;
  const hash = location.hash.slice(1) || 'dashboard';
  const current = () => generation === routeGeneration && (location.hash.slice(1) || 'dashboard') === hash && state.user === owner;
  if (hash.startsWith('task/')) {
    const id = hash.slice(5);
    state.view = 'detail'; renderShell();
    $('#main').innerHTML = '<p class="loading">در حال دریافت کار...</p>';
    try { const detail = savedTask?.id === id ? savedTask : await api(`/tasks/${encodeURIComponent(id)}`); if (current()) { state.detail = detail; renderDetail(); } }
    catch (error) {
      if (!current()) return;
      state.detail = null;
      if (error.status === 404) {
        state.tasks = state.tasks.filter(task => task.id !== id);
        ++loadGeneration;
        ++taskAccessGeneration;
        renderShell();
      }
      $('#main').innerHTML = '<div class="empty"><h2>دریافت کار ممکن نشد</h2><p id="detail-error"></p><button id="back">بازگشت به کارها</button></div>';
      $('#detail-error').textContent = error.message;
      $('#back').onclick = () => navigate('dashboard');
    }
    return;
  }
  state.view = Object.hasOwn(views, hash) && (hash !== 'users' || state.user.admin) ? hash : 'dashboard'; state.detail = null;
  renderShell(); if (state.view === 'users') renderUsers(); else renderList();
}
function pageHeading(title, subtitle, detail = false) {
  return `<div class="page-heading ${detail ? 'detail-heading' : ''}"><div><div class="eyebrow">${detail ? 'همه جزئیات، در یک نگاه' : 'یک قدم نزدیک‌تر به نتیجه'}</div><h1>${escapeHtml(title)}</h1><p>${subtitle}</p></div><div class="heading-actions"><button id="refresh" class="ghost" aria-label="تازه‌سازی اطلاعات">تازه‌سازی</button><button id="new-task" class="primary">+ کار جدید</button></div></div>`;
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
function renderList() {
  const myTasks = state.tasks.filter(task => task.assignee_id === state.user.id);
  const needsReview = state.tasks.filter(task => task.reviewer_id === state.user.id && task.status === 'in_review');
  const revisions = myTasks.filter(task => task.status === 'changes_requested');
  const done = myTasks.filter(task => task.status === 'done');
  const title = state.view === 'dashboard' ? `سلام ${state.user.name.split(' ')[0]}، وقت پیش بردن کارهاست` : views[state.view];
  $('#main').innerHTML = `${pageHeading(title, state.view === 'dashboard' ? 'کارهای امروز را ببینید، نتیجه‌ها را بررسی کنید و قدم بعدی را بردارید.' : 'کارهای مرتبط با شما، همراه با آخرین وضعیت و مسئولان آن‌ها.')}${state.users.filter(user => user.active).length < 2 ? '<div class="notice">برای ساخت کار، دو همکار با حساب فعال نیاز دارید. از صفحه اعضای تیم حساب‌ها را اضافه کنید.</div>' : ''}<section class="stats" aria-label="وضعیت کارهای شما">${[['کارهای باز من', myTasks.filter(task => task.status !== 'done').length, 'در مسیر انجام', '▤'], ['منتظر بازبینی من', needsReview.length, 'آماده دریافت نظر شما', '◎'], ['نیازمند اصلاح من', revisions.length, 'یک فرصت برای بهتر شدن', '↻'], ['تکمیل‌شده‌های من', done.length, 'با تایید مدیر پیگیری', '✓']].map(([label, value, note, symbol]) => `<div class="stat"><span class="stat-symbol" aria-hidden="true">${symbol}</span><span class="stat-label">${label}</span><strong class="stat-number">${faNumber(value)}</strong><span class="stat-note">${note}</span></div>`).join('')}</section><div class="section-head"><h2>${state.view === 'dashboard' ? 'مسیر کارهای تیم' : views[state.view]}</h2><small>آخرین تغییرات، بالاتر از همه</small></div><section class="panel" aria-label="فهرست کارها">${state.view === 'dashboard' ? `<div class="tabs" role="group" aria-label="نوع کارها">${[['all', 'همه کارهای مجاز'], ['mine', 'کارهای من'], ['review', 'منتظر بازبینی'], ['created', 'ساخته‌های من']].map(([key, title]) => `<button data-tab="${key}" class="${state.tab === key ? 'active' : ''}" aria-pressed="${state.tab === key}">${title}</button>`).join('')}</div>` : ''}<div class="filters"><input id="search" type="search" aria-label="جست‌وجوی عنوان کار" placeholder="جست‌وجو در عنوان کارها..." value="${escapeHtml(state.filter.search)}"><select id="status-filter" aria-label="فیلتر وضعیت"><option value="">همه وضعیت‌ها</option>${Object.entries(states).map(([key, label]) => `<option value="${key}" ${state.filter.status === key ? 'selected' : ''}>${label}</option>`).join('')}</select><select id="assignee-filter" aria-label="فیلتر انجام‌دهنده">${optionUsers(state.filter.assignee, 'همه انجام‌دهنده‌ها', true)}</select><select id="reviewer-filter" aria-label="فیلتر مدیر پیگیری">${optionUsers(state.filter.reviewer, 'همه مدیران پیگیری', true)}</select></div><div id="task-results"></div></section><div class="updated-hint">وضعیت کارها هنگام ورود و با دکمه تازه‌سازی دریافت می‌شود.</div>`;
  bindHeading();
  $('#search').oninput = event => { state.filter.search = event.target.value; renderTaskResults(); };
  for (const [id, key] of [['status-filter', 'status'], ['assignee-filter', 'assignee'], ['reviewer-filter', 'reviewer']]) $(`#${id}`).onchange = event => { state.filter[key] = event.target.value; renderTaskResults(); };
  document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => { state.tab = button.dataset.tab; renderList(); });
  renderTaskResults();
}
function renderTaskResults() {
  const scope = state.view === 'dashboard' ? state.tab : state.view;
  const tasks = state.tasks.filter(task => {
    if (scope === 'mine' && task.assignee_id !== state.user.id) return false;
    if (scope === 'created' && task.creator_id !== state.user.id) return false;
    if (scope === 'review' && (task.reviewer_id !== state.user.id || task.status !== 'in_review')) return false;
    return task.title.toLocaleLowerCase('fa').includes(state.filter.search.trim().toLocaleLowerCase('fa')) && (!state.filter.status || task.status === state.filter.status) && (!state.filter.assignee || task.assignee_id === state.filter.assignee) && (!state.filter.reviewer || task.reviewer_id === state.filter.reviewer);
  });
  if (!tasks.length) {
    $('#task-results').innerHTML = '<div class="empty"><div class="empty-mark" aria-hidden="true">▤</div><h3>در این فهرست کاری نیست</h3><p>می‌توانید یک کار جدید بسازید یا فیلترها را تغییر دهید. کارهای مرتبط با شما اینجا نمایش داده می‌شوند.</p><button id="empty-create">ساخت اولین کار</button></div>';
    $('#empty-create').onclick = () => taskModal(); return;
  }
  const due = task => `<span class="${overdue(task) ? 'overdue' : 'muted'}">${date(task.due_date)}${overdue(task) ? ' / گذشته' : ''}</span>`;
  const link = task => `<button class="task-link" data-task="${task.id}">${escapeHtml(task.title)}<span class="task-sub">ساخته ${escapeHtml(userName(task.creator_id))}</span></button>`;
  $('#task-results').innerHTML = `<div class="table-scroll"><table><thead><tr><th>عنوان کار</th><th>انجام‌دهنده</th><th>مدیر پیگیری</th><th>وضعیت</th><th>مهلت انجام</th></tr></thead><tbody>${tasks.map(task => `<tr><td>${link(task)}</td><td>${person(task.assignee_id)}</td><td>${person(task.reviewer_id)}</td><td>${badge(task.status)}</td><td>${due(task)}</td></tr>`).join('')}</tbody></table></div><div class="mobile-cards">${tasks.map(task => `<article class="mobile-card"><div class="mobile-card-head">${link(task)}${badge(task.status)}</div><div class="mobile-card-meta">${person(task.assignee_id)}${due(task)}</div><div class="mobile-card-reviewer">مدیر پیگیری: ${escapeHtml(userName(task.reviewer_id))}</div></article>`).join('')}</div><div class="list-footer">${faNumber(tasks.length)} کار در این فهرست</div>`;
  document.querySelectorAll('[data-task]').forEach(button => button.onclick = () => { location.hash = `task/${button.dataset.task}`; });
}
function openModal(title, content, bind) {
  closeModal();
  const dialog = $('#modal');
  dialog.innerHTML = `<div class="modal-head"><h2 id="modal-title">${title}</h2><button id="modal-close" class="ghost" aria-label="بستن پنجره">×</button></div><div class="modal-body">${content}</div>`;
  $('#modal-close').onclick = closeModal;
  dialog.showModal();
  bind?.();
}
function closeModal() { modalCleanup?.(); modalCleanup = null; if ($('#modal').open) $('#modal').close(); $('#modal').innerHTML = ''; }
function clearSession() {
  closeModal();
  state.user = null; state.csrf = ''; state.tasks = []; state.users = []; state.directory = []; state.detail = null;
}
function rememberTask(detail) {
  const { events, ...summary } = detail;
  const newer = task => task?.id === summary.id && task.version > summary.version;
  if (newer(state.detail) || state.tasks.some(newer)) return false;
  state.tasks = [...state.tasks.filter(task => task.id !== summary.id), summary]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
  return true;
}
function taskSaveContext(form, existing) {
  return { form, owner: state.user, existing, accessGeneration: taskAccessGeneration };
}
async function finishTaskSave({ form, owner, existing, accessGeneration }, task, message) {
  if (state.user !== owner) return;
  // A later list or detail read may have shown that reassignment removed access.
  if (existing && accessGeneration !== taskAccessGeneration && !state.tasks.some(row => row.id === task.id)) return;
  if (!rememberTask(task)) return;
  ++loadGeneration;
  const target = `#task/${task.id}`;
  if (form.isConnected && $('#modal').open) {
    closeModal();
    if (location.hash !== target) history.pushState(null, '', target);
    await route(task);
  } else if (location.hash === target) {
    await route(task);
  } else if (state.view !== 'detail' && state.view !== 'users') {
    renderShell(); renderList();
  }
  toast(message);
}
function taskModal(task) {
  const editing = !!task;
  const users = state.users.filter(user => user.active);
  openModal(editing ? 'ویرایش اطلاعات کار' : 'یک کار تازه بسازید', `<form id="task-form"><div class="field"><label for="task-title">عنوان کار</label><input id="task-title" name="title" required maxlength="200" placeholder="مثلا: آماده‌سازی گزارش ماهانه" value="${escapeHtml(task?.title || '')}"></div><div class="field"><label for="description">توضیح کار و نتیجه مورد انتظار</label><textarea id="description" name="description" required maxlength="10000" placeholder="چه کاری باید انجام شود و نتیجه قابل قبول چیست؟">${escapeHtml(task?.description || '')}</textarea></div><div class="form-grid"><div class="field"><label for="assignee">انجام‌دهنده</label><select id="assignee" name="assignee_id" required>${optionUsers(task?.assignee_id, 'انتخاب انجام‌دهنده')}</select></div><div class="field"><label for="reviewer">مدیر پیگیری</label><select id="reviewer" name="reviewer_id" required>${optionUsers(task?.reviewer_id, 'انتخاب مدیر پیگیری')}</select></div><div class="field span-2"><label for="due-date">مهلت انجام (اختیاری)</label><input class="ltr" type="date" id="due-date" name="due_date" value="${escapeHtml(task?.due_date || '')}"><small>ورود تاریخ میلادی است؛ تاریخ‌ها در فهرست به تقویم فارسی نمایش داده می‌شوند.</small></div></div>${users.length < 2 ? '<div class="notice">ابتدا مدیر سیستم باید حداقل دو حساب فعال ایجاد کند.</div>' : ''}<div class="form-actions"><button type="button" id="cancel-task">انصراف</button><button type="submit" class="primary" ${users.length < 2 ? 'disabled' : ''}>${editing ? 'ذخیره تغییرات' : 'ایجاد کار'}</button></div></form>`, () => {
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
  $('#main').innerHTML = `<button class="back ghost" id="back">بازگشت به کارها</button>${pageHeading(task.title, `آخرین تغییر: ${time(task.updated_at)}`, true)}<div class="detail-layout"><div class="detail-main"><section class="detail-card"><div class="section-head"><h2>درباره این کار</h2>${editable ? '<button id="edit-task" class="small">ویرایش اطلاعات</button>' : ''}</div><div class="description">${escapeHtml(task.description)}</div></section>${task.status === 'changes_requested' && latestFeedback ? `<section class="detail-card"><h2>چه چیزی نیاز به اصلاح دارد؟</h2><div class="description">${escapeHtml(latestFeedback.note)}</div><small>${escapeHtml(latestFeedback.actor_name)} / ${time(latestFeedback.created_at)}</small></section>` : ''}${allowed.length ? `<section class="detail-card action-card"><h2>قدم بعدی شما</h2><p>${isReviewer && task.status === 'in_review' ? 'نتیجه ثبت‌شده در تاریخچه را ببینید؛ سپس تایید کنید یا دلیل اصلاح را بنویسید.' : 'نتیجه و توضیح‌های شما همراه با نام و زمان در تاریخچه ذخیره می‌شود.'}</p><div class="action-buttons">${allowed.map(([action, label]) => `<button class="${action === 'request_changes' ? 'danger' : 'primary'}" data-action="${action}">${label}</button>`).join('')}</div></section>` : `<div class="notice">${task.status === 'done' ? 'این کار با تایید مدیر پیگیری تکمیل شده است و فقط خواندنی است.' : task.status === 'in_review' ? 'نتیجه برای بازبینی فرستاده شده است. اطلاعات کار تا تصمیم مدیر قابل تغییر نیست.' : 'انجام‌دهنده می‌تواند قدم بعدی این کار را ثبت کند.'}</div>`}<section class="detail-card"><h2>مسیر این کار</h2><ol class="timeline">${task.events.map(event => `<li><div class="event-title">${escapeHtml(event.actor_name)} ${actions[event.action]}</div><div class="event-time">${time(event.created_at)} / نسخه ${faNumber(event.snapshot.version)}</div>${event.note ? `<div class="event-note">${escapeHtml(event.note)}</div>` : ''}<details><summary>اطلاعات کار در این مرحله</summary><div class="snapshot">${escapeHtml(event.snapshot.title)}<br>${escapeHtml(event.snapshot.description)}<br>انجام‌دهنده: ${escapeHtml(userName(event.snapshot.assignee_id))}<br>مدیر پیگیری: ${escapeHtml(userName(event.snapshot.reviewer_id))}<br>وضعیت: ${states[event.snapshot.status]}<br>مهلت: ${date(event.snapshot.due_date)}</div></details></li>`).join('')}</ol></section></div><aside class="detail-side"><section class="detail-card"><h2>مشخصات کار</h2><dl class="meta-list"><dt>وضعیت</dt><dd>${badge(task.status)}</dd><dt>انجام‌دهنده</dt><dd>${person(task.assignee_id)}</dd><dt>مدیر پیگیری</dt><dd>${person(task.reviewer_id)}</dd><dt>سازنده</dt><dd>${escapeHtml(userName(task.creator_id))}</dd><dt>مهلت انجام</dt><dd class="${overdue(task) ? 'overdue' : ''}">${date(task.due_date)}</dd><dt>تاریخ ایجاد</dt><dd>${date(task.created_at)}</dd><dt>نسخه</dt><dd>${faNumber(task.version)}</dd></dl></section><div class="notice">فقط افراد مرتبط با کار و مدیر سیستم به این صفحه دسترسی دارند. تایید نتیجه فقط با مدیر پیگیری همین کار است.</div></aside></div>`;
  bindHeading(); $('#back').onclick = () => navigate('dashboard');
  $('#edit-task')?.addEventListener('click', () => taskModal(task));
  document.querySelectorAll('[data-action]').forEach(button => button.onclick = () => actionModal(task, button.dataset.action));
}
function actionModal(task, action) {
  const titles = { start: 'شروع انجام کار', submit: 'ارسال نتیجه برای بازبینی', approve: 'تایید نهایی نتیجه', request_changes: 'درخواست اصلاح' };
  const required = ['submit', 'request_changes'].includes(action);
  const label = action === 'request_changes' ? 'چه چیزی باید اصلاح شود؟' : action === 'submit' ? 'نتیجه انجام کار' : 'توضیح (اختیاری)';
  openModal(titles[action], `<form id="action-form">${action === 'approve' ? '<div class="notice">با تایید شما کار تکمیل می‌شود و در نسخه اول قابل بازگشایی نیست.</div>' : ''}<div class="field"><label for="action-note">${label}</label><textarea id="action-note" name="note" maxlength="10000" ${required ? 'required' : ''}></textarea></div><div class="form-actions"><button type="button" id="cancel-action">انصراف</button><button type="submit" class="${action === 'request_changes' ? 'danger' : 'primary'}">${titles[action]}</button></div></form>`, () => {
    $('#cancel-action').onclick = closeModal;
    $('#action-form').onsubmit = event => {
      event.preventDefault();
      const form = event.currentTarget;
      const save = taskSaveContext(form, true);
      submitForm(form, async values => {
        try {
          const result = await api(`/tasks/${task.id}/actions`, { method: 'POST', body: { action, note: values.note, version: task.version } });
          await finishTaskSave(save, result, 'اقدام شما در تاریخچه ثبت شد.');
        } catch (error) { if (error.status === 409) await refreshConflict(task.id); throw error; }
      });
    };
  });
}
function renderUsers() {
  $('#main').innerHTML = `<div class="page-heading"><div><div class="eyebrow">همکاران کنار هم</div><h1>اعضای تیم</h1><p>حساب‌ها را مدیریت کنید. غیرفعال‌کردن حساب، تاریخچه کارها را حذف نمی‌کند.</p></div><button class="primary" id="new-user">+ عضو جدید</button></div><div class="user-grid">${state.users.map(user => `<article class="user-card"><div class="person">${avatar(user.name)}<div><strong>${escapeHtml(user.name)}</strong><div class="muted ltr">${escapeHtml(user.username)}</div></div></div><span class="badge ${user.active ? 'done' : 'changes_requested'}">${user.active ? 'فعال' : 'غیرفعال'}</span> <span class="badge">${user.admin ? 'مدیر سیستم' : 'عضو تیم'}</span><div class="user-tools"><button class="small" data-edit-user="${user.id}">مدیریت حساب</button><button class="small ghost" data-reset-user="${user.id}">تغییر رمز</button></div></article>`).join('')}</div>`;
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
  openModal(user ? 'مدیریت حساب همکار' : 'افزودن همکار جدید', `<form id="user-form"><div class="field"><label for="user-name">نام و نام خانوادگی</label><input id="user-name" name="name" required maxlength="100" value="${escapeHtml(user?.name || '')}"></div>${user ? '' : '<div class="field"><label for="user-login">نام کاربری</label><input class="ltr" id="user-login" name="username" required minlength="3" maxlength="64" pattern="[a-zA-Z0-9][a-zA-Z0-9._-]+" autocomplete="off" autocapitalize="none"></div><div class="field"><label for="user-pass">رمز عبور اولیه</label><input class="ltr" id="user-pass" name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"><small>رمز را از مسیر امن به همکارتان بدهید. او می‌تواند از بخش حساب رمز را تغییر دهد.</small></div>'}<div class="field"><label class="checkbox"><input name="admin" type="checkbox" ${user?.admin ? 'checked' : ''}>مدیر سیستم (مدیریت حساب‌ها و مشاهده همه کارها)</label></div>${user ? `<div class="field"><label class="checkbox"><input name="active" type="checkbox" ${user.active ? 'checked' : ''}>حساب فعال باشد</label><small>با ذخیره تغییرات، نشست‌های این حساب پایان می‌یابد.</small></div>` : ''}<div class="form-actions"><button type="button" id="cancel-user">انصراف</button><button type="submit" class="primary">${user ? 'ذخیره تغییرات' : 'ساخت حساب'}</button></div></form>`, () => {
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
window.addEventListener('hashchange', () => { closeModal(); route(); });
window.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#modal').open) closeSidebar(); });
matchMedia('(max-width:760px)').addEventListener('change', syncSidebar);
$('.skip').onclick = event => { event.preventDefault(); $('#main').tabIndex = -1; $('#main').focus(); };
initialize();
