#!/usr/bin/env node

/**
 * audit-install-scripts.mjs
 *
 * package-lock.json を解析し、installスクリプト(preinstall, install, postinstall)
 * を持つパッケージを一覧表示する。
 *
 * 対策: 悪意のあるinstallスクリプトによるコード実行
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const LOCKFILE_PATH = resolve(process.cwd(), "package-lock.json");

async function main() {
  let lockfile;
  try {
    const raw = await readFile(LOCKFILE_PATH, "utf-8");
    lockfile = JSON.parse(raw);
  } catch (err) {
    console.error(`[ERROR] package-lock.json の読み込みに失敗: ${err.message}`);
    process.exit(1);
  }

  const packages = lockfile.packages ?? {};
  const results = [];

  for (const [pkgPath, meta] of Object.entries(packages)) {
    // ルートパッケージ ("") はスキップ
    if (pkgPath === "") continue;

    if (meta.hasInstallScript) {
      const name = pkgPath.replace(/^node_modules\//, "");
      results.push({
        name,
        version: meta.version ?? "unknown",
      });
    }
  }

  console.log("=== Install Scripts Audit ===\n");

  if (results.length === 0) {
    console.log("installスクリプトを持つパッケージは見つかりませんでした。");
    console.log("Status: PASS\n");
    return;
  }

  console.log(
    `${results.length} 個のパッケージがinstallスクリプトを持っています:\n`
  );

  // テーブル表示
  const nameWidth = Math.max(12, ...results.map((r) => r.name.length)) + 2;
  const header = "Package".padEnd(nameWidth) + "Version";
  console.log(header);
  console.log("-".repeat(header.length + 10));

  for (const { name, version } of results) {
    console.log(`${name.padEnd(nameWidth)}${version}`);
  }

  console.log(
    "\n[WARNING] 上記パッケージのinstallスクリプトを確認してください。"
  );
  console.log(
    "許可するパッケージは package.json の allowedScripts に追加してください。"
  );
  console.log(
    '例: "allowedScripts": ["esbuild", "sharp"]\n'
  );

  // allowedScripts との照合
  try {
    const pkgJsonRaw = await readFile(
      resolve(process.cwd(), "package.json"),
      "utf-8"
    );
    const pkgJson = JSON.parse(pkgJsonRaw);
    const allowed = new Set(pkgJson.allowedScripts ?? []);

    const unapproved = results.filter((r) => !allowed.has(r.name));
    if (unapproved.length > 0) {
      console.log(
        `未許可のパッケージが ${unapproved.length} 個あります:`
      );
      for (const { name } of unapproved) {
        console.log(`  - ${name}`);
      }
      console.log("\nStatus: WARN");
    } else {
      console.log("全てのinstallスクリプト付きパッケージが許可済みです。");
      console.log("Status: PASS");
    }
  } catch {
    // package.json 読み込み失敗時は警告のみ
    console.log("Status: WARN (package.json の allowedScripts を確認できませんでした)");
  }
}

main();
