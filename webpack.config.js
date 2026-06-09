const path = require("path");
const webpack = require("webpack");

/** @type {import('webpack').Configuration} */
module.exports = {
  entry: {
    extension: "./src/extension.ts"
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].js",
    libraryTarget: "commonjs",
    devtoolModuleFilenameTemplate: "../[resource-path]"
  },
  devtool: "source-map",
  externals: {
    vscode: "commonjs vscode" // Direct VS Code API requires it to be external
  },
  resolve: {
    extensions: [".ts", ".js"]
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader"
          }
        ]
      }
    ]
  },
  target: "node", // Extensions run in a node context
  // Suppress harmless optional-dependency warnings from `ws` package.
  // `bufferutil` and `utf-8-validate` are native addons that ws can use
  // for performance but works correctly without them.
  ignoreWarnings: [
    /Can't resolve 'bufferutil'/,
    /Can't resolve 'utf-8-validate'/,
  ],
};

