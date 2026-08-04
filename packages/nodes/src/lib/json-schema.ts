/**
 * @cadence/nodes — minimal JSON Schema (draft-07 subset) validator.
 *
 * Supports the keyword surface needed by the `zod-schema` validation nodes:
 *   - `type`, `required`, `properties`, `additionalProperties`
 *   - `items` (single schema), `enum`, `const`
 *   - numeric: `minimum`/`maximum`/`exclusiveMinimum`/`exclusiveMaximum`
 *   - string: `minLength`/`maxLength`/`pattern`
 *   - `anyOf` / `oneOf` (first-match semantics)
 *
 * Full JSON Schema (references, conditional, multiple-of, formats) is
 * out of scope; TODO: swap in `ajv` when the package gains it.
 */

export interface JsonSchema {
  readonly type?: string | readonly string[]
  readonly required?: readonly string[]
  readonly properties?: Readonly<Record<string, JsonSchema>>
  readonly additionalProperties?: boolean
  readonly items?: JsonSchema
  readonly enum?: readonly unknown[]
  readonly const?: unknown
  readonly minimum?: number
  readonly maximum?: number
  readonly exclusiveMinimum?: number
  readonly exclusiveMaximum?: number
  readonly minLength?: number
  readonly maxLength?: number
  readonly pattern?: string
  readonly anyOf?: readonly JsonSchema[]
  readonly oneOf?: readonly JsonSchema[]
  readonly [k: string]: unknown
}

export interface SchemaValidationError {
  readonly path: string
  readonly message: string
}

/** Validate `value` against `schema`. Returns a list of errors (empty = valid). */
export function validateWithSchema(schema: JsonSchema, value: unknown): SchemaValidationError[] {
  return validate(schema, value, '$')
}

function validate(schema: JsonSchema, value: unknown, path: string): SchemaValidationError[] {
  const errors: SchemaValidationError[] = []

  if (schema.const !== undefined) {
    if (!deepEqual(schema.const, value)) {
      errors.push({ path, message: `expected const ${JSON.stringify(schema.const)}` })
    }
  }

  if (schema.enum !== undefined) {
    if (!schema.enum.some((v) => deepEqual(v, value))) {
      errors.push({ path, message: `value not in enum` })
    }
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.includes(jsonTypeOf(value))) {
      errors.push({ path, message: `expected type ${types.join(' | ')}` })
      /* stop deep checks when the container type is wrong */
      return errors
    }
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    if (!schema.anyOf.some((sub) => validate(sub, value, path).length === 0)) {
      errors.push({ path, message: 'does not match any anyOf branch' })
    }
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    const passCount = schema.oneOf.filter((sub) => validate(sub, value, path).length === 0).length
    if (passCount !== 1) {
      errors.push({ path, message: `expected exactly one oneOf branch, matched ${passCount}` })
    }
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as unknown as Record<string, unknown>
    if (schema.required !== undefined) {
      for (const key of schema.required) {
        if (!(key in obj)) {
          errors.push({ path: `${path}.${key}`, message: 'is required' })
        }
      }
    }
    const props = schema.properties ?? {}
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj) {
        errors.push(...validate(sub, obj[key], `${path}.${key}`))
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in props)) {
          errors.push({ path: `${path}.${key}`, message: 'is not an allowed additional property' })
        }
      }
    }
  }

  if (Array.isArray(value)) {
    if (schema.items !== undefined) {
      value.forEach((item, i) => {
        errors.push(...validate(schema.items as JsonSchema, item, `${path}[${i}]`))
      })
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({ path, message: `expected >= ${schema.minimum}` })
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({ path, message: `expected <= ${schema.maximum}` })
    }
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      errors.push({ path, message: `expected > ${schema.exclusiveMinimum}` })
    }
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) {
      errors.push({ path, message: `expected < ${schema.exclusiveMaximum}` })
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({ path, message: `length < ${schema.minLength}` })
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push({ path, message: `length > ${schema.maxLength}` })
    }
    if (schema.pattern !== undefined) {
      try {
        if (!new RegExp(schema.pattern).test(value)) {
          errors.push({ path, message: `does not match pattern ${schema.pattern}` })
        }
      } catch {
        errors.push({ path, message: `invalid pattern ${schema.pattern}` })
      }
    }
  }

  return errors
}

function jsonTypeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, (b as unknown[])[i]))
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ao = a as unknown as Record<string, unknown>
    const bo = b as unknown as Record<string, unknown>
    const keysA = Object.keys(ao)
    const keysB = Object.keys(bo)
    if (keysA.length !== keysB.length) return false
    return keysA.every((k) => deepEqual(ao[k], bo[k]))
  }
  return false
}
