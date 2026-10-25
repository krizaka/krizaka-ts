/**
 * `@krizaka/organize/contract` (ADR-003 §6): what the web, the phone (Expo) and macOS (Tauri) share with the server. Browser-safe:
 * no Node import, no SQL. The types of the HTTP shapes, the refusal codes, the marker palette, the status and view rules.
 */
export * from "./config";
export * from "./errors";
export { isId, isRecord, parseTagsParam, TAG_COLORS, type TagColor, tagsHref, toggleTag } from "./rules";
export * from "./status-sets";
export * from "./views";
export { type Actor, type EntityState, type SavedView, STATUS_CHANGED_EVENT, type StatusMove, type StoredConfig, TAG_ORIGIN, type TagOrigin, type WorkspaceEvent, type WorkspaceTag } from "./workspace-port";
