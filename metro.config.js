// Metro 0.83+ uses Array.prototype.toReversed (ES2023). Node 18 lacks it — use Node 20+ for Expo 54.
// This shim unblocks dev if you cannot upgrade immediately; prefer: nvm install 20 && nvm use 20
if (typeof Array.prototype.toReversed !== "function") {
  Object.defineProperty(Array.prototype, "toReversed", {
    value: function toReversed() {
      return [...this].reverse();
    },
    configurable: true,
    writable: true,
  });
}

const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: "./global.css" });
