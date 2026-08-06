import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readdir, access, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'docmgr.js');


const TEST_ROOT = join(homedir(), 'Downloads', 'test');


function assertInsideTestRoot(p) {
    const target = resolve(p);
    if (!target.startsWith(TEST_ROOT + sep)) {
        throw new Error(`refusing to remove ${target} — not inside ${TEST_ROOT}`);
    }
}

const RULES = {
    minAgeSeconds: 0,
    skipExtensions: ['crdownload', 'part'],
    neverMove: ['mobileconfig'],
    rules: { Images: ['png', 'jpg'], Documents: ['pdf'] },
};

let base, dl, env;

beforeEach(async () => {
    await mkdir(TEST_ROOT, { recursive: true });

    base = await mkdtemp(join(TEST_ROOT, 'run-'));
    dl = join(base, 'downloads');
    await mkdir(dl, { recursive: true });

    const configPath = join(base, 'config.json');
    await writeFile(configPath, JSON.stringify({ ...RULES, sourceDir: dl }));

    env = {
        ...process.env,
        DOCMGR_CONFIG: configPath,
        DOCMGR_STATE_DIR: join(base, 'state'),
    };
});

afterEach(async () => {
    if (process.env.KEEP) {
        console.log(`kept for inspection: ${base}`);
        return;
    }
    assertInsideTestRoot(base);
    await rm(base, { recursive: true, force: true });
});

const docmgr = (...args) => execFileAsync(process.execPath, [CLI, ...args], { env });
const touch = (name) => writeFile(join(dl, name), 'content');
const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

test('default is dry-run, it will not touch files', async () => {
    await touch('a.png');
    const { stdout } = await docmgr();

    assert.match(stdout, /a\.png/);
    assert.ok(await exists(join(dl, 'a.png')), 'the origin file is still alive');
    assert.ok(!(await exists(join(dl, 'Images'))), `it shouldn't built a folder`);
});

test('apply-move the file to the correct folder', async () => {
    await touch('a.png');
    await touch('b.pdf');
    await docmgr('apply');

    assert.ok(await exists(join(dl, 'Images', 'a.png')));
    assert.ok(await exists(join(dl, 'Documents', 'b.pdf')));
    assert.ok(!(await exists(join(dl, 'a.png'))));
});

test('downloading / neverMove / random files stay at the same place', async () => {
    await touch('c.crdownload');
    await touch('p.mobileconfig');
    await touch('x.xyz');
    await touch('README');
    await docmgr('apply');

    assert.deepEqual(
        (await readdir(dl)).sort(),
        ['README', 'c.crdownload', 'p.mobileconfig', 'x.xyz'],
    );
});

test(`if the target's name is used, number ir automatically, not replace it`, async () => {
    await mkdir(join(dl, 'Images'), { recursive: true });
    await writeFile(join(dl, 'Images', 'a.png'), 'OLD');
    await touch('a.png');
    await docmgr('apply');

    assert.deepEqual((await readdir(join(dl, 'Images'))).sort(), ['a(1).png', 'a.png']);
});

test('undo- undo the recent apply', async () => {
    await touch('a.png');
    await touch('b.pdf');
    await docmgr('apply');
    await docmgr('undo');

    assert.ok(await exists(join(dl, 'a.png')));
    assert.ok(await exists(join(dl, 'b.pdf')));
    assert.ok(!(await exists(join(dl, 'Images', 'a.png'))));
});

test(`undo twice, there is nothing to undo at the second time`, async () => {
    await touch('a.png');
    await docmgr('apply');
    await docmgr('undo');
    const { stdout } = await docmgr('undo');

    assert.match(stdout, /nothing to undo/);
});

test('empty folder will not get wrong', async () => {
    const { stdout } = await docmgr('apply');
    assert.match(stdout, /no file need to be moved/i);
});

test('--help end normally', async () => {
    const { stdout } = await docmgr('--help');
    assert.match(stdout, /usage/i);
});

test(`sourceDir ends by non-zero if it doesn't exist`, async () => {
    await writeFile(env.DOCMGR_CONFIG, JSON.stringify({ ...RULES, sourceDir: '/nope/nope' }));
    await assert.rejects(docmgr(), (err) => err.code === 1);
});