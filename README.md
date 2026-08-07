<a name="readme-top"></a>

# DocMgr

A CLI tool that helps you manage your downloads.

<!-- TABLE OF CONTENTS -->

<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#why-not-just-sort-by-kind">Why Not Just Sort by Kind?</a></li>
        <li><a href="#built-with">Built With</a></li>
        <li><a href="#limits">Limits</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#automation">Automation</a></li>
    <li><a href="#configuration">Configuration</a></li>
    <li><a href="#how-it-works">How It Works</a></li>
    <li><a href="#license">License</a></li>
  </ol>
</details>

<!-- ABOUT THE PROJECT -->

## About The Project

DocMgr is a command-line tool that sorts the files in your Downloads folder into subfolders by file type. Instead of manually dragging screenshots, PDFs and installers into place every few weeks, you run one command and everything lands where it belongs.

It is built around one principle: **never surprise the user**. Running `docmgr` with no arguments only *shows* you what it would do - nothing on disk is touched until you explicitly say `apply`. And if you don't like the result, `undo` puts everything back exactly where it was, right down to removing the folders it created.

### Key Features:

* **Dry-run by Default:** The plain `docmgr` command never moves a file. Preview as many times as you like, tweak your rules, and only then commit.
* **Reversible:** Every run is journaled, so a single `docmgr undo` reverses the most recent batch - including cleaning up any empty folders it made.
* **Collision-Safe:** An existing `report.pdf` at the destination is never overwritten - the incoming file becomes `report(1).pdf`.
* **Downloads-Aware:** Partial downloads (`.crdownload`, `.part`) and files modified in the last few seconds are skipped, so you never move a file that's still being written.
* **Automatable:** Because it's a single non-interactive command with a safety net, you can schedule it and forget about it entirely.
* **Zero Dependencies:** Nothing but the Node.js standard library. No `npm install`, no supply chain to worry about.

The project is still under active development. As an open-source tool, DocMgr is completely free to use, and contributions from the community are highly welcome.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Why Not Just Sort by Kind?

This is a fair question. Finder can already group your files by kind, and if all you want is for the folder to *look* tidy when you open it, Finder wins - it's instant, needs no setup, and carries no risk.

But the two tools are doing fundamentally different things:

| | Finder's "Sort by Kind" | DocMgr |
| --- | --- | --- |
| What it changes | How the folder **looks** in one window | Where the files **actually are** on disk |
| Outside of Finder | Nothing changed | Still organized |
| Custom categories | System-defined only | Whatever you put in `config.json` |
| Runs without you | No | Yes |

Sorting is a *view*. The moment you `cd ~/Downloads` in a terminal, open a file picker in another app, run a backup, or search with Spotlight, you're back to two thousand files in one flat pile.

Moving files actually buys you things a view cannot:

* **A folder that opens fast.** Finder gets sluggish listing thousands of entries. After a run, the top level is seven folders.
* **Bulk operations become possible.** Once `Images/` exists as a real directory, you can compress everything in it, exclude `Archives/` from iCloud sync, or delete installers older than three months. None of that is expressible over a sorted view.
* **Categories that match how *you* think.** Finder calls `.pixil` and `.blend` "documents". Your `config.json` calls them `Projects`.

And the thing Finder fundamentally can't do: **run while you're not there.** See [Automation](#automation).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built With

* [![Node][Node.js]][Node-url]
* [![JavaScript][JavaScript.com]][JavaScript-url]

### Limits

DocMgr only organizes the **top level** of the target folder - files inside existing subfolders are left alone. `undo` reverts only the most recent `apply`, not the whole history. Paths use `~` expansion, so Windows is untested.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- GETTING STARTED -->

## Getting Started

### Prerequisites

Before getting started with DocMgr, please make sure you have Node.js 18 or later installed.

```sh
node --version
```

If you don't have it, download it from [nodejs.org](https://nodejs.org/) or install it with Homebrew:

```sh
brew install node
```

### Installation

DocMgr is not published to npm, but installing it takes about thirty seconds.

#### Step 1: Get the Code

1. Clone the repository: `git clone https://github.com/cjt-0627/DocMgr`
2. Navigate to the folder: `cd DocMgr`
3. Make the entry point executable: `chmod +x src/docmgr.js`

#### Step 2: Link the Command

1. Run `npm link` inside the project folder.
2. Verify the installation by running `docmgr --help` from anywhere.
3. **Done!** You can now use `docmgr` in any directory.

To remove it later, run `npm unlink -g docmgr`.

---

### For Developers (Run without installing)

If you'd rather not link a global command, invoke the script directly:

```sh
node src/docmgr.js
```

To run the test suite:

```sh
npm test
```

Tests create their own scratch folders and clean up after themselves. Use `KEEP=1 npm test` to leave them in place for inspection.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- USAGE EXAMPLES -->

## Usage

DocMgr is designed around a three-step rhythm: **look, then commit, then undo if you regret it.**

### Try it safely first

Before pointing DocMgr at a folder you care about, practice on a throwaway directory:

```sh
mkdir -p /tmp/docmgr-demo && touch /tmp/docmgr-demo/{a.png,report.pdf,song.mp3,notes.txt,README}
```

Create `~/.docmgr-test.json` — a copy of `config.json` with `"sourceDir": "/tmp/docmgr-demo"` and `"minAgeSeconds": 0` — then point DocMgr at it:

```sh
DOCMGR_CONFIG=~/.docmgr-test.json docmgr
```

Everything below works the same way against the demo folder. Since it lives in `/tmp`, your system will clear it out on its own.

### 1. Preview What Would Happen

Run the command with no arguments. Nothing is moved - you just get a report.

```sh
docmgr
```

```
will move 3 file(s):

  screenshot.png
      -> Images/
  invoice.pdf
      -> Documents/
  installer.dmg
      -> Installers/

  keep  README  (no file extension)
  skip  chrome.crdownload  (downloading...)

run `docmgr apply` to do it.
```

Files listed as `keep` have no matching rule; files listed as `skip` were excluded before rules were even considered. Add `-q` to hide both lists.

This is the step where you tune your rules. Preview, edit `config.json`, preview again - it costs nothing and touches nothing.

### 2. Commit the Changes

Once the plan looks right:

```sh
docmgr apply
```

Destination folders are created inside your source directory as needed. If one file fails, the rest still move - the failure is reported and DocMgr carries on.

### 3. Undo the Last Run

Changed your mind?

```sh
docmgr undo
```

Every `apply` writes a journal to `~/.local/state/docmgr/`, and `undo` replays the most recent one in reverse. Folders that DocMgr created are removed too, but only if they're still empty - anything you put there yourself is left alone.

Running `undo` twice is safe: the second call simply reports that there's nothing left to revert.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- AUTOMATION -->

## Automation

This is where DocMgr earns its keep. A sorted Finder window needs you to be sitting there; a scheduled command doesn't.

Because `docmgr apply` is non-interactive, exits cleanly, and keeps an undo journal, it's safe to run on a timer. On macOS, create `~/Library/LaunchAgents/com.docmgr.daily.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.docmgr.daily</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>/Users/YOUR_NAME/Developer/DocMgr/src/docmgr.js</string>
        <string>apply</string>
        <string>--quiet</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>9</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/tmp/docmgr.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/docmgr.err</string>
</dict>
</plist>
```

Two paths need to match your machine. Find your Node binary with `which node` (Apple Silicon Homebrew usually gives `/opt/homebrew/bin/node`, Intel gives `/usr/local/bin/node`), and replace `YOUR_NAME` with your username — launchd does not expand `~`.

Then load it:

```sh
launchctl load ~/Library/LaunchAgents/com.docmgr.daily.plist
```

Your Downloads folder now tidies itself every morning at 9. Check `/tmp/docmgr.log` to see what it did, and `docmgr undo` still works if a run does something you didn't want.

To stop it:

```sh
launchctl unload ~/Library/LaunchAgents/com.docmgr.daily.plist
```

> **Tip:** run the exact command from `ProgramArguments` by hand once before scheduling it. It's much easier to debug a wrong path in your terminal than inside launchd.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONFIGURATION -->

## Configuration

All behavior is driven by `config.json` in the project root.

| Field | Description |
| --- | --- |
| `sourceDir` | The folder to organize. Supports `~/`. |
| `minAgeSeconds` | Skip files modified within this many seconds — protects in-progress downloads. |
| `skipExtensions` | Temporary download extensions to ignore entirely. |
| `neverMove` | Extensions to leave in place even if a rule matches them. |
| `rules` | A map of `"FolderName": ["ext", "ext"]`. This is where you add categories. |

To add a new category, add one entry to `rules`:

```json
"Fonts": ["ttf", "otf", "woff", "woff2"]
```

Extension matching is case-insensitive, so `IMG_001.HEIC` and `photo.heic` are both handled by the same `heic` rule. If the same extension appears under two folders, the last one wins and DocMgr prints a warning.

Two environment variables override the defaults, mainly for testing:

| Variable | Default |
| --- | --- |
| `DOCMGR_CONFIG` | `<project>/config.json` |
| `DOCMGR_STATE_DIR` | `~/.local/state/docmgr` |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- HOW IT WORKS -->

## How It Works

DocMgr runs in three separate stages, and keeping them separate is what makes the dry-run free and the undo reliable.

1. **Scan** - the only stage that asks the filesystem anything. It walks the top level of `sourceDir` and drops anything that shouldn't be considered: directories, hidden files, in-progress downloads, and files touched too recently.
2. **Plan** - a pure function. It takes the surviving files and decides, for each one, either `move` (with a destination) or `keep` (with a reason). It touches nothing and can't fail.
3. **Execute** - either printed to your screen (`docmgr`) or carried out on disk (`docmgr apply`). Both consume the exact same list of decisions, which is why the preview is guaranteed to describe the real thing.

During `apply`, each successful move is appended to a journal file as one JSON line. `undo` reads the newest journal, replays it backwards, and deletes it when finished - so the record of a run disappears the moment it's been reverted.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->

<!-- https://www.markdownguide.org/basic-syntax/#reference-style-links -->

[Node.js]: https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white
[Node-url]: https://nodejs.org/

[JavaScript.com]: https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black
[JavaScript-url]: https://developer.mozilla.org/en-US/docs/Web/JavaScript