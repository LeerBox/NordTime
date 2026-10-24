// Builds dist/nordtime-v<version>.zip containing only the files the extension needs.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(`${root}manifest.json`, 'utf8'));
const out = `dist/nordtime-v${version}.zip`;

mkdirSync(`${root}dist`, { recursive: true });
execFileSync('git', ['archive', '--format=zip', '-o', out, 'HEAD', 'manifest.json', 'icons', 'src', 'LICENSE'], { cwd: root, stdio: 'inherit' });
console.log(out);
