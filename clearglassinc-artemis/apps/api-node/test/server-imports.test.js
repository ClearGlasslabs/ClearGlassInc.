import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

test("server Stripe imports resolve against their actual module exports", () => {
  const serverUrl = new URL("../src/server.js", import.meta.url);
  const source = readFileSync(serverUrl, "utf8");
  const imports = [...source.matchAll(
    /^\s*import\s+\{([^}]+)\}\s+from\s+["'](\.\/(?:bus|stripe-webhook)\.js)["'];/gm,
  )];

  assert.deepEqual(
    imports.map(([, , specifier]) => specifier).sort(),
    ["./bus.js", "./stripe-webhook.js"],
    "Both server billing import declarations must be checked",
  );

  // Check the server's actual bindings with Node's ESM loader. Import only these
  // side-effect-free helpers: importing server.js itself would connect to Redis.
  // This is an import-contract regression, not a full server startup smoke test.
  const importSource = imports.map(([, bindings, specifier]) =>
    `import {${bindings}} from ${JSON.stringify(new URL(specifier, serverUrl).href)};`,
  ).join("\n");
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", importSource], {
    encoding: "utf8",
    timeout: 5_000,
  });

  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr);
});
