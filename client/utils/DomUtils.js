/**
 * Destroy a Phaser DOM Game Object and make sure its underlying DOM node is
 * actually removed. Phaser's destroy() can leave the node attached, which lets
 * stale inputs float above a later scene and swallow pointer events.
 */
export function destroyDomObject(dom) {
  if (!dom) return;

  const node = dom.node;
  try { dom.destroy(); } catch (err) { /* best-effort cleanup */ }
  try { node?.remove?.(); } catch (err) { /* ignore */ }
  if (node?.parentNode) node.parentNode.removeChild(node);
}
