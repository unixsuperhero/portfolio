/** Just enough JSON Schema to check tool arguments and say what was wrong. */

/** The package's canonical object guard: proves an object, not its fields. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export type SchemaType = "object" | "string" | "integer" | "number" | "boolean" | "array" | "null";

export interface JsonSchema {
  /** A single type, or a list when a value may be more than one (e.g. `["string", "null"]`). */
  type?: SchemaType | readonly SchemaType[];
  description?: string;
  default?: unknown;
  enum?: readonly unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  items?: JsonSchema;
  additionalProperties?: boolean;
}

const typesOf = (schema: JsonSchema): readonly SchemaType[] => {
  const type = schema.type;
  if (type === undefined) return [];
  return typeof type === "string" ? [type] : type;
};

const allowsNull = (schema?: JsonSchema): boolean =>
  schema !== undefined && (typesOf(schema).includes("null") || (schema.enum ?? []).includes(null));

/** Returns one message per problem; an empty array means the arguments are usable. */
export function validateArgs(schema: JsonSchema, args: unknown): string[] {
  const value = args === undefined || args === null ? {} : args;
  if (!isRecord(value)) return ["arguments must be an object"];
  const object = value;
  const problems: string[] = [];
  for (const key of schema.required ?? []) {
    const entry = object[key];
    if (entry === undefined || (entry === null && !allowsNull(schema.properties?.[key]))) {
      problems.push(`missing required property "${key}"`);
    }
  }
  for (const [key, entry] of Object.entries(object)) {
    const property = schema.properties?.[key];
    if (!property) {
      if (schema.additionalProperties === false) problems.push(`unknown property "${key}"`);
      continue;
    }
    // An explicit null on an optional property means "not set"; only required properties care.
    if (entry === undefined || entry === null) continue;
    problems.push(...checkValue(key, property, entry));
  }
  return problems;
}

function checkValue(key: string, schema: JsonSchema, value: unknown): string[] {
  const types = typesOf(schema);
  if (types.length && !types.some(type => matchesType(type, value))) {
    return [`"${key}" must be ${types.join(" or ")}`];
  }
  const problems: string[] = [];
  if (schema.enum && !schema.enum.includes(value)) {
    problems.push(`"${key}" must be one of ${schema.enum.map(entry => JSON.stringify(entry)).join(", ")}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) problems.push(`"${key}" must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) problems.push(`"${key}" must be <= ${schema.maximum}`);
  }
  if (typeof value === "string" && schema.minLength !== undefined && value.length < schema.minLength) {
    problems.push(`"${key}" must not be empty`);
  }
  return problems;
}

function matchesType(type: SchemaType, value: unknown): boolean {
  switch (type) {
    case "string": return typeof value === "string";
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "number": return typeof value === "number";
    case "boolean": return typeof value === "boolean";
    case "array": return Array.isArray(value);
    case "object": return isRecord(value);
    case "null": return value === null;
  }
}
