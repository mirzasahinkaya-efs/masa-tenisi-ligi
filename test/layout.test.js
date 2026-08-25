import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');

/** The grid columns declared for a class, as a count of track definitions. */
function columnCount(className) {
  const rule = new RegExp(`\\.${className}\\s*\\{[^}]*grid-template-columns:([^;]+);`);
  const match = css.match(rule);
  if (!match) return null;
  // Split on whitespace that is not inside minmax(...) or clamp(...).
  return match[1].trim().split(/\s+(?![^(]*\))/).filter(Boolean).length;
}

/**
 * Direct grid items of a form. Anything wrapped in a container is one item, not
 * several — a wrapper is exactly how two buttons share one cell.
 */
function gridItems(formId) {
  const body = html.match(new RegExp(`<form[^>]*id="${formId}"[^>]*>([\\s\\S]*?)</form>`))?.[1];
  if (body === undefined) return null;
  const flattened = body.replace(/<(span|div)\b[^>]*>[\s\S]*?<\/\1>/g, '<wrapper>');
  return (flattened.match(/<(label|select|input|button|textarea|wrapper)\b/g) ?? []).length;
}

const formClass = (formId) =>
  html.match(new RegExp(`<form[^>]*id="${formId}"[^>]*class="([^"]+)"`))?.[1]
  ?? html.match(new RegExp(`<form[^>]*class="([^"]+)"[^>]*id="${formId}"`))?.[1];

const FORMS = ['report-form', 'signin-form', 'amend-form'];

test('every grid form has exactly as many items as its grid has columns', () => {
  /*
   * The bug this exists for: the correction form was given the sign-in form's
   * class, a five-column grid, while having seven items — so it silently wrapped
   * after "Their games" and the button landed on its own line. Nothing else here
   * can see that, because it only shows up once a browser lays the page out.
   */
  for (const id of FORMS) {
    const className = formClass(id);
    assert.ok(className, `${id} has no class`);
    const columns = columnCount(className);
    assert.ok(columns, `no grid-template-columns found for .${className}`);
    assert.equal(
      gridItems(id), columns,
      `${id} (.${className}) has ${gridItems(id)} grid items in ${columns} columns`,
    );
  }
});

test('the correction form shares the recording form\'s column rhythm', () => {
  // Coherence, not just fit: the two forms sit in the same panel one under the
  // other, so a different column layout would read as two unrelated widgets.
  assert.equal(formClass('amend-form'), formClass('report-form'));
});

test('the two correction actions share one cell rather than adding a column', () => {
  const body = html.match(/<form[^>]*id="amend-form"[^>]*>([\s\S]*?)<\/form>/)[1];
  const actions = body.match(/<span class="report__actions">([\s\S]*?)<\/span>/);
  assert.ok(actions, 'the actions wrapper is what keeps the grid at seven columns');
  assert.match(actions[1], /type="submit"/);
  assert.match(actions[1], /id="amend-delete"/);
  assert.match(actions[1], /class="button--danger"/, 'the destructive action must look different');
});

test('every form control is labelled', () => {
  // Each label points at an id that exists, and each control has a label.
  for (const id of FORMS) {
    const body = html.match(new RegExp(`<form[^>]*id="${id}"[^>]*>([\\s\\S]*?)</form>`))[1];
    const labelled = [...body.matchAll(/<label for="([^"]+)"/g)].map((m) => m[1]);
    const controls = [...body.matchAll(/<(?:select|input)[^>]*id="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(labelled.sort(), controls.sort(), id);
    for (const target of labelled) {
      assert.ok(html.includes(`id="${target}"`), `${id}: label points at missing #${target}`);
    }
  }
});

test('the single-column fallback covers every grid form', () => {
  // Below the breakpoint the columns collapse, which is the only thing keeping a
  // seven-column row from overflowing a phone.
  // Every block for the breakpoint, not the first one found: an earlier version
  // of this test read only the first and reported a false failure.
  const blocks = [...css.matchAll(/@media \(max-width: 720px\) \{([\s\S]*?)\n\}/g)]
    .map((match) => match[1]);
  assert.ok(blocks.length, 'no narrow-screen block at all');
  const narrow = blocks.join('\n');
  for (const id of FORMS) {
    const className = formClass(id);
    assert.match(
      narrow, new RegExp(`\\.${className}\\b`),
      `.${className} has no single-column fallback`,
    );
  }
});
