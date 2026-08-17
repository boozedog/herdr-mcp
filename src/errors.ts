import { Schema } from "effect";

/** Returned when the MCP server is not running inside a Herdr pane. */
export class NotInHerdr extends Schema.TaggedError<NotInHerdr>()("not_in_herdr", {
  message: Schema.String,
}) {}

export const NOT_IN_HERDR_MESSAGE =
  "Not running inside Herdr. Start this MCP server from a Herdr pane with HERDR_ENV=1.";

export function notInHerdrError(): NotInHerdr {
  return new NotInHerdr({ message: NOT_IN_HERDR_MESSAGE });
}
