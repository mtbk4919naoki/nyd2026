# npm サプライチェーン攻撃 — 対策ガイド

Mini Shai-Hulud 系（**ChainDrop** 等）の npm ワーム向け。**恒久運用できる手順と設定**を中心にまとめる。  
事件の詳細・件数・タイムラインは [参照](#参照) の公開レポートを見る（内容は古くなる）。

最終更新: 2026-08-06（GitHub Actions / CI 節を追加。Dependabot は任意、submodule CI 分離、SSH rsync deploy を記載）

---

## この文書の使い方

| 読者 | 読む節 |
|------|--------|
| 人間（開発リード・担当者） | [緊急度](#緊急度) → [対策チェックリスト](#対策チェックリスト) → [設定スニペット](#設定スニペットリポジトリ実装) |
| 別リポジトリに展開する人 | [設定スニペット](#設定スニペットリポジトリ実装) + [lockfile 照合スクリプト](#lockfile-照合スクリプト) + [GitHub Actions / CI](#github-actions--ci) |
| **AI エージェント** | [AI エージェント向け](#ai-エージェント向け) を先に読む |

---

## 緊急度

**高い。** 典型攻撃は `npm install` 時の **`preinstall` 自動実行**で資格情報を盗み、**npm / GitHub トークンで他パッケージを再感染**させる。

| すぐ調査（P0） | 優先度を下げられる目安 |
|----------------|------------------------|
| インシデント露出期間中に `npm install` / `update` した | 当該時刻帯に install 履歴がない |
| lockfile に [公表リスト](https://raw.githubusercontent.com/wiz-sec-public/wiz-research-iocs/main/reports/keyv-packages.csv) の `package@version` がある | 全 lockfile スキャンで該当なし |
| `ignore-scripts` なしで install した | 常に `ignore-scripts` + lockfile 固定 |
| `node_modules` に `setup.mjs` / `Math_Symbol.js` 等 | 端末 IOC スキャンで該当なし |
| npm publish 権限のある maintainer 端末 | 権限なし・install 履歴なし |

**重要:** 一度実行されていれば「今 lockfile に無いから安全」にはならない。端末・CI のフォレンジックと credential ローテーションが必要。

---

## 攻撃の要点（変わらない部分）

1. 依存 tarball に `"preinstall": "node setup.mjs"` → **install 前に実行**
2. `setup.mjs` が **Bun** を落として難読化 JS（`Math_Symbol.js` / `math_init.js`）を実行
3. npm / GitHub / クラウド / CI secrets を窃取 → **他パッケージを patch 版で再 publish**（ワーム）
4. `.claude/` / `.vscode/` への永続化、GitHub repo への exfil もあり
5. **SLSA provenance が付いていても安全とは限らない**（正当 CI 経由の侵害例あり）

---

## 対策チェックリスト

### 今すぐ

- [ ] 疑いがある間は Dependabot / Renovate の **自動 merge 停止**
- [ ] 全 lockfile を [Wiz `keyv-packages.csv`](https://raw.githubusercontent.com/wiz-sec-public/wiz-research-iocs/main/reports/keyv-packages.csv) と照合（[lockfile 照合スクリプト](#lockfile-照合スクリプト)）
- [ ] 端末 IOC スキャン（[スニペット](#端末--リポジトリのスキャン)）
- [ ] **`ignore-scripts=true`** をプロジェクト `.npmrc` に入れる

### 侵害疑いがある場合（compromised 扱い）

1. **先に** `gh-token-monitor` を除去（revoke 前に報復ペイロードが走る場合あり）
2. GitHub / npm / クラウド / SSH 等を **クリーン端末から**ローテーション
3. GitHub: 不審 workflow、`.claude`/`.vscode` 注入、公開 repo `Shai-Hulud` 説明文
4. `npm cache clean --force` → `rm -rf node_modules` → **`npm ci`**（`.npmrc` で scripts 無効のまま）

### 恒久

- [ ] **`package-lock.json` をコミット**し **`npm ci` のみ**（`npm install` でバージョンがブレない）
- [ ] **`min-release-age`**（7 日など）で新規 publish 版の即時取り込みを防ぐ
- [ ] GitHub: 2FA、branch protection（**admin bypass 無効**）、Actions デフォルト read-only
- [ ] GitHub Actions で **chaindrop-scan**（PR / 定期 schedule）。Dependabot / Renovate は **任意**（[GitHub Actions / CI](#github-actions--ci)）
- [ ] `.claude/` / `.vscode/` を gitignore（永続化パスの誤コミット防止）

---

## 設定スニペット（リポジトリ実装）

本ガイドに沿った `.npmrc` 等の例。**他 repo へコピー可。**

### `.npmrc`（npm — 必須）

```ini
save-exact=true
ignore-scripts=true
audit=true
min-release-age=7
```

`ignore-scripts=true` が **ChainDrop の preinstall 実行を止める要**。  
ルート package の lifecycle も止まるので、`preinstall` で「npm install 禁止」は **別途 README で運用**する。

### `.yarnrc.yml`（Yarn 利用時）

```yaml
enableScripts: false
npmMinimalAgeGate: "7d"
```

### `bunfig.toml`（Bun 利用時）

```toml
[install]
minimum_release_age = 10080
exact = true
```

`10080` = 7 日（分）。

### `pnpm-workspace.yaml`（pnpm v10.16+）

```yaml
minimumReleaseAge: 10080
```

### `package.json`（Bun 向けメモ）

```json
{
  "trustedDependencies": [],
  "x-notes": {
    "install": "npm ci のみ。.npmrc の ignore-scripts=true が有効なこと。"
  }
}
```

`preinstall` は **入れない**（`ignore-scripts` と矛盾し、ガードとしても効かない）。

### `.gitignore`（追記推奨）

```gitignore
.vscode/
.claude/
node_modules/
```

**`package-lock.json` は ignore しない**（過去 htdocs では ignore されていた — 修正済み）。

### インストール手順（開発者向け）

```bash
cd htdocs
npm ci
npm run dev
```

`.npmrc` があるディレクトリで実行すること。`npm install` は lockfile を意図せず更新するので **使わない**。

### 伝播経路を pin する場合（`keyv` 系に依存している repo）

```json
{
  "overrides": {
    "keyv": "5.6.0",
    "flat-cache": "6.1.23",
    "file-entry-cache": "11.1.5",
    "cacheable": "2.5.0",
    "cacheable-request": "13.0.19",
    "cache-manager": "7.2.9"
  }
}
```

バージョンは **インシデント当時の安全版**。最新の公表リスト・ベンダー advisory を優先すること。

---

## 端末 / リポジトリのスキャン

### lockfile 簡易 grep（頭部パッケージ）

```bash
grep -E '(keyv@6\.0\.0|flat-cache@6\.1\.24|file-entry-cache@11\.1\.6|cacheable@2\.5\.1|cache-manager@7\.2\.10)' \
  package-lock.json pnpm-lock.yaml yarn.lock 2>/dev/null
```

完全版は CSV 照合（[lockfile 照合スクリプト](#lockfile-照合スクリプト) / 本 repo: `npm run chaindrop:scan`）

### 端末上の IOC

```bash
find . -path '*/node_modules/*/setup.mjs' 2>/dev/null
find . \( -path '*/node_modules/*/Math_Symbol.js' -o -path '*/node_modules/*/math_init.js' \) 2>/dev/null
test -f ~/.local/bin/gh-token-monitor.sh && echo 'WARN: gh-token-monitor present'
```

### GitHub ワークフロー

```bash
rg -l 'setup\.mjs|Math_Symbol|math_init|Run Copilot' .github/ 2>/dev/null
```

---

## lockfile 照合スクリプト

Wiz [`keyv-packages.csv`](https://raw.githubusercontent.com/wiz-sec-public/wiz-research-iocs/main/reports/keyv-packages.csv) を fetch / キャッシュし、lockfile 内 `package@version` を照合。**Node 18+・依存ゼロ・1 ファイル**。

| 本 repo | 他 repo |
|---------|---------|
| `npm run chaindrop:scan` | 下の `<details>` から `chaindrop-scan.mjs` を生成 |
| `npm run chaindrop:scan:fetch` | `--fetch` で CSV 再取得（キャッシュ 24h） |
| `npm run chaindrop:scan:fetch -- --check-artifacts` | `node_modules` 内ペイロードも検索 |

実行用実体: [`scripts/chaindrop-scan.mjs`](../scripts/chaindrop-scan.mjs)。`npm run chaindrop:sync` で doc 埋め込み・htdocs CI コピーを同期。

<details>
<summary><code>package.json</code> 追記（既存 <code>scripts</code> にマージ）</summary>

```json
{
  "scripts": {
    "chaindrop:scan": "node scripts/chaindrop-scan.mjs",
    "chaindrop:scan:fetch": "node scripts/chaindrop-scan.mjs --fetch"
  }
}
```

</details>

<!-- chaindrop-scan-embed:start -->

<details>
<summary><code>chaindrop-scan.mjs</code> 全文（クリックで展開）</summary>

```javascript
#!/usr/bin/env node
/**
 * npm サプライチェーン汚染パッケージ照合（Wiz keyv-packages.csv）
 *
 * Usage:
 *   node scripts/chaindrop-scan.mjs [root]
 *   node scripts/chaindrop-scan.mjs --package-json ./path/to/package.json
 *   node scripts/chaindrop-scan.mjs --fetch --check-artifacts
 *
 * 正本。`npm run chaindrop:sync` で doc 埋め込み・htdocs CI 用コピーを同期
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {{ name: string, version: string, lockfile: string, projectDir: string }} ResolvedDep */
/** @typedef {{ package: string, version: string, lockfile: string, projectDir: string }} Match */
/** @typedef {{ projectDir: string, packageJson: string, lockfiles: string[] }} ProjectTarget */

const DEFAULT_IOC_URL =
  'https://raw.githubusercontent.com/wiz-sec-public/wiz-research-iocs/main/reports/keyv-packages.csv';

const LOCKFILE_NAMES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'];

const IOC_FILE_NAMES = ['setup.mjs', 'Math_Symbol.js', 'math_init.js'];

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '.cache',
]);

// --- IOC CSV ---

/**
 * @param {string} versionsField
 * @returns {string[]}
 */
export function parseMaliciousVersionsField(versionsField) {
  let raw = versionsField.trim();
  if (raw.startsWith('"') && raw.endsWith('"')) {
    raw = raw.slice(1, -1);
  }
  return raw
    .split(',')
    .flatMap((part) => part.split(/\s*\|\|\s*/))
    .map((v) => v.trim().replace(/^=\s*/, ''))
    .filter(Boolean);
}

/**
 * @param {string} csvText
 * @returns {Map<string, Set<string>>}
 */
export function parseIocCsv(csvText) {
  /** @type {Map<string, Set<string>>} */
  const map = new Map();
  for (const line of csvText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const comma = trimmed.indexOf(',');
    if (comma === -1) continue;
    const pkg = trimmed.slice(0, comma).trim();
    const versionsField = trimmed.slice(comma + 1);
    if (!pkg || pkg === 'Package') continue;
    const versions = parseMaliciousVersionsField(versionsField);
    if (!map.has(pkg)) map.set(pkg, new Set());
    for (const v of versions) map.get(pkg).add(v);
  }
  return map;
}

/**
 * @param {string} [cacheDir]
 */
export function defaultCachePath(cacheDir) {
  const base = cacheDir || join(homedir(), '.cache', 'chaindrop-scan');
  return join(base, 'keyv-packages.csv');
}

/**
 * @param {{ url?: string, cachePath: string, fetch?: boolean, maxAgeHours?: number }} opts
 */
async function loadIocMap(opts) {
  const url = opts.url || DEFAULT_IOC_URL;
  const cachePath = opts.cachePath;
  const maxAgeMs = (opts.maxAgeHours ?? 24) * 60 * 60 * 1000;

  let useCache = !opts.fetch;
  if (useCache) {
    try {
      const st = await stat(cachePath);
      useCache = Date.now() - st.mtimeMs < maxAgeMs;
    } catch {
      useCache = false;
    }
  }

  let csvText;
  let source;
  if (useCache) {
    csvText = await readFile(cachePath, 'utf8');
    source = 'cache';
  } else {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch IOC list (${res.status}): ${url}`);
    }
    csvText = await res.text();
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, csvText, 'utf8');
    source = 'remote';
  }

  const map = parseIocCsv(csvText);
  const st = await stat(cachePath);
  return {
    map,
    cachePath,
    source,
    packageCount: map.size,
    fetchedAt: st.mtime.toISOString(),
  };
}

/**
 * @param {Map<string, Set<string>>} iocMap
 * @param {string} name
 * @param {string} version
 */
export function isCompromised(iocMap, name, version) {
  const versions = iocMap.get(name);
  return versions?.has(version) ?? false;
}

// --- lockfiles ---

/**
 * @param {string} lockKey
 * @returns {string | null}
 */
export function packageNameFromNpmLockKey(lockKey) {
  if (!lockKey) return null;
  const idx = lockKey.lastIndexOf('node_modules/');
  if (idx === -1) return lockKey;
  return lockKey.slice(idx + 'node_modules/'.length);
}

/**
 * @param {string} lockfilePath
 * @param {string} projectDir
 * @returns {Promise<ResolvedDep[]>}
 */
export async function parsePackageLock(lockfilePath, projectDir) {
  const raw = JSON.parse(await readFile(lockfilePath, 'utf8'));
  /** @type {ResolvedDep[]} */
  const deps = [];
  const relLock = relative(projectDir, lockfilePath) || basename(lockfilePath);

  if (raw.packages && typeof raw.packages === 'object') {
    for (const [key, pkg] of Object.entries(raw.packages)) {
      if (!pkg || typeof pkg !== 'object' || !pkg.version) continue;
      const name = key === '' ? null : packageNameFromNpmLockKey(key);
      if (!name) continue;
      deps.push({ name, version: pkg.version, lockfile: relLock, projectDir });
    }
    return deps;
  }

  if (raw.dependencies && typeof raw.dependencies === 'object') {
    /** @param {Record<string, unknown>} tree */
    function walk(tree) {
      for (const [name, info] of Object.entries(tree)) {
        if (!info || typeof info !== 'object') continue;
        const version = /** @type {{ version?: string, dependencies?: Record<string, unknown> }} */ (info).version;
        if (version) {
          deps.push({ name, version, lockfile: relLock, projectDir });
        }
        const nested = /** @type {{ dependencies?: Record<string, unknown> }} */ (info).dependencies;
        if (nested) walk(nested);
      }
    }
    walk(raw.dependencies);
  }
  return deps;
}

/**
 * @param {string} content
 * @param {string} lockfilePath
 * @param {string} projectDir
 * @returns {ResolvedDep[]}
 */
function parsePnpmLockContent(content, lockfilePath, projectDir) {
  /** @type {ResolvedDep[]} */
  const deps = [];
  const relLock = relative(projectDir, lockfilePath) || basename(lockfilePath);
  const re = /^ {2}(@?[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)?)@([^(\s]+)\(/gm;
  let m;
  while ((m = re.exec(content)) !== null) {
    deps.push({ name: m[1], version: m[2], lockfile: relLock, projectDir });
  }
  return deps;
}

/**
 * @param {string} content
 * @param {string} lockfilePath
 * @param {string} projectDir
 * @returns {ResolvedDep[]}
 */
function parseYarnLockContent(content, lockfilePath, projectDir) {
  /** @type {ResolvedDep[]} */
  const deps = [];
  const relLock = relative(projectDir, lockfilePath) || basename(lockfilePath);
  const blocks = content.split(/\n(?=[^#\s].*@)/);
  for (const block of blocks) {
    const header = block.match(/^"?([^@\n]+)@([^\n":]+)"?:/);
    if (!header) continue;
    const versionMatch = block.match(/^\s+version\s+"([^"]+)"/m);
    if (!versionMatch) continue;
    deps.push({
      name: header[1].trim(),
      version: versionMatch[1],
      lockfile: relLock,
      projectDir,
    });
  }
  return deps;
}

/**
 * @param {string} lockfilePath
 * @param {string} projectDir
 */
async function parseLockfile(lockfilePath, projectDir) {
  const base = basename(lockfilePath);
  const content = await readFile(lockfilePath, 'utf8');
  if (base === 'package-lock.json') {
    return parsePackageLock(lockfilePath, projectDir);
  }
  if (base === 'pnpm-lock.yaml') {
    return parsePnpmLockContent(content, lockfilePath, projectDir);
  }
  if (base === 'yarn.lock') {
    return parseYarnLockContent(content, lockfilePath, projectDir);
  }
  return [];
}

/**
 * @param {ResolvedDep[]} deps
 */
function dedupeDeps(deps) {
  /** @type {Map<string, ResolvedDep>} */
  const map = new Map();
  for (const dep of deps) {
    const key = `${dep.projectDir}\0${dep.lockfile}\0${dep.name}@${dep.version}`;
    map.set(key, dep);
  }
  return [...map.values()];
}

// --- discover ---

/**
 * @param {string} dir
 * @param {ProjectTarget[]} out
 */
async function walkForProjects(dir, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const pkgPath = join(dir, 'package.json');
  let hasPackageJson = false;
  try {
    const st = await stat(pkgPath);
    hasPackageJson = st.isFile();
  } catch {
    hasPackageJson = false;
  }

  if (hasPackageJson) {
    /** @type {string[]} */
    const lockfiles = [];
    for (const name of LOCKFILE_NAMES) {
      const lf = join(dir, name);
      try {
        const st = await stat(lf);
        if (st.isFile()) lockfiles.push(lf);
      } catch {
        // no lockfile
      }
    }
    out.push({ projectDir: dir, packageJson: pkgPath, lockfiles });
  }

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (SKIP_DIRS.has(ent.name)) continue;
    await walkForProjects(join(dir, ent.name), out);
  }
}

/**
 * @param {string} root
 * @returns {Promise<ProjectTarget[]>}
 */
async function discoverProjects(root) {
  /** @type {ProjectTarget[]} */
  const projects = [];
  await walkForProjects(root, projects);
  return projects.sort((a, b) => a.projectDir.localeCompare(b.projectDir));
}

/**
 * @param {string} packageJsonPath
 * @returns {Promise<ProjectTarget | null>}
 */
async function projectFromPackageJson(packageJsonPath) {
  const st = await stat(packageJsonPath);
  if (!st.isFile()) return null;
  const projectDir = dirname(packageJsonPath);
  /** @type {string[]} */
  const lockfiles = [];
  for (const name of LOCKFILE_NAMES) {
    const lf = join(projectDir, name);
    try {
      const lst = await stat(lf);
      if (lst.isFile()) lockfiles.push(lf);
    } catch {
      // skip
    }
  }
  return { projectDir, packageJson: packageJsonPath, lockfiles };
}

/**
 * @param {string} packageJsonPath
 */
async function readPackageJsonName(packageJsonPath) {
  try {
    const raw = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    return typeof raw.name === 'string' ? raw.name : packageJsonPath;
  } catch {
    return packageJsonPath;
  }
}

// --- scan ---

/**
 * @param {string} root
 */
async function findIocArtifacts(root) {
  /** @type {string[]} */
  const hits = [];
  /** @param {string} dir */
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === '.git') continue;
        await walk(full);
        continue;
      }
      if (IOC_FILE_NAMES.includes(ent.name) && /[/\\]node_modules[/\\]/.test(full)) {
        hits.push(relative(root, full));
      }
    }
  }
  const nm = join(root, 'node_modules');
  try {
    const st = await stat(nm);
    if (st.isDirectory()) await walk(nm);
  } catch {
    // no node_modules
  }
  return hits;
}

/**
 * @param {{
 *   root: string,
 *   packageJson?: string,
 *   fetch?: boolean,
 *   cachePath: string,
 *   iocUrl?: string,
 *   checkArtifacts?: boolean,
 * }} opts
 */
export async function runScan(opts) {
  const root = opts.root;
  /** @type {ProjectTarget[]} */
  let projects;
  if (opts.packageJson) {
    const one = await projectFromPackageJson(opts.packageJson);
    projects = one ? [one] : [];
  } else {
    projects = await discoverProjects(root);
  }

  const ioc = await loadIocMap({
    url: opts.iocUrl,
    cachePath: opts.cachePath,
    fetch: opts.fetch,
  });

  /** @type {Match[]} */
  const matches = [];
  /** @type {{ project: string, packageJson: string, lockfile: string, status: string }[]} */
  const lockfileReports = [];
  /** @type {{ project: string, warning: string }[]} */
  const warnings = [];
  /** @type {string[]} */
  const artifacts = [];

  for (const project of projects) {
    const pkgName = await readPackageJsonName(project.packageJson);
    const relProject = relative(root, project.projectDir) || '.';

    if (project.lockfiles.length === 0) {
      warnings.push({
        project: relProject,
        warning: `${pkgName}: lockfile なし — 直接依存のみでは transitive の汚染を検出できません`,
      });
      continue;
    }

    for (const lockfile of project.lockfiles) {
      const deps = dedupeDeps(await parseLockfile(lockfile, project.projectDir));
      const relLock = relative(root, lockfile);
      const projectMatches = deps.filter((d) => isCompromised(ioc.map, d.name, d.version));
      if (projectMatches.length === 0) {
        lockfileReports.push({
          project: relProject,
          packageJson: relative(root, project.packageJson),
          lockfile: relLock,
          status: 'OK',
        });
      } else {
        for (const m of projectMatches) {
          matches.push({
            package: m.name,
            version: m.version,
            lockfile: relLock,
            projectDir: relProject,
          });
        }
        lockfileReports.push({
          project: relProject,
          packageJson: relative(root, project.packageJson),
          lockfile: relLock,
          status: `MATCH ${projectMatches.length}`,
        });
      }
    }

    if (opts.checkArtifacts) {
      artifacts.push(...(await findIocArtifacts(project.projectDir)).map((p) => join(relProject, p)));
    }
  }

  return {
    root,
    ioc,
    projects: projects.map((p) => ({
      projectDir: relative(root, p.projectDir) || '.',
      packageJson: relative(root, p.packageJson),
      lockfiles: p.lockfiles.map((lf) => relative(root, lf)),
    })),
    lockfileReports,
    matches,
    warnings,
    artifacts,
  };
}

// --- CLI ---

function usage() {
  console.log(`Usage: chaindrop-scan [options] [root]

Options:
  --package-json <path>  指定 package.json のプロジェクトのみ
  --fetch                IOC リストを強制再取得
  --cache-dir <path>     キャッシュディレクトリ（default: ~/.cache/chaindrop-scan）
  --check-artifacts      node_modules 内の setup.mjs / Math_Symbol.js 等を検索
  --json                 JSON 出力
  -h, --help             このヘルプ

環境変数:
  CHAINDROP_IOC_URL      汚染リスト CSV URL（default: Wiz keyv-packages.csv）
`);
}

function parseArgs(argv) {
  /** @type {{ root: string, packageJson?: string, fetch: boolean, cacheDir?: string, checkArtifacts: boolean, json: boolean }} */
  const opts = {
    root: process.cwd(),
    fetch: false,
    checkArtifacts: false,
    json: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        usage();
        process.exit(0);
        break;
      case '--package-json':
        opts.packageJson = resolve(argv[++i]);
        break;
      case '--fetch':
        opts.fetch = true;
        break;
      case '--cache-dir':
        opts.cacheDir = argv[++i];
        break;
      case '--check-artifacts':
        opts.checkArtifacts = true;
        break;
      case '--json':
        opts.json = true;
        break;
      default:
        if (arg.startsWith('-')) {
          console.error(`chaindrop-scan: unknown option: ${arg}`);
          usage();
          process.exit(2);
        }
        positional.push(arg);
    }
  }
  if (positional[0]) opts.root = resolve(positional[0]);
  if (opts.packageJson) opts.root = dirname(resolve(opts.packageJson));
  return opts;
}

function printTextReport(result) {
  const { ioc, root, projects, lockfileReports, matches, warnings, artifacts } = result;
  console.log(`chaindrop-scan: root=${root}`);
  console.log(
    `chaindrop-scan: loaded ${ioc.packageCount} packages from ${ioc.source} (${ioc.cachePath}, ${ioc.fetchedAt})`,
  );
  console.log(`chaindrop-scan: projects=${projects.length} lockfiles=${lockfileReports.length}`);

  for (const w of warnings) {
    console.log(`chaindrop-scan: WARN [${w.project}] ${w.warning}`);
  }

  for (const r of lockfileReports) {
    if (r.status === 'OK') {
      console.log(`chaindrop-scan: OK ${r.lockfile}`);
    } else {
      console.log(`chaindrop-scan: ${r.status} ${r.lockfile}`);
    }
  }

  for (const m of matches) {
    console.log(`chaindrop-scan: MATCH ${m.package}@${m.version}`);
    console.log(`  project: ${m.projectDir}`);
    console.log(`  lockfile: ${m.lockfile}`);
  }

  for (const a of artifacts) {
    console.log(`chaindrop-scan: ARTIFACT ${a}`);
  }

  const summaryMatches = matches.length + artifacts.length;
  console.log(
    `chaindrop-scan: summary matches=${summaryMatches} compromised_deps=${matches.length} artifacts=${artifacts.length}`,
  );
  return summaryMatches > 0 ? 1 : 0;
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const cachePath = defaultCachePath(cli.cacheDir);

  const result = await runScan({
    root: cli.root,
    packageJson: cli.packageJson,
    fetch: cli.fetch,
    cachePath,
    iocUrl: process.env.CHAINDROP_IOC_URL,
    checkArtifacts: cli.checkArtifacts,
  });

  if (cli.json) {
    console.log(JSON.stringify(result, null, 2));
    const code = result.matches.length + result.artifacts.length > 0 ? 1 : 0;
    process.exit(code);
  }

  process.exit(printTextReport(result));
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  main().catch((err) => {
    console.error(`chaindrop-scan: ${err.message}`);
    process.exit(2);
  });
}
```

</details>
<!-- chaindrop-scan-embed:end -->

マッチ時 **exit 1**。主要オプション: `--package-json` `--fetch` `--check-artifacts` `--json` / env `CHAINDROP_IOC_URL`

---

## GitHub Actions / CI

ChainDrop 防御の**要は lockfile 照合 CI**（`chaindrop-scan`）。Dependabot / Renovate の自動更新 PR は **補助**であり、無くても `.npmrc` + lockfile + 手動更新で足りる。

### 共通

| 項目 | 推奨 |
|------|------|
| Actions | `actions/checkout@v6` 以上、`actions/setup-node@v6` 以上（Node 24 ランナー対応） |
| workflow `permissions` | `contents: read` のみ |
| スキャン script | [lockfile 照合スクリプト](#lockfile-照合スクリプト) を `.github/scripts/` に配置（または正本 + sync） |
| マージ前 | chaindrop-scan **matches=0** を確認。**Dependabot PR の自動 merge は禁止** |
| 本番 Web サーバー | `.github/`・lockfile・`.npmrc` 等はデプロイ除外（下記 [本番転送の除外](#本番転送の除外)） |

### chaindrop-scan workflow（例）

| トリガー | 用途 |
|----------|------|
| `pull_request` / `push` | lockfile・`.npmrc`・workflow 変更時（path filter 推奨） |
| `schedule`（例: 週1） | Wiz CSV 更新後の定期再照合（`--fetch`） |
| `workflow_dispatch` | 手動（fetch / check_artifacts） |

**開発環境 repo + アプリ repo（submodule）** の典型:

| repo の役割 | CI が scan する範囲 |
|-------------|---------------------|
| **アプリ repo**（HTML 本体） | 当 repo ルートの lockfile |
| **開発環境 repo**（Docker / ツール） | 当 repo 内の npm プロジェクトのみ（例: ルート、`req-info-v2/` 等） |

`submodules: recursive` で **別 private repo** を checkout する必要はない。`GITHUB_TOKEN` は **workflow を走らせた repo 専用**で、他 repo の private サブモジュールには届かない（`repository not found` 相当）。サブモジュール側の lockfile は **アプリ repo 側 CI** で照合する。

ローカルでは submodule を init 済みなら `npm run chaindrop:scan` が `htdocs/` も walk する。CI 上の責務分割と混同しないこと。

### Dependabot（任意）

[`.github/dependabot.yml`](https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file) で version updates を有効化できる。**必須ではない。**

| 項目 | 推奨 |
|------|------|
| 対象 | `npm`（manifest がある directory ごと）、必要なら `github-actions` |
| 自動 merge | **禁止** |
| PR 時 | chaindrop-scan が走るよう path filter を合わせる |

`.npmrc` に **`min-release-age`** がある場合:

- 手動 `npm install` と同様、Dependabot の npm 更新でも **公開から N 日未満の版は解決できず** `ETARGET` になることがある
- `dependabot.yml` に **`cooldown.default-days`** を同じ日数で揃える（例: 7）
- private repo では **Dependency graph**（Settings → Advanced Security）が無効だと更新ジョブが失敗しやすい

運用が重い・CI がキャンセルされる場合は **Dependabot を止め**、週次 schedule の chaindrop-scan + 必要時の手動 `npm outdated` でよい。

#### dependabot.yml 例（npm + github-actions）

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    cooldown:
      default-days: 7   # .npmrc min-release-age=7 と揃える
    open-pull-requests-limit: 2

  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 2
```

### SSH rsync deploy（GitHub Actions・任意）

アプリ repo で **workflow_dispatch** により、選択ブランチの作業ツリーを rsync 転送する例（`htdocs/.github/workflows/ssh-rsync-deploy.yml`）。

| 入力 | 説明 |
|------|------|
| デプロイ先 | 複数環境がある場合は `server` 等で docroot を切り替え |
| `dry_run` | 既定 `true`。本番前に転送一覧を確認 |

**git 差分 mode ではなく**、Run workflow 時に選んだ **ブランチを checkout した状態を丸ごと** rsync する（シンプル運用）。**`--delete` は使わない**（追加・更新のみ）。

Repository secrets の例:

| Secret | 内容 |
|--------|------|
| `SSH_PRIVATE_KEY` | デプロイ用秘密鍵 |
| `SSH_HOST` / `SSH_USER` / `SSH_PORT` | 接続先（環境共通でよい場合） |
| `STAGING_DIR` / `PRODUCTION_DIR` 等 | 環境ごとの docroot |

除外リスト（`.github/deploy-exclude.txt`）で `.github/`、npm 設定、lockfile、`node_modules/` 等を転送対象外にする。

Environment 機能が使えない場合は **repo secrets + プレフィックス**（例: `STAGING_DIR` / `PRODUCTION_DIR`）で足りる。

### 本番転送の除外

開発用ファイルを本番 Web サーバーに載せない:

- `.github/`（Actions 設定・スキャン script）
- `package.json` / lockfile / `.npmrc` 等（ランタイム不要な npm 設定）
- `node_modules/`

親 repo の makediff / FTP / SSH ローカルコマンドでも同趣旨の exclude リストを共有する（例: `docker/bin/makediff-exclude.txt`）。

### 配置例（開発環境 repo + submodule）

| パス | lockfile | chaindrop-scan CI | Dependabot |
|------|----------|-------------------|------------|
| `/`（開発環境 repo） | あれば | ルート + サブディレクトリ（submodule **除く**） | 任意 |
| `htdocs/`（submodule＝アプリ repo） | **コミット必須** | アプリ repo 側 workflow | 任意 |
| その他 npm サブプロジェクト | あれば | 開発環境 repo 側で directory 指定 | 任意 |

---

## GitHub 組織・リポジトリ設定

npm だけ固めても **maintainer GitHub 侵害 → OIDC publish** で再発しうる。

| 領域 | 推奨 |
|------|------|
| Organization | 全メンバー **2FA**（passkey 推奨）、base permissions **Read** |
| Branch protection（`main` / `develop`） | PR 必須、**Include administrators**、signed commits（可能なら） |
| Actions | デフォルト **Read** repository contents のみ |
| lockfile 照合 | **chaindrop-scan**（PR + schedule）。Dependabot は任意 |
| npm publish | 長寿命 `NPM_TOKEN` を避ける。OIDC 利用時は **environment protection** + workflow `permissions` 最小化 |
| 事後調査 | commit message `chore: update config` + `.claude`/`.vscode` 追加、repo description 改ざん |

---

## AI エージェント向け

この文書を読んだ **別 AI エージェント**向けの指示。ユーザーにそのまま渡してよい。

### 目的

npm サプライチェーンワーム（ChainDrop / Shai-Hulud 系）への **防御設定の適用**と **lockfile / 端末の照合**。事件の詳細調査は [参照](#参照) の URL から最新情報を取る。

### やってよいこと

1. 対象 repo の **全 `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock`** を探索
2. [Wiz `keyv-packages.csv`](https://raw.githubusercontent.com/wiz-sec-public/wiz-research-iocs/main/reports/keyv-packages.csv) と **完全一致**（`name@version`）で照合
3. [設定スニペット](#設定スニペットリポジトリ実装) を **不足分のみ**追加（既存方針を壊さない）
4. **`package-lock.json` を gitignore から外しコミット**（未実施なら）
5. `package.json` から **意味のない `preinstall` ガードを削除**（`ignore-scripts=true` と併用不可のため）
6. 汚染照合は [lockfile 照合スクリプト](#lockfile-照合スクリプト) の `<details>` から実装するか、開発環境 repo なら `npm run chaindrop:scan`（submodule init 済みなら walk 対象に含む）。`chaindrop-scan.mjs` 編集後は `npm run chaindrop:sync`
7. **開発環境 repo の CI** では private submodule を checkout しない。アプリ repo 側 CI で lockfile を照合する（[GitHub Actions / CI](#github-actions--ci)）

### やらないこと

- **`npm install` で lockfile を更新してコミット**（ユーザー明示がない限り）。生成は `npm install --package-lock-only` または `npm ci` 方針を確認
- **`ignore-scripts=false` に変更**（セキュリティ後退）
- 公表 CSV と無関係な **`overrides` の一括追加**（該当依存が無い repo では不要）
- 時事性の高い数値（444 packages 等）を **正本としてハードコード** — 常に CSV / 参照 URL を fetch

### 成果物の報告形式

```text
1. スキャン: {lockfile 数} 件、マッチ {n} 件（あれば package@version 列挙）
2. 設定: 追加/変更したファイル一覧
3. 未対応: （該当がなければ「なし」）
4. 侵害疑い: マッチ >0 または IOC あり → Phase 1（ローテーション）を人間に促す
```


---

## 参照

事件の詳細・IOC ハッシュ・タイムライン・被害件数は以下を正とする（**更新される**）。

| 種別 | URL |
|------|-----|
| **汚染 pkg リスト（CSV）** | https://raw.githubusercontent.com/wiz-sec-public/wiz-research-iocs/main/reports/keyv-packages.csv |
| Wiz 調査 | https://www.wiz.io/blog/keyv-and-cacheable-npm-supply-chain-attack |
| StepSecurity | https://www.stepsecurity.io/blog/chaindrop-npm-worm |
| Microsoft | https://www.microsoft.com/en-us/security/blog/2026/08/04/chaindrop-supply-chain-compromise-anatomy-self-propagating-worm/ |
| Aikido | https://www.aikido.dev/blog/keyv-and-friends-compromised-in-npm-supply-chain-attack |

**注意:** 同リポジトリの `shai-hulud-2-packages.csv` は **別キャンペーン**。ChainDrop 照合は **`keyv-packages.csv`**。

### IOC クイック参照（ハッシュ）

| ファイル | SHA-256 |
|----------|---------|
| `setup.mjs`（tarball） | `54dc7ea54a1317cca0e890a2770630cf7fa6c97813e0cb9d2caa93012b350668` |
| `setup.mjs`（IDE） | `fd3ca4007b225fdf8de7af4345a19179d5efa8c4bb9205f88cda806e5684b1eb` |
| `Math_Symbol.js` / `math_init.js` | `9fc2570b7cef51c1b8df116d144d11ff4096357be7d2c4c6367cfc2509cf1bcc` |

ネットワーク: `npm-cache.com`（`:443/router`）、永続化: `gh-token-monitor` — 詳細は上記レポート。
