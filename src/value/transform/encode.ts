/*--------------------------------------------------------------------------

@sinclair/typebox/value

The MIT License (MIT)

Copyright (c) 2017-2024 Haydn Paterson (sinclair) <haydn.developer@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

---------------------------------------------------------------------------*/

import { Kind, TransformKind } from '../../type/symbols/index'
import { TypeBoxError } from '../../type/error/index'
import { ValueError } from '../../errors/index'
import { KeyOfPropertyKeys } from '../../type/keyof/index'
import { Index } from '../../type/indexed/index'
import { Deref } from '../deref/index'
import { Check } from '../check/index'

import type { TSchema } from '../../type/schema/index'
import type { TArray } from '../../type/array/index'
import type { TIntersect } from '../../type/intersect/index'
import type { TNot } from '../../type/not/index'
import type { TObject } from '../../type/object/index'
import type { TRecord } from '../../type/record/index'
import type { TRef } from '../../type/ref/index'
import type { TThis } from '../../type/recursive/index'
import type { TTuple } from '../../type/tuple/index'
import type { TUnion } from '../../type/union/index'

// ------------------------------------------------------------------
// ValueGuard
// ------------------------------------------------------------------
import { IsStandardObject, IsArray, IsValueType } from '../guard/index'
// ------------------------------------------------------------------
// TypeGuard
// ------------------------------------------------------------------
import { IsTransform, IsSchema } from '../../type/guard/type'
// ------------------------------------------------------------------
// Errors
// ------------------------------------------------------------------
export class TransformEncodeCheckError extends TypeBoxError {
  constructor(public readonly schema: TSchema, public readonly value: unknown, public readonly error: ValueError) {
    super(`Unable to encode due to invalid value`)
  }
}
export class TransformEncodeError extends TypeBoxError {
  constructor(public readonly schema: TSchema, public readonly value: unknown, error: any) {
    super(`${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}
// ------------------------------------------------------------------
// Encode
// ------------------------------------------------------------------
// prettier-ignore
function Default(schema: TSchema, value: any) {
  try {
    return IsTransform(schema) ? schema[TransformKind].Encode(value) : value
  } catch (error) {
    throw new TransformEncodeError(schema, value, error)
  }
}
// prettier-ignore
function FromArray(schema: TArray, references: TSchema[], value: any): any {
  const defaulted = Default(schema, value)
  return IsArray(defaulted)
    ? defaulted.map((value: any) => Visit(schema.items, references, value))
    : defaulted
}
// prettier-ignore
function FromIntersect(schema: TIntersect, references: TSchema[], value: any) {
  const defaulted = Default(schema, value)
  if (!IsStandardObject(value) || IsValueType(value)) return defaulted
  const knownKeys = KeyOfPropertyKeys(schema) as string[]
  const knownProperties = knownKeys.reduce((value, key) => {
    return key in defaulted 
      ? { ...value, [key]: Visit(Index(schema, [key]), references, value[key]) } 
      : value
  }, defaulted)
  if (!IsTransform(schema.unevaluatedProperties)) {
    return Default(schema, knownProperties)
  }
  const unknownKeys = Object.getOwnPropertyNames(knownProperties)
  const unevaluatedProperties = schema.unevaluatedProperties as TSchema
  return unknownKeys.reduce((value, key) => {
    return !knownKeys.includes(key) 
      ? { ...value, [key]: Default(unevaluatedProperties, value[key]) }  
      : value
  }, knownProperties)
}
// prettier-ignore
function FromNot(schema: TNot, references: TSchema[], value: any) {
  return Default(schema.not, Default(schema, value))
}
// prettier-ignore
function FromObject(schema: TObject, references: TSchema[], value: any) {
  const defaulted = Default(schema, value)
  if (!IsStandardObject(value)) return defaulted
  const knownKeys = KeyOfPropertyKeys(schema) as string[]
  const knownProperties = knownKeys.reduce((value, key) => {
    return key in value 
      ? { ...value, [key]: Visit(schema.properties[key], references, value[key]) } 
      : value
  }, defaulted)
  if (!IsSchema(schema.additionalProperties)) {
    return knownProperties
  }
  const unknownKeys = Object.getOwnPropertyNames(knownProperties)
  const additionalProperties = schema.additionalProperties as TSchema
  return unknownKeys.reduce((value, key) => {
    return !knownKeys.includes(key) 
      ? { ...value, [key]: Default(additionalProperties, value[key]) }  
      : value
  }, knownProperties)
}
// prettier-ignore
function FromRecord(schema: TRecord, references: TSchema[], value: any) {
  const defaulted = Default(schema, value) as Record<PropertyKey, unknown>
  if (!IsStandardObject(value)) return defaulted
  const pattern = Object.getOwnPropertyNames(schema.patternProperties)[0]
  const knownKeys = new RegExp(pattern)
  const knownProperties = Object.getOwnPropertyNames(value).reduce((value, key) => {
    return knownKeys.test(key) 
      ? { ...value, [key]: Visit(schema.patternProperties[pattern], references, value[key]) }
      : value
  }, defaulted)
  if (!IsSchema(schema.additionalProperties)) {
    return Default(schema, knownProperties)
  }
  const unknownKeys = Object.getOwnPropertyNames(knownProperties)
  const additionalProperties = schema.additionalProperties as TSchema
  return unknownKeys.reduce((value, key) => {
    return !knownKeys.test(key) 
      ? { ...value, [key]: Default(additionalProperties, value[key]) }  
      : value
  }, knownProperties)
}
// prettier-ignore
function FromRef(schema: TRef, references: TSchema[], value: any) {
  const target = Deref(schema, references)
  const resolved = Visit(target, references, value)
  return Default(schema, resolved)
}
// prettier-ignore
function FromThis(schema: TThis, references: TSchema[], value: any) {
  const target = Deref(schema, references)
  const resolved = Visit(target, references, value)
  return Default(schema, resolved)
}
// prettier-ignore
function FromTuple(schema: TTuple, references: TSchema[], value: any) {
  const value1 = Default(schema, value)
  return IsArray(schema.items) ? schema.items.map((schema, index) => Visit(schema, references, value1[index])) : []
}
// prettier-ignore
function FromUnion(schema: TUnion, references: TSchema[], value: any) {
  // test value against union variants
  for (const subschema of schema.anyOf) {
    if (!Check(subschema, references, value)) continue
    const value1 = Visit(subschema, references, value)
    return Default(schema, value1)
  }
  // test transformed value against union variants
  for (const subschema of schema.anyOf) {
    const value1 = Visit(subschema, references, value)
    if (!Check(schema, references, value1)) continue
    return Default(schema, value1)
  }
  return Default(schema, value)
}
// prettier-ignore
function Visit(schema: TSchema, references: TSchema[], value: any): any {
  const references_ = typeof schema.$id === 'string' ? [...references, schema] : references
  const schema_ = schema as any
  switch (schema[Kind]) {
    case 'Array':
      return FromArray(schema_, references_, value)
    case 'Intersect':
      return FromIntersect(schema_, references_, value)
    case 'Not':
      return FromNot(schema_, references_, value)
    case 'Object':
      return FromObject(schema_, references_, value)
    case 'Record':
      return FromRecord(schema_, references_, value)
    case 'Ref':
      return FromRef(schema_, references_, value)
    case 'This':
      return FromThis(schema_, references_, value)
    case 'Tuple':
      return FromTuple(schema_, references_, value)
    case 'Union':
      return FromUnion(schema_, references_, value)
    default:
      return Default(schema_, value)
  }
}
/**
 * `[Internal]` Encodes the value and returns the result. This function expects the
 * caller to pass a statically checked value. This function does not check the encoded
 * result, meaning the result should be passed to `Check` before use. Refer to the
 * `Value.Encode()` function for implementation details.
 */
export function TransformEncode(schema: TSchema, references: TSchema[], value: unknown): unknown {
  return Visit(schema, references, value)
}
