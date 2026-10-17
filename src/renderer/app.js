const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = { recipients: [], fields: [], history: [], selectedFile: null, sending: false };
const titles = {
  dashboard: ['Overview', 'Everything you need to run your next campaign.'],
  recipients: ['Recipients', 'Import and manage your send list.'],
  composer: ['Composer', 'Create a polished bilingual email.'],
  history: ['History', 'Review campaign and recipient delivery results.'],
  settings: ['SMTP Settings', 'Connect the mail server you already use.']
};
const agentPrefix = `You are an expert email designer and HTML email developer. Create a complete, production-ready HTML email template based on the requirements I add below.

Mandatory requirements:
- Output only the final HTML document, with no Markdown fences or explanation.
- The email can contain both Persian and English. Use correct dir="rtl" / dir="ltr" on the relevant containers and make Persian layout RTL by default when Persian is the primary language.
- Load Vazirmatn from Google Fonts for Persian text, with Tahoma and Arial fallbacks. Remember that some email clients may block remote fonts.
- Use a table-based layout and inline CSS for broad email-client compatibility.
- Keep the content width at or below 640px and make it responsive on mobile.
- Do not use JavaScript, forms, video, CSS grid, or external stylesheets other than the Vazirmatn Google Font.
- Use accessible colors, descriptive alt text, and a clear call-to-action.
- Use {{logoUrl}} exactly for the public HTTPS logo URL; never embed a local file or base64 image.
- Personalize the subject and HTML using any variables listed below. Keep variable names exactly as provided, including Persian text and spaces.
- You may always use {{email}} for the normalized recipient address and {{logoUrl}} for the logo.
- Include a preheader, sensible spacing, and a simple footer.

My campaign requirements:`;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function formatDate(value) {
  if (!value) return '—';
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function toast(message, error = false) {
  const element = $('#toast');
  element.textContent = message;
  element.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { element.className = 'toast'; }, 3200);
}

function errorMessage(error) {
  return String(error?.message || error || 'Something went wrong').replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function showPage(name) {
  $$('.page').forEach((page) => page.classList.toggle('active', page.id === name));
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.page === name));
  $('#page-title').textContent = titles[name][0];
  $('#page-subtitle').textContent = titles[name][1];
  if (name === 'recipients') loadRecipients();
  if (name === 'history') loadHistory();
  if (name === 'composer') updatePreview();
}

async function bootstrap() {
  const data = await window.mailApp.bootstrap();
  const s = data.settings;
  $('#smtp-host').value = s.smtpHost || '';
  $('#smtp-port').value = s.smtpPort || '587';
  $('#smtp-secure').value = s.smtpSecure || 'false';
  $('#smtp-user').value = s.smtpUser || '';
  $('#smtp-pass').value = s.smtpPass || '';
  $('#from-name').value = s.fromName || '';
  $('#from-email').value = s.fromEmail || '';
  $('#reply-to').value = s.replyTo || '';
  $('#batch-delay').value = s.batchDelay || '5';
  $('#mail-subject').value = data.template.subject || '';
  $('#mail-html').value = data.template.html || '';
  $('#logo-url').value = data.template.logoUrl || '';
  $('#prompt-prefix').textContent = agentPrefix;
  state.fields = data.recipientFields || [];
  $('#stat-recipients').textContent = data.recipientCount;
  state.history = data.recentCampaigns;
  renderDashboard(data.recentCampaigns, data.recipientCount);
  await loadRecipients();
  updatePreview();
}

function renderDashboard(campaigns, recipientCount = state.recipients.length) {
  $('#stat-recipients').textContent = recipientCount;
  $('#stat-delivered').textContent = campaigns.reduce((sum, item) => sum + Number(item.sent), 0);
  $('#stat-campaigns').textContent = campaigns.length;
  const target = $('#recent-campaigns');
  if (!campaigns.length) { target.className = 'campaign-list empty-state'; target.textContent = 'No campaigns yet. Your first send will appear here.'; return; }
  target.className = 'campaign-list';
  target.innerHTML = campaigns.map((item) => `<div class="campaign-row"><b>${escapeHtml(item.subject)}</b><small>${formatDate(item.started_at)}</small><small>${item.sent}/${item.total} sent</small><span class="status-pill ${escapeHtml(item.status)}">${escapeHtml(item.status.replaceAll('_', ' '))}</span></div>`).join('');
}

async function loadRecipients() {
  state.recipients = await window.mailApp.listRecipients();
  state.fields = [...new Set(state.recipients.flatMap((recipient) => Object.keys(recipient.fields || {})))];
  renderVariableList();
  $('#recipient-badge').textContent = state.recipients.length;
  $('#send-count').textContent = `${state.recipients.length} recipient${state.recipients.length === 1 ? '' : 's'}`;
  $('#stat-recipients').textContent = state.recipients.length;
  const body = $('#recipients-table');
  if (!state.recipients.length) {
    body.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:35px;color:#9aa2b1">No recipients yet. Import a spreadsheet or add an address manually.</td></tr>';
    return;
  }
  body.innerHTML = state.recipients.map((item) => {
    const entries = Object.entries(item.fields || {}).filter(([, value]) => String(value).trim() && String(value).trim().toLowerCase() !== item.email.toLowerCase());
    const shown = entries.slice(0, 3).map(([key, value]) => `<span class="data-pill" title="${escapeHtml(key)}: ${escapeHtml(value)}">${escapeHtml(key)}: ${escapeHtml(value)}</span>`).join('');
    const more = entries.length > 3 ? `<span class="data-pill">+${entries.length - 3} more</span>` : '';
    return `<tr><td><b>${escapeHtml(item.email)}</b></td><td><div class="recipient-fields">${shown}${more || (!shown ? '<span class="data-pill">No extra data</span>' : '')}</div></td><td>${escapeHtml(item.source)}</td><td>${formatDate(item.createdAt)}</td><td><button class="delete-btn" data-delete-recipient="${item.id}" title="Remove">×</button></td></tr>`;
  }).join('');
}

function renderVariableList() {
  const fields = [...new Set(['email', 'logoUrl', ...state.fields])];
  $('#available-variables').innerHTML = fields.map((field) => `<button class="variable-chip" data-variable="${escapeHtml(field)}">{{${escapeHtml(field)}}}</button>`).join('');
}

function updatePreview() {
  let html = $('#mail-html').value || '<div style="padding:30px;font-family:Arial">Your preview will appear here.</div>';
  const sample = state.recipients[0] || { email: 'recipient@example.com', fields: {} };
  const values = { ...(sample.fields || {}), email: sample.email, logoUrl: $('#logo-url').value || 'https://placehold.co/264x80?text=Your+Logo' };
  html = html.replace(/{{\s*([^{}]+?)\s*}}/g, (_match, rawKey) => escapeHtml(values[rawKey.trim()] ?? ''));
  $('#mail-preview').srcdoc = html;
}

function templatePayload() {
  return { subject: $('#mail-subject').value.trim(), html: $('#mail-html').value, logoUrl: $('#logo-url').value.trim() };
}

async function saveTemplate(showToast = true) {
  await window.mailApp.saveTemplate(templatePayload());
  if (showToast) toast('Template draft saved.');
}

async function loadHistory() {
  state.history = await window.mailApp.getHistory();
  const body = $('#history-table');
  if (!state.history.length) {
    body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:#9aa2b1">No campaigns have been sent yet.</td></tr>';
  } else {
    body.innerHTML = state.history.map((item) => `<tr><td><b>${escapeHtml(item.subject)}</b></td><td>${formatDate(item.started_at)}</td><td>${item.total}</td><td>${item.sent}</td><td>${item.failed}</td><td><span class="status-pill ${escapeHtml(item.status)}">${escapeHtml(item.status.replaceAll('_', ' '))}</span></td><td><button class="link-btn" data-history-id="${item.id}">Details</button></td></tr>`).join('');
  }
  renderDashboard(state.history.slice(0, 6), state.recipients.length);
}

async function saveSettings() {
  const settings = {
    smtpHost: $('#smtp-host').value.trim(), smtpPort: $('#smtp-port').value,
    smtpSecure: $('#smtp-secure').value, smtpUser: $('#smtp-user').value.trim(), smtpPass: $('#smtp-pass').value,
    fromName: $('#from-name').value.trim(), fromEmail: $('#from-email').value.trim(), replyTo: $('#reply-to').value.trim(),
    batchDelay: $('#batch-delay').value
  };
  await window.mailApp.saveSettings(settings);
  $('#settings-saved').textContent = '✓ Saved locally';
  setTimeout(() => { $('#settings-saved').textContent = ''; }, 2500);
}

$$('.nav-item').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.page)));
$$('[data-go]').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.go)));

$('#choose-file').addEventListener('click', async () => {
  try {
    const file = await window.mailApp.chooseExcel();
    if (!file) return;
    if (!file.columns.length) throw new Error('No column headers were found in the first sheet.');
    state.selectedFile = file;
    $('#file-name').textContent = file.fileName;
    $('#file-meta').textContent = `${file.rowCount} rows · ${file.columns.length} columns · first sheet`;
    $('#email-column').innerHTML = file.columns.map((column) => `<option value="${escapeHtml(column)}">${escapeHtml(column)}</option>`).join('');
    const guessed = file.columns.find((column) => /e[-_ ]?mail/i.test(column));
    if (guessed) $('#email-column').value = guessed;
    const shownColumns = file.columns.slice(0, 4);
    $('#sheet-preview').innerHTML = `<table><thead><tr>${shownColumns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${file.preview.map((row) => `<tr>${shownColumns.map((c) => `<td>${escapeHtml(row[c])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    $('#file-config').classList.remove('hidden');
  } catch (error) { toast(errorMessage(error), true); }
});

$('#import-file').addEventListener('click', async () => {
  if (!state.selectedFile) return;
  try {
    const result = await window.mailApp.importExcel({ filePath: state.selectedFile.filePath, column: $('#email-column').value });
    await loadRecipients();
    toast(`Imported ${result.imported} email${result.imported === 1 ? '' : 's'}; skipped ${result.skipped}.`);
  } catch (error) { toast(errorMessage(error), true); }
});

$('#add-email').addEventListener('click', async () => {
  try { await window.mailApp.addRecipient($('#manual-email').value); $('#manual-email').value = ''; await loadRecipients(); toast('Recipient added.'); }
  catch (error) { toast(errorMessage(error), true); }
});
$('#manual-email').addEventListener('keydown', (event) => { if (event.key === 'Enter') $('#add-email').click(); });

$('#recipients-table').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-delete-recipient]');
  if (!button) return;
  await window.mailApp.deleteRecipient(Number(button.dataset.deleteRecipient));
  await loadRecipients();
});
$('#clear-recipients').addEventListener('click', async () => {
  if (!state.recipients.length || !confirm('Remove every recipient from the send list?')) return;
  await window.mailApp.clearRecipients(); await loadRecipients(); toast('Recipient list cleared.');
});

$$('.editor-tab').forEach((button) => button.addEventListener('click', () => {
  $$('.editor-tab').forEach((tab) => tab.classList.toggle('active', tab === button));
  $('#html-editor-panel').classList.toggle('hidden', button.dataset.editor !== 'html');
  $('#agent-editor-panel').classList.toggle('hidden', button.dataset.editor !== 'agent');
}));
$('#refresh-preview').addEventListener('click', updatePreview);
$('#mail-html').addEventListener('input', () => { clearTimeout(updatePreview.timer); updatePreview.timer = setTimeout(updatePreview, 450); });
$('#logo-url').addEventListener('input', () => { clearTimeout(updatePreview.timer); updatePreview.timer = setTimeout(updatePreview, 450); });
$('#save-template').addEventListener('click', () => saveTemplate().catch((error) => toast(errorMessage(error), true)));
$('#copy-prompt').addEventListener('click', async () => {
  const variables = [...new Set(['email', 'logoUrl', ...state.fields])].map((field) => `{{${field}}}`).join(', ');
  const fullPrompt = `${agentPrefix}\n\nAvailable variables from the imported spreadsheet:\n${variables}\n\n${$('#prompt-continuation').value.trim()}`;
  try { await navigator.clipboard.writeText(fullPrompt); toast('Full agent prompt copied.'); }
  catch { toast('Could not access the clipboard.', true); }
});

$('#available-variables').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-variable]');
  if (!button) return;
  try { await navigator.clipboard.writeText(`{{${button.dataset.variable}}}`); toast(`Copied {{${button.dataset.variable}}}`); }
  catch { toast('Could not access the clipboard.', true); }
});

$('#send-campaign').addEventListener('click', () => {
  const payload = templatePayload();
  if (!payload.subject || !payload.html) { toast('Add a subject and HTML template first.', true); return; }
  if (!state.recipients.length) { toast('Import at least one recipient first.', true); return; }
  $('#confirm-copy').textContent = `This will send “${payload.subject}” to ${state.recipients.length} recipient${state.recipients.length === 1 ? '' : 's'} in batches of 20.`;
  $('#confirm-modal').classList.remove('hidden');
});
$('#cancel-send').addEventListener('click', () => $('#confirm-modal').classList.add('hidden'));
$('#confirm-send').addEventListener('click', async () => {
  $('#confirm-modal').classList.add('hidden');
  state.sending = true;
  $('#send-campaign').disabled = true;
  $('#send-campaign').textContent = 'Sending…';
  $('#send-progress').classList.remove('hidden');
  $('#progress-fill').style.width = '0%';
  try {
    const result = await window.mailApp.sendCampaign(templatePayload());
    toast(`Campaign complete: ${result.sent} sent, ${result.failed} failed.`);
    $('#progress-title').textContent = 'Campaign complete';
    $('#progress-text').textContent = `${result.sent} sent · ${result.failed} failed`;
    await loadHistory();
  } catch (error) {
    toast(errorMessage(error), true);
    $('#progress-title').textContent = 'Sending stopped';
    $('#progress-text').textContent = errorMessage(error);
  } finally {
    state.sending = false;
    $('#send-campaign').disabled = false;
    $('#send-campaign').textContent = 'Send campaign';
  }
});

window.mailApp.onProgress((progress) => {
  const percent = Math.round((progress.processed / progress.total) * 100);
  $('#progress-title').textContent = `Sending batch ${progress.batch}`;
  $('#progress-text').textContent = `${progress.processed} of ${progress.total} processed · ${progress.failed} failed`;
  $('#progress-fill').style.width = `${percent}%`;
});

$('#save-settings').addEventListener('click', () => saveSettings().catch((error) => toast(errorMessage(error), true)));
$('#test-smtp').addEventListener('click', async () => {
  const button = $('#test-smtp');
  const resultBox = $('#test-result');
  button.disabled = true; button.textContent = 'Testing…'; resultBox.className = 'test-result hidden';
  try {
    await saveSettings();
    const result = await window.mailApp.testSmtp($('#test-email').value.trim());
    resultBox.textContent = `Success — message accepted (${result.messageId || 'no message ID'}).`;
    resultBox.className = 'test-result success';
  } catch (error) {
    resultBox.textContent = errorMessage(error);
    resultBox.className = 'test-result error';
  } finally { button.disabled = false; button.textContent = 'Send test email'; }
});

$('#refresh-history').addEventListener('click', () => loadHistory().catch((error) => toast(errorMessage(error), true)));
$('#history-table').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-history-id]');
  if (!button) return;
  const items = await window.mailApp.getDeliveries(Number(button.dataset.historyId));
  $('#deliveries-table').innerHTML = items.length ? items.map((item) => `<tr><td>${escapeHtml(item.email)}</td><td><span class="status-pill ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td><td>${formatDate(item.sentAt)}</td><td>${escapeHtml(item.error || '—')}</td></tr>`).join('') : '<tr><td colspan="4">No delivery rows recorded.</td></tr>';
  $('#delivery-panel').classList.remove('hidden');
});
$('#close-deliveries').addEventListener('click', () => $('#delivery-panel').classList.add('hidden'));

bootstrap().catch((error) => toast(errorMessage(error), true));
