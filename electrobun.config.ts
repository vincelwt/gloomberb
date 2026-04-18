import type { ElectrobunConfig } from "electrobun/bun";
import pkg from "./package.json";

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
      createDmg: false,
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
};

export default config;
