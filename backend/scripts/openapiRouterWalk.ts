/**
 * Recursive Express router inspection used by the OpenAPI generator.
 *
 * Walks `app._router.stack` / `router.stack`, descending into every layer that
 * wraps a sub-router (`layer.name === 'router'` or a handle exposing its own
 * `stack`), and concatenates mount prefixes so a route registered as
 * `GET /_test` on a router mounted at `/v1` is reported as `GET /v1/_test`.
 */

export interface DiscoveredRoute {
  /** Lower-case HTTP method, e.g. `get`. */
  method: string;
  /** Full OpenAPI-style path, e.g. `/api/v1/vault/{id}`. */
  path: string;
}

interface LayerKey {
  name: string | number;
}

interface Layer {
  name?: string;
  regexp?: RegExp & { fast_slash?: boolean };
  keys?: LayerKey[];
  route?: { path: string | string[]; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
}

interface Routable {
  stack?: Layer[];
  _router?: { stack?: Layer[] };
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

/** Recovers the mount prefix of a router layer from Express 4's compiled regexp. */
function layerPrefix(layer: Layer): string {
  const { regexp, keys = [] } = layer;
  if (!regexp || regexp.fast_slash) return '';

  let keyIndex = 0;
  const source = regexp.source
    .replace(/^\^/, '')
    .replace('\\/?(?=\\/|$)', '')
    .replace(/\(\?:\\?\/\(\[\^\\?\/\]\+\?\)\)/g, () => `/{${keys[keyIndex++]?.name ?? 'param'}}`)
    .replace(/\\\//g, '/');

  return source === '/' ? '' : source;
}

/** Converts an Express path pattern (`/:id`) to OpenAPI form (`/{id}`). */
function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)\??/g, '{$1}');
}

function joinPaths(prefix: string, path: string): string {
  const joined = `${prefix}${path === '/' ? '' : path}`.replace(/\/{2,}/g, '/');
  const trimmed = joined.length > 1 ? joined.replace(/\/$/, '') : joined;
  return trimmed === '' ? '/' : trimmed;
}

function walk(stack: Layer[], prefix: string, out: DiscoveredRoute[], seen: Set<object>): void {
  for (const layer of stack) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const routePath of paths) {
        if (typeof routePath !== 'string') continue;
        for (const method of Object.keys(layer.route.methods)) {
          if (!HTTP_METHODS.has(method)) continue;
          out.push({ method, path: toOpenApiPath(joinPaths(prefix, routePath)) });
        }
      }
      continue;
    }

    const child = layer.handle?.stack;
    if (layer.name === 'router' || Array.isArray(child)) {
      // Guard against a router mounted inside itself.
      if (!child || seen.has(child)) continue;
      seen.add(child);
      walk(child, joinPaths(prefix, layerPrefix(layer)), out, seen);
      seen.delete(child);
    }
  }
}

/** Returns every concrete route reachable from an Express app or Router. */
export function collectRoutes(root: Routable, basePath = ''): DiscoveredRoute[] {
  const stack = root._router?.stack ?? root.stack ?? [];
  const out: DiscoveredRoute[] = [];
  walk(stack, basePath, out, new Set());

  const unique = new Map<string, DiscoveredRoute>();
  for (const route of out) unique.set(`${route.method} ${route.path}`, route);
  return [...unique.values()];
}

type PathItem = Record<string, unknown>;

/**
 * Adds a minimal operation for each discovered route the spec does not already
 * document. Existing hand-written operations are never overwritten. Returns
 * the routes that were added so callers can report them.
 */
export function mergeDiscoveredRoutes(
  spec: { paths?: Record<string, PathItem> },
  routes: DiscoveredRoute[],
): DiscoveredRoute[] {
  const paths = (spec.paths ??= {});
  const added: DiscoveredRoute[] = [];

  for (const route of routes) {
    const item = (paths[route.path] ??= {});
    if (item[route.method]) continue;

    const tag = route.path.split('/').find((s) => s && !s.startsWith('{')) ?? 'default';
    const params = [...route.path.matchAll(/\{([^}]+)\}/g)].map((m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));

    item[route.method] = {
      tags: [tag],
      summary: `${route.method.toUpperCase()} ${route.path}`,
      ...(params.length ? { parameters: params } : {}),
      responses: { '200': { description: 'Successful response' } },
    };
    added.push(route);
  }

  return added;
}
