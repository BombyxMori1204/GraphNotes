import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "LocalVault",
  slug: "localvault",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  scheme: "localvault",
  assetBundlePatterns: ["**/*"],
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.localvault.app"
  },
  android: {
    adaptiveIcon: {
      // foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#ffffff"
    },
    package: "com.localvault.app"
  },
  web: {
    // favicon: "./assets/favicon.png"
  },
  plugins: [
    "expo-router",
    [
      "expo-sqlite",
      {
        "enableFTS": true
      }
    ]
  ],
  experiments: {
    typedRoutes: true
  }
});
