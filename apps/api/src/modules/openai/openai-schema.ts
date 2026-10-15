export type JsonSchema = Record<string, unknown>;

/** Converts the shared prompt schema into OpenAI Structured Outputs strict-mode JSON Schema. */
export function toStrictJsonSchema(schema: JsonSchema): JsonSchema {
  const result: JsonSchema = {};
  const type = typeof schema.type === 'string' ? schema.type.toLowerCase() : undefined;
  if (type) result.type = type;
  else if (Array.isArray(schema.type)) result.type = schema.type.map(value => typeof value === 'string' ? value.toLowerCase() : value);

  if (schema.description !== undefined) result.description = schema.description;
  if (Array.isArray(schema.enum)) result.enum = schema.enum;

  if (schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)) {
    const properties = schema.properties as Record<string, JsonSchema>;
    result.properties = Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, toStrictJsonSchema(value)]));
    result.required = Object.keys(properties);
    result.additionalProperties = false;
  }

  if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
    result.items = toStrictJsonSchema(schema.items as JsonSchema);
  }

  return result;
}
