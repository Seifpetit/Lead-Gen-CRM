declare const userIdBrand: unique symbol;

/**
 * The ID of an authenticated user. Every query on a user-owned table requires one, and a
 * plain string does not type-check as a UserId, so a query cannot be written without it.
 * Values come from users.ts (create/find) or, from pass 2 on, the auth middleware.
 */
export type UserId = string & { readonly [userIdBrand]: true };

/** Only for code that has just verified the ID belongs to a real, authenticated user. */
export function trustedUserId(id: string): UserId {
  return id as UserId;
}
