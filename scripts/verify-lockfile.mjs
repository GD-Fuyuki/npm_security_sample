#!/usr/bin/env node

/**
 * verify-lockfile.mjs
 *
 * package-lock.json の整合性を検証する。
 * - 有効なJSONであること
 * - lockfileVersionが適切であること
 * - 不審なresolvedURL、プロトコルがないこと
 * - integrityハッシュが存在すること
 *
 * 対策: Lockfile Poisoning
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const LOCKFILE_PATH = resolve(process.cwd(), "package-lock.json");

// 許可するレジストリホスト
const ALLOWED_HOSTS = ["registry.npmjs.org"];

async function main() {
  const errors = [];
  const warnings = [];

  // 1. JSONとして読み込み
  let lockfile;
  try {
    const raw = await readFile(LOCKFILE_PATH, "utf-8");
    lockfile = JSON.parse(raw);
  } catch (err) {
    console.error(`[ERROR] package-lock.json の読み込みに失敗: ${err.message}`);
    process.exit(1);
  }

  console.log("=== Lockfile Integrity Verification ===\n");

  // 2. lockfileVersion チェック
  const version = lockfile.lockfileVersion;
  if (version == null) {
    errors.push("lockfileVersion フィールドが見つかりません");
  } else if (version < 2) {
    errors.push(
      `lockfileVersion ${version} は古いバージョンです。npm 7以降の lockfileVersion 2 または 3 を推奨します`
    );
  } else {
    console.log(`lockfileVersion: ${version} (OK)`);
  }

  // 3. packages エントリの検証
  const packages = lockfile.packages ?? {};
  let totalPackages = 0;
  let missingIntegrity = 0;
  let suspiciousUrls = [];
  let suspiciousProtocols = [];

  for (const [pkgPath, meta] of Object.entries(packages)) {
    if (pkgPath === "") continue; // ルートパッケージ
    totalPackages++;

    // resolved URL チェック
    if (meta.resolved) {
      try {
        const url = new URL(meta.resolved);

        // HTTPS チェック
        if (url.protocol !== "https:") {
          suspiciousUrls.push({
            package: pkgPath,
            url: meta.resolved,
            reason: `非HTTPSプロトコル: ${url.protocol}`,
          });
        }

        // ホスト名チェック
        if (!ALLOWED_HOSTS.some((host) => url.hostname === host)) {
          suspiciousUrls.push({
            package: pkgPath,
            url: meta.resolved,
            reason: `未許可のホスト: ${url.hostname}`,
          });
        }
      } catch {
        // file: や git: プロトコルのチェック
        if (
          meta.resolved.startsWith("file:") ||
          meta.resolved.startsWith("git:")
        ) {
          suspiciousProtocols.push({
            package: pkgPath,
            resolved: meta.resolved,
          });
        }
      }
    }

    // integrity チェック
    // リンクされたパッケージや一部のメタデータにはintegrityがない場合がある
    if (!meta.integrity && !meta.link && meta.resolved) {
      missingIntegrity++;
    }
  }

  console.log(`総パッケージ数: ${totalPackages}\n`);

  // 結果レポート
  if (suspiciousUrls.length > 0) {
    errors.push(
      `${suspiciousUrls.length} 個の不審なresolved URLが見つかりました:`
    );
    for (const { package: pkg, url, reason } of suspiciousUrls) {
      errors.push(`  - ${pkg}: ${reason} (${url})`);
    }
  }

  if (suspiciousProtocols.length > 0) {
    warnings.push(
      `${suspiciousProtocols.length} 個のfile:/git:プロトコル参照が見つかりました:`
    );
    for (const { package: pkg, resolved } of suspiciousProtocols) {
      warnings.push(`  - ${pkg}: ${resolved}`);
    }
  }

  if (missingIntegrity > 0) {
    warnings.push(
      `${missingIntegrity} 個のパッケージでintegrityハッシュが欠落しています`
    );
  }

  // 出力
  if (warnings.length > 0) {
    console.log("[WARNINGS]");
    for (const w of warnings) console.log(`  ${w}`);
    console.log();
  }

  if (errors.length > 0) {
    console.log("[ERRORS]");
    for (const e of errors) console.log(`  ${e}`);
    console.log("\nStatus: FAIL");
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.log("Status: WARN (要確認事項あり)\n");
  } else {
    console.log("全チェック合格。");
    console.log("Status: PASS\n");
  }
}

main();
