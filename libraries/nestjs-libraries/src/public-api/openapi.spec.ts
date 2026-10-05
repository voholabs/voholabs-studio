import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// apps/backend/public-api.openapi.json describes every /public/v1 route, and
// nothing that is not one. Routes are read from the controllers' decorators,
// so adding a route without describing it fails here.
const root = join(__dirname, '..', '..', '..', '..');
const controllers = join(root, 'apps', 'backend', 'src', 'public-api', 'routes', 'v1');
const spec = JSON.parse(
  readFileSync(join(root, 'apps', 'backend', 'public-api.openapi.json'), 'utf8')
);

const routes = readdirSync(controllers)
  .filter((file) => file.endsWith('.controller.ts'))
  .flatMap((file) => {
    const source = readFileSync(join(controllers, file), 'utf8');
    if (!source.includes("@Controller('/public/v1')")) {
      return [];
    }
    return Array.from(
      source.matchAll(/@(Get|Post|Put|Patch|Delete)\('([^']*)'\)/g)
    ).map(
      ([, method, path]) =>
        `${method.toLowerCase()} ${path.replace(/:(\w+)/g, '{$1}')}`
    );
  });

const described = Object.entries(spec.paths).flatMap(([path, methods]) =>
  Object.keys(methods as object).map((method) => `${method} ${path}`)
);

describe('public API OpenAPI description', () => {
  it('is OpenAPI 3.1 with the Studio server', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.servers[0].url).toMatch(/\/public\/v1$/);
  });

  it('finds the routes', () => {
    expect(routes).toContain('get /wallet');
    expect(routes).toContain('get /skills/{slug}');
    expect(routes).toContain('get /openapi.json');
  });

  it('describes every route', () => {
    expect(routes.filter((route) => !described.includes(route))).toEqual([]);
  });

  it('describes no route that does not exist', () => {
    expect(described.filter((route) => !routes.includes(route))).toEqual([]);
  });

  it('resolves every reference', () => {
    const text = JSON.stringify(spec);
    const refs = Array.from(
      new Set(Array.from(text.matchAll(/"\$ref":"#\/components\/(\w+)\/(\w+)"/g)))
    );
    for (const [, kind, name] of refs) {
      expect(spec.components[kind]?.[name]).toBeDefined();
    }
  });

  it('marks only the ticket uploads and itself as needing no key', () => {
    const open = Object.entries(spec.paths).flatMap(([path, methods]) =>
      Object.entries(methods as Record<string, any>)
        .filter(([, operation]) => Array.isArray(operation.security) && !operation.security.length)
        .map(([method]) => `${method} ${path}`)
    );
    expect(open.sort()).toEqual(
      ['get /openapi.json', 'post /brief-upload/{token}', 'post /upload-ticket/{token}'].sort()
    );
  });
});
