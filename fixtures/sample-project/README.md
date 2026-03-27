# sample-project

A minimal sample project used as a fixture for drift-guard tests.

## Overview

This project demonstrates a simple TypeScript module structure that drift-guard
can inspect for promise violations.

## Installation

```bash
npm install
```

## Usage

```typescript
import { greet } from './src/index.js';

console.log(greet('world'));
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm test` | Run the test suite |
| `npm run build` | Compile TypeScript |

## Project Structure

```
sample-project/
├── src/
│   └── index.ts
├── tests/
├── CLAUDE.md
└── README.md
```

## Requirements

- Node.js >= 18
- TypeScript >= 5

## Contributing

1. Fork the repository.
2. Create a feature branch: `git checkout -b feat/my-feature`.
3. Commit using Conventional Commits.
4. Open a pull request.

## Code Style

- Strict TypeScript — no implicit `any`.
- Named exports preferred.
- JSDoc on all public functions.

## Testing

Tests are written with Vitest and located in `tests/`. Run with:

```bash
npm test
```

Coverage target: 80% or above.

## Security

No credentials or secrets should be committed. Run `npm audit` before releases.

## License

MIT
