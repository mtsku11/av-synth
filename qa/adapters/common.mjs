import fs from 'node:fs';
import path from 'node:path';

export function parseCliArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

export function finish(result, outputPath = null) {
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized);
  }
  process.stdout.write(serialized);
}

export function splitArgs(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function resolveConfiguredServer({
  commandEnv,
  argsEnv,
  fallback = null,
  rootEnv = null,
  rootScript = null,
  rootArgs = [],
}) {
  if (process.env[commandEnv]) {
    return {
      command: process.env[commandEnv],
      args: splitArgs(process.env[argsEnv]),
      source: `env:${commandEnv}`,
    };
  }
  if (rootEnv && rootScript && process.env[rootEnv]) {
    return {
      command: process.env.AV_SYNTH_VIDEO_QUALITY_PYTHON ?? 'python3',
      args: [path.join(process.env[rootEnv], rootScript), ...rootArgs],
      source: `env:${rootEnv}`,
    };
  }
  return fallback;
}

export function summarizeCsvRows(csvPath, { delimiter = ';', limit = 13 } = {}) {
  const raw = fs.readFileSync(csvPath, 'utf8').trim();
  if (!raw) return [];
  const rows = raw
    .split(/\r?\n/)
    .map((row) =>
      row
        .split(delimiter)
        .map((cell) => Number(cell))
        .filter((value) => Number.isFinite(value)),
    )
    .filter((row) => row.length);
  return rows.slice(0, limit).map((row, index) => ({
    index,
    mean: row.reduce((sum, value) => sum + value, 0) / row.length,
    min: row.reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY),
    max: row.reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY),
  }));
}

export function summarizeChromaCsv(csvPath, limit = 12) {
  const raw = fs.readFileSync(csvPath, 'utf8').trim();
  if (!raw) return [];
  const totals = new Map();
  for (const line of raw.split(/\r?\n/).slice(1)) {
    const [note, , amplitude] = line.split(',');
    const value = Number(amplitude);
    if (!note || !Number.isFinite(value)) continue;
    totals.set(note, (totals.get(note) ?? 0) + value);
  }
  return [...totals.entries()]
    .map(([note, totalAmplitude]) => ({ note, totalAmplitude }))
    .sort((left, right) => right.totalAmplitude - left.totalAmplitude)
    .slice(0, limit);
}
