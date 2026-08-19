# Purging leaked files from git history

Two files must be removed from the repository's **history** (deleting them at HEAD is not enough — anyone who clones gets every old commit):

1. `JSONs/Magistarski rad - Dorotea Abaz.docx` — a third-party document committed by accident on 2026-07-22 (added in `5acc905`, deleted at HEAD, still reachable as a blob).
2. `JSONs/c33d-graph-2026-07-22T08-20-17.json` — the copy at HEAD has been scrubbed (2026-08-18), but every pre-scrub version in history still contains the accidentally pasted message. We purge the whole path from history and re-add the scrubbed file in a fresh commit, so the old blobs become unreachable and nothing sensitive needs to be written into any script.

`scripts/purge-history.bat` automates steps 2–6 below. Read this page once before running it.

## Before you start

- **Do this from a machine-local clone, not the OneDrive folder.** Rewriting history inside a live OneDrive sync invites lock errors and conflict copies.
- **Back up first.** The script makes a `git clone --mirror` backup automatically; keep it until you have verified the result.
- Every collaborator (currently: just you) must **re-clone** after the rewrite. Old clones must be deleted, not pulled.

## Steps

1. Install git-filter-repo (once):

   ```
   pip install git-filter-repo
   ```

2. Make a mirror backup **outside OneDrive**:

   ```
   git clone --mirror . %USERPROFILE%\c33d-backup-YYYYMMDD
   ```

3. Keep a copy of the current (scrubbed) session export aside:

   ```
   copy "JSONs\c33d-graph-2026-07-22T08-20-17.json" "%TEMP%\c33d-scrubbed-export.json"
   ```

4. Rewrite history, removing both paths everywhere:

   ```
   git filter-repo --force --invert-paths ^
     --path "JSONs/Magistarski rad - Dorotea Abaz.docx" ^
     --path "JSONs/c33d-graph-2026-07-22T08-20-17.json"
   ```

   Notes: `--invert-paths` means "keep everything EXCEPT these paths". filter-repo also removes the `origin` remote as a safety measure — that is expected.

5. Restore the scrubbed export as a new commit:

   ```
   copy "%TEMP%\c33d-scrubbed-export.json" "JSONs\c33d-graph-2026-07-22T08-20-17.json"
   git add "JSONs/c33d-graph-2026-07-22T08-20-17.json"
   git commit -m "restore scrubbed session export (history purged)"
   ```

6. Re-add the remote and force-push everything:

   ```
   git remote add origin https://github.com/3esign/c33d.git
   git push --force --all origin
   git push --force --tags origin
   ```

7. **Purge GitHub's caches.** Force-pushing does not immediately remove old commits from GitHub's servers (cached views, PR refs). Contact GitHub Support and ask them to run garbage collection / remove the cached commits, per their guide:
   https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository

8. Verify locally that the blobs are gone:

   ```
   git rev-list --objects --all | findstr /i "magistarski"
   ```

   (No output = purged.)

## Aftermath

- Delete any other local clones and re-clone fresh.
- The backup mirror from step 2 still contains the sensitive blobs — keep it private, and delete it once you have confirmed the rewrite is good.
