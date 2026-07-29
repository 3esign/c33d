# scripts/

Double-click **`C3D.bat`** in the project root — it is a menu that runs
everything here. Each script also works on its own if you prefer.

| Script | What it does |
|---|---|
| `check.bat` | Typecheck (`tsc -b`), production build (`vite build`), full test suite. Run before committing. Touches nothing in git. |
| `test-new.bat` | Only the two Jul-25 contract tests (`test_ir_ref_coercion`, `test_run_abort`). Seconds instead of minutes — use while editing the compiler or the abort layer. |
| `dev.bat` | Starts the dev server and opens the browser. |
| `commit.bat` | Shows the diff, asks separately about source and about `JSONs/` exports, commits, offers to push. |
| `deploy.bat` | `npx vercel --prod`. **This is the only thing that updates c33d.vercel.app** — the site is CLI-deployed, not connected to GitHub, so `git push` does not publish. |
| `release.bat` | check → commit → deploy, stopping at the first failure. |
| `fix-git-lock.bat` | Removes a stale `.git\index.lock` (OneDrive leaves these behind), but refuses while a `git.exe` process is actually running. |
| `status.bat` | Branch, sync state, changed files, recent commits. |

## Two things worth knowing

**Two tests fail in some environments and always have.** `test_flower_integration`
and `test_nonuniform` exercise the OpenCascade WASM kernel and fail in
environments where it cannot initialise. They failed identically before the
Jul-25 changes. Everything else should pass — in particular
`test_ir_ref_coercion` (39 contracts) and `test_run_abort` (24).

**Pushing is not publishing.** `git push` updates GitHub. `deploy.bat` updates
the live site. They are independent.
