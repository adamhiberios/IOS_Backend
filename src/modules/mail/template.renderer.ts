import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Tiny template renderer for the email templates in ./templates/.
 *
 * Supports two constructs:
 *   - {{token}}         — replaced by vars[token], or '' if missing
 *   - {{#if cond}}…{{/if}} / {{#unless cond}}…{{/unless}}
 *
 * No external dependency. Sufficient for transactional emails; if logic gets
 * richer (loops, nested conditionals) swap to Handlebars in one place.
 */
export type TemplateVars = Record<string, string | number | boolean | undefined>;

function isTruthy(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return String(v).length > 0 && String(v) !== 'false';
}

function renderConditionals(template: string, vars: TemplateVars): string {
  // {{#if cond}}...{{/if}}
  let out = template.replace(
    /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, key, body) => (isTruthy(vars[key]) ? body : ''),
  );
  // {{#unless cond}}...{{/unless}}
  out = out.replace(
    /\{\{#unless\s+(\w+)\}\}([\s\S]*?)\{\{\/unless\}\}/g,
    (_, key, body) => (isTruthy(vars[key]) ? '' : body),
  );
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderTokens(
  template: string,
  vars: TemplateVars,
  escape: boolean,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = vars[key];
    if (v === undefined || v === null) return '';
    const s = String(v);
    return escape ? escapeHtml(s) : s;
  });
}

/**
 * Load and render a template pair. Returns the HTML + text bodies.
 * The renderer auto-injects `currentYear` so every template footer is consistent
 * without callers passing it in.
 */
export function renderTemplate(
  name: string,
  vars: TemplateVars = {},
): { html: string; text: string } {
  const dir = join(__dirname, 'templates');
  const html = readFileSync(join(dir, `${name}.html`), 'utf8');
  const text = readFileSync(join(dir, `${name}.txt`), 'utf8');

  const merged: TemplateVars = {
    currentYear: new Date().getFullYear(),
    ...vars,
  };

  return {
    // HTML mode: escape token values so a `<script>` in a user's name renders
    // as text, not executable HTML.
    html: renderTokens(renderConditionals(html, merged), merged, true),
    // Text mode: no escaping — recipients see the raw value.
    text: renderTokens(renderConditionals(text, merged), merged, false),
  };
}
