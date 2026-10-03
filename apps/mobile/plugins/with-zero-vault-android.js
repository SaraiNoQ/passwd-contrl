const fs = require("node:fs");
const path = require("node:path");
const {
  AndroidConfig,
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withMainApplication,
} = require("expo/config-plugins");

const RELEASE_DECLARATIONS = `
// zero-vault-release-build-declarations-begin
def zeroVaultReleaseVersionCode = System.getenv('ZERO_VAULT_ANDROID_VERSION_CODE')

gradle.taskGraph.whenReady { graph ->
    def releaseRequested = graph.allTasks.any { task ->
        task.path.toLowerCase().contains('release')
    }
    if (!releaseRequested) {
        return
    }
    if (zeroVaultReleaseVersionCode == null ||
        !(zeroVaultReleaseVersionCode ==~ /[1-9][0-9]*/) ||
        Integer.parseInt(zeroVaultReleaseVersionCode) <= 1) {
        throw new GradleException(
            'ZERO_VAULT_ANDROID_VERSION_CODE must be an integer greater than 1 for release builds'
        )
    }
}
// zero-vault-release-build-declarations-end
`;

const RELEASE_ASSIGNMENT = `
// zero-vault-release-build-assignment-begin
if (zeroVaultReleaseVersionCode != null && zeroVaultReleaseVersionCode ==~ /[1-9][0-9]*/) {
    android.defaultConfig.versionCode = Integer.parseInt(zeroVaultReleaseVersionCode)
}
android.buildTypes.release.minifyEnabled = true
android.buildTypes.release.shrinkResources = true
android.buildTypes.release.ndk.debugSymbolLevel = 'FULL'
// zero-vault-release-build-assignment-end
`;

const THEME_COLORS = {
  light: {
    bg_root: "#F7F9FC",
    bg_shell: "#FFFFFF",
    bg_panel: "#FFFFFF",
    bg_panel_soft: "#EEF3F8",
    border: "#D9E2EC",
    border_strong: "#B8C5D1",
    text_primary: "#102A43",
    text_secondary: "#334E68",
    text_muted: "#627D98",
    primary: "#006A7C",
    success: "#147D64",
    accent: "#A61E63",
    warning: "#985B00",
    danger: "#B4233C",
  },
  dark: {
    bg_root: "#050B12",
    bg_shell: "#07111D",
    bg_panel: "#0B1624",
    bg_panel_soft: "#101827",
    border: "#1F2937",
    border_strong: "#334155",
    text_primary: "#F8FAFC",
    text_secondary: "#CBD5E1",
    text_muted: "#94A3B8",
    primary: "#22D3EE",
    success: "#34D399",
    accent: "#F472B6",
    warning: "#F59E0B",
    danger: "#FB7185",
  },
};

const VAULT_SYSTEM_PROCESS_GUARD = `
    // zero-vault-system-process-guard-begin
    // Autofill and Credential Manager callbacks have a strict response window. Their
    // dedicated process is native-only, so it must not boot React Native or Expo.
    if (expo.modules.zerovault.ZeroVaultSystemProcess.isCurrent(this)) return
    // zero-vault-system-process-guard-end
`;

const VAULT_SYSTEM_CONFIGURATION_GUARD = `
    // zero-vault-system-configuration-guard-begin
    if (expo.modules.zerovault.ZeroVaultSystemProcess.isCurrent(this)) return
    // zero-vault-system-configuration-guard-end
`;

function colorResources(colors) {
  const entries = Object.entries(colors)
    .map(([name, value]) => `    <color name="zv_${name}">${value}</color>`)
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<resources>
${entries}
</resources>
`;
}

function replaceMarkedBlock(contents, name, block, insert) {
  const start = `// ${name}-begin`;
  const end = `// ${name}-end`;
  const expression = new RegExp(
    `${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`,
    "m",
  );
  if (expression.test(contents)) {
    return contents.replace(expression, `${block.trim()}\n`);
  }
  return insert(contents, block.trim());
}

function removeMarkedBlock(contents, name) {
  const start = `// ${name}-begin`;
  const end = `// ${name}-end`;
  return contents.replace(
    new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`, "m"),
    "",
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findClosingBrace(contents, openBrace) {
  let depth = 0;
  for (let index = openBrace; index < contents.length; index += 1) {
    if (contents[index] === "{") depth += 1;
    if (contents[index] === "}") depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

function removeReleaseSigningConfig(contents) {
  const buildTypes = /buildTypes\s*\{/.exec(contents);
  if (!buildTypes) throw new Error("Zero Vault could not locate Android buildTypes");
  const buildTypesOpen = contents.indexOf("{", buildTypes.index);
  const buildTypesClose = findClosingBrace(contents, buildTypesOpen);
  const release = /release\s*\{/.exec(contents.slice(buildTypesOpen + 1, buildTypesClose));
  if (!release) throw new Error("Zero Vault could not locate the Android release build type");
  const releaseStart = buildTypesOpen + 1 + release.index;
  const releaseOpen = contents.indexOf("{", releaseStart);
  const releaseClose = findClosingBrace(contents, releaseOpen);
  const block = contents.slice(releaseOpen + 1, releaseClose)
    .replace(/^\s*signingConfig\b.*$/gm, "");
  if (/\bsigningConfig\b/.test(block)) {
    throw new Error("Zero Vault could not remove Android release signingConfig");
  }
  return `${contents.slice(0, releaseOpen + 1)}${block}${contents.slice(releaseClose)}`;
}

function withZeroVaultManifest(config) {
  return withAndroidManifest(config, (result) => {
    const manifest = result.modResults;
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    application.$["android:allowBackup"] = "false";
    application.$["android:fullBackupContent"] = "@xml/zero_vault_backup_rules";
    application.$["android:dataExtractionRules"] = "@xml/zero_vault_data_extraction_rules";
    application.$["android:usesCleartextTraffic"] = "false";
    application.$["android:networkSecurityConfig"] =
      "@xml/zero_vault_network_security_config";

    return result;
  });
}

function withZeroVaultMainApplication(config) {
  return withMainApplication(config, (result) => {
    if (result.modResults.language !== "kt") {
      throw new Error("Zero Vault system-process isolation requires a Kotlin MainApplication");
    }
    let contents = removeMarkedBlock(
      result.modResults.contents,
      "zero-vault-system-process-guard",
    );
    contents = removeMarkedBlock(contents, "zero-vault-system-configuration-guard");
    const onCreate = /override\s+fun\s+onCreate\(\)\s*\{[\s\S]*?super\.onCreate\(\)/m;
    if (!onCreate.test(contents)) {
      throw new Error("Zero Vault could not locate MainApplication.onCreate");
    }
    contents = contents.replace(
      onCreate,
      (match) => `${match}\n${VAULT_SYSTEM_PROCESS_GUARD.trimEnd()}`,
    );
    const onConfigurationChanged =
      /override\s+fun\s+onConfigurationChanged\(newConfig:\s*Configuration\)\s*\{[\s\S]*?super\.onConfigurationChanged\(newConfig\)/m;
    if (!onConfigurationChanged.test(contents)) {
      throw new Error("Zero Vault could not locate MainApplication.onConfigurationChanged");
    }
    contents = contents.replace(
      onConfigurationChanged,
      (match) => `${match}\n${VAULT_SYSTEM_CONFIGURATION_GUARD.trimEnd()}`,
    );
    result.modResults.contents = contents;
    return result;
  });
}

function withZeroVaultResources(config) {
  return withDangerousMod(config, [
    "android",
    async (result) => {
      const res = path.join(result.modRequest.platformProjectRoot, "app", "src", "main", "res");
      const xml = path.join(res, "xml");
      const raw = path.join(res, "raw");
      const values = path.join(res, "values");
      const valuesNight = path.join(res, "values-night");
      fs.mkdirSync(xml, { recursive: true });
      fs.mkdirSync(raw, { recursive: true });
      fs.mkdirSync(values, { recursive: true });
      fs.mkdirSync(valuesNight, { recursive: true });
      writeIfChanged(
        path.join(values, "zero_vault_colors.xml"),
        colorResources(THEME_COLORS.light),
      );
      writeIfChanged(
        path.join(valuesNight, "zero_vault_colors.xml"),
        colorResources(THEME_COLORS.dark),
      );
      writeIfChanged(
        path.join(raw, "zero_vault_keep.xml"),
        `<?xml version="1.0" encoding="utf-8"?>
<resources xmlns:tools="http://schemas.android.com/tools"
    tools:keep="@color/zv_*" />
`,
      );
      writeIfChanged(
        path.join(xml, "zero_vault_network_security_config.xml"),
        `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
`,
      );
      writeIfChanged(
        path.join(xml, "zero_vault_backup_rules.xml"),
        `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
    <exclude domain="root" path="." />
    <exclude domain="file" path="." />
    <exclude domain="database" path="." />
    <exclude domain="sharedpref" path="." />
    <exclude domain="external" path="." />
    <exclude domain="device_root" path="." />
    <exclude domain="device_file" path="." />
    <exclude domain="device_database" path="." />
    <exclude domain="device_sharedpref" path="." />
</full-backup-content>
`,
      );
      writeIfChanged(
        path.join(xml, "zero_vault_data_extraction_rules.xml"),
        `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup disableIfNoEncryptionCapabilities="true">
        <exclude domain="root" path="." />
        <exclude domain="file" path="." />
        <exclude domain="database" path="." />
        <exclude domain="sharedpref" path="." />
        <exclude domain="external" path="." />
        <exclude domain="device_root" path="." />
        <exclude domain="device_file" path="." />
        <exclude domain="device_database" path="." />
        <exclude domain="device_sharedpref" path="." />
    </cloud-backup>
    <device-transfer>
        <exclude domain="root" path="." />
        <exclude domain="file" path="." />
        <exclude domain="database" path="." />
        <exclude domain="sharedpref" path="." />
        <exclude domain="external" path="." />
        <exclude domain="device_root" path="." />
        <exclude domain="device_file" path="." />
        <exclude domain="device_database" path="." />
        <exclude domain="device_sharedpref" path="." />
    </device-transfer>
</data-extraction-rules>
`,
      );
      const allowlist = normalizePrivilegedCallerAllowlist(
        process.env.ZERO_VAULT_ANDROID_PRIVILEGED_CALLERS_JSON || '{"apps":[]}',
      );
      writeIfChanged(
        path.join(raw, "zero_vault_privileged_callers.json"),
        `${JSON.stringify(allowlist)}\n`,
      );
      return result;
    },
  ]);
}

function normalizePrivilegedCallerAllowlist(source) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error("ZERO_VAULT_ANDROID_PRIVILEGED_CALLERS_JSON is not valid JSON", {
      cause: error,
    });
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !hasExactKeys(parsed, ["apps"]) ||
    !Array.isArray(parsed.apps)
  ) {
    throw new Error("The privileged-caller allowlist must contain an apps array");
  }
  return {
    apps: parsed.apps.map((app) => {
      const info = app?.info;
      if (
        app?.type !== "android" ||
        !hasExactKeys(app, ["type", "info"]) ||
        !info ||
        !hasExactKeys(info, ["package_name", "signatures"]) ||
        typeof info.package_name !== "string" ||
        !/^[A-Za-z][A-Za-z0-9_.]{1,254}$/.test(info.package_name) ||
        !Array.isArray(info.signatures) ||
        info.signatures.length === 0
      ) {
        throw new Error("The privileged-caller allowlist contains an invalid Android app");
      }
      return {
        type: "android",
        info: {
          package_name: info.package_name,
          signatures: info.signatures.map((signature) => {
            if (
              !hasExactKeys(signature, ["build", "cert_fingerprint_sha256"]) ||
              (signature?.build !== "release" && signature?.build !== "userdebug")
            ) {
              throw new Error("A privileged-caller signature has an invalid build type");
            }
            const compact = String(signature.cert_fingerprint_sha256 || "")
              .replaceAll(":", "")
              .toUpperCase();
            if (!/^[0-9A-F]{64}$/.test(compact)) {
              throw new Error("A privileged-caller signature must be a SHA-256 fingerprint");
            }
            return {
              build: signature.build,
              cert_fingerprint_sha256: compact.match(/.{2}/g).join(":"),
            };
          }),
        },
      };
    }),
  };
}

function hasExactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function writeIfChanged(file, contents) {
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== contents) {
    fs.writeFileSync(file, contents, { encoding: "utf8", mode: 0o644 });
  }
}

function withZeroVaultReleaseBuild(config) {
  return withAppBuildGradle(config, (result) => {
    if (result.modResults.language !== "groovy") {
      throw new Error("Zero Vault Android release build hardening currently requires Groovy Gradle");
    }
    let contents = result.modResults.contents;
    contents = removeMarkedBlock(contents, "zero-vault-release-signing-declarations");
    contents = removeMarkedBlock(contents, "zero-vault-release-signing-config");
    contents = removeMarkedBlock(contents, "zero-vault-release-signing-assignment");
    contents = replaceMarkedBlock(
      contents,
      "zero-vault-release-build-declarations",
      RELEASE_DECLARATIONS,
      (value, block) => value.replace(/\nandroid\s*\{/, `\n${block}\n\nandroid {`),
    );
    contents = replaceMarkedBlock(
      contents,
      "zero-vault-release-build-assignment",
      RELEASE_ASSIGNMENT,
      (value, block) => `${value.trimEnd()}\n\n${block}\n`,
    );
    contents = removeReleaseSigningConfig(contents);
    result.modResults.contents = contents;
    return result;
  });
}

module.exports = function withZeroVaultAndroid(config) {
  config = withZeroVaultManifest(config);
  config = withZeroVaultMainApplication(config);
  config = withZeroVaultResources(config);
  config = withZeroVaultReleaseBuild(config);
  return config;
};
