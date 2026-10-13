import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { availableModels } from './llm.ts';
import { missingValue, parseArgs } from './util.ts';

// One command for a shopkeeper or the demo: `npm run app` (add `-- --open` to open the browser).
// It checks Node, Ollama and the model, says what's missing, and starts the server. It never downloads anything:
// a missing model gets the exact `ollama pull` command, and the server matches fuzzy-only until the model is there.
// Every other flag (--catalog, --port, --data, --model, --url, …) is passed to the server unchanged.

export function nodeVersionOk(version: string): boolean {
  return Number(/^v?(\d+)\./.exec(version)?.[1] ?? 0) >= 24;
}

export function openCommand(platform: string, url: string): [string, string[]] {
  if (platform === 'darwin') return ['open', [url]];
  if (platform === 'win32') return ['cmd', ['/c', 'start', '', url]];
  return ['xdg-open', [url]];
}

function openBrowser(url: string) {
  const [cmd, cmdArgs] = openCommand(process.platform, url);
  console.log(`Opening ${url} in your browser.`);
  const opener = spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true });
  opener.on('error', () => console.log(`Couldn't open a browser. Open ${url} yourself.`));
  opener.unref();
}

async function main() {
  if (!nodeVersionOk(process.version)) {
    console.error(`ParchiMatch Lite needs Node.js 24 or newer; this is ${process.version}. Install it from https://nodejs.org (or: brew install node).`);
    process.exit(1);
  }
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const usageError = missingValue(args, { model: 'gemma4:e2b-it-qat', url: 'http://127.0.0.1:11434' });
  if (usageError) {
    console.error(usageError);
    process.exit(1);
  }
  const model = String(args.model ?? 'gemma4:e2b-it-qat');
  const ollamaUrl = String(args.url ?? 'http://127.0.0.1:11434');

  // The server checks the model on every request, so starting Ollama or pulling the model later needs no restart.
  const models = await availableModels(ollamaUrl, AbortSignal.timeout(3000));
  if (models === null) {
    console.log(`Ollama isn't running at ${ollamaUrl}.`);
    console.log('Starting with fuzzy matching only (no local model). To use the model, start Ollama (brew services start ollama, or open the Ollama app).');
  } else if (!models.includes(model)) {
    console.log(`Model ${model} isn't downloaded. To download it (needs internet), run:\n  ollama pull ${model}\n`);
    console.log('Starting with fuzzy matching only until then.');
  } else {
    console.log(`Model ${model} is ready.`);
  }

  const root = resolve(import.meta.dirname, '..');
  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', resolve(root, 'src/server.ts'), ...argv.filter((a) => a !== '--open')], {
    cwd: root,
    stdio: ['inherit', 'pipe', 'inherit'],
  });
  let printed = '';
  let opened = !args.open;
  server.stdout!.on('data', (chunk: Buffer) => {
    process.stdout.write(chunk);
    if (opened) return;
    printed += chunk.toString();
    const address = /ParchiMatch Lite → (http:\/\/127\.0\.0\.1:\d+)/.exec(printed);
    if (address) {
      opened = true;
      openBrowser(address[1]);
    }
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.kill(signal));
  server.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

// import.meta.main is missing before Node 22.18; fall back to the script path so the Node check above still runs there.
if (import.meta.main ?? resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
