import { createWriteStream, chmodSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import https from "https";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Skip when running in the source repo (dev install)
const pkg = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf-8"));
if (pkg.dependencies) process.exit(0);
const REPO = "vincelwt/gloomberb";

const platform = process.platform;
const arch = process.arch;

const osMap = { darwin: "darwin", linux: "linux" };
const archMap = { arm64: "arm64", x64: "x64" };

const os = osMap[platform];
let cpu = archMap[arch];

if (!os || !cpu) {
  console.error(`Unsupported platform: ${platform}-${arch}`);
  process.exit(1);
}

// macOS x64 uses arm64 binary (runs via Rosetta 2)
if (os === "darwin" && cpu === "x64") {
  cpu = "arm64";
}

const asset = `gloomberb-${os}-${cpu}`;
const binDir = join(__dirname, "bin");
const binPath = join(binDir, "gloomberb");

if (!existsSync(binDir)) {
  mkdirSync(binDir, { recursive: true });
}

const url = `https://github.com/${REPO}/releases/latest/download/${asset}`;

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
      }
      const file = createWriteStream(binPath);
      res.pipe(file);
      file.on("finish", () => {
        file.close();
        chmodSync(binPath, 0o755);
        resolve();
      });
      file.on("error", reject);
    }).on("error", reject);
  });
}

console.log(`Downloading ${asset}...`);
download(url)
  .then(() => console.log("gloomberb installed successfully."))
  .catch((err) => {
    console.error("Failed to download gloomberb binary:", err.message);
    process.exit(1);
  });
