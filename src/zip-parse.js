import fs from 'fs'
import path,{ resolve } from 'path'
import Module from 'module'
import Archive, { znorm, zjoin } from './archive'

export default function (path) {
  return new Archive(path)
}

// window 下，eslint 路径加载不了
if (process.platform === 'win32') {
  const pjoin = path.join.bind(path)
  path.join = function () {
    return znorm(pjoin.apply(path, arguments))
  }
}

const ZIP_CACHE = {};
const packageMainCache = {};

function getZip(path) {
  path = znorm(path);
  const cached = ZIP_CACHE[path];
  if (cached) {
    return cached;
  }

  const zip = new Archive(path);
  ZIP_CACHE[path] = zip;

  return zip;
}

function parseZipPath(path) {
  const idx = path.indexOf(".zip");
  if (idx == -1) {
    return false;
  }

  return {
    zip: znorm(path.substr(0, idx + 4)),
    entry: znorm(path.substr(idx + 5))
  };
}

function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

function readPackage(zip, entry) {
  if (hasOwnProperty(packageMainCache, entry)) {
    return packageMainCache[entry];
  }
  const jsonPath = zjoin(entry, 'package.json');
  let json;
  let pkg;

  try {
    json = zip.readFileSync(jsonPath, 'utf8');
  } catch (e) {
    return false;
  }

  try {
    pkg = packageMainCache[entry] = JSON.parse(json).main;
  } catch (e) {
    e.path = jsonPath;
    e.message = 'Error parsing ' + jsonPath + ': ' + e.message;
    throw e;
  }

  return pkg;
}

function tryFile(zip, entry) {
  try {
    const stat = zip.statSync(entry);
    if (stat && !stat.isDirectory()) {
      return zip.realpathSync(entry, Module._realpathCache);
    }
  } catch (e) { /* ignore ENOENT exception */ }

  return false;
}

function tryExtensions(zip, entry, exts) {
  for (let i = 0; i < exts.length; i++) {
    const filename = tryFile(zip, entry + exts[i]);
    if (filename) {
      return filename;
    }
  }
  return false;
}

function tryPackage(zip, entry, exts) {
  const pkg = readPackage(zip, entry);

  if (!pkg) return false;

  const filename = zjoin(entry, pkg);
  return tryFile(zip, filename) || tryExtensions(zip, filename, exts) || tryExtensions(zip, zjoin(filename, 'index'), exts);
}

// fs hooks ..
(function (flists) {
  flists.forEach((name) => {
    const orig = fs[name];
    fs[name] = function (path, arg1, arg2) {
      path = resolve(path) // webpack loader : resolve( loader/../../file )
      let idx = path.indexOf(".zip");
      const pidx = path.indexOf('package.json'); // readFile: mods.zip/package.json -> /package.json
      if (pidx !== -1 && pidx - 5 === idx) {
        path = path.substr(0, idx - 5) + path.substr(pidx - 1)
        idx = path.indexOf(".zip");
      }
      if (idx == -1) {
        return orig.apply(fs, arguments);
      }
      const zpath = parseZipPath(path);
      const zip = getZip(zpath.zip);
      return zip[name](znorm(zpath.entry), arg1, arg2);
    };
  });
})([
  'readFileSync',
  'readFile',
  'readdirSync',
  'readdir',
  'statSync',
  'stat',
  'realpathSync',
  'existsSync'
]);

// Module _findPath hijacking
(function () {
  const orig = Module._findPath;
  Module._findPath = function (request, paths) {
    let result = orig.apply(module, arguments);
    if (result)
      return result;

    const exts = Object.keys(Module._extensions);

    if (request.charAt(0) === '/') {
      paths = [''];
    }

    const trailingSlash = (request.slice(-1) === '/');

    const cacheKey = JSON.stringify({
      request: request,
      paths: paths
    });
    if (Module._pathCache[cacheKey]) {
      return Module._pathCache[cacheKey];
    }

    for (let i = 0, PL = paths.length; i < PL; i++) {
      const basePath = resolve(paths[i], request);
      const zpath = parseZipPath(basePath);
      if (!zpath)
        continue;
      const zip = getZip(zpath.zip);
      let filename
      if (!trailingSlash) {
        filename = tryFile(zip, zpath.entry);

        if (!filename)
          filename = tryExtensions(zip, zpath.entry, exts);
      }

      if (!filename)
        filename = tryPackage(zip, zpath.entry, exts);

      if (!filename) {
        filename = tryExtensions(zip, zjoin(zpath.entry, 'index'), exts);
      }

      if (filename) {
        Module._pathCache[cacheKey] = filename;
        return filename;
      }
    }
    return false;
  }
})();