# Quality Gates

## Test Requirements
- Every source file under `src/` must have a corresponding test file.
- Minimum test count: 15 tests per project.
- All tests must pass before a commit is accepted.
- Test coverage must be >= 80%.

## Type Safety
- TypeScript strict mode must be enabled.
- No use of `any` without a suppression comment explaining why.
- All function parameters and return types must be explicitly annotated.

## Code Quality
- No TODO comments left in production code.
- Maximum cyclomatic complexity per function: 10.
- Functions must be <= 50 lines.
- Files must be <= 300 lines.

## Documentation
- All exported functions must have JSDoc comments.
- JSDoc must include `@param` and `@returns` tags.
- Inline comments required for non-obvious logic.

## Dependency Management
- All dependencies pinned to minor version ranges (e.g., `^1.2.0`).
- No dependencies with known high/critical CVEs.
- `devDependencies` must not appear in `dependencies`.

## CI Requirements
- CI pipeline must run on every pull request.
- Build, lint, and test steps are all required.
- Pipeline must complete in under 5 minutes.
