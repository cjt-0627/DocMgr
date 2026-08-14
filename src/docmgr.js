#!/usr/bin/env node
import {
    readdir, lstat, readFile, appendFile, mkdir, rename, copyFile, unlink, access, rmdir,stat,
} from 'node:fs/promises';
import { createReadStream, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, extname, join, parse, resolve, relative } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

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

function globToRegExp(glob){
    const body=String(glob).replace(/[.*+?^${}()|[\]\\]/g,(ch)=>{
        if(ch === '*') return '.*';
        if(ch === '?') return '.';
        return `\\${ch}`;
    });
    return new RegExp(`^${body}$`, 'i');
}

function compileRules(rules){
    const compiled=[];
    const seen =new Map();

    if(!rules || typeof rules !== 'object'){
        throw new Error('config needs a "rules" object');
    }

    for(const [folder, rule] of Object.entries(rules)){
        const spec=Array.isArray(rule)?{ext:rule}:rule;
        if(!spec || typeof spec !=='object'){
            throw new Error(`rule "${folder}" must be an array of extensions or an object`);
        }
        if(!spec.ext && !spec.match){
            throw new Error(`rule "${folder}" needs at least one of "ext" or "match"`);
        }
        
        const extensions= new Set((spec.ext ?? []).map((e)=> String(e).toLowerCase()));
        for(const ext of extensions){
            if(seen.has(ext)){
                console.warn(`warn .${ext} defined at ${seen.get(ext)} and ${folder}, use ${seen.get(ext)}`);
            }else{
                seen.set(ext, folder);
            }
        }

        const globs=spec.match ?? [];
        compiled.push({folder, extensions, globs, patterns: globs.map(globToRegExp)});
    }

    return compiled;
}

function matchRule(file, rules){
    for(const rule of rules){
        for (let i=0;i<rule.patterns.length;i+=1){
            if(rule.patterns[i].test(file.name)){
                return {folder:rule.folder, pattern:rule.globs[i]};
            }
        }
    }
    if(file.ext === '') return null;
    for(const rule of rules){
        if(rule.extensions.has(file.ext)) return {folder:rule.folder, pattern:null};
    }
    return null;
    
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

function plan(candidates, rules, config){
    const neverMove=new Set((config.neverMove ?? []).map((e)=>e.toLowerCase()));

    return candidates.map((file)=>{
        if(file.ext !== '' && neverMove.has(file.ext)){
            return {...file, action: 'keep', reason: `.${file.ext} is set to never move`};
        }

        const hit=matchRule(file, rules);
        if(!hit){
            const reason=file.ext ==='' ? 'no file extension' :`.${file.ext} has no rule`;
            return {...file, action:'keep', reason};
        }

        return{
            ...file,
            action:'move',
            folder:hit.folder,
            pattern:hit.pattern,
            to: join(config.sourceDir, hit.folder, file.name),
        };
    })
}

async function hashFile(path) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) {
        hash.update(chunk);
    }
    return hash.digest('hex');
}

async function findTwin(file, targetPath) {
    const { dir, name, ext } = parse(targetPath);
    let candidate = targetPath;
    let n = 0;
    let sourceHash = null;

    while (await exists(candidate)) {
        const stats = await stat(candidate);
        if (stats.size === file.size) {
            sourceHash ??= await hashFile(file.path);
            if (await hashFile(candidate) === sourceHash) return candidate;
        }
        n += 1;
        candidate = join(dir, `${name}(${n})${ext}`);
    }
    return null;
}

async function detectDuplicates(decisions, config) {
    const out = [];
    for (const d of decisions) {
        if (d.action !== 'move') {
            out.push(d);
            continue;
        }
        const twin = await findTwin(d, d.to);
        if (twin) {
            out.push({
                ...d,
                action: 'duplicate',
                reason: `same content as ${relative(config.sourceDir, twin)}`,
            });
        } else {
            out.push(d);
        }
    }
    return out;
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
    const dupes=decisions.filter((d) => d.action==='duplicate');

    if(dupes.length>0){
        console.log(`\n${dupes.length} duplicate(s), left in place:`);
        for(const d of dupes){
            console.log(`${d.name}\n =${d.reason}`);
        }
    }

    if (moves.length === 0) {
        console.log('nothing to move.');
    } else {
        console.log(`will move ${moves.length} file(s):\n`);
        for (const m of moves) {
            const why=m.pattern ? `  (name matches "${m.pattern}")` : '';
            console.log(`  ${m.name}\n      -> ${m.folder}/${why}`);
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
    const dupes = decisions.filter((d) => d.action === 'duplicate');

    if (!quiet) {
        for (const d of dupes) {
            console.log(`duplicate  ${d.name}  (${d.reason})`);
        }
    }

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

    let rules;
    try{
        rules=compileRules(config.rules);
    }catch(err){
        console.error(`config error: ${err.message}`);
        process.exitCode=1;
        return;
    }

    const {candidates,skipped}=await scan(config);
    const planned=plan(candidates,rules,config);
    const decisions = config.onDuplicate === 'number' ? planned : await detectDuplicates(planned, config);

    if (command === 'apply') await apply(decisions, quiet);
    else printPlan(decisions, skipped, quiet);
}


function isMainModule() {
    if (!process.argv[1]) return false;
    try {
        return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
    } catch {
        return false;
    }
}

if (isMainModule()) {
    main().catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}

export { extensionOf, expandHome, globToRegExp, compileRules, matchRule, plan, resolveCollision};
