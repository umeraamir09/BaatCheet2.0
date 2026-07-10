/**
 * Emoji spritesheet URL configuration for emoji-mart.
 *
 * The @emoji-mart/react Picker component uses CSS sprite sheets to render
 * emojis as images. This module provides the URL for the Apple emoji set
 * sprite sheet hosted on jsdelivr CDN.
 *
 * The sprite sheet contains all emojis in a grid layout, and the Picker
 * component uses CSS background-position to display individual emojis.
 */

import appleSpritesheet from "emoji-datasource-apple/img/apple/sheets-256/64.png";

/**
 * Returns the bundled URL for the Apple emoji spritesheet.
 * Called by emoji-mart Picker component with the emoji set name.
 *
 * Vite bundles this local package asset so it does not rely on a CDN at runtime.
 *
 * @param set - The emoji set name (e.g., "apple", "google", "twitter")
 * @returns The bundled URL for the spritesheet image
 */
export function getAppleSpritesheetURL(): string {
  return appleSpritesheet;
}
