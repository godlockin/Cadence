/**
 * @cadence/nodes — minimal JMESPath subset evaluator.
 *
 * Supports the expression surface needed by common data-transform flows:
 *   - identifiers & dotted paths (`a.b.c`, auto-projection over arrays)
 *   - index access (`[0]`, `[-1]`)
 *   - list projections (`[*]` wildcard, `[]` flatten)
 *   - pipes (`a | b`) with `@` referring to the piped value
 *   - literals: numbers, strings, booleans, null
 *
 * Functions (`length()`, `sort()`, ...) and multi-select are out of scope;
 * TODO: swap in the real `jmespath` npm package in a later phase.
 */

export class JmesPathError extends Error {
  constructor(
    public readonly expression: string,
    public readonly reason: string,
  ) {
    super(`Invalid JMESPath '${expression}': ${reason}`)
    this.name = 'JmesPathError'
  }
}

type Token =
  | { type: 'ident'; value: string }
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'dot' }
  | { type: 'lbr'; value: '[' | '[*]' | '[]' }
  | { type: 'rbr' }
  | { type: 'pipe' }
  | { type: 'at' }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'comma' }

type Ast =
  | { type: 'current' }
  | { type: 'literal'; value: unknown }
  | { type: 'field'; name: string }
  | { type: 'index'; index: number }
  | { type: 'wildcard' }
  | { type: 'flatten' }
  | { type: 'dot'; steps: Ast[] }
  | { type: 'pipe'; left: Ast; right: Ast }

const STRING_RE = /^(['"])(?:\\.|(?!\1).)*\1/

export function tokenize(expr: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < expr.length) {
    const c = expr[i]
    if (c === undefined) break
    if (/\s/.test(c)) {
      i += 1
      continue
    }
    if (c === '.') {
      tokens.push({ type: 'dot' })
      i += 1
      continue
    }
    if (c === '@') {
      tokens.push({ type: 'at' })
      i += 1
      continue
    }
    if (c === '|') {
      tokens.push({ type: 'pipe' })
      i += 1
      continue
    }
    if (c === '(') {
      tokens.push({ type: 'lparen' })
      i += 1
      continue
    }
    if (c === ')') {
      tokens.push({ type: 'rparen' })
      i += 1
      continue
    }
    if (c === ',') {
      tokens.push({ type: 'comma' })
      i += 1
      continue
    }
    if (c === '[') {
      if (expr[i + 1] === '*') {
        tokens.push({ type: 'lbr', value: '[*]' })
        i += 2
      } else if (expr[i + 1] === ']') {
        tokens.push({ type: 'lbr', value: '[]' })
        i += 2
      } else {
        tokens.push({ type: 'lbr', value: '[' })
        i += 1
      }
      continue
    }
    if (c === ']') {
      tokens.push({ type: 'rbr' })
      i += 1
      continue
    }
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(expr[i + 1] ?? ''))) {
      const m = /^-?\d+(\.\d+)?/.exec(expr.slice(i))
      if (!m) throw new JmesPathError(expr, `bad number at '${c}'`)
      tokens.push({ type: 'number', value: Number(m[0]) })
      i += m[0].length
      continue
    }
    const s = STRING_RE.exec(expr.slice(i))
    if (s) {
      tokens.push({ type: 'string', value: parseStringLiteral(s[0]) })
      i += s[0].length
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(expr.slice(i))
      if (!m) throw new JmesPathError(expr, `bad identifier at '${c}'`)
      tokens.push({ type: 'ident', value: m[0] })
      i += m[0].length
      continue
    }
    throw new JmesPathError(expr, `unexpected character '${c}'`)
  }
  return tokens
}

function parseStringLiteral(s: string): string {
  const inner = s.slice(1, -1)
  return inner.replace(/\\(['"\\])/g, '$1')
}

export function parse(expr: string): Ast {
  const tokens = tokenize(expr)
  let pos = 0
  const peek = (): Token | undefined => tokens[pos]
  const next = (): Token | undefined => tokens[pos++]

  function parseExpression(): Ast {
    /* `a | [0]` — a bracket at the very start applies to the current node. */
    let left: Ast = peek()?.type === 'lbr' ? { type: 'current' } : parsePrimary()
    while (true) {
      const t = peek()
      if (t === undefined) break
      if (t.type === 'dot') {
        next()
        const right = parsePrimary()
        left = { type: 'dot', steps: [left, right] }
      } else if (t.type === 'lbr') {
        next()
        const { value: bracket } = t
        if (bracket === '[*]') {
          expectRbr()
          left = { type: 'dot', steps: [left, { type: 'wildcard' }] }
        } else if (bracket === '[]') {
          expectRbr()
          left = { type: 'dot', steps: [left, { type: 'flatten' }] }
        } else {
          const idxTok = next()
          expectRbr()
          if (idxTok?.type !== 'number') throw new JmesPathError(expr, 'expected numeric index')
          left = { type: 'dot', steps: [left, { type: 'index', index: idxTok.value }] }
        }
      } else if (t.type === 'pipe') {
        next()
        const right = parseExpression()
        left = { type: 'pipe', left, right }
        break
      } else {
        break
      }
    }
    return left
  }

  function parsePrimary(): Ast {
    const t = next()
    if (t === undefined) throw new JmesPathError(expr, 'unexpected end of expression')
    switch (t.type) {
      case 'at':
        return { type: 'current' }
      case 'ident':
        return { type: 'field', name: t.value }
      case 'number':
        return { type: 'literal', value: t.value }
      case 'string':
        return { type: 'literal', value: t.value }
      default:
        throw new JmesPathError(expr, `unexpected token '${t.type}'`)
    }
  }

  function expectRbr(): void {
    const t = next()
    if (t?.type !== 'rbr') throw new JmesPathError(expr, 'expected ]')
  }

  const ast = parseExpression()
  if (pos !== tokens.length) {
    throw new JmesPathError(expr, `unexpected trailing tokens after index ${pos}`)
  }
  return ast
}

/** Evaluate a JMESPath expression string against an input value. */
export function search(expr: string, input: unknown): unknown {
  const ast = parse(expr)
  return evalAst(ast, input)
}

function evalAst(ast: Ast, input: unknown): unknown {
  switch (ast.type) {
    case 'current':
      return input
    case 'literal':
      return ast.value
    case 'field':
      return fieldAccess(input, ast.name)
    case 'index':
      return indexAccess(input, ast.index)
    case 'wildcard':
      return Array.isArray(input) ? input : []
    case 'flatten':
      return flattenArray(input)
    case 'dot': {
      let cursor = input
      for (const step of ast.steps) {
        cursor = evalAst(step, cursor)
      }
      return cursor
    }
    case 'pipe': {
      const left = evalAst(ast.left, input)
      return evalAst(ast.right, left)
    }
  }
}

function fieldAccess(input: unknown, name: string): unknown {
  if (input === null || typeof input !== 'object') return null
  if (Array.isArray(input)) {
    return input.map((el) => {
      if (el === null || typeof el !== 'object') return null
      const obj = el as unknown as Record<string, unknown>
      return name in obj ? obj[name] : null
    })
  }
  const obj = input as unknown as Record<string, unknown>
  return name in obj ? obj[name] : null
}

function indexAccess(input: unknown, index: number): unknown {
  if (!Array.isArray(input)) return null
  const i = index < 0 ? input.length + index : index
  return input[i] ?? null
}

function flattenArray(input: unknown): unknown {
  if (!Array.isArray(input)) return null
  const out: unknown[] = []
  for (const el of input) {
    if (Array.isArray(el)) out.push(...el)
    else out.push(el)
  }
  return out
}
