import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const THIS_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));
export const REPO_ROOT = resolve(THIS_DIR, "../../..");

export interface ContractLoadResult<T = Record<string, unknown>> {
  available: boolean;
  mod: T | null;
  error?: string;
}

interface ViteSsrServerLike {
  ssrLoadModule(url: string): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

let fallbackViteServerPromise: Promise<ViteSsrServerLike> | null = null;

async function getFallbackViteServer(): Promise<ViteSsrServerLike> {
  if (!fallbackViteServerPromise) {
    fallbackViteServerPromise = (async () => {
      const vite = await import("vite");
      const reactPluginMod = await import("@vitejs/plugin-react");
      const reactFactory = reactPluginMod.default;
      const server = await vite.createServer({
        root: REPO_ROOT,
        configFile: false,
        plugins: [reactFactory()],
        server: { middlewareMode: true, hmr: false },
        optimizeDeps: { noDiscovery: true },
        appType: "custom",
        logLevel: "silent",
      });
      return server as unknown as ViteSsrServerLike;
    })();
  }
  return fallbackViteServerPromise;
}

export async function closeContractLoader(): Promise<void> {
  if (!fallbackViteServerPromise) return;
  try {
    const server = await fallbackViteServerPromise;
    await server.close();
  } finally {
    fallbackViteServerPromise = null;
  }
}

export function resolveRepoPath(repoRelativePath: string): string {
  const normalized = repoRelativePath.replace(/^[/\\]+/, "");
  return resolve(REPO_ROOT, normalized);
}

export function repoFileExists(repoRelativePath: string): boolean {
  return existsSync(resolveRepoPath(repoRelativePath));
}

export function readRepoText(repoRelativePath: string): string {
  const absPath = resolveRepoPath(repoRelativePath);
  if (!existsSync(absPath)) {
    throw new Error(`Repo file does not exist: ${repoRelativePath} (${absPath})`);
  }
  return readFileSync(absPath, "utf8");
}

export async function loadContractModule<T = Record<string, unknown>>(
  repoRelativePath: string,
): Promise<ContractLoadResult<T>> {
  const absPath = resolveRepoPath(repoRelativePath);
  if (!existsSync(absPath)) {
    return {
      available: false,
      mod: null,
      error: `Module not found: ${repoRelativePath}`,
    };
  }

  const fileUrl = pathToFileURL(absPath).href;
  try {
    const mod = (await import(/* @vite-ignore */ fileUrl)) as T;
    return { available: true, mod };
  } catch (directErr) {
    // Plain Node execution (outside Vitest's Vite transform pipeline) cannot directly
    // import `.tsx` or extensionless `.ts` relative imports; fall back to Vite SSR loader.
    try {
      const server = await getFallbackViteServer();
      const ssrPath = `/${repoRelativePath.replace(/^[/\\]+/, "").replace(/\\/g, "/")}`;
      const mod = (await server.ssrLoadModule(ssrPath)) as T;
      return { available: true, mod };
    } catch (viteErr) {
      const firstMsg =
        directErr instanceof Error ? directErr.message : String(directErr);
      const secondMsg =
        viteErr instanceof Error ? viteErr.message : String(viteErr);
      return {
        available: false,
        mod: null,
        error: `Failed to load ${repoRelativePath}: ${firstMsg} (Vite fallback: ${secondMsg})`,
      };
    }
  }
}

export async function requireContractModule<T = Record<string, unknown>>(
  repoRelativePath: string,
): Promise<T> {
  const res = await loadContractModule<T>(repoRelativePath);
  if (!res.available || !res.mod) {
    throw new Error(
      res.error ?? `Contract module unavailable: ${repoRelativePath}`,
    );
  }
  return res.mod;
}

export function requireExport<T>(
  mod: Record<string, unknown>,
  exportName: string,
  modulePath: string,
): T {
  if (!mod || !(exportName in mod) || mod[exportName] === undefined) {
    throw new Error(
      `Missing required contract export "${exportName}" in ${modulePath}`,
    );
  }
  return mod[exportName] as T;
}
