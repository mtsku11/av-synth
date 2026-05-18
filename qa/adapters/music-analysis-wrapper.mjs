import fs from 'node:fs';
import path from 'node:path';
import {
  parseCliArgs,
  finish,
  resolveConfiguredServer,
  summarizeChromaCsv,
  summarizeCsvRows,
} from './common.mjs';
import { McpStdioClient } from './mcp-stdio-client.mjs';

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.input);
  const outputPath = args.output ? path.resolve(args.output) : null;

  if (!fs.existsSync(inputPath)) {
    finish({ status: 'failed', error: `Missing input file: ${inputPath}` }, outputPath);
    return;
  }

  const serverConfig = resolveConfiguredServer({
    commandEnv: 'AV_SYNTH_MUSIC_ANALYSIS_COMMAND',
    argsEnv: 'AV_SYNTH_MUSIC_ANALYSIS_ARGS_JSON',
    fallback: null,
  });

  if (!serverConfig) {
    finish(
      {
        status: 'not_available',
        tool: 'mcp-music-analysis',
        reason:
          'Set AV_SYNTH_MUSIC_ANALYSIS_COMMAND and AV_SYNTH_MUSIC_ANALYSIS_ARGS_JSON to a local MCP server command.',
      },
      outputPath,
    );
    return;
  }

  let client = null;
  try {
    client = new McpStdioClient(serverConfig.command, serverConfig.args, {
      cwd: process.cwd(),
      env: process.env,
    });
    await client.initialize();

    const load = await client.callTool('load', { file_path: inputPath });
    const yPath = load?.y_path;
    if (!yPath || !fs.existsSync(yPath)) {
      throw new Error('Music analysis server did not return a usable y_path');
    }

    const [duration, tempo, beatTrack, mfccPath, chromaPath] = await Promise.all([
      client.callTool('get_duration', { path_audio_time_series_y: yPath }),
      client.callTool('tempo', { path_audio_time_series_y: yPath }),
      client.callTool('beat_track', { path_audio_time_series_y: yPath, units: 'time' }),
      client.callTool('mfcc', { path_audio_time_series_y: yPath }),
      client.callTool('chroma_cqt', { path_audio_time_series_y: yPath }),
    ]);

    finish(
      {
        status: 'ok',
        tool: 'mcp-music-analysis',
        server: serverConfig,
        input: inputPath,
        result: {
          load,
          durationSeconds: typeof duration === 'number' ? duration : Number(duration),
          tempoBpm: Array.isArray(tempo) ? tempo[0] : tempo,
          beatTrack,
          mfccSummary:
            typeof mfccPath === 'string' && fs.existsSync(mfccPath)
              ? summarizeCsvRows(mfccPath)
              : null,
          chromaSummary:
            typeof chromaPath === 'string' && fs.existsSync(chromaPath)
              ? summarizeChromaCsv(chromaPath)
              : null,
        },
        stderr: client.stderr || null,
      },
      outputPath,
    );
  } catch (error) {
    finish(
      {
        status: 'not_available',
        tool: 'mcp-music-analysis',
        server: serverConfig,
        input: inputPath,
        error: error instanceof Error ? error.message : String(error),
        hint: 'Install the server locally and point AV_SYNTH_MUSIC_ANALYSIS_COMMAND / AV_SYNTH_MUSIC_ANALYSIS_ARGS_JSON at it.',
      },
      outputPath,
    );
  } finally {
    await client?.close();
  }
}

await main();
