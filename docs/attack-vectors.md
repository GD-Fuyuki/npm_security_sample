# npm サプライチェーン攻撃ベクトル解説

## 1. Typosquatting（タイポスクワッティング）

**概要**: 人気パッケージに似た名前のパッケージを公開し、タイプミスを狙う攻撃。

**実例**:
- `crossenv` → `cross-env` の偽装（2017年）
- `event-stream` → `event-streem` 等の亜種

**対策**:
- `scripts/check-typosquat.mjs` による自動検出
- パッケージ追加時のレビュープロセス
- Socket.dev 等の外部サービスの活用

---

## 2. Dependency Confusion（依存関係の混乱）

**概要**: 組織の内部パッケージと同名のパッケージを公開レジストリに登録し、インストール時に公開版を優先させる攻撃。

**実例**:
- Alex Birsan による2021年の研究で、Apple, Microsoft, PayPal等の内部パッケージ名を公開レジストリに登録

**対策**:
- `.npmrc` でのレジストリ固定 (`registry=https://registry.npmjs.org/`)
- スコープ付きパッケージの使用 (`@mycompany/package-name`)
- `lockfile-lint` による resolved URL の検証

---

## 3. Malicious Install Scripts（悪意のあるインストールスクリプト）

**概要**: `preinstall` / `postinstall` スクリプトを悪用し、`npm install` 実行時に任意のコードを実行する攻撃。

**実例**:
- `ua-parser-js` の侵害（2021年）: postinstallスクリプトで暗号通貨マイナーをインストール
- `colors` / `faker` の破壊（2022年）: メンテナによる意図的な破壊

**対策**:
- `.npmrc` の `ignore-scripts=true`
- `package.json` の `allowedScripts` による明示的な許可
- `scripts/audit-install-scripts.mjs` による監査

---

## 4. Compromised Maintainer（メンテナアカウントの侵害）

**概要**: パッケージメンテナのアカウントが乗っ取られ、正規パッケージに悪意のあるコードが注入される攻撃。

**実例**:
- `event-stream` 事件（2018年）: メンテナ権限を譲渡された攻撃者が悪意のある依存関係を追加
- `coa` / `rc` パッケージの侵害（2021年）

**実例（2026年）**:
- `axios@1.14.1` / `axios@0.30.4` の侵害: 攻撃者が侵害したアカウントから直接npm CLIでパブリッシュ。悪意のある依存関係 `plain-crypto-js` を追加し、postinstallフックでRAT（遠隔操作トロイの木馬）をインストール。正規のリリースフロー（GitHub Actions/OIDC署名）を経由しなかった。

**対策**:
- `npm audit signatures` によるプロベナンス検証
- GitHub Actions の `dependency-review-action` による PR レビュー
- バージョンの完全固定（`^` や `~` を使わない）
- **クールダウン（`min-release-age`）**: 公開直後のバージョンをインストール対象から除外し、コミュニティが悪意のあるコードを検出・報告する時間的猶予を確保する（後述）

---

## 5. Lockfile Poisoning（ロックファイルの改ざん）

**概要**: `package-lock.json` 内の `resolved` URL を書き換え、正規のレジストリの代わりに攻撃者のサーバーからパッケージをダウンロードさせる攻撃。

**攻撃手法**:
1. PR で `package-lock.json` の `resolved` フィールドを変更
2. レビュアーがロックファイルの差分を見落とす
3. マージ後、`npm ci` が改ざんされた URL からパッケージを取得

**対策**:
- `.npmrc` の `omit-lockfile-registry-resolved=true`（resolved URL自体を除去）
- `lockfile-lint` による resolved URL / ホスト名 / プロトコルの検証
- `scripts/verify-lockfile.mjs` による整合性チェック
- Git hooks でのコミット前チェック

---

## 6. Protestware（プロテストウェア）

**概要**: メンテナが政治的・社会的な抗議のため、意図的にパッケージを破壊または改変する行為。

**実例**:
- `colors.js` / `faker.js`（2022年）: メンテナが無限ループコードを注入
- `node-ipc`（2022年）: 特定地域のIPアドレスに対してファイルを削除

**対策**:
- バージョンの完全固定（自動アップデートを防止）
- Dependabot による管理されたアップデート（差分レビュー付き）
- `npm ci`（lockfileに基づく厳密なインストール）

---

## 7. Phantom Dependencies（幽霊依存関係）

**概要**: `package.json` に明示されていないが、hoistingにより偶然使えてしまうパッケージへの依存。依存関係の構造変更で突然壊れるリスクがある。

**対策**:
- CI での `npm ci`（lockfile と package.json の整合性を検証）
- 使用パッケージが `package.json` に明記されていることの確認
- ESLint の `import/no-extraneous-dependencies` ルール

---

## 8. クールダウン（Cooldown / min-release-age）

**概要**: パッケージの新バージョンが公開されてから一定期間はインストール対象としない仕組み。公開直後のバージョンを自動的に取り込まないことで、コミュニティが悪意のあるコードを検出・報告する時間的猶予を確保する。

**背景**: 2026年3月の `axios` サプライチェーン攻撃（→ 4. Compromised Maintainer参照）では、侵害されたアカウントから悪意のあるバージョンが直接パブリッシュされた。クールダウンが設定されていれば、攻撃バージョンが検出・非公開化されるまでの間にインストールを防止できた可能性がある。

**各パッケージマネージャーの対応**:

| ツール | バージョン | 設定名 |
|---|---|---|
| npm | 11.10.0以降 | `min-release-age` |
| pnpm | 10.16以降 | `minimumReleaseAge` |
| uv (Python) | 0.9.17以降 | `exclude-newer` |
| pip (Python) | 26.0以降 | `--uploaded-prior-to` |

**設定方法（npm）**:

`.npmrc` に以下を追加（7日間のクールダウン）:
```ini
min-release-age=7
```

**注意点**:
- クールダウン期間中は新バージョンが取得できないため、緊急のセキュリティパッチ適用時は一時的に値を下げるか `--before` オプションで上書きが必要
- lockfile に既に記録されたバージョンの `npm ci` には影響しない（新規インストール・更新時のみ適用）

**参考**: [yamory - axiosのサプライチェーン攻撃](https://yamory.io/blog/supplychain-attack-on-axios)

---

## 参考リンク

- [npm Security Best Practices](https://docs.npmjs.com/packages-and-modules/securing-your-code)
- [OpenSSF Scorecard](https://securityscorecards.dev/)
- [Socket.dev](https://socket.dev/)
- [Snyk Advisor](https://snyk.io/advisor/)
- [GitHub Dependency Review](https://docs.github.com/en/code-security/supply-chain-security)
- [yamory - axiosに対するサプライチェーン攻撃とクールダウン機能](https://yamory.io/blog/supplychain-attack-on-axios)
