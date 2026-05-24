import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

import { findArtifact } from './artifacts.js';

const ROOT = process.cwd();
const CASES_DIR = path.join(ROOT, 'qa/cases');
const RESULTS_DIR = path.join(ROOT, 'qa/results/playwright/test-results');
const CONFIG_PATH = path.join(ROOT, 'qa/analyzers.config.json');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadQaCases(casePattern = null) {
  return fs
    .readdirSync(CASES_DIR)
    .filter((entry) => entry.endsWith('.json'))
    .sort()
    .map((entry) => loadJson(path.join(CASES_DIR, entry)))
    .filter((qaCase) => (casePattern ? casePattern.test(qaCase.id) : true));
}

function maybeLoadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  return loadJson(CONFIG_PATH);
}

function defaultReferenceVideo(qaCase) {
  if (!qaCase.recording?.filename) return null;
  const candidate = path.join(ROOT, 'qa/references', `${qaCase.recording.filename}.webm`);
  return fs.existsSync(candidate) ? candidate : null;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function statFile(filePath) {
  const stat = fs.statSync(filePath);
  return {
    path: path.relative(ROOT, filePath),
    bytes: stat.size,
    sha256: sha256File(filePath),
    modifiedAt: stat.mtime.toISOString(),
  };
}

function probeMedia(filePath) {
  return JSON.parse(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_format', '-show_streams', '-print_format', 'json', filePath],
      { encoding: 'utf8' },
    ),
  );
}

function getStream(probe, codecType) {
  return probe.streams?.find((stream) => stream.codec_type === codecType) ?? null;
}

function getDurationSeconds(probe) {
  const fromFormat = Number(probe.format?.duration ?? NaN);
  if (Number.isFinite(fromFormat) && fromFormat > 0) return fromFormat;
  const streamDuration = Number(probe.streams?.find((stream) => stream.duration)?.duration ?? NaN);
  return Number.isFinite(streamDuration) && streamDuration > 0 ? streamDuration : null;
}

function extractWav(webmPath, wavPath) {
  execFileSync(
    'ffmpeg',
    ['-y', '-i', webmPath, '-vn', '-acodec', 'pcm_s16le', '-ar', '48000', '-ac', '2', wavPath],
    { stdio: 'pipe' },
  );
}

function measureVolume(wavPath, startSeconds = null, durationSeconds = null) {
  return measureVolumeWithFilter(wavPath, startSeconds, durationSeconds);
}

function measureVolumeWithFilter(
  wavPath,
  startSeconds = null,
  durationSeconds = null,
  filterPrefix = null,
) {
  const args = ['-hide_banner'];
  if (typeof startSeconds === 'number') args.push('-ss', startSeconds.toFixed(6));
  if (typeof durationSeconds === 'number') args.push('-t', durationSeconds.toFixed(6));
  const filter = filterPrefix ? `${filterPrefix},volumedetect` : 'volumedetect';
  args.push('-i', wavPath, '-af', filter, '-f', 'null', '-');
  const result = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  return parseVolumeOutput(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
}

function parseVolumeOutput(output) {
  const meanMatch = output.match(/mean_volume:\s*(-?\d+(?:\.\d+)?) dB/);
  const maxMatch = output.match(/max_volume:\s*(-?\d+(?:\.\d+)?) dB/);
  return {
    meanDb: meanMatch ? Number(meanMatch[1]) : null,
    maxDb: maxMatch ? Number(maxMatch[1]) : null,
  };
}

function listScreenshots(dirPath) {
  return fs
    .readdirSync(dirPath)
    .filter((entry) => entry.endsWith('.png'))
    .sort()
    .map((entry) => path.relative(ROOT, path.join(dirPath, entry)));
}

function maybeLoadMetrics(caseDir) {
  const metricsPath = path.join(caseDir, 'metrics.json');
  if (!fs.existsSync(metricsPath)) return null;
  return loadJson(metricsPath);
}

function parseMetricNumber(raw) {
  if (!raw) return null;
  if (raw === 'inf' || raw === '-inf') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readLastLabeledValue(output, label) {
  const regex = new RegExp(
    `${escapeRegExp(label)}:\\s*(-?(?:inf|\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?))`,
    'g',
  );
  let match = regex.exec(output);
  let last = null;
  while (match) {
    last = parseMetricNumber(match[1]);
    match = regex.exec(output);
  }
  return last;
}

function runFfmpegFilter(inputPath, startSeconds, durationSeconds, filter) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-ss',
      startSeconds.toFixed(6),
      '-t',
      durationSeconds.toFixed(6),
      '-i',
      inputPath,
      '-af',
      filter,
      '-f',
      'null',
      '-',
    ],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (result.status !== 0) throw new Error(output.trim() || 'ffmpeg filter run failed');
  return output;
}

function measureAstats(wavPath, startSeconds, durationSeconds, filterPrefix = null) {
  const filter = filterPrefix
    ? `${filterPrefix},astats=metadata=0:reset=0`
    : 'astats=metadata=0:reset=0';
  const output = runFfmpegFilter(wavPath, startSeconds, durationSeconds, filter);
  return {
    rmsLevelDb: readLastLabeledValue(output, 'RMS level dB'),
    peakLevelDb: readLastLabeledValue(output, 'Peak level dB'),
    zeroCrossingRate: readLastLabeledValue(output, 'Zero crossings rate'),
    dynamicRange: readLastLabeledValue(output, 'Dynamic range'),
    crestFactor: readLastLabeledValue(output, 'Crest factor'),
  };
}

function measureAspectralStats(wavPath, startSeconds, durationSeconds, filterPrefix = null) {
  const filter = filterPrefix
    ? `${filterPrefix},aspectralstats=measure=centroid+spread+flatness+flux:win_size=2048:overlap=0.5,ametadata=print:file=-`
    : 'aspectralstats=measure=centroid+spread+flatness+flux:win_size=2048:overlap=0.5,ametadata=print:file=-';
  const output = runFfmpegFilter(wavPath, startSeconds, durationSeconds, filter);
  const values = {
    spectralCentroidHz: [],
    spectralSpreadHz: [],
    spectralFlatness: [],
    spectralFlux: [],
  };
  for (const line of output.split('\n')) {
    const match = line.match(
      /^lavfi\.aspectralstats\.\d+\.(centroid|spread|flatness|flux)=(-?(?:inf|\d+(?:\.\d+)?(?:e[+-]?\d+)?))$/,
    );
    if (!match) continue;
    const value = parseMetricNumber(match[2]);
    if (value === null) continue;
    if (match[1] === 'centroid') values.spectralCentroidHz.push(value);
    if (match[1] === 'spread') values.spectralSpreadHz.push(value);
    if (match[1] === 'flatness') values.spectralFlatness.push(value);
    if (match[1] === 'flux') values.spectralFlux.push(value);
  }
  const mean = (samples) =>
    samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : null;
  return {
    spectralCentroidHz: mean(values.spectralCentroidHz),
    spectralSpreadHz: mean(values.spectralSpreadHz),
    spectralFlatness: mean(values.spectralFlatness),
    spectralFlux: mean(values.spectralFlux),
  };
}

function measureChannelAudio(wavPath, startSeconds, durationSeconds, channelIndex) {
  const channelFilter = `pan=mono|c0=c${channelIndex}`;
  const volume = measureVolumeWithFilter(wavPath, startSeconds, durationSeconds, channelFilter);
  const astats = measureAstats(wavPath, startSeconds, durationSeconds, channelFilter);
  const spectral = measureAspectralStats(wavPath, startSeconds, durationSeconds, channelFilter);
  return {
    meanVolumeDb: volume.meanDb,
    maxVolumeDb: volume.maxDb,
    ...astats,
    ...spectral,
  };
}

function differenceOrNull(left, right) {
  return typeof left === 'number' && typeof right === 'number' ? left - right : null;
}

function getCheckpointSegment(snapshot, wavDurationSeconds, paddingMs = 120) {
  const start = snapshot?.timing?.captureStartSeconds;
  const end = snapshot?.timing?.captureEndSeconds;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const paddedStart = Math.max(0, start - paddingMs / 1000);
  const paddedEnd = Math.min(wavDurationSeconds, end + paddingMs / 1000);
  if (!(paddedEnd > paddedStart)) return null;
  return {
    startSeconds: paddedStart,
    endSeconds: paddedEnd,
    durationSeconds: paddedEnd - paddedStart,
  };
}

function measureSegmentAudio(wavPath, segment) {
  const volume = measureVolume(wavPath, segment.startSeconds, segment.durationSeconds);
  const astats = measureAstats(wavPath, segment.startSeconds, segment.durationSeconds);
  const spectral = measureAspectralStats(wavPath, segment.startSeconds, segment.durationSeconds);
  const left = measureChannelAudio(wavPath, segment.startSeconds, segment.durationSeconds, 0);
  const right = measureChannelAudio(wavPath, segment.startSeconds, segment.durationSeconds, 1);
  return {
    startSeconds: segment.startSeconds,
    endSeconds: segment.endSeconds,
    durationSeconds: segment.durationSeconds,
    meanVolumeDb: volume.meanDb,
    maxVolumeDb: volume.maxDb,
    ...astats,
    ...spectral,
    leftMeanVolumeDb: left.meanVolumeDb,
    rightMeanVolumeDb: right.meanVolumeDb,
    leftMaxVolumeDb: left.maxVolumeDb,
    rightMaxVolumeDb: right.maxVolumeDb,
    leftRmsLevelDb: left.rmsLevelDb,
    rightRmsLevelDb: right.rmsLevelDb,
    leftPeakLevelDb: left.peakLevelDb,
    rightPeakLevelDb: right.peakLevelDb,
    leftZeroCrossingRate: left.zeroCrossingRate,
    rightZeroCrossingRate: right.zeroCrossingRate,
    leftSpectralCentroidHz: left.spectralCentroidHz,
    rightSpectralCentroidHz: right.spectralCentroidHz,
    leftSpectralSpreadHz: left.spectralSpreadHz,
    rightSpectralSpreadHz: right.spectralSpreadHz,
    leftSpectralFlatness: left.spectralFlatness,
    rightSpectralFlatness: right.spectralFlatness,
    leftSpectralFlux: left.spectralFlux,
    rightSpectralFlux: right.spectralFlux,
    leftMinusRightMeanVolumeDb: differenceOrNull(left.meanVolumeDb, right.meanVolumeDb),
    leftMinusRightRmsLevelDb: differenceOrNull(left.rmsLevelDb, right.rmsLevelDb),
    leftMinusRightPeakLevelDb: differenceOrNull(left.peakLevelDb, right.peakLevelDb),
    leftMinusRightZeroCrossingRate: differenceOrNull(left.zeroCrossingRate, right.zeroCrossingRate),
    leftMinusRightSpectralCentroidHz: differenceOrNull(
      left.spectralCentroidHz,
      right.spectralCentroidHz,
    ),
    leftMinusRightSpectralSpreadHz: differenceOrNull(left.spectralSpreadHz, right.spectralSpreadHz),
    leftMinusRightSpectralFlatness: differenceOrNull(left.spectralFlatness, right.spectralFlatness),
    leftMinusRightSpectralFlux: differenceOrNull(left.spectralFlux, right.spectralFlux),
  };
}

function readComparisonMetric(snapshot, comparison) {
  if (comparison.source === 'exported-audio') {
    const value = snapshot?.metrics?.[comparison.metric];
    return typeof value === 'number' ? value : null;
  }
  const domainMetrics = comparison.domain === 'audio' ? snapshot?.audio : snapshot?.video;
  if (!domainMetrics) return null;
  const value = domainMetrics[comparison.metric];
  return typeof value === 'number' ? value : null;
}

function evaluateComparison(metricCheckpoints, comparison) {
  const from = metricCheckpoints[comparison.from];
  const to = metricCheckpoints[comparison.to];
  if (!from || !to) {
    return {
      comparison,
      status: 'missing',
      reason: `Missing checkpoint(s): ${comparison.from}, ${comparison.to}`,
    };
  }

  const fromValue = readComparisonMetric(from, comparison);
  const toValue = readComparisonMetric(to, comparison);
  if (fromValue === null || toValue === null) {
    return {
      comparison,
      status: 'missing',
      reason: `Missing metric ${comparison.metric} for ${comparison.from} or ${comparison.to}`,
    };
  }

  const actualDelta = toValue - fromValue;
  const threshold = comparison.delta ?? 0;
  let passed = false;
  if (comparison.op === '>') passed = actualDelta > threshold;
  if (comparison.op === '>=') passed = actualDelta >= threshold;
  if (comparison.op === '<') passed = actualDelta < threshold;
  if (comparison.op === '<=') passed = actualDelta <= threshold;

  return {
    comparison,
    status: passed ? 'passed' : 'failed',
    fromValue,
    toValue,
    actualDelta,
    threshold,
  };
}

function buildExportedAudioAnalysis(qaCase, wavPath, wavProbe, liveMetrics) {
  const comparisons = (qaCase.expectations?.metricComparisons ?? []).filter(
    (comparison) => comparison.source === 'exported-audio',
  );
  if (!comparisons.length || !liveMetrics?.checkpoints) return null;

  const wavDurationSeconds = getDurationSeconds(wavProbe);
  if (!wavDurationSeconds) {
    return {
      checkpoints: {},
      comparisons: comparisons.map((comparison) => ({
        comparison,
        status: 'missing',
        reason: 'Missing WAV duration',
      })),
    };
  }

  const checkpoints = {};
  for (const comparison of comparisons) {
    for (const checkpointId of [comparison.from, comparison.to]) {
      const cacheKey = `${checkpointId}:${comparison.segmentPaddingMs ?? 120}`;
      if (checkpoints[cacheKey]) continue;
      const snapshot = liveMetrics.checkpoints?.[checkpointId];
      const segment = getCheckpointSegment(
        snapshot,
        wavDurationSeconds,
        comparison.segmentPaddingMs,
      );
      checkpoints[cacheKey] = {
        checkpointId,
        ...(segment
          ? { metrics: measureSegmentAudio(wavPath, segment), segment }
          : { metrics: null, segment: null }),
      };
    }
  }

  const comparisonResults = comparisons.map((comparison) =>
    evaluateComparison(
      Object.fromEntries(
        [comparison.from, comparison.to].map((checkpointId) => {
          const cacheKey = `${checkpointId}:${comparison.segmentPaddingMs ?? 120}`;
          return [checkpointId, checkpoints[cacheKey]];
        }),
      ),
      comparison,
    ),
  );

  return {
    checkpoints,
    comparisons: comparisonResults,
  };
}

function expandTemplate(template, replacements) {
  return template.replace(/\{(\w+)\}/g, (_, key) => replacements[key] ?? '');
}

function runAdapter(name, adapter, replacements) {
  if (!adapter?.command || !Array.isArray(adapter.args)) {
    return {
      status: 'not_configured',
      tool: name,
    };
  }

  const args = adapter.args.map((arg) => expandTemplate(arg, replacements));
  try {
    const stdout = execFileSync(adapter.command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const output = stdout ? JSON.parse(stdout) : null;
    return {
      status: output?.status ?? 'ok',
      tool: name,
      command: [adapter.command, ...args].join(' '),
      output,
    };
  } catch (error) {
    const stderr =
      error instanceof Error && 'stderr' in error
        ? String(error.stderr ?? '').trim()
        : String(error);
    return {
      status: 'failed',
      tool: name,
      command: [adapter.command, ...args].join(' '),
      error: stderr,
    };
  }
}

function buildHeuristics(
  qaCase,
  webmProbe,
  wavProbe,
  audioVolume,
  screenshots,
  exportedAudio,
  videoReference,
) {
  const flags = [];
  const videoStream = getStream(webmProbe, 'video');
  const audioStream = getStream(webmProbe, 'audio') ?? getStream(wavProbe, 'audio');
  const webmDuration = getDurationSeconds(webmProbe);
  const wavDuration = getDurationSeconds(wavProbe);

  if (!videoStream) flags.push('missing-video-stream');
  if (!audioStream) flags.push('missing-audio-stream');
  if (!screenshots.length) flags.push('missing-screenshots');
  if (webmDuration !== null && webmDuration < 1) flags.push('very-short-webm');
  if (wavDuration !== null && wavDuration < 1) flags.push('very-short-wav');
  if (audioVolume.maxDb !== null && audioVolume.maxDb > -1) flags.push('clipping-risk');
  if (audioVolume.meanDb !== null && audioVolume.meanDb < -45) flags.push('very-quiet-audio');
  if (qaCase.audit && !videoReference) flags.push('no-reference-video');
  if (exportedAudio?.comparisons?.some((result) => result.status === 'failed')) {
    flags.push('failed-exported-audio-assertions');
  }
  if (exportedAudio?.comparisons?.some((result) => result.status === 'missing')) {
    flags.push('missing-exported-audio-assertions');
  }

  return {
    flags,
    reviewFocus: [...(qaCase.audit?.manualChecks ?? []), ...flags],
  };
}

function buildCaseAnalysis(qaCase, config) {
  if (!qaCase.recording?.filename) {
    return {
      caseId: qaCase.id,
      status: 'skipped',
      reason: 'Case has no recording configuration',
    };
  }

  const webmName = `${qaCase.recording.filename}.webm`;
  const webmPath = findArtifact(RESULTS_DIR, qaCase.id, webmName);
  if (!webmPath) {
    return {
      caseId: qaCase.id,
      status: 'missing',
      reason: `Recording artifact not found: ${webmName}`,
    };
  }

  const caseDir = path.dirname(webmPath);
  const wavPath = path.join(caseDir, `${qaCase.recording.filename}.wav`);
  extractWav(webmPath, wavPath);

  const webmProbe = probeMedia(webmPath);
  const wavProbe = probeMedia(wavPath);
  const screenshots = listScreenshots(caseDir);
  const liveMetrics = maybeLoadMetrics(caseDir);
  const audioVolume = measureVolume(wavPath);
  const exportedAudio = buildExportedAudioAnalysis(qaCase, wavPath, wavProbe, liveMetrics);
  const videoReference = qaCase.referenceVideo
    ? path.resolve(ROOT, qaCase.referenceVideo)
    : defaultReferenceVideo(qaCase);
  const replacements = {
    caseId: qaCase.id,
    caseDir,
    webm: webmPath,
    wav: wavPath,
    analysis: path.join(caseDir, 'analysis.json'),
    referenceVideo: videoReference ?? '',
  };

  const analysis = {
    caseId: qaCase.id,
    title: qaCase.title ?? qaCase.id,
    generatedAt: new Date().toISOString(),
    artifactDir: path.relative(ROOT, caseDir),
    status: 'ok',
    source: qaCase.source,
    recording: qaCase.recording,
    audit: qaCase.audit ?? null,
    artifacts: {
      webm: statFile(webmPath),
      wav: statFile(wavPath),
      screenshots,
      playwrightVideo: fs.existsSync(path.join(caseDir, 'video.webm'))
        ? statFile(path.join(caseDir, 'video.webm'))
        : null,
    },
    media: {
      webm: webmProbe,
      wav: wavProbe,
      audioVolume,
    },
    liveMetrics,
    exportedAudio,
    review: buildHeuristics(
      qaCase,
      webmProbe,
      wavProbe,
      audioVolume,
      screenshots,
      exportedAudio,
      videoReference,
    ),
    analyzers: {
      musicAnalysis: runAdapter('mcp-music-analysis', config.musicAnalysis, replacements),
      ffmpegQualityMetrics: videoReference
        ? runAdapter('ffmpeg-quality-metrics', config.ffmpegQualityMetrics, replacements)
        : {
            status: 'skipped',
            tool: 'ffmpeg-quality-metrics',
            reason: 'No referenceVideo configured for this case',
          },
      videoQuality: videoReference
        ? runAdapter('video-quality-mcp', config.videoQuality, replacements)
        : {
            status: 'skipped',
            tool: 'video-quality-mcp',
            reason: 'No referenceVideo configured for this case',
          },
      ffmpeg: {
        status: 'ok',
        tool: 'ffmpeg',
        wavExtraction: path.relative(ROOT, wavPath),
      },
    },
  };
  if (exportedAudio?.comparisons?.some((result) => result.status !== 'passed')) {
    analysis.status = 'failed';
  }

  fs.writeFileSync(path.join(caseDir, 'analysis.json'), `${JSON.stringify(analysis, null, 2)}\n`);
  return analysis;
}

function main() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const casePattern = process.argv[2] ? new RegExp(process.argv[2]) : null;
  const qaCases = loadQaCases(casePattern);
  const config = maybeLoadConfig();
  const results = qaCases.map((qaCase) => buildCaseAnalysis(qaCase, config));
  const families = Object.values(
    results.reduce((acc, result) => {
      const family = result.audit?.family ?? 'unclassified';
      const operator = result.audit?.operator ?? 'unclassified';
      const kind = result.audit?.kind ?? 'uncategorized';
      if (!acc[family]) {
        acc[family] = {
          family,
          total: 0,
          ok: 0,
          operators: {},
          cases: [],
        };
      }
      const entry = acc[family];
      entry.total += 1;
      if (result.status === 'ok') entry.ok += 1;
      entry.operators[operator] ??= [];
      if (!entry.operators[operator].includes(kind)) entry.operators[operator].push(kind);
      entry.cases.push({
        caseId: result.caseId,
        operator,
        kind,
        status: result.status,
        flags: result.review?.flags ?? [],
      });
      return acc;
    }, {}),
  ).sort((a, b) => a.family.localeCompare(b.family));
  const PATH_PRIORITY = {
    product: 0,
    'operator-regression': 1,
    'source-coverage': 2,
    unclassified: 3,
  };
  const paths = Object.values(
    results.reduce((acc, result) => {
      const pathKey = result.audit?.path ?? 'unclassified';
      if (!acc[pathKey]) {
        acc[pathKey] = { path: pathKey, total: 0, ok: 0, families: {}, cases: [] };
      }
      const entry = acc[pathKey];
      entry.total += 1;
      if (result.status === 'ok') entry.ok += 1;
      const fam = result.audit?.family ?? 'unclassified';
      entry.families[fam] ??= 0;
      entry.families[fam] += 1;
      entry.cases.push({
        caseId: result.caseId,
        family: fam,
        operator: result.audit?.operator ?? 'unclassified',
        kind: result.audit?.kind ?? 'uncategorized',
        status: result.status,
      });
      return acc;
    }, {}),
  ).sort((a, b) => (PATH_PRIORITY[a.path] ?? 99) - (PATH_PRIORITY[b.path] ?? 99));
  const summary = {
    generatedAt: new Date().toISOString(),
    cases: results,
    paths,
    families,
  };
  const summaryPath = path.join(RESULTS_DIR, 'analysis-summary.json');
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  const complete = results.filter((result) => result.status === 'ok').length;
  if (results.some((result) => result.status === 'failed')) process.exitCode = 1;
  console.log(
    `Wrote analysis for ${complete}/${results.length} cases to qa/results/playwright/test-results`,
  );
}

main();
