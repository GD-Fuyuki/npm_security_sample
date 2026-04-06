# npm Supply Chain Security Template

npm サプライチェーン攻撃に対する対策を実装したテンプレートリポジトリです。

## 攻撃ベクトルと対策マッピング

| 攻撃ベクトル | 対策 | ファイル |
|---|---|---|
| Typosquatting | Levenshtein距離による類似パッケージ名検出 | `scripts/check-typosquat.mjs` |
| Dependency Confusion | レジストリ固定 + lockfile-lint | `.npmrc`, `.lockfile-lintrc.json` |
| Malicious Install Scripts | `ignore-scripts=true` + allowlist | `.npmrc`, `package.json` |
| Compromised Maintainer | 署名検証 + dependency-review + クールダウン | CI workflows, `.npmrc` |
| Lockfile Poisoning | resolved URL除去 + lockfile-lint | `.npmrc`, `.lockfile-lintrc.json` |
| Protestware | バージョン完全固定 + Dependabot管理 | `package.json`, `dependabot.yml` |
| Phantom Dependencies | `npm ci` による厳密インストール | CI workflows |

各攻撃の技術的な背景は [docs/attack-vectors.md](docs/attack-vectors.md) も参照してください。

---

## 攻撃ベクトル別 対策の詳細

### 1. Typosquatting（タイポスクワッティング）

**攻撃手法**: 人気パッケージに酷似した名前（例: `cross-env` → `crossenv`）のパッケージを公開し、開発者のタイプミスや不注意で悪意のあるパッケージをインストールさせる。

**実例**:
- `crossenv`（2017年）: `cross-env` を偽装し、環境変数を外部サーバーに送信
- `event-streem`: `event-stream` の偽装パッケージ

**このリポジトリでの対策**:

`scripts/check-typosquat.mjs` が、`package.json` の全依存関係に対して **Levenshtein距離**（編集距離）を用いた類似度チェックを行います。人気パッケージ約150個のリストと照合し、編集距離が1-2のパッケージを検出します。

```bash
npm run security:check-typosquat
```

```
# 検出例: "crossenv" は "cross-env" に類似 (編集距離: 1)
[WARNING] 1 件の疑わしいパッケージ名が見つかりました:
  "crossenv" は "cross-env" に類似しています (編集距離: 1)
```

| 防御ポイント | 設定 |
|---|---|
| CI自動チェック | `security-audit.yml` の "Check typosquatting" ステップ |
| ローカル手動実行 | `npm run security:check-typosquat` |

---

### 2. Dependency Confusion（依存関係の混乱）

**攻撃手法**: 組織が社内で使っている非公開パッケージ（例: `@mycompany/auth-utils`）と同名のパッケージを公開レジストリに高バージョンで登録する。npmはデフォルトで公開レジストリを優先するため、`npm install` 時に攻撃者のパッケージが取得される。

**実例**:
- Alex Birsan（2021年）: Apple、Microsoft、PayPal等の内部パッケージ名を公開レジストリに登録し、35社以上で任意コード実行に成功

**このリポジトリでの対策**:

**(a) `.npmrc` でのレジストリ固定**

```ini
# 全パッケージを公式レジストリに強制
registry=https://registry.npmjs.org/

# プライベートパッケージはスコープで分離
# @mycompany:registry=https://npm.pkg.github.com
```

レジストリを明示的に指定することで、意図しないレジストリからの取得を防止します。プライベートパッケージを使う場合はスコープ付きレジストリ（`@mycompany:registry=...`）で分離します。

**(b) `lockfile-lint` によるresolved URL検証**

```json
// .lockfile-lintrc.json
{
  "allowedHosts": ["npm"],
  "validateHttps": true,
  "validatePackageNames": true
}
```

```bash
npm run security:lockfile-lint
```

lockfile-lint は `package-lock.json` 内の全パッケージの `resolved` URL を検査し、以下を検証します:

| 検証項目 | 検出する攻撃 |
|---|---|
| `allowedHosts: ["npm"]` | npmjs.org以外のレジストリからの取得を拒否 |
| `validateHttps: true` | HTTP（非暗号化）での取得を拒否 |
| `validatePackageNames: true` | パッケージ名の不一致を検出 |
| `validateIntegrity: true` | integrityハッシュ欠落を検出 |

---

### 3. Malicious Install Scripts（悪意のあるインストールスクリプト）

**攻撃手法**: `package.json` の `preinstall` / `postinstall` スクリプトを悪用し、`npm install` 実行時に任意のコードを実行する。開発者は依存関係の追加時にinstallスクリプトの内容を確認しないことが多く、攻撃の起点として最も多用される。

**実例**:
- `ua-parser-js`（2021年）: postinstallで暗号通貨マイナーをインストール
- `axios@1.14.1`（2026年）: 依存関係 `plain-crypto-js` のpostinstallでRAT（遠隔操作ツール）をインストール。macOS/Windows/Linux全対応、C2通信後に痕跡を自己削除

**このリポジトリでの対策**:

**(a) `.npmrc` でinstallスクリプトを全面無効化**

```ini
ignore-scripts=true
```

この設定により、全パッケージの `preinstall` / `install` / `postinstall` スクリプトの自動実行が**完全にブロック**されます。axios事件では `plain-crypto-js` の postinstall が攻撃の起点でしたが、`ignore-scripts=true` が設定されていればRATのインストールは発生しませんでした。

**(b) `scripts/audit-install-scripts.mjs` で可視化**

```bash
npm run security:check-scripts
```

`package-lock.json` の `hasInstallScript` フィールドを解析し、installスクリプトを持つパッケージを一覧表示します。`package.json` の `allowedScripts` と照合し、未許可のパッケージがあれば警告します。

**(c) 正当なスクリプトの許可方法**

`esbuild` や `sharp` のようにネイティブバイナリのダウンロードが必要なパッケージは、`package.json` で明示的に許可します:

```json
{
  "allowedScripts": ["esbuild", "sharp"]
}
```

または個別にリビルド:

```bash
npm rebuild esbuild
```

---

### 4. Compromised Maintainer（メンテナアカウントの侵害）

**攻撃手法**: パッケージメンテナのアカウントを乗っ取り（フィッシング、クレデンシャルスタッフィング等）、正規パッケージに悪意のあるコードを含むバージョンを公開する。パッケージ名自体は正規のため、既存の利用者全員が攻撃対象になる。

**実例**:
- `event-stream`（2018年）: メンテナ権限を譲渡された攻撃者が `flatmap-stream` を依存関係に追加、暗号通貨ウォレットの窃取コードを注入
- `coa` / `rc`（2021年）: 侵害アカウントから悪意のあるバージョンを公開
- `axios@1.14.1`（2026年）: メンテナ `jasonsaayman` のアカウントが侵害され、npm CLIから直接パブリッシュ。**正規のCI/CDリリースフロー（GitHub Actions + OIDC署名）を経由せず**に公開されたため、Provenance署名が付与されなかった

**このリポジトリでの対策**:

**(a) `npm audit signatures` によるProvenance検証**

```bash
npm run security:audit-signatures
```

npm v9.5以降で利用可能。GitHub Actions等のCI環境からOIDCを用いてパブリッシュされたパッケージには**Provenance署名**が付与されます。`npm audit signatures` は、この署名の有無と正当性を検証します。

axios事件では、攻撃者は侵害アカウントからnpm CLIで直接パブリッシュしたため、Provenance署名がありませんでした。この検証により異常を検出可能です。

**(b) クールダウン (`min-release-age`)**

```ini
# .npmrc
min-release-age=7
```

パッケージの新バージョン公開後**7日間**はインストール対象から除外します。axios事件では悪意のあるバージョンが公開から約2-3時間で検出・削除されました。クールダウンが設定されていれば、攻撃バージョンを取り込むことはありませんでした。

| npm 11.10.0以降 | pnpm 10.16以降 | uv 0.9.17以降 |
|---|---|---|
| `min-release-age=7` | `minimumReleaseAge=10080` | `exclude-newer="7 days"` |

**(c) `dependency-review-action` によるPRレビュー**

```yaml
# .github/workflows/dependency-review.yml
- uses: actions/dependency-review-action@ce3cf95... # v4.6.0
  with:
    fail-on-severity: moderate
    warn-on-openssf-scorecard-level: 3
```

PRで依存関係が変更された場合、新規追加・更新されたパッケージの脆弱性とOpenSSF Scorecardスコアを自動チェックします。

---

### 5. Lockfile Poisoning（ロックファイルの改ざん）

**攻撃手法**: `package-lock.json` 内の `resolved` フィールドを攻撃者が管理するURLに書き換え、PRとしてマージさせる。`package-lock.json` は巨大で差分レビューが困難なため、見落とされやすい。マージ後、`npm ci` が改ざんされたURLからパッケージを取得する。

**攻撃の流れ**:
```
1. 攻撃者がPRで package-lock.json を変更
2. resolved: "https://registry.npmjs.org/express/-/express-4.21.2.tgz"
   ↓ 書き換え
   resolved: "https://evil.example.com/express/-/express-4.21.2.tgz"
3. レビュアーがlockfileの差分を見落とす
4. マージ後、npm ci が攻撃者のサーバーからパッケージを取得
```

**このリポジトリでの対策**:

**(a) `.npmrc` でresolved URLを根本排除**

```ini
omit-lockfile-registry-resolved=true
```

この設定は `package-lock.json` から `resolved` URLフィールド自体を**完全に除去**します。インストール時のレジストリは常に `.npmrc` の `registry` 設定から決定されるため、lockfile内のURLを改ざんする攻撃が**原理的に不可能**になります。

**(b) `lockfile-lint` による多層検証**

```bash
npm run security:lockfile-lint
```

`omit-lockfile-registry-resolved` を使わない環境や古いnpmバージョン向けに、lockfile-lintが以下を検証します:

- resolved URLのホストが `registry.npmjs.org` であること
- プロトコルがHTTPSであること
- integrityハッシュが存在すること

**(c) `scripts/verify-lockfile.mjs` による補助検証**

```bash
npm run security:verify-lockfile
```

lockfile-lintに加えて、以下の追加検証を行います:

- `lockfileVersion` が2以上であること
- `file:` や `git:` プロトコルの参照がないこと
- integrityハッシュが `sha512` であること

**(d) Git Hooks でのローカル検証**

```bash
# .husky/pre-commit
npm run security:lockfile-lint
npm run security:check-scripts
```

CIに到達する前に、コミット時点でlockfileの改ざんを検出します。

---

### 6. Protestware（プロテストウェア）

**攻撃手法**: パッケージの正規メンテナが、政治的・社会的な抗議のために意図的にパッケージを破壊したり、特定条件で有害な動作をするコードを注入する。正規メンテナによる行為のため、アカウント侵害とは異なり検出が難しい。

**実例**:
- `colors.js` / `faker.js`（2022年1月）: メンテナのMarak氏がオープンソースの無償労働に抗議し、無限ループコード（`LIBERTY LIBERTY LIBERTY`を永久出力）を注入。`colors@1.4.1` が汚染された
- `node-ipc`（2022年3月）: ロシア・ベラルーシのIPアドレスからのアクセス時にファイルシステムを破壊するコードを注入

**このリポジトリでの対策**:

**(a) バージョンの完全固定**

```json
// package.json
{
  "dependencies": {
    "express": "4.21.2"    // "^4.21.2" ではなく完全固定
  }
}
```

`^`（キャレット）や `~`（チルダ）を使わず、バージョンを完全に固定します。これにより、メンテナが新バージョンを公開しても、**明示的に更新操作をしない限り**自動的に取り込まれることはありません。

`colors.js` 事件では、`^1.4.0` のように範囲指定していたプロジェクトが `npm install` 実行時に汚染された `1.4.1` を自動取得しました。完全固定であれば影響を受けませんでした。

**(b) Dependabot による管理されたアップデート**

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "npm"
    schedule:
      interval: "weekly"
      day: "monday"
    groups:
      production-dependencies:
        dependency-type: "production"
        update-types: ["minor", "patch"]
```

バージョンを完全固定した上で、Dependabotが週次で更新PRを自動作成します。更新内容は**差分レビュー付きのPR**として提出されるため、破壊的変更やコード注入をマージ前に検出できます。

| 設定 | 効果 |
|---|---|
| `interval: "weekly"` | 毎週月曜に更新チェック |
| `groups` によるグループ化 | minor/patchをまとめてPRノイズを削減 |
| `open-pull-requests-limit: 10` | 未マージPRの上限を設定 |

---

### 7. Phantom Dependencies（幽霊依存関係）

**攻撃手法**: npmのhoisting（巻き上げ）により、`package.json` に明記していないパッケージが `node_modules` のルートに配置され、`require()` / `import` で偶然利用できてしまう現象。直接的な攻撃手法ではないが、以下のリスクがある:

- 依存ツリーの変更で突然パッケージが消え、本番環境が壊れる
- 意図しないバージョンのパッケージを使用してしまう
- 攻撃者がphantom dependencyを標的にした悪意のあるパッケージを公開する

**例**:
```
# package.json には "express" のみ記載
# しかし express の依存関係 "qs" が hoisting により直接 import 可能
import qs from "qs";  // package.json に未記載だが動作する
```

**このリポジトリでの対策**:

**(a) CI環境での `npm ci`**

```yaml
# .github/workflows/security-audit.yml
- name: Install dependencies
  run: npm ci
```

`npm ci` は `npm install` と異なり、以下の厳密な動作をします:

| | `npm install` | `npm ci` |
|---|---|---|
| lockfile との整合性 | 不一致時にlockfileを更新 | 不一致時に**エラーで停止** |
| `node_modules` | 差分更新 | 完全削除→再インストール |
| package.json との一致 | 緩い | 厳密に一致を要求 |

これにより、`package.json` と `package-lock.json` の不一致（=phantom dependencyの兆候）がCIで検出されます。

**(b) 開発時の追加対策（推奨）**

ESLintの `import/no-extraneous-dependencies` ルールを導入することで、`package.json` に未記載のパッケージのimportをリント時に検出できます:

```json
// .eslintrc.json（任意導入）
{
  "rules": {
    "import/no-extraneous-dependencies": "error"
  }
}
```

---

## Quick Start

```bash
# リポジトリをクローン
git clone <repository-url>
cd npm-security-sample

# 依存関係をインストール（ignore-scripts=true が適用される）
npm ci

# 全セキュリティチェックを実行
npm run security:all
```

## セキュリティスクリプト

| コマンド | 説明 |
|---|---|
| `npm run security:all` | 全チェックを一括実行 |
| `npm run security:audit` | npm audit（既知の脆弱性チェック） |
| `npm run security:audit-signatures` | レジストリ署名の検証 |
| `npm run security:lockfile-lint` | lockfileの整合性検証 |
| `npm run security:check-scripts` | installスクリプトを持つパッケージの一覧 |
| `npm run security:check-typosquat` | typosquatting疑いのあるパッケージ検出 |
| `npm run security:verify-lockfile` | lockfileの詳細整合性チェック |

## 主要な設定ファイル

### `.npmrc` — npmハードニング

最も重要な設定ファイル。以下を実現:

- **`ignore-scripts=true`**: installスクリプトの自動実行を防止
- **`registry=https://registry.npmjs.org/`**: レジストリを固定
- **`omit-lockfile-registry-resolved=true`**: lockfileからresolved URLを除去し、lockfile poisoningを防止
- **`strict-ssl=true`**: レジストリへのMITMを防止
- **`min-release-age=7`**: 公開7日以内のバージョンをインストール対象から除外（クールダウン）
- **`audit=true`**: インストール時に自動で脆弱性チェック

### `.lockfile-lintrc.json` — lockfile検証ルール

- HTTPSの強制
- 許可されたホスト（npmjsのみ）の検証
- integrityハッシュの存在確認
- パッケージ名の一致検証

### GitHub Actions

- **`security-audit.yml`**: push/PR/daily cronで全セキュリティチェック + SBOM生成
- **`dependency-review.yml`**: PRで新規追加された依存関係の脆弱性チェック
- **`dependabot.yml`**: 週次で依存関係の自動更新PR作成

全Actionはタグ（`@v4`）ではなく**コミットハッシュで固定（SHAピンニング）**しています。タグは上書き可能なため、侵害されたActionが正規タグを通じて配信されるリスクを防止します（LiteLLM事件の教訓）。

```yaml
# Bad: タグは上書き可能
- uses: actions/checkout@v4

# Good: コミットハッシュで固定
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
```

### Git Hooks (husky)

- **pre-commit**: lockfile-lint + installスクリプト監査
- **pre-push**: 全セキュリティチェック

## カスタマイズ

### プライベートレジストリを使う場合

`.npmrc` にスコープ付きレジストリを追加:

```ini
@mycompany:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}
```

`.lockfile-lintrc.json` の `allowedHosts` にも追加:

```json
{
  "allowedHosts": ["npm", "npm.pkg.github.com"]
}
```

### installスクリプトが必要なパッケージがある場合

`package.json` の `allowedScripts` に追加:

```json
{
  "allowedScripts": ["esbuild", "sharp"]
}
```

または個別にリビルド:

```bash
npm rebuild esbuild
```

### 特定の脆弱性を許容する場合

`npm audit` の結果から許容するアドバイザリーがある場合、`overrides` で一時的にバージョンを固定するか、`npm audit fix` で対応してください。

## 既知の脆弱性について

以下の推移的依存に修正版が未リリースの脆弱性があります（2026年4月時点）:

| パッケージ | 影響範囲 | 深刻度 | 原因 |
|---|---|---|---|
| `path-to-regexp` 8.0.0-8.3.0 | ReDoS | High | `express` → `router` の依存 |
| `picomatch` <=4.0.3 | ReDoS / Method Injection | High | `lockfile-lint` → `fast-glob` → `micromatch` の依存 |

いずれも上流パッケージの修正リリースを待つ必要があります。修正版がリリースされた際は:

1. `overrides` で推移的依存のバージョンを更新する
2. `audit-level` を `moderate` に戻す

```json
// package.json - 修正版リリース後の対応例
{
  "overrides": {
    "path-to-regexp": ">=8.4.0",
    "picomatch": ">=4.1.0"
  }
}
```

## CI/CDパイプラインの概要

```
Push/PR to main
  │
  ├── security-audit.yml
  │   ├── npm ci (ignore-scripts)
  │   ├── npm audit
  │   ├── npm audit signatures
  │   ├── lockfile-lint
  │   ├── verify-lockfile.mjs
  │   ├── audit-install-scripts.mjs
  │   ├── check-typosquat.mjs
  │   └── SBOM生成 (CycloneDX)
  │
  └── dependency-review.yml (PRのみ)
      └── 新規依存関係の脆弱性・ライセンスチェック

Daily Cron (06:00 UTC)
  └── security-audit.yml (新規公開脆弱性の検出)

Weekly (Monday)
  └── Dependabot (依存関係更新PRの自動作成)
```

## ライセンス

MIT
