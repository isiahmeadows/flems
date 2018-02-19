import lz from 'lz-string'

import { readLinkV1 } from "./link-v1"

export function endsWith(suffix, str) {
  return str.indexOf(suffix, str.length - suffix.length) > -1
}

export function assign(obj, obj2) {
  for (const key in obj2) {
    if (Object.prototype.hasOwnProperty.call(obj2, key))
      obj[key] = obj2[key]
  }
  return obj
}

export function readFlemsIoLink(link) {
  if (link == null) return null
  // Strip the 'https://flems.io/#' prefix
  if (link.slice(0, 18) === 'https://flems.io/#') link = link.slice(18)
  const index = link.indexOf("=")
  if (index < 0) return null

  const type = parseInt(link.slice(0, index), 10)
  const compressed = link.slice(index + 1)

  // Let's tolerate errors in the URL.
  try {
    if (type === 0) {
      return JSON.parse(lz.decompressFromEncodedURIComponent(compressed))
    } else if (type === 1) {
      return readLinkV1(compressed)
    } else {
      return null
    }
  } catch (_) {
    // Maybe, alert user that the hash couldn't be read or something?
    return null
  }
}

export function createFlemsIoLink(state) {
  return 'https://flems.io/#0=' + lz.compressToEncodedURIComponent(
    JSON.stringify(state)
  )
}

export function find(fn, array) {
  for (let i = 0, match; i < array.length; i++) {
    if (match = fn(array[i])) return match
  }
  return undefined
}

export const ext = f => {
  const index = f.lastIndexOf('.') + 1
  return index ? f.slice(index) : undefined
}

export const isJs = f => endsWith('.js', f)
export const isTs = f => endsWith('.ts', f)
export const isLs = f => endsWith('.ls', f)
export const isCoffee = f => endsWith('.coffee', f)
export const isCss = f => endsWith('.css', f)
export const isHtml = f => endsWith('.html', f)
export const isScript = f => isJs(f) || isTs(f) || isLs(f) || isCoffee(f)

export const urlRegex = /^https?:\/\//
export const filenameRegex = /^[\w-_.]*$/
