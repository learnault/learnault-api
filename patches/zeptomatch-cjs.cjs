/**
 * Minimal CJS zeptomatch-compatible glob matcher.
 * Implements the subset of zeptomatch's API used by @prisma/dev:
 *   zeptomatch(pattern, path) → boolean
 */
'use strict'

const SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/g

function escapeRegex(str) {
  return str.replace(SPECIAL_CHARS, '\\$&')
}

function compile(pattern) {
  let regexStr = '^'
  let i = 0
  const len = pattern.length

  while (i < len) {
    const ch = pattern[i]

    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // ** — match anything including /
        regexStr += '.*'
        i += 2
        if (pattern[i] === '/') i++ // skip trailing slash after **/
      } else {
        // * — match anything except /
        regexStr += '[^/]*'
        i++
      }
    } else if (ch === '?') {
      regexStr += '[^/]'
      i++
    } else if (ch === '{') {
      // Find closing brace
      let j = i + 1
      let depth = 1
      while (j < len && depth > 0) {
        if (pattern[j] === '{') depth++
        else if (pattern[j] === '}') depth--
        j++
      }
      const alternatives = pattern.slice(i + 1, j - 1).split(',')
      regexStr += '(' + alternatives.map(escapeRegex).join('|') + ')'
      i = j
    } else if (ch === '[') {
      let j = i + 1
      while (j < len && pattern[j] !== ']') j++
      regexStr += pattern.slice(i, j + 1)
      i = j + 1
    } else if (ch === '\\') {
      regexStr += escapeRegex(pattern[i + 1])
      i += 2
    } else {
      regexStr += escapeRegex(ch)
      i++
    }
  }

  regexStr += '$'
  return new RegExp(regexStr)
}

const cache = new Map()

function zeptomatch(pattern, path, options) {
  if (typeof pattern !== 'string') return false
  let re = cache.get(pattern)
  if (!re) {
    re = compile(pattern)
    cache.set(pattern, re)
  }
  return re.test(path)
}

zeptomatch.compile = function compileGlob(pattern, options) {
  if (typeof pattern === 'string') {
    return { test: (path) => zeptomatch(pattern, path, options) }
  }
  return { test: () => false }
}

module.exports = zeptomatch
module.exports.default = zeptomatch
