/**
 * VS Code's built-in profile templates (New Profile → template: Python, Data Science, ...), stage C-4.
 * VS Code reads the list from `profileTemplatesUrl` in its product.json; each entry points to a `.code-profile`
 * (codeProfile.ts). Profile Kit reads the same list to suggest groups. docs/PLAN.md section 8-2.
 */
import { PRODUCT_TEMPLATES_URL_KEY } from './compat';
import { isRecord } from './preset';

export interface ProfileTemplate {
  name: string;
  url: string;
}

const isHttps = (v: unknown): v is string => {
  if (typeof v !== 'string') return false;
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
};

/** The template list URL from product.json content, or undefined when there is none (VS Code OSS builds). */
export function templatesUrlFromProduct(product: unknown): string | undefined {
  const url = isRecord(product) ? product[PRODUCT_TEMPLATES_URL_KEY] : undefined;
  return isHttps(url) ? url : undefined;
}

/** `[{name, url}]` from the template list; entries without a name or an https URL are left out. */
export function parseTemplateList(json: unknown): ProfileTemplate[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((e) =>
    isRecord(e) && typeof e.name === 'string' && e.name.trim() && isHttps(e.url)
      ? [{ name: e.name.trim(), url: e.url }]
      : [],
  );
}
