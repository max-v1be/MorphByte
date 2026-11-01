import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const check = process.argv.includes("--check");
const ignored = new Set(["node_modules", "dist", "build", "docs"]);


async function sourceFiles(directory)
{
  const files = [];

  for (const entry of await readdir(directory, { withFileTypes: true }))

  {
    const filename = path.join(directory, entry.name);

    if (entry.isDirectory() && !ignored.has(entry.name))
    {
      files.push(...(await sourceFiles(filename)));
    }

    else if (entry.isFile() && /\.(?:cjs|mjs|ts)$/.test(entry.name))
    {
      files.push(filename);
    }

  }

  return files;
}


function parse(source, filename)
{
  return ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
}


function applyEdits(source, edits)
{
  for (const { start, end, text } of edits.sort((a, b) => b.start - a.start))
  {
    source = source.slice(0, start) + text + source.slice(end);
  }

  return source;
}


function addControlBraces(source, filename)
{
  const file = parse(source, filename);
  const edits = [];

  function wrap(statement)
  {
    if (!ts.isBlock(statement))
    {
      edits.push({
        start: statement.getStart(file),
        end: statement.getStart(file),
        text: "{\n",
      });

      edits.push({ start: statement.end, end: statement.end, text: "\n}" });

    }

  }

  function visit(node)
  {
    if (ts.isIfStatement(node))
    {
      wrap(node.thenStatement);

      if (node.elseStatement && !ts.isIfStatement(node.elseStatement))
      {
        wrap(node.elseStatement);
      }

    }

    else if (
      ts.isForStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node)
    )
    {
      wrap(node.statement);
    }

    ts.forEachChild(node, visit);
  }

  visit(file);

  return applyEdits(source, edits);
}


function allmanBraces(source, filename)
{
  const file = parse(source, filename);
  const edits = [];

  function newLineBefore(token)
  {
    const start = token.getStart(file);
    const lineStart = source.lastIndexOf("\n", start - 1) + 1;
    const prefix = source.slice(lineStart, start);

    if (/\S/.test(prefix))
    {
      const indent = /^\s*/.exec(prefix)[0];
      const whitespace = /[ \t]*$/.exec(prefix)[0].length;

      edits.push({ start: start - whitespace, end: start, text: `\n${indent}` });

    }

  }

  function visit(node)
  {
    const block =
      ts.isBlock(node) ||
      ts.isClassDeclaration(node) ||
      ts.isClassExpression(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isModuleBlock(node) ||
      ts.isCaseBlock(node);

    for (const child of node.getChildren(file))
    {
      if (block && child.kind === ts.SyntaxKind.OpenBraceToken)
      {
        newLineBefore(child);
      }

      if (
        block &&
        child.kind === ts.SyntaxKind.CloseBraceToken &&
        /\{[ \t]*$/.test(source.slice(0, child.getStart(file)))
      )
      {
        newLineBefore(child);
      }

      if (
        [
          ts.SyntaxKind.ElseKeyword,
          ts.SyntaxKind.CatchKeyword,
          ts.SyntaxKind.FinallyKeyword,
        ].includes(child.kind)
      )
      {
        newLineBefore(child);
      }

      visit(child);
    }

  }

  visit(file);

  return applyEdits(source, edits);
}


function doubleQuotes(source, filename)
{
  const file = parse(source, filename);
  const edits = [];

  function visit(node)
  {
    if (ts.isStringLiteral(node))
    {
      edits.push({
        start: node.getStart(file),
        end: node.end,
        text: JSON.stringify(node.text),
      });

    }

    ts.forEachChild(node, visit);
  }

  visit(file);

  return applyEdits(source, edits);
}


function blankLines(source, filename)
{
  const file = parse(source, filename);
  const gaps = new Map();

  function separate(position, count = 1)
  {
    const lineEnd = source.indexOf("\n", position);

    if (lineEnd < 0 || !source.slice(lineEnd).trim())
    {
      return;
    }

    gaps.set(lineEnd, Math.max(gaps.get(lineEnd) || 0, count));
  }

  function visit(node)
  {
    if (ts.isSourceFile(node) || ts.isBlock(node))
    {
      for (let index = 1; index < node.statements.length; index++)
      {
        const previous = node.statements[index - 1];
        const current = node.statements[index];
        const gap = source.slice(previous.end, current.getStart(file));

        if (gap.trim())
        {
          continue; // Keep comments attached to their statements.
        }

        if (ts.isFunctionDeclaration(current))
        {
          separate(previous.end, ts.isSourceFile(node) ? 2 : 1);
        }

        else if (
          ts.isReturnStatement(current) ||
          ts.isIfStatement(current) ||
          ts.isTryStatement(current) ||
          (ts.isVariableStatement(previous) && !ts.isVariableStatement(current))
        )
        {
          separate(previous.end);
        }

      }

    }

    for (const child of node.getChildren(file))
    {
      if (child.kind === ts.SyntaxKind.CloseBraceToken)
      {
        const lineEnd = source.indexOf("\n", child.end);
        const suffix = source.slice(child.end, lineEnd < 0 ? source.length : lineEnd);

        if (/^[\t ),;\]]*(?:\/\/[^\n]*)?$/.test(suffix))
        {
          separate(child.end);
        }

      }

      visit(child);
    }

  }

  visit(file);
  const edits = [...gaps].map(([start, count]) =>
  {
    const existing = /^\n(?:[\t ]*\n)*/.exec(source.slice(start))[0];

    return { start, end: start + existing.length, text: "\n".repeat(count + 1) };

  });

  return applyEdits(source, edits);
}

const files = (
  await Promise.all(
    ["packages", "scripts", "examples"].map((directory) =>
      sourceFiles(path.join(root, directory)),
    ),
  )
)
  .flat()
  .sort();
let changed = 0;

for (const filename of files)
{
  const source = await readFile(filename, "utf8");
  const formatted = blankLines(
    doubleQuotes(
      allmanBraces(
        await prettier.format(addControlBraces(source, filename), {
          filepath: filename,
          endOfLine: "lf",
          tabWidth: 2,
          printWidth: 90,
          singleQuote: false,
        }),

        filename,
      ),
      filename,
    ),
    filename,
  );

  if (source !== formatted)
  {
    changed++;

    if (check)
    {
      console.error(path.relative(root, filename));
    }

    else
    {
      await writeFile(filename, formatted);
    }

  }

}

console.log(
  `${check ? "Checked" : "Formatted"} ${files.length} source files; ${changed} ${check ? "need formatting" : "changed"}.`,
);

if (check && changed)
{
  process.exitCode = 1;
}
