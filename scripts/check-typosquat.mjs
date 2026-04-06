#!/usr/bin/env node

/**
 * check-typosquat.mjs
 *
 * package.json の依存関係を人気パッケージ名と比較し、
 * Levenshtein距離が1-2の疑わしいパッケージを検出する。
 *
 * 対策: Typosquatting攻撃
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// 人気npmパッケージ上位（定期的に更新推奨）
const POPULAR_PACKAGES = [
  "express", "react", "react-dom", "vue", "angular", "next", "nuxt",
  "lodash", "underscore", "moment", "dayjs", "date-fns",
  "axios", "node-fetch", "got", "request", "superagent",
  "webpack", "rollup", "vite", "esbuild", "parcel", "turbo",
  "babel-core", "@babel/core", "typescript", "ts-node",
  "eslint", "prettier", "stylelint", "biome",
  "jest", "mocha", "chai", "vitest", "ava", "tap",
  "commander", "yargs", "minimist", "chalk", "colors", "ora",
  "debug", "winston", "pino", "bunyan", "morgan",
  "mongoose", "sequelize", "typeorm", "prisma", "knex", "pg", "mysql2",
  "redis", "ioredis", "memcached",
  "socket.io", "ws", "engine.io",
  "cors", "helmet", "cookie-parser", "body-parser", "multer",
  "jsonwebtoken", "bcrypt", "bcryptjs", "passport", "argon2",
  "dotenv", "config", "convict",
  "uuid", "nanoid", "cuid",
  "sharp", "jimp", "canvas",
  "puppeteer", "playwright", "selenium-webdriver", "cypress",
  "nodemon", "pm2", "forever", "concurrently",
  "rimraf", "mkdirp", "glob", "minimatch", "fast-glob",
  "cross-env", "cross-spawn", "execa", "shelljs",
  "semver", "npm", "yarn", "pnpm",
  "http-server", "serve", "live-server",
  "nodemailer", "aws-sdk", "@aws-sdk/client-s3",
  "firebase", "firebase-admin", "supabase",
  "graphql", "apollo-server", "express-graphql",
  "tailwindcss", "postcss", "autoprefixer", "sass", "less",
  "storybook", "chromatic",
  "husky", "lint-staged", "commitlint",
  "zod", "joi", "yup", "ajv",
  "rxjs", "immer", "zustand", "redux", "mobx", "recoil", "jotai",
  "three", "d3", "chart.js", "recharts",
  "electron", "tauri",
  "fastify", "koa", "hapi", "restify", "polka",
  "inquirer", "prompts", "enquirer",
  "tar", "archiver", "adm-zip",
  "lru-cache", "node-cache", "keyv",
];

/**
 * Levenshtein距離を計算する
 */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

async function main() {
  let pkgJson;
  try {
    const raw = await readFile(resolve(process.cwd(), "package.json"), "utf-8");
    pkgJson = JSON.parse(raw);
  } catch (err) {
    console.error(`[ERROR] package.json の読み込みに失敗: ${err.message}`);
    process.exit(1);
  }

  const allDeps = {
    ...pkgJson.dependencies,
    ...pkgJson.devDependencies,
    ...pkgJson.optionalDependencies,
  };

  const depNames = Object.keys(allDeps);
  const suspects = [];

  console.log("=== Typosquatting Detection ===\n");
  console.log(`チェック対象: ${depNames.length} パッケージ\n`);

  for (const dep of depNames) {
    // スコープ付きパッケージの場合、パッケージ名部分のみ比較
    const depName = dep.startsWith("@") ? dep.split("/")[1] ?? dep : dep;

    for (const popular of POPULAR_PACKAGES) {
      const popularName = popular.startsWith("@")
        ? popular.split("/")[1] ?? popular
        : popular;

      // 完全一致はスキップ（正規パッケージ）
      if (dep === popular || depName === popularName) continue;

      // 自身も人気パッケージリストに含まれている場合はスキップ
      if (POPULAR_PACKAGES.includes(dep)) continue;

      const distance = levenshtein(depName, popularName);

      // 編集距離1-2で、かつパッケージ名が短すぎない場合のみフラグ
      if (distance <= 2 && depName.length >= 4) {
        suspects.push({
          dependency: dep,
          similarTo: popular,
          distance,
        });
      }
    }
  }

  if (suspects.length === 0) {
    console.log("疑わしいパッケージ名は見つかりませんでした。");
    console.log("Status: PASS\n");
    process.exit(0);
  }

  console.log(
    `[WARNING] ${suspects.length} 件の疑わしいパッケージ名が見つかりました:\n`
  );

  for (const { dependency, similarTo, distance } of suspects) {
    console.log(
      `  "${dependency}" は "${similarTo}" に類似しています (編集距離: ${distance})`
    );
  }

  console.log(
    "\n上記パッケージが意図したものか確認してください。"
  );
  console.log(
    "typosquattingパッケージは悪意のあるコードを含む可能性があります。\n"
  );
  console.log("Status: FAIL");
  process.exit(1);
}

main();
