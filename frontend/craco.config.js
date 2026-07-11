module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      webpackConfig.ignoreWarnings = [/Failed to parse source map/];
      return webpackConfig;
    },
  },
  devServer: (devServerConfig) => {
    devServerConfig.allowedHosts = "all";
    devServerConfig.client = {
      ...(devServerConfig.client || {}),
      webSocketURL: {
        port: 443,
        protocol: "wss",
      },
    };
    return devServerConfig;
  },
};
