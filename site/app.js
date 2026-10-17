const screenshots = {
  overview: {
    src: 'assets/screenshots/overview.png',
    alt: 'MailSimp overview screen',
    caption: 'See recipient counts, delivery totals, and recent campaigns at a glance.'
  },
  recipients: {
    src: 'assets/screenshots/recipients.png',
    alt: 'MailSimp recipient import screen',
    caption: 'Import a spreadsheet, choose the email field, and review personalized recipient data.'
  },
  composer: {
    src: 'assets/screenshots/composer.png',
    alt: 'MailSimp bilingual HTML composer screen',
    caption: 'Edit HTML beside a live preview, with bilingual and right-to-left content supported.'
  }
};

document.querySelectorAll('.shot-tab').forEach((button) => {
  button.addEventListener('click', () => {
    const screenshot = screenshots[button.dataset.shot];
    document.querySelectorAll('.shot-tab').forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    const image = document.querySelector('#product-shot');
    image.src = screenshot.src;
    image.alt = screenshot.alt;
    document.querySelector('#shot-caption').textContent = screenshot.caption;
  });
});

const platform = navigator.userAgent.toLowerCase();
const preferred = platform.includes('windows')
  ? '.windows-download'
  : platform.includes('mac')
    ? '.mac-download'
    : '.linux-download';
document.querySelector(preferred)?.classList.add('recommended');
const preferredLink = document.querySelector(preferred)?.href;
if (preferredLink) document.querySelector('.recommended-download').href = preferredLink;
