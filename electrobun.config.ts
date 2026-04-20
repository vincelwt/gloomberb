import type { ElectrobunConfig } from "electrobun/bun";
import pkg from "./package.json";

const RELEASE_BASE_URL = "https://github.com/vincelwt/gloomberb/releases/latest/download";

const config: ElectrobunConfig = {
  app: {
    name: "Gloomberb",
    identifier: "com.vincelwt.gloomberb",
    version: pkg.version,
    description: pkg.description,
  },
  build: {
    bun: {
      entrypoint: "src/renderers/electrobun/bun/index.ts",
      sourcemap: "external",
    },
    copy: {
      "dist/electrobun-view": "views/mainview",
    },
    watch: [
      "src",
      "scripts/build-electrobun-view.ts",
      "electrobun.config.ts",
      "package.json",
    ],
    watchIgnore: [
      ".git",
      ".git/**",
      "dist/**",
      "build/**",
      "artifacts/**",
      "node_modules/**",
    ],
    mac: {
      codesign: true,
      createDmg: true,
      notarize: true,
      icons: "icon.iconset",
      defaultRenderer: "native",
    },
  },
  scripts: {
    preBuild: "scripts/build-electrobun-view.ts",
    postBuild: "",
    postWrap: "",
    postPackage: "",
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  release: {
    baseUrl: RELEASE_BASE_URL,
  },
};

export default config;
