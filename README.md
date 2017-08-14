
# Zip Parse
从zip中读取文件,模块，支持普通require，fs等操作及各种构建工具

### 例子
创建模块
```shell
$ (cd node_modules && zip -r ../mods.zip *) && rm -r node_modules
```

引入钩子函数:
```javascript
require("zip-parse");
require("./mods.zip/request");	// Load 'request' from mods.zip
```

或者通过，设置 **NODE_PATH** 变量:
```shell
$ NODE_PATH=./mods.zip node ./yourapp.js
```
使用的时候省略`./mods.zip/`路径。
```javascript
require("zip-parse");
require("request");
```