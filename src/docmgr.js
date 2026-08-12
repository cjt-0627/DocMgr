#!/usr/bin/env node
import {
    readdir, lstat, readFile, appendFile, mkdir, rename, copyFile, unlink, access, rmdir,
} from 'node:fs/promises';
import { dirname, extname, join, parse, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = process.env.DOCMGR_CONFIG ?? join(projectRoot, 'config.json');
const stateDir = process.env.DOCMGR_STATE_DIR ?? join(homedir(), '.local', 'state', 'docmgr');

function expandHome(p) {
    return p.startsWith('~/') ? join(homedir(), p.slice(2)) : p;
}

async function exists(p) {
    try {
        await access(p);
        return true;
    } catch {
        return false;
    }
}

function extensionOf(filename) {
    return extname(filename).slice(1).toLowerCase();
}

async function loadConfig() {
    const raw = await readFile(configPath, 'utf8');
    const config = JSON.parse(raw);
    config.sourceDir = expandHome(config.sourceDir);
    return config;
}

function buildLookup(rules) {
    const lookup = new Map();
    for (const [folder, extensions] of Object.entries(rules)) {
        for (const ext of extensions) {
            const key = ext.toLowerCase();
            if (lookup.has(key)) {
                console.warn(`warn .${key} defined at ${lookup.get(key)} and ${folder}, use ${folder}`);
            }
            lookup.set(key, folder);
        }
    }
    return lookup;
}

async function scan(config) {
    const entries = await readdir(config.sourceDir, { withFileTypes: true });
    const skipExt = new Set(config.skipExtensions.map((e) => e.toLowerCase()));
    const minAgeMs = config.minAgeSeconds * 1000;
    const now = Date.now();

    const candidates = [];
    const skipped = [];

    for (const entry of entries) {
        const name = entry.name;

        if (!entry.isFile()) {
            skipped.push([name, entry.isDirectory() ? 'folder' : 'abnormal file']);
            continue;
        }
        if (name.startsWith('.')) {
            skipped.push([name, 'hidden file']);
            continue;
        }

        const ext = extensionOf(name);
        if (skipExt.has(ext)) {
            skipped.push([name, 'downloading...']);
            continue;
        }

        const path = join(config.sourceDir, name);
        const stats = await lstat(path);
        if (now - stats.mtimeMs < minAgeMs) {
            skipped.push([name, 'maybe still writing']);
            continue;
        }

        candidates.push({ name, path, ext, size: stats.size });
    }

    return { candidates, skipped };
}

function plan(candidates, lookup, config) {
    const neverMove = new Set((config.neverMove ?? []).map((e) => e.toLowerCase()));

    return candidates.map((file) => {
        if (file.ext === '') {
            return { ...file, action: 'keep', reason: 'no file extension' };
        }
        if (neverMove.has(file.ext)) {
            return { ...file, action: 'keep', reason: `.${file.ext} is set to never move` };
        }

        const folder = lookup.get(file.ext);
        if (!folder) {
            return { ...file, action: 'keep', reason: `.${file.ext} has no rule` };
        }

        return { ...file, action: 'move', folder, to: join(config.sourceDir, folder, file.name) };
    });
}

async function resolveCollision(targetPath) {
    const { dir, name, ext } = parse(targetPath);
    let candidate = targetPath;
    let n = 0;
    while (await exists(candidate)) {
        n += 1;
        candidate = join(dir, `${name}(${n})${ext}`);
    }
    return candidate;
}

async function moveFile(from, to) {
    try {
        await rename(from, to);
    } catch (err) {
        if (err.code !== 'EXDEV') throw err;
        await copyFile(from, to);
        await unlink(from);
    }
}

function printPlan(decisions, skipped, quiet) {
    const moves = decisions.filter((d) => d.action === 'move');
    const keeps = decisions.filter((d) => d.action === 'keep');

    if (moves.length === 0) {
        console.log('nothing to move.');
    } else {
        console.log(`will move ${moves.length} file(s):\n`);
        for (const m of moves) {
            console.log(`  ${m.name}\n      -> ${m.folder}/`);
        }
    }

    if (!quiet) {
        for (const k of keeps) console.log(`  keep  ${k.name}  (${k.reason})`);
        for (const [name, reason] of skipped) console.log(`  skip  ${name}  (${reason})`);
    }

    if (moves.length > 0) console.log('\nrun `docmgr apply` to do it.');
}

async function apply(decisions, quiet) {
    const moves = decisions.filter((d) => d.action === 'move');
    if (moves.length === 0) {
        if (!quiet) console.log('There is no file need to be moved.');
        return;
    }

    await mkdir(stateDir, { recursive: true });
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const journalPath = join(stateDir, `${runId}.jsonl`);
    let ok = 0;

    for (const m of moves) {
        try {
            const createdDir = await mkdir(dirname(m.to), {
                recursive: true
            });
            const finalTo = await resolveCollision(m.to);
            await moveFile(m.path, finalTo);
            await appendFile(journalPath, JSON.stringify({
                from: m.path, to: finalTo, createdDir
            }) + '\n');
            ok += 1;
            if (!quiet) console.log(`moved  ${m.name}  ->  ${m.folder}/`);
        } catch (err) {
            console.error(`failed ${m.name}: ${err.message}`);
        }
    }

    if (!quiet) console.log(`\n${ok}/${moves.length} moved, journal: ${journalPath}`);
}

async function undo(quiet) {
    let files = [];
    try {
        files = (await readdir(stateDir)).filter((f) => f.endsWith('.jsonl')).sort();
    } catch {
        // stateDir does not exist yet
    }
    if (files.length === 0) {
        console.log('nothing to undo');
        return;
    }

    const journalPath = join(stateDir, files[files.length - 1]);
    const lines = (await readFile(journalPath, 'utf8')).split('\n').filter(Boolean);
    let ok = 0;
    const createdDirs = [];

    for (const line of lines.reverse()) {
        const { from, to, createdDir } = JSON.parse(line);
        if (createdDir) createdDirs.push(createdDir);
        try {
            if (!(await exists(to))) {
                console.error(`skip ${to}: already gone`);
                continue;
            }
            const back = await resolveCollision(from);
            await moveFile(to, back);
            ok += 1;
            if (!quiet) console.log(`restored  ${back}`);
        } catch (err) {
            console.error(`failed ${to}: ${err.message}`);
        }
    }

    for (const dir of createdDirs.sort((a, b) => b.length - a.length)) {
        try {
            await rmdir(dir);
            if (!quiet) console.log(`removed ${dir}`);
        } catch {
            // not empty (or already gone) - leave it alone
        }
    }

    if (!quiet) console.log(`\n${ok}/${lines.length} restored`);
    await unlink(journalPath);
}

function printHelp() {
    console.log(`docmgr - organize your downloads folder

usage:
  docmgr [plan]     show what would be moved (default, does not touch files)
  docmgr apply      actually move the files
  docmgr undo       revert the most recent apply

options:
  -q, --quiet       only print what matters
  -h, --help        show this help`);
}

function parseArgs(argv) {
    const args = { command: 'plan', quiet: false };
    for (const a of argv) {
        if (a === 'plan' || a === 'apply' || a === 'undo') args.command = a;
        else if (a === '-q' || a === '--quiet') args.quiet = true;
        else if (a === '-h' || a === '--help') args.command = 'help';
        else {
            console.error(`unknown argument: ${a}`);
            args.command = 'help';
        }
    }
    return args;
}

async function main() {
    const { command, quiet } = parseArgs(process.argv.slice(2));

    if (command === 'help') return printHelp();
    if (command === 'undo') return undo(quiet);

    const config = await loadConfig();
    if (!(await exists(config.sourceDir))) {
        console.error(`sourceDir not found: ${config.sourceDir}`);
        process.exitCode = 1;
        return;
    }

    const lookup = buildLookup(config.rules);
    const { candidates, skipped } = await scan(config);
    const decisions = plan(candidates, lookup, config);

    if (command === 'apply') await apply(decisions, quiet);
    else printPlan(decisions, skipped, quiet);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
    main().catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}

export { extensionOf, expandHome, buildLookup, plan, resolveCollision };