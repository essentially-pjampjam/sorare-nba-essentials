import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const distDir = resolve(rootDir, "dist");
const manifestPath = resolve(distDir, "manifest.json");

if (!existsSync(manifestPath)) {
  console.error("Missing dist/manifest.json. Run `npm run build` first.");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const version = manifest.version ?? "0.0.0";
const releasesDir = resolve(rootDir, "releases");
mkdirSync(releasesDir, { recursive: true });

const outZip = resolve(
  releasesDir,
  `pjampjams-sorare-essentials-v${version}.zip`,
);
if (existsSync(outZip)) {
  rmSync(outZip, { force: true });
}

if (process.platform === "win32") {
  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${distDir}\\*' -DestinationPath '${outZip}' -CompressionLevel Optimal`,
    ],
    { stdio: "inherit" },
  );
} else {
  execFileSync("zip", ["-r", outZip, "."], {
    cwd: distDir,
    stdio: "inherit",
  });
}

console.log(`Created Chrome Web Store package: ${outZip}`);
