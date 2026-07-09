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

/**
 * Returns the URL for the Apple emoji spritesheet.
 * Called by emoji-mart Picker component with the emoji set name.
 *
 * The sprite sheet is self-hosted in the public directory to avoid
 * CDN blocking by WebView2's tracking prevention.
 *
 * @param set - The emoji set name (e.g., "apple", "google", "twitter")
 * @returns The local URL for the spritesheet image
 */
export function getAppleSpritesheetURL(): string {
  // Self-hosted sprite sheet in public directory
  // This avoids CDN blocking by WebView2's tracking prevention
  return `/apple-emoji-64.png`;
}
