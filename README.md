# Docs Preview Diff

A local tool for reviewing markdown changes in a git repository side by side.

## What it does

- Loads any local git repo path you point it at
- Auto-detects the repo default branch as the base ref
- Auto-fills the compare ref from the checked-out branch when blank
- Compares a base ref and a PR/ref branch
- Lists only changed markdown files
- Renders the selected file in two panes, base on the left and compare on the right
- Keeps scroll positions aligned between panes

## Run it

```bash
npm start
```

Then open `http://localhost:3000`.

## Configuration

Set `local_repo_dir` in `.env` to the local git clone you want the app to open by default.
Set `main_branch` and `compare_branch` to the branches you want prefilled in the UI.
The compare ref must exist in the local clone. If you delete the local branch, the app will error unless you switch to another valid ref.

Example:

```env
local_repo_dir="/Users/yourname/Desktop/work/docs"
main_branch="main"
compare_branch="feature/my-pr"
```

## Recommended inputs

- Repo path: the value from `local_repo_dir` in `.env`
- Base ref: the value from `main_branch` in `.env`
- Compare ref: the value from `compare_branch` in `.env`

## Notes

- It will only show files matching `*.md`, `*.mdx`, or `*.markdown` that changed between the refs.
- If the compare ref no longer exists in the local repo, the diff view will fail when it tries to run `git diff` and `git show`.
