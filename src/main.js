const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const readXlsxFile = require('read-excel-file/node');
const { DatabaseSync } = require('node:sqlite');

let mainWindow;
let db;
let activeCampaign = false;

if (process.env.MAILSIMP_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.MAILSIMP_USER_DATA_DIR));
}

const DEFAULT_TEMPLATE = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;background:#f3f5f8;font-family:Vazirmatn,Tahoma,Arial,sans-serif;direction:rtl;text-align:right;color:#172033">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f8;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:16px;overflow:hidden">
        <tr><td style="padding:28px 32px;border-bottom:1px solid #e7eaf0">
          <!-- Replace with your public HTTPS logo URL -->
          <img src="{{logoUrl}}" alt="Logo" width="132" style="display:block;max-width:132px;height:auto">
        </td></tr>
        <tr><td style="padding:36px 32px">
          <h1 style="margin:0 0 16px;font-size:26px;line-height:1.5">سلام!</h1>
          <p style="margin:0 0 22px;font-size:16px;line-height:1.9">متن ایمیل فارسی یا English content را اینجا قرار دهید.</p>
          <a href="https://example.com" style="display:inline-block;background:#5d5fef;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-weight:700">مشاهده جزئیات</a>
        </td></tr>
        <tr><td style="padding:20px 32px;background:#fafbfc;color:#667085;font-size:12px;line-height:1.8">این ایمیل برای {{email}} ارسال شده است.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'mailsimp.sqlite');
  const legacyPaths = [
    path.join(app.getPath('userData'), 'batchmail.sqlite'),
    path.join(path.dirname(app.getPath('userData')), 'BatchMail Studio', 'batchmail.sqlite')
  ];
  const legacyPath = legacyPaths.find((candidate) => fs.existsSync(candidate));
  if (!fs.existsSync(dbPath) && legacyPath) fs.copyFileSync(legacyPath, dbPath);
  db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      source TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      subject TEXT NOT NULL DEFAULT '',
      html TEXT NOT NULL DEFAULT '',
      logo_url TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      total INTEGER NOT NULL DEFAULT 0,
      sent INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'sending',
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT NOT NULL DEFAULT '',
      sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(campaign_id) REFERENCES campaigns(id)
    );
  `);
  const recipientColumns = db.prepare('PRAGMA table_info(recipients)').all();
  if (!recipientColumns.some((column) => column.name === 'data_json')) {
    db.exec(`ALTER TABLE recipients ADD COLUMN data_json TEXT NOT NULL DEFAULT '{}'`);
  }
  db.prepare(`INSERT OR IGNORE INTO templates (id, subject, html, logo_url) VALUES (1, ?, ?, '')`)
    .run('A message from our team', DEFAULT_TEMPLATE);
  const defaults = {
    smtpHost: '', smtpPort: '587', smtpSecure: 'false', smtpUser: '', smtpPass: '',
    fromName: '', fromEmail: '', replyTo: '', batchDelay: '5'
  };
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(defaults)) insert.run(key, value);
}

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

function smtpConfig(settings) {
  return {
    host: settings.smtpHost,
    port: Number(settings.smtpPort || 587),
    secure: settings.smtpSecure === 'true',
    auth: settings.smtpUser ? { user: settings.smtpUser, pass: settings.smtpPass } : undefined,
    pool: true,
    maxConnections: 5,
    maxMessages: 20,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000
  };
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function parseCsv(input) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"' && quoted && input[index + 1] === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(value); value = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(value); value = '';
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
    } else value += char;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  return rows;
}

async function readSpreadsheet(filePath) {
  const rawRows = path.extname(filePath).toLowerCase() === '.csv'
    ? parseCsv(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''))
    : await readXlsxFile(filePath);
  if (!rawRows.length) return { columns: [], rows: [] };
  const columns = rawRows[0].map((value, index) => String(value ?? '').trim() || `Column ${index + 1}`);
  const rows = rawRows.slice(1).map((row) => Object.fromEntries(columns.map((column, index) => [column, String(row[index] ?? '')])));
  return { columns, rows };
}

function safeJson(value, fallback = {}) {
  try { return JSON.parse(value || '{}'); } catch { return fallback; }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function renderVariables(content, data, html = false) {
  return String(content).replace(/{{\s*([^{}]+?)\s*}}/g, (_match, rawKey) => {
    const key = rawKey.trim();
    const value = Object.prototype.hasOwnProperty.call(data, key) ? data[key] : '';
    return html ? escapeHtml(value) : String(value ?? '');
  });
}

function recipientFields() {
  const fields = new Set();
  for (const row of db.prepare('SELECT data_json FROM recipients').all()) {
    Object.keys(safeJson(row.data_json)).forEach((key) => fields.add(key));
  }
  return [...fields];
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 850,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#f5f7fb',
    title: 'MailSimp',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.on('console-message', (_event, details) => {
    if (details.level === 'error') console.error(`[renderer] ${details.message}`);
  });
  const screenshotPath = process.env.MAILSIMP_SCREENSHOT || process.env.BATCHMAIL_SCREENSHOT;
  if (screenshotPath) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const importFixture = process.env.MAILSIMP_IMPORT_FIXTURE || process.env.BATCHMAIL_IMPORT_FIXTURE;
        if (importFixture) {
          await mainWindow.webContents.executeJavaScript(`window.mailApp.importExcel(${JSON.stringify({
            filePath: importFixture,
            column: process.env.MAILSIMP_IMPORT_COLUMN || process.env.BATCHMAIL_IMPORT_COLUMN || 'email'
          })})`);
          await mainWindow.webContents.executeJavaScript('loadRecipients()');
        }
        const screenshotPage = process.env.MAILSIMP_SCREENSHOT_PAGE || process.env.BATCHMAIL_SCREENSHOT_PAGE;
        if (screenshotPage) {
          await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-page="${screenshotPage}"]')?.click()`);
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
        const image = await mainWindow.webContents.capturePage();
        fs.writeFileSync(screenshotPath, image.toPNG());
        app.quit();
      }, 1800);
    });
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  initDatabase();
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function registerIpc() {
  ipcMain.handle('app:bootstrap', () => ({
    settings: getSettings(),
    template: db.prepare('SELECT subject, html, logo_url AS logoUrl FROM templates WHERE id = 1').get(),
    recipientCount: db.prepare('SELECT COUNT(*) AS count FROM recipients').get().count,
    recipientFields: recipientFields(),
    recentCampaigns: db.prepare('SELECT * FROM campaigns ORDER BY id DESC LIMIT 6').all()
  }));

  ipcMain.handle('settings:save', (_event, settings) => {
    const allowed = ['smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'smtpPass', 'fromName', 'fromEmail', 'replyTo', 'batchDelay'];
    const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const key of allowed) upsert.run(key, String(settings[key] ?? ''));
    return { ok: true };
  });

  ipcMain.handle('smtp:test', async (_event, testEmail) => {
    const settings = getSettings();
    if (!validateEmail(testEmail)) throw new Error('Enter a valid test email address.');
    if (!settings.smtpHost || !settings.fromEmail) throw new Error('SMTP host and sender email are required.');
    const transporter = nodemailer.createTransport(smtpConfig(settings));
    try {
      await transporter.verify();
      const info = await transporter.sendMail({
        from: { name: settings.fromName || settings.fromEmail, address: settings.fromEmail },
        to: testEmail,
        replyTo: settings.replyTo || undefined,
        subject: 'MailSimp — SMTP test successful',
        html: '<div style="font-family:Arial,sans-serif;padding:24px"><h2>SMTP is working</h2><p>This test message was sent by MailSimp.</p></div>'
      });
      return { ok: true, messageId: info.messageId };
    } finally {
      transporter.close();
    }
  });

  ipcMain.handle('excel:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose an Excel or CSV file',
      properties: ['openFile'],
      filters: [{ name: 'Spreadsheets', extensions: ['xlsx', 'csv'] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    const { columns, rows } = await readSpreadsheet(filePath);
    return { filePath, fileName: path.basename(filePath), columns, preview: rows.slice(0, 5), rowCount: rows.length };
  });

  ipcMain.handle('excel:import', async (_event, { filePath, column }) => {
    if (!fs.existsSync(filePath)) throw new Error('The selected file no longer exists.');
    const { rows } = await readSpreadsheet(filePath);
    const insert = db.prepare(`
      INSERT INTO recipients (email, source, data_json) VALUES (?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET source = excluded.source, data_json = excluded.data_json
    `);
    let imported = 0;
    let skipped = 0;
    for (const row of rows) {
      const email = String(row[column] ?? '').trim().toLowerCase();
      if (!validateEmail(email)) { skipped += 1; continue; }
      insert.run(email, path.basename(filePath), JSON.stringify(row));
      imported += 1;
    }
    return { imported, skipped, total: db.prepare('SELECT COUNT(*) AS count FROM recipients').get().count };
  });

  ipcMain.handle('recipients:list', () => db.prepare('SELECT id, email, source, data_json AS dataJson, created_at AS createdAt FROM recipients ORDER BY id DESC').all()
    .map((row) => ({ ...row, fields: safeJson(row.dataJson) })));
  ipcMain.handle('recipients:fields', () => recipientFields());
  ipcMain.handle('recipients:add', (_event, email) => {
    const normalized = String(email || '').trim().toLowerCase();
    if (!validateEmail(normalized)) throw new Error('Enter a valid email address.');
    db.prepare(`INSERT OR IGNORE INTO recipients (email, source, data_json) VALUES (?, ?, '{}')`).run(normalized, 'Manual');
    return { ok: true };
  });
  ipcMain.handle('recipients:delete', (_event, id) => { db.prepare('DELETE FROM recipients WHERE id = ?').run(id); return { ok: true }; });
  ipcMain.handle('recipients:clear', () => { db.exec('DELETE FROM recipients'); return { ok: true }; });

  ipcMain.handle('template:save', (_event, template) => {
    db.prepare(`UPDATE templates SET subject = ?, html = ?, logo_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`)
      .run(String(template.subject || ''), String(template.html || ''), String(template.logoUrl || ''));
    return { ok: true };
  });

  ipcMain.handle('campaign:history', () => db.prepare('SELECT * FROM campaigns ORDER BY id DESC LIMIT 100').all());
  ipcMain.handle('campaign:deliveries', (_event, id) => db.prepare('SELECT email, status, error, sent_at AS sentAt FROM deliveries WHERE campaign_id = ? ORDER BY id').all(id));

  ipcMain.handle('campaign:send', async (_event, template) => {
    if (activeCampaign) throw new Error('A campaign is already sending.');
    const settings = getSettings();
    if (!settings.smtpHost || !settings.fromEmail) throw new Error('Configure SMTP host and sender email first.');
    if (!template.subject.trim() || !template.html.trim()) throw new Error('Subject and HTML template are required.');
    const recipients = db.prepare('SELECT email, data_json AS dataJson FROM recipients ORDER BY id').all();
    if (!recipients.length) throw new Error('Import at least one recipient first.');

    activeCampaign = true;
    db.prepare(`UPDATE templates SET subject = ?, html = ?, logo_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`)
      .run(template.subject, template.html, template.logoUrl || '');
    const campaign = db.prepare('INSERT INTO campaigns (subject, total) VALUES (?, ?)').run(template.subject, recipients.length);
    const campaignId = Number(campaign.lastInsertRowid);
    const transporter = nodemailer.createTransport(smtpConfig(settings));
    let sent = 0;
    let failed = 0;
    const batchSize = 20;
    const delayMs = Math.max(0, Number(settings.batchDelay || 5)) * 1000;
    const record = db.prepare('INSERT INTO deliveries (campaign_id, email, status, error) VALUES (?, ?, ?, ?)');

    try {
      await transporter.verify();
      for (let offset = 0; offset < recipients.length; offset += batchSize) {
        const batch = recipients.slice(offset, offset + batchSize);
        const results = await Promise.allSettled(batch.map(({ email, dataJson }) => {
          const variables = { ...safeJson(dataJson), email, logoUrl: template.logoUrl || '' };
          return transporter.sendMail({
            from: { name: settings.fromName || settings.fromEmail, address: settings.fromEmail },
            to: email,
            replyTo: settings.replyTo || undefined,
            subject: renderVariables(template.subject, variables),
            html: renderVariables(template.html, variables, true)
          });
        }));
        results.forEach((result, index) => {
          const email = batch[index].email;
          if (result.status === 'fulfilled') { sent += 1; record.run(campaignId, email, 'sent', ''); }
          else { failed += 1; record.run(campaignId, email, 'failed', String(result.reason?.message || result.reason || 'Unknown error')); }
        });
        db.prepare('UPDATE campaigns SET sent = ?, failed = ? WHERE id = ?').run(sent, failed, campaignId);
        mainWindow?.webContents.send('campaign:progress', { campaignId, total: recipients.length, sent, failed, processed: sent + failed, batch: Math.floor(offset / batchSize) + 1 });
        if (offset + batchSize < recipients.length && delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      db.prepare(`UPDATE campaigns SET status = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`).run(failed ? (sent ? 'completed_with_errors' : 'failed') : 'completed', campaignId);
      return { campaignId, total: recipients.length, sent, failed };
    } catch (error) {
      db.prepare(`UPDATE campaigns SET status = 'failed', sent = ?, failed = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`).run(sent, failed, campaignId);
      throw error;
    } finally {
      transporter.close();
      activeCampaign = false;
    }
  });
}
