# Development

Use Node.js 22 or newer. From the repository root:

```sh
npm ci
npm run format
npm run build
npm run format:check
npm run check
npm test
```

Run the same conversion tests under Bun with:

```sh
bun test --timeout 30000 packages/tests/core.test.mjs packages/tests/reliability.test.mjs
bun run scripts/bun-smoke.mjs
```

## Code style

Use camelCase for functions, variables and parameters, and PascalCase for classes and types. Keep external API names intact: Node-API uses snake_case, CSV parser options use snake_case, and MorphByte error codes use uppercase names.

Use Allman braces for functions, classes and control flow, including single-statement branches:

```js
function checkInput(input)
{
  if (!input)
  {
    throw new TypeError("Input is required");
  }

}
```

`npm run format` applies Prettier, then places block braces using the TypeScript parser. Object literals keep their usual layout. `npm run format:check` checks the same rules without writing files; CI runs it before building. For C++, use `clang-format -i packages/core-native/src/addon.cpp` with the repository's `.clang-format`. C++ formatting is separate from the JavaScript check.

Leave a blank line after closing brace lines and between logical steps. Top-level functions have two blank lines before them. Use double quotes for JavaScript and TypeScript strings, escaping embedded double quotes with `\"`. Template literals retain their interpolation syntax. C++ character literals keep single quotes because they represent characters rather than strings. Keep comments short and in English; inline comments should explain a constraint at the statement they describe.

Prefer a function or module with one responsibility over a class hierarchy. Share logic when the behavior and failure conditions match; keep format-specific behavior in its adapter. Comments should explain a constraint or a decision that the code cannot explain by itself.

## Source layout

- `packages/morphbyte/src/engine.cjs`: public conversion API, batch execution and configured converter instances.
- `packages/morphbyte/src/worker-pool.cjs`: bounded queue, worker reuse, cancellation and deadlines.
- `packages/morphbyte/src/output.cjs`: output targets, path checks, staging and file commits.
- `packages/morphbyte/src/options.cjs`: option merging, validation and codec selection.
- `packages/morphbyte/src/worker.cjs`: built-in route dispatch inside workers.
- `packages/image`, `packages/pdf`, `packages/data`: format adapters.

Edit source files rather than `dist` or the package's copied documentation. Run `npm run build` to update those generated files. Add regression tests when changing conversion behavior or safety checks. Formatting-only edits do not need new tests.

The optional C++ addon needs a compiler and Node development headers. See the README for setup and `docs/progress.md` for the remaining implementation gaps.
