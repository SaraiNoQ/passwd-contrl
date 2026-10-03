#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const [output, pnpmInput, cargoInput, gradleInput, configuration, fingerprint] = process.argv.slice(2);
if (!output || !pnpmInput || !cargoInput || !gradleInput || !configuration || !fingerprint) {
  throw new Error(
    "usage: mobile-generate-sbom.mjs OUTPUT PNPM_JSON CARGO_JSON GRADLE_TXT CONFIGURATION FINGERPRINT",
  );
}

const components = new Map();
const packageVersion = JSON.parse(readFileSync("apps/mobile/package.json", "utf8")).version;
const appVersion = JSON.parse(readFileSync("apps/mobile/app.json", "utf8")).expo?.version;
if (typeof appVersion !== "string" || !appVersion || packageVersion !== appVersion) {
  throw new Error("Mobile package.json and app.json versions must match");
}
const add = (group, name, version, purl) => {
  if (!name || !version || version === "unspecified") return;
  const key = purl;
  components.set(key, {
    type: "library",
    ...(group ? { group } : {}),
    name,
    version,
    "bom-ref": key,
    purl,
  });
};

const npmPurl = (name, version) => {
  const parts = name.startsWith("@") ? name.split("/") : [name];
  return `pkg:npm/${parts.map(encodeURIComponent).join("/")}@${encodeURIComponent(version)}`;
};

const pnpmLicenses = JSON.parse(readFileSync(pnpmInput, "utf8"));
for (const packages of Object.values(pnpmLicenses)) {
  if (!Array.isArray(packages)) continue;
  for (const pkg of packages) {
    if (!pkg || typeof pkg.name !== "string" || !Array.isArray(pkg.versions)) continue;
    for (const version of pkg.versions) {
      if (typeof version === "string" && /^\d/.test(version)) {
        add("", pkg.name, version, npmPurl(pkg.name, version));
      }
    }
  }
}

const cargo = JSON.parse(readFileSync(cargoInput, "utf8"));
for (const pkg of cargo.packages || []) {
  add("", pkg.name, pkg.version, `pkg:cargo/${encodeURIComponent(pkg.name)}@${encodeURIComponent(pkg.version)}`);
}

for (const line of readFileSync(gradleInput, "utf8").split("\n")) {
  const match = line.match(/---\s+([^\s:]+):([^\s:]+):([^\s()]+)(?:\s+->\s+([^\s()]+))?/);
  if (!match) continue;
  const [, group, name, requested, selected] = match;
  const version = selected || requested;
  add(group, name, version, `pkg:maven/${encodeURIComponent(group)}/${encodeURIComponent(name)}@${encodeURIComponent(version)}`);
}

const bom = {
  $schema: "https://cyclonedx.org/schema/bom-1.5.schema.json",
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: `urn:uuid:${randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: { components: [{ type: "application", name: "zero-vault-mobile-sbom", version: "1" }] },
    component: { type: "application", name: "com.zerovault.mobile", version: appVersion },
    properties: [
      { name: "zero-vault:source-fingerprint", value: fingerprint },
      { name: "zero-vault:gradle-configuration", value: configuration },
      ...(process.env.ZERO_VAULT_ANDROID_VERSION_CODE
        ? [
            {
              name: "zero-vault:android-version-code",
              value: process.env.ZERO_VAULT_ANDROID_VERSION_CODE,
            },
          ]
        : []),
    ],
  },
  components: [...components.values()].sort((a, b) => a["bom-ref"].localeCompare(b["bom-ref"])),
};

writeFileSync(output, `${JSON.stringify(bom, null, 2)}\n`, { flag: "wx" });
