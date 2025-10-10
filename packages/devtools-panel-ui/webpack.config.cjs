const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  entry: path.resolve(__dirname, 'src/index.tsx'),
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
    chunkFilename: '[id].bundle.js',
    publicPath: './',
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js'],
    fallback: {
      "path": false,
      "fs": false
    }
  },
  module: {
    rules: [
      { 
        test: /\.tsx?$/, 
        use: {
          loader: 'ts-loader',
          options: { transpileOnly: true }
        }, 
        exclude: /node_modules/ 
      },
      { test: /\.css$/, use: ['style-loader', 'css-loader'] },
      { 
        test: /\.(ttf|woff|woff2|eot)$/, 
        type: 'asset/resource',
        generator: {
          filename: 'fonts/[name][ext]'
        }
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({ 
      template: path.resolve(__dirname, 'src/index.html'),
      title: 'CNStra DevTools'
    })
  ],
  devServer: {
    static: path.resolve(__dirname, 'dist'),
    port: 5173,
    hot: true,
    host: '0.0.0.0',
    allowedHosts: 'all',
  },
};


