import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { parseCliArgs, finish, splitArgs } from './common.mjs';

function commandExists(command) {
  const result = spawnSync('/bin/zsh', ['-lc', `command -v ${JSON.stringify(command)}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return result.status === 0;
}

function resolveCommand() {
  if (process.env.AV_SYNTH_FFMPEG_QUALITY_METRICS_COMMAND) {
    return {
      command: process.env.AV_SYNTH_FFMPEG_QUALITY_METRICS_COMMAND,
      args: splitArgs(process.env.AV_SYNTH_FFMPEG_QUALITY_METRICS_ARGS_JSON),
      source: 'env:AV_SYNTH_FFMPEG_QUALITY_METRICS_COMMAND',
    };
  }
  if (commandExists('ffmpeg-quality-metrics')) {
    return {
      command: 'ffmpeg-quality-metrics',
      args: [],
      source: 'path:ffmpeg-quality-metrics',
    };
  }
  if (commandExists('uvx')) {
    return {
      command: 'uvx',
      args: ['ffmpeg-quality-metrics'],
      source: 'path:uvx',
    };
  }
  return null;
}

function probeFps(inputPath, ffmpegPath) {
  const parsed = JSON.parse(
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'stream=avg_frame_rate,r_frame_rate',
        '-select_streams',
        'v:0',
        '-of',
        'json',
        inputPath,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${path.dirname(ffmpegPath)}:${process.env.PATH ?? ''}`,
        },
      },
    ),
  );
  const stream = parsed.streams?.[0];
  const parseRate = (raw) => {
    if (!raw || raw === '0/0') return null;
    const [numeratorRaw, denominatorRaw] = String(raw).split('/');
    const numerator = Number(numeratorRaw);
    const denominator = Number(denominatorRaw ?? '1');
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
      return null;
    }
    const value = numerator / denominator;
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  const candidates = [parseRate(stream?.avg_frame_rate), parseRate(stream?.r_frame_rate)].filter(
    (value) => typeof value === 'number' && value <= 240,
  );
  if (candidates.length) return candidates[0];

  const configured = Number(process.env.AV_SYNTH_FFMPEG_QUALITY_METRICS_FRAMERATE ?? '60');
  return Number.isFinite(configured) && configured > 0 ? configured : 60;
}

function supportsLibvmaf(ffmpegPath) {
  const output = execFileSync(ffmpegPath, ['-hide_banner', '-filters'], { encoding: 'utf8' });
  return /\blibvmaf\b/.test(output);
}

function cleanNumber(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';
  return value;
}

function summarizeMetric(metricData) {
  if (!metricData || typeof metricData !== 'object') return null;
  const summary = {};
  for (const [field, stats] of Object.entries(metricData)) {
    if (!stats || typeof stats !== 'object') continue;
    if (!('average' in stats)) continue;
    summary[field] = {
      average: cleanNumber(stats.average),
      median: cleanNumber(stats.median),
      stdev: cleanNumber(stats.stdev),
      min: cleanNumber(stats.min),
      max: cleanNumber(stats.max),
    };
  }
  return Object.keys(summary).length ? summary : null;
}

function buildSummary(result) {
  const global = result?.global;
  if (!global || typeof global !== 'object') return null;
  return {
    psnr: summarizeMetric(global.psnr),
    ssim: summarizeMetric(global.ssim),
    vmaf: summarizeMetric(global.vmaf),
    vif: summarizeMetric(global.vif),
    msad: summarizeMetric(global.msad),
  };
}

function buildFrameCounts(result) {
  return Object.fromEntries(
    ['psnr', 'ssim', 'vmaf', 'vif', 'msad']
      .filter((metric) => Array.isArray(result?.[metric]))
      .map((metric) => [metric, result[metric].length]),
  );
}

function parseMetricsJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const normalized = raw
    .replace(/\b-Infinity\b/g, '"-Infinity"')
    .replace(/\bInfinity\b/g, '"Infinity"')
    .replace(/\bNaN\b/g, 'null');
  return JSON.parse(normalized);
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.input);
  const referencePath = path.resolve(args.reference);
  const outputPath = args.output ? path.resolve(args.output) : null;

  if (!fs.existsSync(inputPath) || !fs.existsSync(referencePath)) {
    finish(
      {
        status: 'failed',
        error: 'Missing input or reference file',
        input: inputPath,
        reference: referencePath,
      },
      outputPath,
    );
    return;
  }

  const commandConfig = resolveCommand();
  if (!commandConfig) {
    finish(
      {
        status: 'not_available',
        tool: 'ffmpeg-quality-metrics',
        reason:
          'Install ffmpeg-quality-metrics or set AV_SYNTH_FFMPEG_QUALITY_METRICS_COMMAND / AV_SYNTH_FFMPEG_QUALITY_METRICS_ARGS_JSON.',
      },
      outputPath,
    );
    return;
  }

  const ffmpegPath = process.env.AV_SYNTH_FFMPEG_QUALITY_METRICS_FFMPEG_PATH ?? 'ffmpeg';
  const framerate = probeFps(referencePath, ffmpegPath);
  const libvmafAvailable = supportsLibvmaf(ffmpegPath);
  const metrics = ['psnr', 'ssim'];
  if (libvmafAvailable) metrics.push('vmaf');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-synth-ffqm-'));
  const metricsPath = path.join(tmpDir, 'metrics.json');

  try {
    const commandArgs = [
      ...commandConfig.args,
      '--ffmpeg-path',
      ffmpegPath,
      '--framerate',
      String(framerate),
      '-o',
      metricsPath,
      '-m',
      ...metrics,
      '--',
      inputPath,
      referencePath,
    ];

    const stdout = execFileSync(commandConfig.command, commandArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const result = parseMetricsJson(metricsPath);

    finish(
      {
        status: 'ok',
        tool: 'ffmpeg-quality-metrics',
        command: {
          command: commandConfig.command,
          args: commandArgs,
          source: commandConfig.source,
        },
        input: inputPath,
        reference: referencePath,
        capabilities: {
          ffmpegPath,
          framerate,
          libvmafAvailable,
          requestedMetrics: metrics,
        },
        warnings: [
          ...(!libvmafAvailable
            ? [
                'VMAF skipped because the configured ffmpeg build does not expose libvmaf. Set AV_SYNTH_FFMPEG_QUALITY_METRICS_FFMPEG_PATH to a libvmaf-enabled ffmpeg build to enable it.',
              ]
            : []),
        ],
        summary: buildSummary(result),
        global: result.global ?? null,
        frameCounts: buildFrameCounts(result),
        stdout: stdout || null,
      },
      outputPath,
    );
  } catch (error) {
    finish(
      {
        status: 'failed',
        tool: 'ffmpeg-quality-metrics',
        command: commandConfig,
        input: inputPath,
        reference: referencePath,
        capabilities: {
          ffmpegPath,
          framerate,
          libvmafAvailable,
          requestedMetrics: metrics,
        },
        error:
          error instanceof Error && 'stderr' in error
            ? String(error.stderr ?? '').trim()
            : error instanceof Error
              ? error.message
              : String(error),
      },
      outputPath,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

await main();
