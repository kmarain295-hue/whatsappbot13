/**
 * Lightweight element-inspection descriptor.
 *
 * Formerly exported from `~/components/workbench/Inspector` — moved here so
 * the chat UI can reference the type without depending on the (now removed)
 * workbench component tree. The workbench / inspector UI has been removed
 * from this prototype; `selectedElement` in the chat stays `null` in
 * practice, but the type is retained so the chat components compile.
 */
export interface ElementInfo {
  displayText: string;
  tagName: string;
  className: string;
  id: string;
  textContent: string;
  styles: Record<string, string>;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    left: number;
  };
}
