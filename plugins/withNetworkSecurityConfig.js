// Expo config plugin: writes an explicit network_security_config.xml that
// blocks cleartext (http://) traffic, and wires it into the application
// tag of the merged Android manifest.
//
// Why: Android 9+ blocks cleartext by default, but the default behavior
// is implicit. Adding an explicit policy file is what Play Console's
// automated network-security scanner looks for, and what auditors flag
// in pen-tests as "explicit > implicit". This config refuses ALL
// cleartext; the backend (flipon-backend.onrender.com) is HTTPS so the
// app loses nothing. If a future surface ever needs cleartext to a
// specific host (e.g. local dev server on LAN), add a <domain-config>
// exception below — DON'T flip cleartextTrafficPermitted back to true
// globally.

const path = require('path');
const fs = require('fs');
const {
  withAndroidManifest,
  withDangerousMod,
} = require('@expo/config-plugins');

const RES_DIR = path.join('app', 'src', 'main', 'res', 'xml');
const FILE_NAME = 'network_security_config.xml';
const CONFIG_REF = '@xml/network_security_config';

const XML_BODY = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system"/>
    </trust-anchors>
  </base-config>
</network-security-config>
`;

const withNetworkSecurityConfig = (config) => {
  // Drop the XML file into the native res/xml folder on every prebuild.
  // Uses withDangerousMod to escape the normal mod system because the
  // file lives outside the standard config schema.
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.platformProjectRoot;
      const dir = path.join(projectRoot, RES_DIR);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, FILE_NAME), XML_BODY);
      return cfg;
    },
  ]);

  // Reference the file from the <application> tag so Android actually
  // uses it. Without this attribute the file just sits unused.
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const app = manifest.application?.[0];
    if (app) {
      app.$ = app.$ || {};
      app.$['android:networkSecurityConfig'] = CONFIG_REF;
    }
    return cfg;
  });

  return config;
};

module.exports = withNetworkSecurityConfig;
