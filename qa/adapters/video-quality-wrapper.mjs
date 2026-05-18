import fs from 'node:fs';
import path from 'node:path';
import { parseCliArgs, finish, resolveConfiguredServer } from './common.mjs';
import { McpStdioClient } from './mcp-stdio-client.mjs';

async function callToolSafely(client, name, args) {
  try {
    return {
      status: 'ok',
      output: await client.callTool(name, args),
    };
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
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

  const serverConfig = resolveConfiguredServer({
    commandEnv: 'AV_SYNTH_VIDEO_QUALITY_COMMAND',
    argsEnv: 'AV_SYNTH_VIDEO_QUALITY_ARGS_JSON',
    fallback: null,
    rootEnv: 'AV_SYNTH_VIDEO_QUALITY_ROOT',
    rootScript: 'main.py',
  });

  if (!serverConfig) {
    finish(
      {
        status: 'not_available',
        tool: 'video-quality-mcp',
        reason:
          'Set AV_SYNTH_VIDEO_QUALITY_ROOT or AV_SYNTH_VIDEO_QUALITY_COMMAND / AV_SYNTH_VIDEO_QUALITY_ARGS_JSON to a local server checkout.',
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

    const [metadata, gop, metrics, artifacts, summary] = await Promise.all([
      callToolSafely(client, 'analyze_video_metadata', { path: inputPath }),
      callToolSafely(client, 'analyze_gop_structure', { path: inputPath }),
      callToolSafely(client, 'compare_quality_metrics', {
        reference: referencePath,
        distorted: inputPath,
      }),
      callToolSafely(client, 'analyze_artifacts', {
        target: inputPath,
        reference: referencePath,
      }),
      callToolSafely(client, 'summarize_transcode_comparison', {
        source: referencePath,
        transcoded: inputPath,
      }),
    ]);

    finish(
      {
        status: 'ok',
        tool: 'video-quality-mcp',
        server: serverConfig,
        input: inputPath,
        reference: referencePath,
        result: {
          metadata,
          gop,
          metrics,
          artifacts,
          summary,
        },
        stderr: client.stderr || null,
      },
      outputPath,
    );
  } catch (error) {
    finish(
      {
        status: 'not_available',
        tool: 'video-quality-mcp',
        server: serverConfig,
        input: inputPath,
        reference: referencePath,
        error: error instanceof Error ? error.message : String(error),
        hint: 'Clone the server locally and set AV_SYNTH_VIDEO_QUALITY_ROOT, or provide AV_SYNTH_VIDEO_QUALITY_COMMAND / AV_SYNTH_VIDEO_QUALITY_ARGS_JSON.',
      },
      outputPath,
    );
  } finally {
    await client?.close();
  }
}

await main();
