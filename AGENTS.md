# Working Style

- Implement requested changes completely and to a high standard.
- Use good judgment on code quality, architecture, UI, and supporting changes needed for the result to work well.
- Do not reduce the quality or completeness of the implementation just to finish faster.
- Skipping optional checks must never mean lowering implementation effort, design quality, polish, or careful reasoning.
- Understand that skipping verification reduces confidence, not the intended quality of the work.
- Prioritize implementing the change over optional verification and administrative work.
- Skip tests, builds, linting, type checks, browser checks, and other optional validation unless the user asks for them or one narrow check is essential to avoid a dangerous change.
- When verification is genuinely necessary, use the fastest narrow check that covers the specific risk instead of running broad check suites.
- For UI changes, ensure the local development server is running so the user can immediately see the result through hot reload.
- Start or restart the local server when needed, give the user the localhost URL, and leave it running after the change.
- Do not treat starting the local development server as optional verification; it is part of delivering a visible UI change.
- A production build or deployment is not required for viewing local UI changes.
- Do not commit, push, publish, or deploy unless the user explicitly asks or the requested operation cannot work without it.
- Keep plans and progress updates minimal. Start coding quickly.
- Preserve unrelated existing work.
- When verification is requested, run only the checks relevant to that request.
