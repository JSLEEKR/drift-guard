# Project Rules

## Process
- All features must have corresponding tests before merging.
- Commit messages must follow Conventional Commits format (feat/fix/docs/chore).
- PRs must pass CI before merge.

## Style
- Use TypeScript strict mode.
- Prefer named exports over default exports.
- Maximum file length: 300 lines.

## Architecture
- Source code lives under `src/`.
- Tests live under `tests/`.
- No circular dependencies between modules.

## Quality
- Test coverage must remain above 80%.
- No `any` types without explicit justification comment.
- All public functions must have JSDoc comments.

## Security
- No secrets or credentials committed to the repository.
- Dependencies must be pinned to minor versions.
- Run `npm audit` before each release.
