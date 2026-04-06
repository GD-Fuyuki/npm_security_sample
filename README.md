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

各攻撃の詳細な解説は [docs/attack-vectors.md](docs/attack-vectors.md) を参照してください。

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
