import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { parseCliArgs, finish, resolveConfiguredServer } from './common.mjs';
import { McpStdioClient } from './mcp-stdio-client.mjs';

function createStaticServer(filePath) {
  const basename = path.basename(filePath);
  const server = http.createServer((request, response) => {
    const requestPath = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (requestPath !== `/${basename}`) {
      response.statusCode = 404;
      response.end('Not found');
      return;
    }
    fs.createReadStream(filePath).pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to bind local static server'));
        return;
      }
      resolve({
        close: () =>
          new Promise((done, fail) => server.close((error) => (error ? fail(error) : done()))),
        url: `http://127.0.0.1:${address.port}/${basename}`,
      });
    });
  });
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.input);
  const outputPath = args.output ? path.resolve(args.output) : null;

  if (!fs.existsSync(inputPath)) {
    finish({ status: 'failed', error: `Missing input file: ${inputPath}` }, outputPath);
    return;
  }

  const serverConfig = resolveConfiguredServer({
    commandEnv: 'AV_SYNTH_VIDEO_ANALYZER_COMMAND',
    argsEnv: 'AV_SYNTH_VIDEO_ANALYZER_ARGS_JSON',
    fallback: {
      command: 'npx',
      args: ['--no-install', 'mcp-video-analyzer@latest'],
      source: 'default:npx-no-install',
    },
  });

  let transport = null;
  let client = null;
  try {
    transport = await createStaticServer(inputPath);
    client = new McpStdioClient(serverConfig.command, serverConfig.args, {
      cwd: process.cwd(),
      env: process.env,
    });
    await client.initialize();
    // AV-synth output has no speech and no on-screen text, so we skip the
    // Whisper transcription and per-frame OCR that the tool defaults to.
    // Asking for metadata + frames only keeps the analysis tractable.
    const result = await client.callTool('analyze_video', {
      url: transport.url,
      options: {
        detail: 'brief',
        fields: ['metadata', 'frames'],
        maxFrames: 12,
        skipFrames: false,
      },
    });
    finish(
      {
        status: 'ok',
        tool: 'mcp-video-analyzer',
        server: serverConfig,
        input: inputPath,
        proxiedUrl: transport.url,
        result,
        stderr: client.stderr || null,
      },
      outputPath,
    );
  } catch (error) {
    finish(
      {
        status: 'not_available',
        tool: 'mcp-video-analyzer',
        server: serverConfig,
        input: inputPath,
        error: error instanceof Error ? error.message : String(error),
        hint: 'Install the server locally or set AV_SYNTH_VIDEO_ANALYZER_COMMAND / AV_SYNTH_VIDEO_ANALYZER_ARGS_JSON.',
      },
      outputPath,
    );
  } finally {
    await client?.close();
    await transport?.close();
  }
}

await main();
