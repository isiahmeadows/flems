import lz from 'lz-string'

// The state is stored as follows:
//
// - A CRC32 checksum of the rest.
//   - This is useful for detecting incorrect strings as a sanity check. (When
//     pasting long URLs, it's not uncommon for bytes to get added, truncated,
//     or whatever).
//
// - `console` | `autoReload`
// - `middle` as a double in its bit representation
// - `selected` as a string
//
// - For each file f as a list:
//   - `compiler`
//   - `name` as a string
//   - `content` as a string
//
// - For each link l as a list:
//   - `type`
//   - `name` as a string
//   - `url` as a string
//   - For each patches list c as a list:
//     - For each patch p as a list:
//       - `type` (either -1, 0, or 1)
//       - `content` as a string
//     - `length1`
//     - `length2`
//     - `start1`
//     - `start2`
//
// - All strings' values, concatenated in order of their appearances above
//
// Each source type is as follows:
//
// - `0` for HTML
// - `1` for CSS
// - `2` for JS
//
// Each compiler is as follows:
//
// - `0` for none
// - `1` for TypeScript
// - `2` for Babel
// - `3` for LiveScript
// - `4` for CoffeeScript
//
// Each string is as follows:
//
// - The length of the string
//
// Each list is as follows:
//
// - The length of the list
// - Each list's entries
//
// All this complexity is so that the state can be stored as densely as
// practically possible without blowing up the code base's complexity.

const TYPE_TABLE = [
  'html',
  'css',
  'js',
  'js',
  'js',
  'js',
  'js'
]

const COMPILER_TABLE = [
  null,
  null,
  'ts',
  'babel',
  'ls',
  'coffee'
]

function fail() {
  throw new Error("fail")
}

// Thanks Hacker's Delight for being useful. Adapted from `crc32b` from here,
// but with the loop unrolled.
// http://www.hackersdelight.org/hdcodetxt/crc.c.txt
function computeChecksum(str, index) {
  const CRC32_POLYNOMIAL_REVERSED = 0xEDB88320
  let crc = 0xFFFFFFFF
  while (index !== str.length) {
    crc = crc ^ str.charCodeAt(index++)
    crc = (crc >>> 1) ^ (CRC32_POLYNOMIAL_REVERSED & -(crc & 1))
    crc = (crc >>> 1) ^ (CRC32_POLYNOMIAL_REVERSED & -(crc & 1))
    crc = (crc >>> 1) ^ (CRC32_POLYNOMIAL_REVERSED & -(crc & 1))
    crc = (crc >>> 1) ^ (CRC32_POLYNOMIAL_REVERSED & -(crc & 1))
    crc = (crc >>> 1) ^ (CRC32_POLYNOMIAL_REVERSED & -(crc & 1))
    crc = (crc >>> 1) ^ (CRC32_POLYNOMIAL_REVERSED & -(crc & 1))
    crc = (crc >>> 1) ^ (CRC32_POLYNOMIAL_REVERSED & -(crc & 1))
    crc = (crc >>> 1) ^ (CRC32_POLYNOMIAL_REVERSED & -(crc & 1))
  }
  return ~crc
}

const f64 = new Float64Array(1)
const i8 = new Uint8Array(f64.buffer)

const BASE64_VALUE_TABLE = new Uint8Array([
  // 0x0n
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  // 0x1n
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  // 0x2n
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 62, -1, -1, -1, 63,
  // 0x3n
  52, 53, 54, 55, 56, 57, 58, 59, 60, 61, -1, -1, -1, -1, -1, -1,
  // 0x4n
  -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
  // 0x5n
  15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, -1, -1, -1, -1, -1,
  // 0x6n
  -1, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
  // 0x7n
  41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, -1, -1, -1, -1, -1,
])

const BASE64_CHAR_TABLE = new Uint8Array([
  0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37,
  0x38, 0x39, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46,
  0x47, 0x48, 0x49, 0x4a, 0x4b, 0x4c, 0x4d, 0x4e,
  0x4f, 0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56,
  0x57, 0x58, 0x59, 0x5a, 0x61, 0x62, 0x63, 0x64,
  0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x6b, 0x6c,
  0x6d, 0x6e, 0x6f, 0x70, 0x71, 0x72, 0x73, 0x74,
  0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x2b, 0x2f,
])

export function readLinkV1(link) {
  // Read the checksum and verify it.
  const checksumText = atob(link.slice(0, 6) + "==")
  const checksum = (
    checksumText.charCodeAt(0) << 24 |
    checksumText.charCodeAt(1) << 16 |
    checksumText.charCodeAt(2) << 8 |
    checksumText.charCodeAt(3)
  )
  if (checksum !== computeChecksum(link, 6)) fail()
  link = lz.decompressFromEncodedURIComponent(link.slice(6))
  let index = 0

  function readChar() {
    if (index === link.length) return fail()
    return index < link.length ? link.charCodeAt(index++) : fail()
  }

  function read64() {
    const ch = readChar()
    if (ch < 0x80) {
      const code = BASE64_VALUE_TABLE[ch]
      if (code >= 0) return code
    }
    return fail()
  }

  function readInt() {
    let value = 0
    let ch = 0

    do {
      ch = read64()
      value = (value << 5) | (ch >>> 1)
    } while (ch & 1)

    return value
  }

  function readString(length) {
    return index + length < link.length
      ? link.slice(index, index += length)
      : fail()
  }

  function readDouble() {
    if (index + 11 < link.length) return fail()
    const chars = atob(link.slice(index, index += 11) + "=")
    for (let i = 0; i < 8; i++) i8[i] = chars.charCodeAt(i)
    return f64[0]
  }

  function readList(func) {
    const list = new Array(readInt())
    for (let i = 0; i < list.length; i++) list[i] = func(i)
    return list
  }

  const flags = read64()
  const console = (flags & 1) !== 0,
  const autoReload = (flags & 2) !== 0,
  const middle = readDouble(),
  const selected = readInt(),
  const files = rangeMap(() => ({
    compiler: read64(),
    name: readInt(),
    content: readInt()
  })),
  const links = rangeMap(() => ({
    type: read64(),
    name: readInt(),
    url: readInt(),
    patches: rangeMap(() => [
      rangeMap(() => [readInt(), readInt()]),
      [
        readInt(), // length1
        readInt(), // length2
        readInt(), // start1
        readInt() // start2
      ]
    ])
  }))

  return {
    console, autoReload, middle,
    selected: readString(selected),
    files: files.map(file => ({
      compiler: COMPILER_TABLE[file.type],
      name: readString(file.name),
      content: readString(file.content)
    })),
    links: links.map(link => ({
      type: TYPE_TABLE[link.type],
      name: readString(link.name),
      url: readString(link.url),
      patches: link.patches.map(([patches, rest]) =>
        patches.map(pair => [pair[0] + 1, readString(pair[1])])
        .concat(rest)
      )
    }))
  }
}

export function writeLinkV1(state) {
  let link = ""
  let table = ""

  function writeChar(code) {
    link += String.fromCharCode(code)
  }

  function write64(code) {
    if (code < 64) writeChar(BASE64_CHAR_TABLE[code])
    else throw new TypeError("impossible")
  }

  // This encodes variable-length integers up to 2^32 - 1
  function writeInt(value) {
    // Grab the top 2 bits if applicable, and remove them if necessary.
    if (value & 0xc0000000) {
      write64(value >>> 30 | 1)
      value <<= 2
    } else {
      // Chop off leading zeroes to remove redundant bytes.
      while ((value & 0xf8000000) === 0) value <<= 5
    }
    let prev = value >>> 26 // 32 - 5 - 1
    value <<= 5
    while (value & 0xf8000000) {
      write64(prev | 1)
      prev = value >>> 26 // 32 - 5 - 1
      value <<= 5
    }
    write64(prev & 0x3e) // Chop off the last bit.
  }

  function writeString(string) {
    writeInt(string.length)
    table += string
  }

  function writeList(list, func, len = list.length) {
    writeInt(len)
    for (let i = 0; i < len; i++) func(list[i])
  }

  function writeDouble(value) {
    f64[0] = value
    link += btoa(String.fromCharCode.apply(null, i8)).slice(0, -1)
  }

  write64(ref,
    ((state.console ? 1 : 0) << 0) |
    ((state.autoReload ? 1 : 0) << 1)
  )
  writeDouble(state.middle)
  writeString(state.selected)
  writeList(state.files, file => {
    writeChar(Math.max(0, COMPILER_TABLE.indexOf(file.compiler)))
    writeString(file.name)
    writeString(file.content)
  })

  writeList(state.links, link => {
    writeChar(Math.max(0, TYPE_TABLE.indexOf(link.type)))
    writeString(link.name)
    writeString(link.url)
    writeList(link.patches, list => {
      writeList(list, ([type, contents]) => {
        writeChar(type + 1)
        writeString(contents[1])
      }, list.length - 4)

      writeChar(list[list.length - 4])
      writeChar(list[list.length - 3])
      writeChar(list[list.length - 2])
      writeChar(list[list.length - 1])
    })
  })
  const checksum = computeChecksum(link, 0)
  // We only need 6 bytes, so we don't need the equal signs to discriminate.
  return btoa(
    String.fromCharCode(checksum >>> 24) +
    String.fromCharCode((checksum >>> 16) & 0xFF) +
    String.fromCharCode((checksum >>> 8) & 0xFF) +
    String.fromCharCode(checksum & 0xFF)
  ).slice(0, -2) + link + lz.compressToEncodedURIComponent(table)
}
