import { Schema } from "effect";

export const BusyPeerPolicy = Schema.Literal("refuse");
export type BusyPeerPolicy = typeof BusyPeerPolicy.Type;

export const PairingStrategy = Schema.Literal("role-suffix");
export type PairingStrategy = typeof PairingStrategy.Type;

export const RoundMode = Schema.Union([
  Schema.Literal("submit"),
  Schema.Literal("respond"),
]);
export type RoundMode = typeof RoundMode.Type;

export const EdgePairMode = Schema.Union([
  Schema.Literal("suffix"),
  Schema.Literal("unsuffixed"),
]);
export type EdgePairMode = typeof EdgePairMode.Type;

export const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
export type PositiveInt = typeof PositiveInt.Type;

export const DefaultsSchema = Schema.Struct({
  timeout_ms: Schema.optional(Schema.Number),
  read_lines: Schema.optional(Schema.Number),
  busy_peer: Schema.optional(BusyPeerPolicy),
  max_rounds: Schema.optional(PositiveInt),
});

export const PairingSchema = Schema.Struct({
  strategy: Schema.optional(PairingStrategy),
});

export const RoleSchema = Schema.Struct({
  id: Schema.String,
  match: Schema.String,
  mutate: Schema.Boolean,
});

export const EdgeSchema = Schema.Struct({
  id: Schema.String,
  from: Schema.String,
  to: Schema.String,
  tool: Schema.optional(Schema.Boolean),
  round: Schema.optional(RoundMode),
  pair: Schema.optional(EdgePairMode),
});

export const EnvelopeSchema = Schema.Struct({
  required: Schema.optional(Schema.Array(Schema.String)),
});

export const WorkflowConfigSchema = Schema.Struct({
  preset: Schema.optional(Schema.String),
  defaults: Schema.optional(DefaultsSchema),
  pairing: Schema.optional(PairingSchema),
  roles: Schema.Array(RoleSchema),
  edges: Schema.Array(EdgeSchema),
  envelope: Schema.optional(EnvelopeSchema),
});

export type Defaults = typeof DefaultsSchema.Type;
export type Role = typeof RoleSchema.Type;
export type Edge = typeof EdgeSchema.Type;
export type WorkflowConfig = typeof WorkflowConfigSchema.Type;

export type LoadedWorkflow = {
  name: string;
  config_path: string | null;
  defaults: Required<Pick<Defaults, "timeout_ms" | "read_lines" | "max_rounds">> & {
    busy_peer: BusyPeerPolicy;
  };
  pairing: { strategy: PairingStrategy };
  roles: readonly Role[];
  edges: readonly Edge[];
  envelope?: typeof EnvelopeSchema.Type;
};
