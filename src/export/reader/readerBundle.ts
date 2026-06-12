/**
 * VMark Reader Assets
 *
 * Provides inline CSS and JS for the interactive reader in exported HTML.
 */

// Import raw CSS and JS as strings
import readerCSS from "./vmark-reader.css?raw";
import readerJS from "./vmark-reader.js?raw";

/**
 * Get the reader CSS for embedding in exported HTML.
 */
export function getReaderCSS(): string {
  return readerCSS;
}

/**
 * Get the reader JavaScript for embedding in exported HTML.
 */
export function getReaderJS(): string {
  return readerJS;
}
