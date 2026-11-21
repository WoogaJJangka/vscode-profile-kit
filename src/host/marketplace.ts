/**
 * Extension metadata from the Visual Studio Marketplace, for recommending profiles before an extension is installed.
 * Same public gallery endpoint VS Code itself uses (PLAN.md section 8, #7). Only the extension ID is sent.
 * Failure is normal (offline, proxy): callers fall back to the ID alone.
 */
import { type ExtensionMeta, normalizeId } from '../core';

export const GALLERY_URL = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery';
/** IncludeVersions | IncludeCategoryAndTags | IncludeVersionProperties | ExcludeNonValidated */
export const GALLERY_FLAGS = 0x1 | 0x4 | 0x10 | 0x200;
const FILTER_EXTENSION_NAME = 7;

export interface GalleryExtension extends ExtensionMeta {
  /** Marketplace extension GUID (`identifier.uuid` in a .code-profile). */
  uuid?: string;
  displayName?: string;
  description?: string;
}

type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const rec = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);
const list = (v: unknown) =>
  typeof v === 'string'
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

/** Turn one gallery result entry into ExtensionMeta. Internal tags (`__ext_py`, `__web_extension`) are dropped. */
export function galleryToMeta(entry: unknown): GalleryExtension | undefined {
  const e = rec(entry);
  const publisher = rec(e.publisher).publisherName;
  if (typeof publisher !== 'string' || typeof e.extensionName !== 'string') return undefined;
  const version = rec(Array.isArray(e.versions) ? e.versions[0] : undefined);
  const props = new Map(
    (Array.isArray(version.properties) ? version.properties : []).map((p) => [rec(p).key, rec(p).value] as const),
  );
  return {
    id: `${publisher}.${e.extensionName}`.toLowerCase(),
    ...(typeof e.extensionId === 'string' ? { uuid: e.extensionId } : {}),
    ...(typeof e.displayName === 'string' ? { displayName: e.displayName } : {}),
    ...(typeof e.shortDescription === 'string' ? { description: e.shortDescription } : {}),
    categories: strs(e.categories),
    keywords: strs(e.tags).filter((t) => !t.startsWith('__')),
    extensionDependencies: list(props.get('Microsoft.VisualStudio.Code.ExtensionDependencies')),
    extensionPack: list(props.get('Microsoft.VisualStudio.Code.ExtensionPack')),
  };
}

/** Look up extensions by ID. Missing IDs are simply absent from the result. Throws on network or HTTP errors. */
export async function queryGallery(
  ids: readonly string[],
  options: { fetch?: Fetch; timeoutMs?: number } = {},
): Promise<Map<string, GalleryExtension>> {
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as Fetch);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const res = await doFetch(GALLERY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json;api-version=3.0-preview.1' },
      body: JSON.stringify({
        filters: [
          { criteria: ids.map((id) => ({ filterType: FILTER_EXTENSION_NAME, value: id })), pageSize: ids.length },
        ],
        flags: GALLERY_FLAGS,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Marketplace answered ${res.status}`);
    const body = rec(await res.json());
    const first = rec(Array.isArray(body.results) ? body.results[0] : undefined);
    const out = new Map<string, GalleryExtension>();
    for (const entry of Array.isArray(first.extensions) ? first.extensions : []) {
      const meta = galleryToMeta(entry);
      if (meta) out.set(normalizeId(meta.id), meta);
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}
