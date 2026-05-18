import { spawn } from 'node:child_process';

export class McpStdioClient {
  #child;
  #stderr = '';
  #buffer = Buffer.alloc(0);
  #nextId = 1;
  #pending = new Map();

  constructor(command, args = [], options = {}) {
    this.#child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options,
    });

    this.#child.stdout.on('data', (chunk) => this.#onData(chunk));
    this.#child.stderr.on('data', (chunk) => {
      this.#stderr += chunk.toString('utf8');
    });
    this.#child.on('exit', (code, signal) => {
      const error = new Error(
        `MCP server exited before request completed (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
      );
      for (const { reject } of this.#pending.values()) reject(error);
      this.#pending.clear();
    });
  }

  get stderr() {
    return this.#stderr.trim();
  }

  async initialize() {
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'av-synth-qa',
        version: '1.0.0',
      },
    });
    this.notify('notifications/initialized', {});
  }

  request(method, params = {}) {
    const id = this.#nextId++;
    const payload = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };
    const promise = new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
    this.#write(payload);
    return promise;
  }

  notify(method, params = {}) {
    this.#write({
      jsonrpc: '2.0',
      method,
      params,
    });
  }

  async callTool(name, args = {}) {
    const response = await this.request('tools/call', {
      name,
      arguments: args,
    });
    return parseToolResponse(response);
  }

  async close() {
    if (!this.#child.killed) this.#child.kill();
  }

  #write(message) {
    // MCP stdio transport: newline-delimited JSON, one message per line.
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #onData(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    while (true) {
      const newlineIndex = this.#buffer.indexOf(0x0a);
      if (newlineIndex === -1) return;
      const line = this.#buffer.subarray(0, newlineIndex).toString('utf8').trim();
      this.#buffer = this.#buffer.subarray(newlineIndex + 1);
      if (!line) continue;
      this.#handleMessage(JSON.parse(line));
    }
  }

  #handleMessage(message) {
    if (typeof message.id !== 'number') return;
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
      return;
    }
    pending.resolve(message.result ?? null);
  }
}

export function parseToolResponse(result) {
  if (!result) return null;
  if (result.structuredContent) return result.structuredContent;
  const content = Array.isArray(result.content) ? result.content : [];
  if (!content.length) return result;
  if (content.length === 1 && content[0]?.type === 'text') {
    const text = content[0].text?.trim() ?? '';
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  }
  return {
    content: content.map((item) =>
      item?.type === 'text'
        ? item.text
        : {
            type: item?.type ?? 'unknown',
          },
    ),
  };
}
