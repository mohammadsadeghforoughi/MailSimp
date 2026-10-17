const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'site');
const output = path.join(root, 'dist-site');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const repository = process.env.GITHUB_REPOSITORY || 'example/mailsimp';
const repositoryUrl = `https://github.com/${repository}`;
const defaultSiteUrl = `https://${repository.split('/')[0]}.github.io/${repository.split('/')[1]}/`;
const siteUrl = `${process.env.SITE_URL || defaultSiteUrl}`.replace(/\/?$/, '/');

fs.rmSync(output, { recursive: true, force: true });
fs.cpSync(source, output, { recursive: true });
fs.copyFileSync(path.join(root, 'assets', 'icon.png'), path.join(output, 'assets', 'icon.png'));

const replacements = {
  '__REPOSITORY_URL__': repositoryUrl,
  '__SITE_URL__': siteUrl,
  '__VERSION__': pkg.version
};

function renderDirectory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      renderDirectory(entryPath);
      continue;
    }
    if (!/\.(html|txt|xml|webmanifest)$/.test(entry.name)) continue;
    let content = fs.readFileSync(entryPath, 'utf8');
    for (const [token, value] of Object.entries(replacements)) content = content.replaceAll(token, value);
    fs.writeFileSync(entryPath, content);
  }
}

renderDirectory(output);
console.log(`Built MailSimp site in ${output}`);
