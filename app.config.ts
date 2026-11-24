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
    softwareKeyboardLayoutMode: "pan",
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
    "onnxruntime-react-native",
    "./plugins/with-onnxruntime-package",
    [
      "expo-build-properties",
      {
        android: {
          cmakeVersion: "3.31.6"
        }
      }
    ],
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
