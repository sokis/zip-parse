import fs from 'fs'
import path from 'path'
import assert from 'assert'
import zlib from 'zlib'

// Store original fs funcitons
const openSync = fs.openSync;
const closeSync = fs.closeSync;
const statSync = fs.statSync;
const readSync = fs.readSync;
const readAsync = fs.read;

const FH_SIZE = 30;
const FH_SIGN = 0x04034b50;
const EOCD_SIZE = 22;
const EOCD_SIGN = 0x06054b50;
const CDE_SIZE = 46;
const CDE_SIGN = 0x02014b50;


export function znorm(str) {
  return str.replace(/\\/g, '/')
}

export function zjoin(a, b) {
  return znorm(path.join(a, b))
}

export default class Archive {

  constructor(path) {

    this.path = path;
    this.fd = openSync(path, 'r');
    this.fileLen = statSync(path).size;
    this.files = {};

    this._loadCD();
  }

  readFileSync(fname, encoding) {
    const file = this.files[fname];
    if (!file) {
      return fs.readFileSync(fname, encoding)
    }

    const hdr = new Buffer(FH_SIZE);
    this._readSync(hdr, file.offset);

    const dataOff = this._getDataOffset(file, hdr);
    const cbuf = new Buffer(file.csize);

    const read = this._readSync(cbuf, dataOff);
    assert.equal(read, cbuf.length);

    let result;
    if (file.method === 0) {
      result = cbuf;
    } else if (file.method === 8) {
      result = zlib.inflateRawSync(cbuf);
    } else {
      throw Error('Unsupported compression method ' + file.method);
    }

    return encoding ? result.toString(encoding) : result;
  }

  statSync(path) {
    if (!this.existsSync(path)) {
      return fs.existsSync(path)
    }
    var file = this.files[path];

    return Object.assign({
      isDirectory() {
        return file.dir;
      },
      isFile() {
        return !file.dir;
      }
    }, file);
  }

  stat(path, callback) {
    try {
      var file = this.statSync(path)
      callback && callback(null, file)
    } catch (error) {
      callback && callback(error)
    }
  }

  readFile(fname, encoding, callback) {
    var file = this.files[fname];
    if (!file) {
      if (typeof encoding === 'function') callback = encoding, encoding = null
      return fs.readFile(fname, encoding, callback)
    }

    var hdr = new Buffer(FH_SIZE);

    this._readAsync(hdr, file.offset, () => {
      var dataOff = this._getDataOffset(file, hdr);
      var cbuf = new Buffer(file.csize);

      this._readAsync(cbuf, dataOff, function (err, read) {
        assert.equal(read, cbuf.length);

        if (file.method === 0) {
          callback(null, cbuf);
        } else if (file.method === 8) {
          zlib.inflateRaw(cbuf, callback);
        }
      });
    });
  }

  filter(pred) {
    const result = [];

    for (let f in this.files) {
      const file = this.files[f];
      if (pred(f, file)) {
        result.push(file);
      }
    }

    return result;
  }

  readdir(dir, callback) {
    dir = zjoin(dir, '/');
    const filtered = this.filter((relativePath, file) => {
      var ss = relativePath.indexOf('/', dir.length);
      return relativePath.indexOf(dir) === 0 &&
        relativePath !== dir &&
        (ss === -1 || ss == relativePath.length - 1);
    });
    const files = filtered.map((file) => {
      return path.basename(file.name);
    });
    callback && callback(null, files)
    return files
  }

  readdirSync(dir) {
    return this.readdir(dir);
  }

  realpathSync(path) {
    return zjoin(this.path, path);
  }

  _getDataOffset(file, hdr) {
    assert.equal(hdr.readUIntLE(0, 4), FH_SIGN, 'Couldn\'t find file signature');

    var fnameLen = hdr.readUIntLE(26, 2);
    var extraLen = hdr.readUIntLE(28, 2);
    var dataOff = file.offset + hdr.length + fnameLen + extraLen;

    return dataOff;
  }


  _readSync(buf, position) {
    if (!buf.length) {
      return 0;
    }
    return readSync(this.fd, buf, 0, buf.length, position);
  }

  _readAsync(buf, position, callback) {
    if (!buf.length) {
      callback(null, 0, buf);
      return;
    }
    return readAsync(this.fd, buf, 0, buf.length, position, callback);
  }

  _readCDEntry(cdbuf, offset) {
    function field(pos, size) {
      return cdbuf.readUIntLE(offset + pos, size);
    }
    assert.equal(field(0, 4), CDE_SIGN, 'Couldn\'t find CD signature');

    var fnameLen = field(28, 2);
    var fnamePos = offset + CDE_SIZE;
    var extraLen = field(30, 2);
    var commentLen = field(32, 2);

    var fname = cdbuf.toString(undefined, fnamePos, fnamePos + fnameLen);

    var file = {
      name: fname,
      method: field(10, 2),
      csize: field(20, 4),
      usize: field(24, 4),
      offset: field(42, 4)
    };
    file.dir = fname.substr(-1) == '/';
    if (file.dir) {
      this.files[file.name.substr(0, file.name.length - 1)] = file;
    }
    this.files[file.name] = file;

    return CDE_SIZE + fnameLen + extraLen + commentLen;
  }

  _getCD() {
    // Find EOCD
    var eocd = new Buffer(EOCD_SIZE);
    this._readSync(eocd, this.fileLen - eocd.length);
    assert.equal(eocd.readUIntLE(0, 4), EOCD_SIGN, 'Couldn\'t find EOCD signature');

    var size = eocd.readUIntLE(12, 4);
    var offset = eocd.readUIntLE(16, 4);
    var cdbuf = new Buffer(size);
    var read = this._readSync(cdbuf, offset);
    assert.equal(read, size);

    return {
      records: eocd.readUIntLE(10, 2),
      buf: cdbuf
    };
  }

  _loadCD() {
    var cd = this._getCD();
    var off = 0;
    for (var i = 0; i < cd.records; i++) {
      off += this._readCDEntry(cd.buf, off);
    }
  }

  close() {
    closeSync(this.fd);
  }

  exists(path) {
    return path in this.files;
  }

  existsSync(path) {
    return this.exists(path);
  }
}