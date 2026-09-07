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
    <li><a href="#configuration">Configuration</a></li>
    <li><a href="#license">License</a></li>
  </ol>
</details>

<!-- ABOUT THE PROJECT -->

## About The Project

DocMgr is a command-line tool that sorts files in your Downloads folder by extension.

### Demo

[Demo Video](https://youtu.be/CCFq3lsEIt4)

### What it does

* Moves files into folders based on rules in `config.json`
* Skips partial downloads and files that were modified recently
* Never overwrites an existing file; duplicate names get a number such as `report(1).pdf`
* Keeps an undo record for the latest run

The project is still under active development. As an open-source tool, DocMgr is completely free to use, and contributions from the community are highly welcome.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built With

* [Node][Node-url]
* [JavaScript][JavaScript-url]

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
3. You can now use `docmgr` in any directory.

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

## Usage

DocMgr is designed around a three-step rhythm: **look, then commit, then undo if you regret it.**

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

| Variable             | Default                   |
| -------------------- | ------------------------- |
| `DOCMGR_CONFIG`    | `<project>/config.json` |
| `DOCMGR_STATE_DIR` | `~/.local/state/docmgr` |

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
