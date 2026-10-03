// Shared result shape for server actions used with useActionState / direct calls from client components.
export type ActionState = {
  ok: boolean;
  error?: string;
  message?: string;
  /** Field-level messages keyed by input name. */
  fields?: Record<string, string>;
};

export const IDLE: ActionState = { ok: false };
