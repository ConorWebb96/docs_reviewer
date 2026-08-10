import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const envPath = path.join(__dirname, '.env');

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const content = readFileSync(filePath, 'utf8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const fileEnv = loadEnvFile(envPath);
const localRepoDir = process.env.local_repo_dir || fileEnv.local_repo_dir || '';
const mainBranch = process.env.main_branch || fileEnv.main_branch || '';
const compareBranch = process.env.compare_branch || fileEnv.compare_branch || '';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function text(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function runGit(repoPath, args) {
  const result = spawnSync('git', ['-C', repoPath, ...args], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args.join(' ')}`);
  }
  return result.stdout;
}

function isRepo(repoPath) {
  if (!repoPath) return false;
  const probe = spawnSync('git', ['-C', repoPath, 'rev-parse', '--is-inside-work-tree'], {
    encoding: 'utf8',
  });
  return probe.status === 0 && probe.stdout.trim() === 'true';
}

function resolveDefaultBase(repoPath) {
  const candidates = [
    ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
    ['rev-parse', '--abbrev-ref', 'origin/HEAD'],
  ];
  for (const args of candidates) {
    const result = spawnSync('git', ['-C', repoPath, ...args], { encoding: 'utf8' });
    if (result.status === 0) {
      const ref = result.stdout.trim();
      if (ref) return ref;
    }
  }
  const branches = listBranches(repoPath);
  if (branches.includes('main')) return 'main';
  if (branches.includes('master')) return 'master';
  return branches[0] || 'HEAD';
}

function resolveCurrentBranch(repoPath) {
  const result = spawnSync('git', ['-C', repoPath, 'branch', '--show-current'], { encoding: 'utf8' });
  if (result.status === 0) {
    const branch = result.stdout.trim();
    if (branch) return branch;
  }
  return 'HEAD';
}

function listBranches(repoPath) {
  const output = runGit(repoPath, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes']);
  return [...new Set(output.split('\n').map((line) => line.trim()).filter(Boolean))].sort();
}

function listDocFiles(repoPath, baseRef, compareRef) {
  const output = runGit(repoPath, [
    'diff',
    '--name-only',
    '--diff-filter=ACMRT',
    `${baseRef}...${compareRef}`,
    '--',
    '*.md',
    '*.mdx',
    '*.markdown',
  ]);
  return output.split('\n').map((line) => line.trim()).filter(Boolean);
}

function getFileChangeStats(repoPath, baseRef, compareRef, filePath) {
  const output = runGit(repoPath, [
    'diff',
    '--numstat',
    `${baseRef}...${compareRef}`,
    '--',
    filePath,
  ]).trim();

  if (!output) {
    return { additions: 0, deletions: 0 };
  }

  const [line] = output.split('\n');
  const [addsRaw, delsRaw] = line.split('\t');
  const additions = addsRaw === '-' ? 0 : Number(addsRaw || 0);
  const deletions = delsRaw === '-' ? 0 : Number(delsRaw || 0);
  return {
    additions: Number.isFinite(additions) ? additions : 0,
    deletions: Number.isFinite(deletions) ? deletions : 0,
  };
}

function listDocChanges(repoPath, baseRef, compareRef) {
  return listDocFiles(repoPath, baseRef, compareRef).map((file) => ({
    file,
    ...getFileChangeStats(repoPath, baseRef, compareRef, file),
  }));
}

function readRefFile(repoPath, ref, filePath) {
  const gitPath = `${ref}:${filePath}`;
  const result = spawnSync('git', ['-C', repoPath, 'show', gitPath], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    if (/does not exist in/i.test(stderr) || /Path '.*' does not exist in/i.test(stderr)) {
      return null;
    }
    throw new Error(stderr || `Unable to read ${gitPath}`);
  }
  return result.stdout;
}

function sendIndex(res) {
  const html = readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  text(res, 200, html, 'text/html; charset=utf-8');
}

function safeRepoPath(raw) {
  if (!raw) return '';
  return path.resolve(raw);
}

function withQuery(url) {
  return Object.fromEntries(url.searchParams.entries());
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/meta') {
    try {
      const repoPath = safeRepoPath(url.searchParams.get('repoPath'));
      if (!isRepo(repoPath)) {
        return json(res, 400, { error: 'That path is not a git repository.' });
      }
      const branches = listBranches(repoPath);
      const defaultBase = resolveDefaultBase(repoPath);
      const currentBranch = resolveCurrentBranch(repoPath);
      return json(res, 200, { repoPath, branches, defaultBase, currentBranch });
    } catch (error) {
      return json(res, 500, { error: error.message });
    }
  }

  if (url.pathname === '/api/config') {
    return json(res, 200, {
      localRepoDir,
      mainBranch,
      compareBranch,
    });
  }

  if (url.pathname === '/api/files') {
    try {
      const { repoPath: rawRepoPath, base, compare } = withQuery(url);
      const repoPath = safeRepoPath(rawRepoPath);
      if (!isRepo(repoPath)) {
        return json(res, 400, { error: 'That path is not a git repository.' });
      }
      if (!base || !compare) {
        return json(res, 400, { error: 'Both base and compare refs are required.' });
      }
      const changes = listDocChanges(repoPath, base, compare);
      return json(res, 200, { changes });
    } catch (error) {
      return json(res, 500, { error: error.message });
    }
  }

  if (url.pathname === '/api/file') {
    try {
      const { repoPath: rawRepoPath, ref, file } = withQuery(url);
      const repoPath = safeRepoPath(rawRepoPath);
      if (!isRepo(repoPath)) {
        return json(res, 400, { error: 'That path is not a git repository.' });
      }
      if (!ref || !file) {
        return json(res, 400, { error: 'Both ref and file are required.' });
      }
      const content = readRefFile(repoPath, ref, file);
      return json(res, 200, {
        content: content ?? '',
        exists: content !== null,
      });
    } catch (error) {
      return json(res, 500, { error: error.message });
    }
  }

  const assetPath = url.pathname === '/' ? path.join(publicDir, 'index.html') : path.join(publicDir, url.pathname);
  if (existsSync(assetPath) && assetPath.startsWith(publicDir)) {
    const ext = path.extname(assetPath).toLowerCase();
    const types = {
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.html': 'text/html; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
    };
    return text(res, 200, readFileSync(assetPath), types[ext] || 'application/octet-stream');
  }

  return sendIndex(res);
});

server.on('error', (error) => {
  console.error(`Failed to start preview server: ${error.message}`);
  if (error.code === 'EPERM' || error.code === 'EACCES') {
    console.error('If this environment blocks local listeners, run it on your machine with npm start.');
  }
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`Docs preview diff running at http://${host}:${port}`);
});
