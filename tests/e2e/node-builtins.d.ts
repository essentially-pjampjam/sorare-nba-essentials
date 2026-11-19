declare module "node:fs" {
  export interface Dirent {
    name: string;
    isFile(): boolean;
    isDirectory(): boolean;
  }

  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: "utf8" | "utf-8"): string;
  export function readFileSync(path: string): Buffer;
  export function readdirSync(
    path: string,
    options: { withFileTypes: true },
  ): Dirent[];
  export function readdirSync(path: string): string[];
  export function statSync(path: string): {
    size: number;
    isFile(): boolean;
    isDirectory(): boolean;
  };
}

declare module "node:path" {
  export function resolve(...paths: string[]): string;
  export function join(...paths: string[]): string;
  export function dirname(path: string): string;
  export function basename(path: string, suffix?: string): string;
  export function extname(path: string): string;
  export function relative(from: string, to: string): string;
  export function isAbsolute(path: string): boolean;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
  export function pathToFileURL(path: string): URL;
}

declare module "node:vm" {
  export interface Context {
    [key: string]: unknown;
  }

  export interface ScriptOptions {
    filename?: string;
    lineOffset?: number;
    columnOffset?: number;
  }

  export interface RunningScriptOptions {
    timeout?: number;
    displayErrors?: boolean;
  }

  export class Script {
    constructor(code: string, options?: ScriptOptions);
    runInContext(
      contextifiedObject: Context,
      options?: RunningScriptOptions,
    ): unknown;
    runInNewContext(
      contextObject?: Context,
      options?: RunningScriptOptions,
    ): unknown;
  }

  export function createContext(contextObject?: Context): Context;
  export function runInContext(
    code: string,
    contextifiedObject: Context,
    options?: RunningScriptOptions,
  ): unknown;
  export function isContext(object: object): boolean;
}

declare module "node:module" {
  export function createRequire(
    filename: string | URL,
  ): (id: string) => unknown;

  export interface StripTypeScriptTypesOptions {
    mode?: "strip" | "transform";
    sourceMap?: boolean;
    sourceUrl?: string;
  }

  export function stripTypeScriptTypes(
    code: string,
    options?: StripTypeScriptTypesOptions,
  ): string;
}

declare module "node:child_process" {
  export interface ExecFileSyncOptions {
    cwd?: string;
    encoding?: "utf8" | "utf-8";
    env?: Record<string, string | undefined>;
    timeout?: number;
    stdio?: "pipe" | "inherit" | "ignore";
  }

  export interface SpawnSyncOptions {
    cwd?: string;
    encoding?: "utf8" | "utf-8";
    env?: Record<string, string | undefined>;
    timeout?: number;
    input?: string;
    shell?: boolean;
  }

  export interface SpawnSyncReturns<T = string> {
    pid: number;
    output: Array<T | null>;
    stdout: T;
    stderr: T;
    status: number | null;
    signal: string | null;
    error?: Error;
  }

  export function execFileSync(
    file: string,
    args?: ReadonlyArray<string>,
    options?: ExecFileSyncOptions,
  ): string;

  export function spawnSync(
    command: string,
    args?: ReadonlyArray<string>,
    options?: SpawnSyncOptions,
  ): SpawnSyncReturns<string>;
}

interface NodeBufferConstructor {
  from(input: string, encoding?: string): Buffer;
  from(input: ArrayLike<number>): Buffer;
  isBuffer(obj: unknown): obj is Buffer;
  byteLength(input: string, encoding?: string): number;
  concat(list: ReadonlyArray<Uint8Array>, totalLength?: number): Buffer;
}

interface Buffer extends Uint8Array {
  toString(encoding?: string, start?: number, end?: number): string;
}

declare const Buffer: NodeBufferConstructor;

interface NodeProcess {
  cwd(): string;
  env: Record<string, string | undefined>;
  argv: string[];
  version: string;
  platform: string;
  exitCode?: number;
}

declare const process: NodeProcess;
