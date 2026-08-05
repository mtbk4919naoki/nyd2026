#!/usr/bin/env node
/**
 * npm サプライチェーン汚染パッケージ照合（Wiz keyv-packages.csv）
 *
 * Usage:
 *   node scripts/chaindrop-scan.mjs [root]
 *   node scripts/chaindrop-scan.mjs --package-json ./path/to/package.json
 *   node scripts/chaindrop-scan.mjs --fetch --check-artifacts
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
