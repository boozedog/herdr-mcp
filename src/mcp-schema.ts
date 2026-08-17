/**
 * Shared helper to expose Effect v4 schemas to the MCP SDK v2.
 *
 * The MCP SDK's `registerTool` requires a Standard Schema v1 (`~standard.validate`)
 * combined with a Standard JSON Schema v1 converter (`~standard.jsonSchema`) so it
 * can both validate `tools/call` arguments and advertise the argument shape in
 * `tools/list`. Effect provides two conversion entry points:
 *
 *   - `Schema.toStandardSchemaV1(schema)`  -> StandardSchemaV1 & schema
 *   - `Schema.toStandardJSONSchemaV1(...)` -> StandardJSONSchemaV1 & schema
 *
 * Wrapping one inside the other yields a value carrying both `~standard.validate`
 * and `~standard.jsonSchema`, which is exactly what the SDK accepts.
 */
import { Schema } from "effect";
import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";

export type McpInputSchema = StandardSchemaWithJSON;

/** Wrap an Effect schema so it satisfies MCP SDK v2's `inputSchema` contract. */
export function toMcpInputSchema<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
): StandardSchemaWithJSON {
  return Schema.toStandardJSONSchemaV1(
    Schema.toStandardSchemaV1(schema),
  ) as unknown as StandardSchemaWithJSON;
}

/**
 * Convenience: schema for tools with no arguments. `Schema.Struct({})` advertises
 * a noisy `anyOf: [{type:object},{type:array}]`; a string-keyed record of unknown
 * values yields a clean `{"type":"object"}`.
 */
export const NoArgs = Schema.Record(Schema.String, Schema.Unknown);
