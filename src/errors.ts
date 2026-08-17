import { Schema } from "effect";

/** Returned when the MCP server is not running inside a Herdr pane. */
export class NotInHerdr extends Schema.TaggedError<NotInHerdr>()("not_in_herdr", {
  message: Schema.String,
}) {}

export class InvalidConfig extends Schema.TaggedError<InvalidConfig>()("invalid_config", {
  message: Schema.String,
  path: Schema.String,
  schema_path: Schema.String,
  detail: Schema.optional(Schema.String),
}) {}

export class UnknownTarget extends Schema.TaggedError<UnknownTarget>()("unknown_target", {
  message: Schema.String,
  target: Schema.optional(Schema.String),
}) {}

export class UnknownEdge extends Schema.TaggedError<UnknownEdge>()("unknown_edge", {
  message: Schema.String,
  edge: Schema.String,
}) {}

export class BusyPeer extends Schema.TaggedError<BusyPeer>()("busy_peer", {
  message: Schema.String,
  pane_id: Schema.String,
  agent_status: Schema.String,
}) {}

export class WrongRole extends Schema.TaggedError<WrongRole>()("wrong_role", {
  message: Schema.String,
  expected_role: Schema.String,
  actual_role: Schema.String,
}) {}

export class PromptStalled extends Schema.TaggedError<PromptStalled>()("prompt_stalled", {
  message: Schema.String,
  pane_id: Schema.String,
}) {}

export class ParseFailed extends Schema.TaggedError<ParseFailed>()("parse_failed", {
  message: Schema.String,
  stdout: Schema.optional(Schema.String),
}) {}

export class ConfirmationError extends Schema.TaggedError<ConfirmationError>()("confirmation_error", {
  message: Schema.String,
  pane_id: Schema.String,
  detail: Schema.optional(Schema.String),
}) {}

export type HerdrMcpError =
  | NotInHerdr
  | InvalidConfig
  | UnknownTarget
  | UnknownEdge
  | BusyPeer
  | WrongRole
  | PromptStalled
  | ParseFailed
  | ConfirmationError;

export const NOT_IN_HERDR_MESSAGE =
  "Not running inside Herdr. Start this MCP server from a Herdr pane with HERDR_ENV=1.";

export function notInHerdrError(): NotInHerdr {
  return new NotInHerdr({ message: NOT_IN_HERDR_MESSAGE });
}

const encoders = {
  not_in_herdr: Schema.encodeUnknownSync(NotInHerdr),
  invalid_config: Schema.encodeUnknownSync(InvalidConfig),
  unknown_target: Schema.encodeUnknownSync(UnknownTarget),
  unknown_edge: Schema.encodeUnknownSync(UnknownEdge),
  busy_peer: Schema.encodeUnknownSync(BusyPeer),
  wrong_role: Schema.encodeUnknownSync(WrongRole),
  prompt_stalled: Schema.encodeUnknownSync(PromptStalled),
  parse_failed: Schema.encodeUnknownSync(ParseFailed),
  confirmation_error: Schema.encodeUnknownSync(ConfirmationError),
} as const;

export function encodeError(error: HerdrMcpError): Record<string, unknown> {
  const tag = error._tag as keyof typeof encoders;
  return encoders[tag](error) as Record<string, unknown>;
}
