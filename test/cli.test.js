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

const RULES={
    minAgeSeconds:0,
    skipExtensions:['crdownload','part'],
    neverMove:['mobileconfig'],
    rules:{
        Images:['png','jpg'],
        Documents:['pdf'],
        Screenshots:{match:['Screenshot *', '螢幕截圖 *']}
    }
}

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

test('a filename pattern wins over the extension rule above it', async()=>{
    await touch('Screenshot 2026-08-13 at 15.21.45.png');
    await touch('螢幕截圖 2026-08-13.png');
    await touch('cat.png');
    await docmgr('apply');

    assert.deepEqual(
        (await readdir(join(dl, 'Screenshots'))).sort(),
        ['Screenshot 2026-08-13 at 15.21.45.png', '螢幕截圖 2026-08-13.png'],
    );
    assert.deepEqual(await readdir(join(dl,'Images')),['cat.png']);
});

test('plan explains which pattern matched', async()=>{
    await touch('Screenshot 1.png');
    const {stdout}=await docmgr();

    assert.match(stdout, /Screenshots\/\s+\(name matches "Screenshot \*"\)/);
});

test('a broken rule fails with a readable config error', async()=>{
    await writeFile(env.DOCMGR_CONFIG, JSON.stringify({...RULES, sourceDir:dl,rules:{
        A:{}
    }}));
    await assert.rejects(docmgr(),(err)=>{
        assert.equal(err.code,1);
        assert.match(err.stderr, /config error/);
        return true;
    });

});

test('undo - undo the recent apply', async () => {
    await touch('a.png');
    await touch('b.pdf');
    await docmgr('apply');
    await docmgr('undo');

    assert.ok(await exists(join(dl, 'a.png')));
    assert.ok(await exists(join(dl, 'b.pdf')));
    assert.ok(!(await exists(join(dl, 'Images', 'a.png'))));
});

test('undo will delete empty folders', async()=>{
    await touch('a.png');
    await await docmgr('apply');
    assert.ok(await exists(join(dl, 'Images')));

    await docmgr('undo');
    assert.ok(!(await exists(join(dl, 'Images'))),'Images should be deleted');
});

test(`The folder sholudn't be deleted when there is something still inside`, async()=>{
    await touch('a.png');
    await docmgr('apply');
    await writeFile(join(dl, 'Images','other.txt'), 'x');

    await docmgr('undo');
    assert.ok(await exists(join(dl,'Images')), 'Images should stay');
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

test(`identical file isn't monitorEventLoopDelay, ans not numbered`, async()=>{
    await mkdir(join(dl,'Documents'),{recursive:true});
    await writeFile(join(dl, 'Documents','b.pdf'),'content');
    await touch('b.pdf');
    const {stdout}=await docmgr('apply');

    assert.match(stdout, /duplicate/i);
    assert.ok(await exists(join(dl,'b.pdf')), 'source files stay at the same place');
    assert.deepEqual(await readdir(join(dl, 'Documents')),['b.pdf']);
});

test('same name but different content still gets numbered', async()=>{
    await mkdir(join(dl,'Documents'),{recursive:true});
    await writeFile(join(dl, 'Documents','b.pdf'),'DIFFERENT');
    await touch('b.pdf');
    await docmgr('apply');

    assert.deepEqual((await readdir(join(dl,'Documents'))).sort(),['b(1).pdf','b.pdf']);
});

test('detects the twin among numbered sibilings',async()=>{
    await mkdir(join(dl, 'Documents'),{recursive:true});
    await writeFile(join(dl, 'Documents', 'b.pdf'), 'DIFFERENT');
    await writeFile(join(dl, 'Documents', 'b(1).pdf'), 'content');
    await touch('b.pdf');
    await docmgr('apply');

    assert.ok(await exists(join(dl, 'b.pdf')), 'should recognize that b(1).pdf is the same file');
    assert.ok(!(await exists(join(dl, 'Documents', 'b(2).pdf'))));

})