const { withMainApplication } = require('@expo/config-plugins');
const generateCode = require('@expo/config-plugins/build/utils/generateCode');

module.exports = function withOnnxruntimePackage(config) {
  return withMainApplication(config, (config) => {
    if (config.modResults.language !== 'kt') {
      throw new Error('ONNX Runtime package registration expects a Kotlin MainApplication.');
    }

    config.modResults.contents = generateCode.mergeContents({
      src: config.modResults.contents,
      newSrc: '          add(ai.onnxruntime.reactnative.OnnxruntimePackage())',
      tag: 'onnxruntime-react-native-package',
      anchor: /PackageList\(this\)\.packages\.apply\s*\{/,
      offset: 1,
      comment: '//',
    }).contents;

    return config;
  });
};
