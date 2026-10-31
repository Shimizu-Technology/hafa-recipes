import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import { expect, it } from 'vitest';

it('keeps NetInfo in the synchronous bundle when a Debug split import would fail', () => {
  // Metro normalizes an external node_modules split URL containing /../ and
  // returns 404. Inspect the native dependency boundary so that exact failure
  // cannot gate detail initialization again; runtime reproduction is in QA.
  const source = readFileSync(new URL('./hooks/useRecipes.ts', import.meta.url), 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] });
  expect(ast.program.body.some(node => node.type === 'ImportDeclaration'
    && node.source.value === '@react-native-community/netinfo')).toBe(true);
  const imports = [];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.callee?.type === 'Import') imports.push(node.arguments[0]?.value);
    Object.values(node).forEach(value => Array.isArray(value) ? value.forEach(visit) : visit(value));
  };
  visit(ast);
  expect(imports).not.toContain('@react-native-community/netinfo');
});
