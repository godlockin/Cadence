/**
 * @cadence/nodes — minimal JSONata subset evaluator.
 *
 * Supports the common expression surface for data transforms:
 *   - `$` current input, `$.a.b` dotted access
 *   - bare identifier access (`a.b`)
 *   - array index (`[0]`, `[-1]`)
 *   - string concat (`&`), numeric arithmetic (`+ - * / %`)
 *   - literals: numbers, strings, booleans, null
 *
 * JSONata's full power (functions, path wildcards, grouping, transformations)
 * is out of scope; TODO: swap in the `jsonata` npm package in a later phase.
 */

export class JsonataError extends Error {
  constructor(
    public readonly expression: string,
    public readonly reason: string,
  ) {
    super(`Invalid JSONata '${expression}': ${reason}`)
    this.name = 'JsonataError'
  }
}

type JsonataAst =
  | { type: 'input' }
  | { type: 'literal'; value: unknown }
  | { type: 'field'; name: string; steps: readonly JsonataAst[] }
  | { type: 'binop'; op: string; left: JsonataAst; right: JsonataAst }

class Parser {
  private pos = 0

  constructor(private readonly expr: string) {}

  private peek(): string | undefined {
    this.skipWs()
    return this.expr[this.pos]
  }

  private skipWs(): void {
    while (this.pos < this.expr.length && /\s/.test(this.expr[this.pos] ?? '')) this.pos += 1
  }

  private take(): string | undefined {
    this.skipWs()
    const c = this.expr[this.pos]
    if (c !== undefined) this.pos += 1
    return c
  }

  private error(reason: string): never {
    throw new JsonataError(this.expr, reason)
  }

  parse(): JsonataAst {
    const ast = this.additive()
    this.skipWs()
    if (this.pos < this.expr.length) {
      this.error(`unexpected trailing character '${this.expr[this.pos]}'`)
    }
    return ast
  }

  private additive(): JsonataAst {
    let left = this.multiplicative()
    while (true) {
      const op = this.peek()
      if (op === '+' || op === '-') {
        this.take()
        const right = this.multiplicative()
        left = { type: 'binop', op, left, right }
      } else {
        return left
      }
    }
  }

  private multiplicative(): JsonataAst {
    let left = this.concat()
    while (true) {
      const op = this.peek()
      if (op === '*' || op === '/' || op === '%') {
        this.take()
        const right = this.concat()
        left = { type: 'binop', op, left, right }
      } else {
        return left
      }
    }
  }

  private concat(): JsonataAst {
    let left = this.unary()
    while (this.peek() === '&') {
      this.take()
      const right = this.unary()
      left = { type: 'binop', op: '&', left, right }
    }
    return left
  }

  private unary(): JsonataAst {
    if (this.peek() === '-') {
      this.take()
      const operand = this.unary()
      return { type: 'binop', op: '*', left: { type: 'literal', value: -1 }, right: operand }
    }
    return this.postfix()
  }

  private postfix(): JsonataAst {
    let node = this.primary()
    while (true) {
      const c = this.peek()
      if (c === '.') {
        this.take()
        const name = this.readIdent()
        node = this.appendStep(node, name)
      } else if (c === '[') {
        this.take()
        const idx = this.readNumber()
        if (idx === undefined) this.error('expected numeric index in []')
        this.expect(']')
        node = { type: 'field', name: '', steps: [node, { type: 'literal', value: idx }] }
      } else {
        return node
      }
    }
  }

  private appendStep(node: JsonataAst, name: string): JsonataAst {
    if (node.type === 'field') {
      return {
        type: 'field',
        name: node.name,
        steps: [...node.steps, { type: 'field', name, steps: [] }],
      }
    }
    return { type: 'field', name, steps: [node] }
  }

  private primary(): JsonataAst {
    const c = this.peek()
    if (c === undefined) this.error('unexpected end of expression')
    if (c === '$') {
      this.take()
      return { type: 'input' }
    }
    if (c === "'") {
      this.take()
      return { type: 'literal', value: this.readSingleQuote() }
    }
    if (c === '"') {
      this.take()
      return { type: 'literal', value: this.readDoubleQuote() }
    }
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(this.expr[this.pos + 1] ?? ''))) {
      const n = this.readNumber()
      if (n === undefined) this.error('bad number')
      return { type: 'literal', value: n }
    }
    if (/[A-Za-z_]/.test(c)) {
      const name = this.readIdent()
      if (name === 'true') return { type: 'literal', value: true }
      if (name === 'false') return { type: 'literal', value: false }
      if (name === 'null') return { type: 'literal', value: null }
      return { type: 'field', name, steps: [] }
    }
    this.error(`unexpected character '${c}'`)
  }

  private readIdent(): string {
    const m = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(this.expr.slice(this.pos))
    if (!m) this.error('expected identifier')
    this.pos += m[0].length
    return m[0]
  }

  private readNumber(): number | undefined {
    this.skipWs()
    const m = /^-?\d+(\.\d+)?/.exec(this.expr.slice(this.pos))
    if (!m) return undefined
    this.pos += m[0].length
    return Number(m[0])
  }

  private readSingleQuote(): string {
    const start = this.pos
    while (this.pos < this.expr.length && this.expr[this.pos] !== "'") this.pos += 1
    if (this.pos >= this.expr.length) this.error('unterminated single-quoted string')
    this.pos += 1
    return this.expr.slice(start, this.pos - 1)
  }

  private readDoubleQuote(): string {
    const start = this.pos
    while (this.pos < this.expr.length && this.expr[this.pos] !== '"') this.pos += 1
    if (this.pos >= this.expr.length) this.error('unterminated double-quoted string')
    this.pos += 1
    return this.expr.slice(start, this.pos - 1)
  }

  private expect(expected: string): void {
    const c = this.take()
    if (c !== expected) this.error(`expected '${expected}'`)
  }
}

/** Evaluate a JSONata expression string against an input value. */
export function evaluate(expr: string, input: unknown): unknown {
  const ast = new Parser(expr).parse()
  return evalAst(ast, input)
}

function evalAst(ast: JsonataAst, input: unknown): unknown {
  switch (ast.type) {
    case 'input':
      return input
    case 'literal':
      return ast.value
    case 'field': {
      let cursor = input
      if (ast.name !== '') cursor = fieldAccess(cursor, ast.name)
      for (const step of ast.steps) {
        if (step.type === 'literal') {
          const idx = step.value
          if (typeof idx === 'number') {
            cursor = Array.isArray(cursor)
              ? (cursor[idx < 0 ? cursor.length + idx : idx] ?? null)
              : null
          }
        } else if (step.type === 'field') {
          cursor = fieldAccess(cursor, step.name)
        } else {
          cursor = evalAst(step, cursor)
        }
      }
      return cursor
    }
    case 'binop':
      return applyBinop(ast, input)
  }
}

function applyBinop(ast: Extract<JsonataAst, { type: 'binop' }>, input: unknown): unknown {
  const left = evalAst(ast.left, input)
  const right = evalAst(ast.right, input)
  switch (ast.op) {
    case '&':
      return `${left ?? ''}${right ?? ''}`
    case '+':
      return asNumber(left) + asNumber(right)
    case '-':
      return asNumber(left) - asNumber(right)
    case '*':
      return asNumber(left) * asNumber(right)
    case '/':
      return asNumber(left) / asNumber(right)
    case '%':
      return asNumber(left) % asNumber(right)
  }
}

function asNumber(v: unknown): number {
  if (typeof v === 'number') return v
  const n = Number(v)
  return Number.isNaN(n) ? 0 : n
}

function fieldAccess(input: unknown, name: string): unknown {
  if (input === null || typeof input !== 'object') return null
  if (Array.isArray(input)) {
    return input.map((el) => (el !== null && typeof el === 'object' ? fieldAccess(el, name) : null))
  }
  const obj = input as unknown as Record<string, unknown>
  return name in obj ? obj[name] : null
}
